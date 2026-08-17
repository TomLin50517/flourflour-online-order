import { PhotonImage, SamplingFilter, fliph, flipv, resize } from "@cf-wasm/photon/node";

// 見 docs/OPEN-QUESTIONS.md：正式站 /api/v1/admin/uploads 500（CompileError:
// Wasm code generation disallowed by embedder）——原因是這裡固定走 /node
// 進入點（執行期動態編譯 wasm，Cloudflare Workers 禁止）。已實測 /workerd
// 進入點（靜態 wasm binding，Workers 允許）在建置階段就會炸：Next.js 的
// Turbopack 與 webpack（含 asyncWebAssembly 實驗選項）在解析
// `dist/workerd.js` 的 `import wasmModule from "*.wasm"` 時都失敗，即使把
// @cf-wasm/photon 標成 serverExternalPackages 仍會在 tracing 階段炸——
// 這是 Next.js bundler 對這種 wasm-bindgen 產生的靜態 import 語法的已知
// 相容性落差（跟 Prisma 7 wasm query compiler 那次是同一類上游問題）。
// 暫時維持 /node（本機開發/測試不受影響），正式站的圖片上傳功能待進一步
// 處理（見 docs/OPEN-QUESTIONS.md 的完整記錄與待選方案）。

export type DetectedImageType = "image/jpeg" | "image/png" | "image/webp";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * 見 CLAUDE.md 陷阱 #7 / SPEC.md §12.1：只看副檔名或 Content-Type 不可信，
 * 必須檢查檔案實際的 magic bytes。回傳 null 代表不是支援的圖片格式。
 */
export function detectImageType(buffer: Buffer): DetectedImageType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

const MAX_EDGE_PX = 1200;

/**
 * 讀取 JPEG APP1 段內 TIFF/Exif 的 Orientation tag（0x0112）。找不到則視為 1（不需校正）。
 * 只處理 JPEG——PNG/WebP 上傳幾乎不帶方向 EXIF，且 photon 沒有內建的 EXIF 解析，
 * 這裡只實作 sharp `.rotate()` 真正用得到的那一小塊（讀 orientation tag），
 * 不做完整 EXIF 解析器。
 */
function readJpegExifOrientation(buffer: Buffer): number {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return 1;

  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];

    // SOI/EOI/RSTn 沒有長度欄位。
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // SOS 之後就是壓縮的影像資料，不會再有 metadata 段。
    if (marker === 0xda) break;

    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (marker === 0xe1) {
      const segmentStart = offset + 4;
      if (
        buffer.length >= segmentStart + 6 &&
        buffer.toString("ascii", segmentStart, segmentStart + 4) === "Exif" &&
        buffer[segmentStart + 4] === 0x00 &&
        buffer[segmentStart + 5] === 0x00
      ) {
        return readTiffOrientation(buffer, segmentStart + 6);
      }
    }
    offset += 2 + segmentLength;
  }
  return 1;
}

