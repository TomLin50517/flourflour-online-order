import { PhotonImage } from "@cf-wasm/photon/node";
import { describe, expect, it } from "vitest";
import { detectImageType, reencodeToWebp } from "@/lib/image-processing";

function makeSolidPixels(width: number, height: number, r: number, g: number, b: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = 255;
  }
  return pixels;
}

function makeImage(format: "jpeg" | "png" | "webp", width = 100, height = 100): Buffer {
  const image = new PhotonImage(makeSolidPixels(width, height, 200, 100, 50), width, height);
  const bytes =
    format === "jpeg" ? image.get_bytes_jpeg(90) : format === "png" ? image.get_bytes() : image.get_bytes_webp();
  image.free();
  return Buffer.from(bytes);
}

/**
 * 手動組出一段最小可用的 JPEG APP1/Exif 段（TIFF 小端序，含 Orientation 與 Copyright
 * 兩個 IFD entry），插到 SOI 之後，模擬相機拍照後夾帶方向與版權資訊的真實檔案結構。
 * 用來驗證 image-processing.ts 自己手刻的 EXIF orientation 解析（見該檔案註解：
 * photon 沒有內建 EXIF 解析，改自己讀 orientation tag）。
 */
function injectExifOrientation(jpeg: Buffer, orientation: number, copyright?: string): Buffer {
  const copyrightBytes = copyright ? Buffer.from(`${copyright}\0`, "ascii") : null;
  const ifdStart = 8; // TIFF header 固定 8 bytes（II + magic 42 + 第一個 IFD offset）
  const entryCount = copyrightBytes ? 2 : 1;
  const ifdSize = 2 + entryCount * 12 + 4;
  const stringDataOffset = ifdStart + ifdSize;

  const tiff = Buffer.alloc(stringDataOffset + (copyrightBytes?.length ?? 0));
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(ifdStart, 4);
  tiff.writeUInt16LE(entryCount, ifdStart);

  let entryOffset = ifdStart + 2;
  // Orientation tag: 0x0112, type=3 (SHORT), count=1, value 放在 value 欄位前 2 bytes。
  tiff.writeUInt16LE(0x0112, entryOffset);
  tiff.writeUInt16LE(3, entryOffset + 2);
  tiff.writeUInt32LE(1, entryOffset + 4);
  tiff.writeUInt16LE(orientation, entryOffset + 8);
  entryOffset += 12;

  if (copyrightBytes) {
    // Copyright tag: 0x8298, type=2 (ASCII), count=字串長度含結尾 \0，offset 指向 string data。
    tiff.writeUInt16LE(0x8298, entryOffset);
    tiff.writeUInt16LE(2, entryOffset + 2);
    tiff.writeUInt32LE(copyrightBytes.length, entryOffset + 4);
    tiff.writeUInt32LE(stringDataOffset, entryOffset + 8);
    copyrightBytes.copy(tiff, stringDataOffset);
    entryOffset += 12;
  }
  tiff.writeUInt32LE(0, entryOffset); // 下一個 IFD offset：無

  const exifHeader = Buffer.from("Exif\0\0", "ascii");
  const app1Payload = Buffer.concat([exifHeader, tiff]);
  const app1Segment = Buffer.concat([
    Buffer.from([0xff, 0xe1]),
    Buffer.from([(app1Payload.length + 2) >> 8, (app1Payload.length + 2) & 0xff]),
    app1Payload,
  ]);

  // JPEG 前 2 bytes 是 SOI（FF D8），APP1 段插在它後面、其餘資料之前。
  return Buffer.concat([jpeg.subarray(0, 2), app1Segment, jpeg.subarray(2)]);
}

describe("detectImageType", () => {
  it("recognizes real jpeg/png/webp magic bytes", () => {
    expect(detectImageType(makeImage("jpeg"))).toBe("image/jpeg");
    expect(detectImageType(makeImage("png"))).toBe("image/png");
    expect(detectImageType(makeImage("webp"))).toBe("image/webp");
  });

  it("rejects a file whose extension lies about its content", () => {
    // 見 CLAUDE.md 陷阱 #7：一個「.jpg」檔名但內容其實是純文字，必須被判定為無效。
    const fakeJpeg = Buffer.from("this is not an image, just plain text pretending to be one");
    expect(detectImageType(fakeJpeg)).toBeNull();
  });

  it("rejects empty or truncated buffers", () => {
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull(); // JPEG 簽章只有前兩碼
  });
});

describe("reencodeToWebp", () => {
  it("outputs a valid webp within the max-edge constraint", async () => {
    const input = makeImage("png", 2000, 1000);
    const result = await reencodeToWebp(input);

    expect(detectImageType(result.buffer)).toBe("image/webp");
    expect(result.width).toBeLessThanOrEqual(1200);
    expect(result.height).toBeLessThanOrEqual(1200);
    // 2000x1000 依比例縮到最長邊 1200 → 寬 1200、高 600
    expect(result.width).toBe(1200);
    expect(result.height).toBe(600);
  });

  it("does not upscale images smaller than the max edge", async () => {
    const input = makeImage("jpeg", 300, 200);
    const result = await reencodeToWebp(input);
    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
  });

  it("corrects EXIF orientation (rotates 90° CW for orientation=6)", async () => {
    const landscape = makeImage("jpeg", 300, 200);
    const tagged = injectExifOrientation(landscape, 6);

    const result = await reencodeToWebp(tagged);
    // orientation=6 校正後應變成直向（寬高互換）。
    expect(result.width).toBe(200);
    expect(result.height).toBe(300);
  });

  it("leaves image untouched for orientation=1 (normal)", async () => {
    const landscape = makeImage("jpeg", 300, 200);
    const tagged = injectExifOrientation(landscape, 1);

    const result = await reencodeToWebp(tagged);
    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
  });

  it("strips EXIF metadata", async () => {
    const base = makeImage("jpeg", 400, 300);
    const withExif = injectExifOrientation(base, 1, "should not survive re-encoding");

    const result = await reencodeToWebp(withExif);
    expect(result.buffer.includes("should not survive re-encoding")).toBe(false);
    expect(result.buffer.includes("Exif")).toBe(false);
  });
});
