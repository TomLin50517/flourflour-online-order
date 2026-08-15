import { S3Client } from "@aws-sdk/client-s3";

export const s3Client = new S3Client({
  region: "us-east-1",
  endpoint: process.env.STORAGE_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY ?? "",
    secretAccessKey: process.env.STORAGE_SECRET_KEY ?? "",
  },
});

export const STORAGE_BUCKET = process.env.STORAGE_BUCKET ?? "";
export const STORAGE_PUBLIC_BASE_URL = process.env.STORAGE_PUBLIC_BASE_URL ?? "";
