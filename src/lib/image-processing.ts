import sharp from "sharp";

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
const WEBP_QUALITY = 82;

/**
 * 見 SPEC.md §12.1「圖片重新編碼為 webp 去除 EXIF」、§12.2「原圖上傳後轉 webp，最大邊 1200px」。
 * `.rotate()` 不帶參數會先依 EXIF 方向校正畫面，sharp 預設輸出就不含中繼資料
 * （不呼叫 `.withMetadata()` 即不保留 EXIF），故校正後直接等同去除 EXIF。
 */
export async function reencodeToWebp(
  buffer: Buffer,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer({ resolveWithObject: true });

  return { buffer: data, width: info.width, height: info.height };
}