function readTiffOrientation(buffer: Buffer, tiffStart: number): number {
  if (tiffStart + 8 > buffer.length) return 1;

  const byteOrder = buffer.toString("ascii", tiffStart, tiffStart + 2);
  const little = byteOrder === "II";
  if (!little && byteOrder !== "MM") return 1;

  const readU16 = (o: number) => (little ? buffer.readUInt16LE(o) : buffer.readUInt16BE(o));
  const readU32 = (o: number) => (little ? buffer.readUInt32LE(o) : buffer.readUInt32BE(o));

  if (readU16(tiffStart + 2) !== 42) return 1;

  const ifdStart = tiffStart + readU32(tiffStart + 4);
  if (ifdStart + 2 > buffer.length) return 1;

  const entryCount = readU16(ifdStart);
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = ifdStart + 2 + i * 12;
    if (entryOffset + 12 > buffer.length) break;
    if (readU16(entryOffset) === 0x0112) {
      const value = readU16(entryOffset + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/**
 * 見 docs/OPEN-QUESTIONS.md：@cf-wasm/photon（實測版本）的 `rotate()` 有已知 bug——
 * 90 度旋轉後，非 0/255 的中間色版值會被錯誤地推到 255（實測重現：raw RGB (0,200,0)
 * 旋轉後變成 (0,255,0)，僅發生在呼叫 rotate() 之後，resize()／fliph()／flipv() 皆無此問題）。
 * 90/180/270 度旋轉本質上是精確的像素座標搬移、不需要任何插值，故直接操作
 * `get_raw_pixels()` 手動搬移，完全繞開 rotate() 這個 bug；已用另外的驗證腳本
 * 比對過 sharp 的 `.rotate()` 輸出，確認四個色塊的位置與色值都吻合。
 */
function rotate90Cw(pixels: Uint8Array, width: number, height: number): { pixels: Uint8Array; width: number; height: number } {
  const newWidth = height;
  const newHeight = width;
  const out = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstX = newWidth - 1 - y;
      const dstY = x;
      const dstIdx = (dstY * newWidth + dstX) * 4;
      out[dstIdx] = pixels[srcIdx];
      out[dstIdx + 1] = pixels[srcIdx + 1];
      out[dstIdx + 2] = pixels[srcIdx + 2];
      out[dstIdx + 3] = pixels[srcIdx + 3];
    }
  }
  return { pixels: out, width: newWidth, height: newHeight };
}

function rotateImage(image: PhotonImage, quarterTurnsCw: 1 | 2 | 3): PhotonImage {
  let pixels = image.get_raw_pixels();
  let width = image.get_width();
  let height = image.get_height();
  for (let i = 0; i < quarterTurnsCw; i++) {
    const step = rotate90Cw(pixels, width, height);
    pixels = step.pixels;
    width = step.width;
    height = step.height;
  }
  return new PhotonImage(pixels, width, height);
}

/**
 * 依 EXIF Orientation 值校正畫面方向，回傳校正後的 PhotonImage（可能是新實例）。
 * 對照表（與 libvips/sharp `.rotate()` 相同的標準定義）：
 * 2=水平翻轉 3=180° 4=垂直翻轉 5=順轉90°+水平翻轉 6=順轉90° 7=順轉270°+水平翻轉 8=順轉270°。
 */
function applyExifOrientation(image: PhotonImage, orientation: number): PhotonImage {
  switch (orientation) {
    case 2:
      fliph(image);
      return image;
    case 3: {
      const out = rotateImage(image, 2);
      image.free();
      return out;
    }
    case 4:
      flipv(image);
      return image;
    case 5: {
      const out = rotateImage(image, 1);
      fliph(out);
      image.free();
      return out;
    }
    case 6: {
      const out = rotateImage(image, 1);
      image.free();
      return out;
    }
    case 7: {
      const out = rotateImage(image, 3);
      fliph(out);
      image.free();
      return out;
    }
    case 8: {
      const out = rotateImage(image, 3);
      image.free();
      return out;
    }
    default:
      return image;
  }
}

function computeFitDimensions(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * 見 SPEC.md §12.1「圖片重新編碼為 webp 去除 EXIF」、§12.2「原圖上傳後轉 webp，最大邊 1200px」。
 * 見 docs/OPEN-QUESTIONS.md：改用 @cf-wasm/photon（Workers 相容的 WASM 函式庫）取代 sharp
 * （原生 binding，Workers runtime 不支援）。photon 的 `get_bytes_webp()` 只支援無損 webp，
 * 沒有像 sharp 那樣的有損品質參數，輸出檔案會比先前的 quality:82 版本大，這是已知取捨。
 * 重新編碼本身（從像素資料重建 webp）就不會保留原始 EXIF，故不需要另外呼叫去除metadata 的步驟。
 */
export async function reencodeToWebp(
  buffer: Buffer,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const detectedType = detectImageType(buffer);
  const orientation = detectedType === "image/jpeg" ? readJpegExifOrientation(buffer) : 1;

  const decoded = PhotonImage.new_from_byteslice(new Uint8Array(buffer));
  const oriented = applyExifOrientation(decoded, orientation);

  const target = computeFitDimensions(oriented.get_width(), oriented.get_height(), MAX_EDGE_PX);
  const resized = resize(oriented, target.width, target.height, SamplingFilter.Lanczos3);
  oriented.free();

  const result = {
    buffer: Buffer.from(resized.get_bytes_webp()),
    width: resized.get_width(),
    height: resized.get_height(),
  };
  resized.free();

  return result;
}
