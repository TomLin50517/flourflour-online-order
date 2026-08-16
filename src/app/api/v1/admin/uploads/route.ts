import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import { ValidationError, toErrorResponse } from "@/lib/errors";
import { detectImageType, reencodeToWebp } from "@/lib/image-processing";
import { s3Client, STORAGE_BUCKET, STORAGE_PUBLIC_BASE_URL } from "@/lib/storage";
import { requireAdmin } from "@/server/admin/guard";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * 見 docs/OPEN-QUESTIONS.md：此端點取代了原本 SPEC.md §8.3 描述的
 * presigned-PUT 上傳流程（`POST /admin/uploads/presign`）。presigned URL
 * 讓檔案直接從瀏覽器傳到 S3，伺服器完全看不到檔案內容，無法驗證 magic
 * bytes、也無法重新編碼成 webp（§12.1／§12.2 的硬性要求）——兩者互斥，
 * 故改為檔案先經過本伺服器：驗證內容、轉檔、再由伺服器寫入物件儲存。
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new ValidationError("缺少上傳檔案");
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ValidationError("圖片大小不可超過 5MB");
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // 見 CLAUDE.md 陷阱 #7：檢查實際檔案內容，不信任副檔名／Content-Type。
    const detectedType = detectImageType(buffer);
    if (!detectedType) {
      throw new ValidationError("檔案內容不是有效的 jpeg/png/webp 圖片");
    }

    const { buffer: webpBuffer, width, height } = await reencodeToWebp(buffer);

    const objectKey = `products/${randomUUID()}.webp`;
    await s3Client.send(
      new PutObjectCommand({
        Bucket: STORAGE_BUCKET,
        Key: objectKey,
        Body: webpBuffer,
        ContentType: "image/webp",
      }),
    );

    return NextResponse.json({
      url: `${STORAGE_PUBLIC_BASE_URL}/${objectKey}`,
      width,
      height,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
