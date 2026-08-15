import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { s3Client, STORAGE_BUCKET, STORAGE_PUBLIC_BASE_URL } from "@/lib/storage";
import { uploadPresignSchema } from "@/schemas/admin";
import { requireAdmin } from "@/server/admin/guard";

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const { contentType } = uploadPresignSchema.parse(await request.json());

    const objectKey = `products/${randomUUID()}.${EXTENSION_BY_TYPE[contentType]}`;

    // 注意：PUT 型 presigned URL 無法強制檔案大小上限，5MB 限制由前端上傳前檢查
    // （見 admin 商品圖片上傳表單），本端點僅做 content-type 限制與短期有效簽章。
    const uploadUrl = await getSignedUrl(
      s3Client,
      new PutObjectCommand({
        Bucket: STORAGE_BUCKET,
        Key: objectKey,
        ContentType: contentType,
      }),
      { expiresIn: 300 },
    );

    return NextResponse.json({
      uploadUrl,
      publicUrl: `${STORAGE_PUBLIC_BASE_URL}/${objectKey}`,
      objectKey,
      maxBytes: MAX_UPLOAD_BYTES,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
