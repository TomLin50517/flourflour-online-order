import type { PhotonImage as PhotonImageType } from "@cf-wasm/photon";

// 見 docs/OPEN-QUESTIONS.md：@cf-wasm/photon 的 /workerd 進入點在 Next.js
// 的 bundler（Turbopack／webpack）下建置期一律失敗（wasm-bindgen 產生的
// `import x from "*.wasm"` 寫法，兩種 bundler 都無法解析），無法在
// Cloudflare Workers 上使用。正式站改走 Cloudflare 原生的 Images binding
// （`env.IMAGES`，見 wrangler.jsonc）——不經過任何 npm 套件或 wasm 打包，
// 完全繞開這個問題。本機 Node.js 開發／測試沒有這個 binding，維持用
// @cf-wasm/photon 的 /node 進入點（執行期動態編譯 wasm，Node.js 環境本來
// 就沒問題）。
//
// 重要：`/node` 進入點的原始碼在「模組頂層」（import 當下，不是呼叫函式時）
// 就執行 `new WebAssembly.Module(...)`（見該檔案 `dist/node.js` 原始碼），
// 所以就算只在判斷「不是 Cloudflare Workers」時才呼叫用到它的函式，只要這行
// import 出現在檔案最上層、且這支檔案在 Workers 上被載入，Worker 啟動載入
// 這個模組的當下就會直接拋 CompileError（實測重現）。必須改成動態
// `import()`，包在只有本機路徑會執行到的函式裡，讓 bundler 把它拆成獨立、
// 真正延遲載入的 chunk，Cloudflare Workers 執行期才不會被迫載入它。
function isCloudflareWorkersRuntime(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

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

function rotateImage(photon: PhotonModule, image: PhotonImageType, quarterTurnsCw: 1 | 2 | 3): PhotonImageType {
  let pixels = image.get_raw_pixels();
  let width = image.get_width();
  let height = image.get_height();
  for (let i = 0; i < quarterTurnsCw; i++) {
    const step = rotate90Cw(pixels, width, height);
    pixels = step.pixels;
    width = step.width;
    height = step.height;
  }
  return new photon.PhotonImage(pixels, width, height);
}

/**
 * 依 EXIF Orientation 值校正畫面方向，回傳校正後的 PhotonImage（可能是新實例）。
 * 對照表（與 libvips/sharp `.rotate()` 相同的標準定義）：
 * 2=水平翻轉 3=180° 4=垂直翻轉 5=順轉90°+水平翻轉 6=順轉90° 7=順轉270°+水平翻轉 8=順轉270°。
 */
function applyExifOrientation(photon: PhotonModule, image: PhotonImageType, orientation: number): PhotonImageType {
  switch (orientation) {
    case 2:
      photon.fliph(image);
      return image;
    case 3: {
      const out = rotateImage(photon, image, 2);
      image.free();
      return out;
    }
    case 4:
      photon.flipv(image);
      return image;
    case 5: {
      const out = rotateImage(photon, image, 1);
      photon.fliph(out);
      image.free();
      return out;
    }
    case 6: {
      const out = rotateImage(photon, image, 1);
      image.free();
      return out;
    }
    case 7: {
      const out = rotateImage(photon, image, 3);
      photon.fliph(out);
      image.free();
      return out;
    }
    case 8: {
      const out = rotateImage(photon, image, 3);
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
 * 本機 Node.js 開發／測試用的路徑，@cf-wasm/photon 的 `get_bytes_webp()` 只支援無損 webp，
 * 沒有像 sharp 那樣的有損品質參數，輸出檔案會比先前的 quality:82 版本大，這是已知取捨。
 * 重新編碼本身（從像素資料重建 webp）就不會保留原始 EXIF，故不需要另外呼叫去除metadata 的步驟。
 */
type PhotonModule = typeof import("@cf-wasm/photon/node");

async function reencodeToWebpViaPhoton(
  buffer: Buffer,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const photon = await import("@cf-wasm/photon/node");

  const detectedType = detectImageType(buffer);
  const orientation = detectedType === "image/jpeg" ? readJpegExifOrientation(buffer) : 1;

  const decoded = photon.PhotonImage.new_from_byteslice(new Uint8Array(buffer));
  const oriented = applyExifOrientation(photon, decoded, orientation);

  const target = computeFitDimensions(oriented.get_width(), oriented.get_height(), MAX_EDGE_PX);
  const resized = photon.resize(oriented, target.width, target.height, photon.SamplingFilter.Lanczos3);
  oriented.free();

  const result = {
    buffer: Buffer.from(resized.get_bytes_webp()),
    width: resized.get_width(),
    height: resized.get_height(),
  };
  resized.free();

  return result;
}

// 見 CLAUDE.md「不得已時用 unknown + type guard，並註明理由」：`cloudflare-env.d.ts`
// 是用 `wrangler types --include-runtime=false` 產生（見 next.config.ts 的說明，
// 刻意不含完整 Workers runtime 全域型別，避免跟 Node.js 的 Buffer／fetch 等全域型別
// 衝突），故 `ImagesBinding` 只是個沒有實際定義、被 tsconfig 的 skipLibCheck 放行的
// 型別佔位符。這裡改成在本檔案內自行宣告用得到的最小介面，語意依 Cloudflare 官方
// Images binding 文件（`env.IMAGES.input().transform().output()`），並在存取
// `getCloudflareContext().env.IMAGES` 時明確轉型進來，取代隱性的 any。
interface ImageTransformer {
  transform(transform: {
    width?: number;
    height?: number;
    fit?: "scale-down" | "contain" | "pad" | "squeeze" | "cover" | "crop";
    rotate?: 0 | 90 | 180 | 270;
    flip?: "h" | "v" | "hv";
  }): ImageTransformer;
  output(options: { format: "image/webp" }): Promise<{ image(): ReadableStream<Uint8Array> }>;
}
interface ImagesBindingShape {
  input(stream: ReadableStream<Uint8Array>): ImageTransformer;
  info(
    stream: ReadableStream<Uint8Array>,
  ): Promise<{ format: "image/svg+xml" } | { format: string; fileSize: number; width: number; height: number }>;
}

/**
 * 依 EXIF Orientation 值，把對應的 rotate／flip 轉換依序疊加到 Cloudflare Images
 * binding 的 transform pipeline 上。對照表與 applyExifOrientation()（photon 版）
 * 完全一致：2=水平翻轉 3=180° 4=垂直翻轉 5=順轉90°+水平翻轉 6=順轉90°
 * 7=順轉270°+水平翻轉 8=順轉270°。
 */
function applyExifOrientationTransform(transformer: ImageTransformer, orientation: number): ImageTransformer {
  switch (orientation) {
    case 2:
      return transformer.transform({ flip: "h" });
    case 3:
      return transformer.transform({ rotate: 180 });
    case 4:
      return transformer.transform({ flip: "v" });
    case 5:
      return transformer.transform({ rotate: 90 }).transform({ flip: "h" });
    case 6:
      return transformer.transform({ rotate: 90 });
    case 7:
      return transformer.transform({ rotate: 270 }).transform({ flip: "h" });
    case 8:
      return transformer.transform({ rotate: 270 });
    default:
      return transformer;
  }
}

/**
 * 見 SPEC.md §12.1「圖片重新編碼為 webp 去除 EXIF」、§12.2「原圖上傳後轉 webp，最大邊 1200px」。
 * 正式站（Cloudflare Workers）用的路徑，走原生 Images binding，不經過任何 npm wasm 套件。
 * `fit: "scale-down"` 對應 SPEC 的「最長邊 1200px、不放大」語意：給定的 width/height
 * 是縮放框的上限，長寬比不變，只會縮小不會放大。
 */
async function reencodeToWebpViaImagesBinding(
  buffer: Buffer,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const { env } = getCloudflareContext();
  const images = env.IMAGES as unknown as ImagesBindingShape;

  const detectedType = detectImageType(buffer);
  const orientation = detectedType === "image/jpeg" ? readJpegExifOrientation(buffer) : 1;

  let transformer = images.input(new Blob([new Uint8Array(buffer)]).stream());
  transformer = applyExifOrientationTransform(transformer, orientation);
  transformer = transformer.transform({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "scale-down" });

  const result = await transformer.output({ format: "image/webp" });
  const webpBuffer = Buffer.from(await new Response(result.image()).arrayBuffer());

  const info = await images.info(new Blob([new Uint8Array(webpBuffer)]).stream());
  if (!("width" in info)) {
    throw new Error("Cloudflare Images binding 未回傳轉檔後圖片的尺寸");
  }

  return { buffer: webpBuffer, width: info.width, height: info.height };
}

export async function reencodeToWebp(
  buffer: Buffer,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  return isCloudflareWorkersRuntime() ? reencodeToWebpViaImagesBinding(buffer) : reencodeToWebpViaPhoton(buffer);
}
