import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { detectImageType, reencodeToWebp } from "@/lib/image-processing";

async function makeImage(format: "jpeg" | "png" | "webp", width = 100, height = 100): Promise<Buffer> {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 100, b: 50 } },
  });
  if (format === "jpeg") return image.jpeg().toBuffer();
  if (format === "png") return image.png().toBuffer();
  return image.webp().toBuffer();
}

describe("detectImageType", () => {
  it("recognizes real jpeg/png/webp magic bytes", async () => {
    expect(detectImageType(await makeImage("jpeg"))).toBe("image/jpeg");
    expect(detectImageType(await makeImage("png"))).toBe("image/png");
    expect(detectImageType(await makeImage("webp"))).toBe("image/webp");
  });

  it("rejects a file whose extension lies about its content", async () => {
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
    const input = await makeImage("png", 2000, 1000);
    const result = await reencodeToWebp(input);

    expect(detectImageType(result.buffer)).toBe("image/webp");
    expect(result.width).toBeLessThanOrEqual(1200);
    expect(result.height).toBeLessThanOrEqual(1200);
    // 2000x1000 依比例縮到最長邊 1200 → 寬 1200、高 600
    expect(result.width).toBe(1200);
    expect(result.height).toBe(600);
  });

  it("does not upscale images smaller than the max edge", async () => {
    const input = await makeImage("jpeg", 300, 200);
    const result = await reencodeToWebp(input);
    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
  });

  it("strips EXIF metadata", async () => {
    const withExif = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .withExif({ IFD0: { Copyright: "should not survive re-encoding" } })
      .jpeg()
      .toBuffer();

    const result = await reencodeToWebp(withExif);
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.exif).toBeUndefined();
  });
});
