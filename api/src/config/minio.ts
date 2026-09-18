import { Client } from "minio";
import { env } from "./env.js";

export const minioClient = new Client({
  endPoint: env.MINIO_ENDPOINT,
  port: env.MINIO_PORT,
  useSSL: env.MINIO_USE_SSL,
  accessKey: env.MINIO_ACCESS_KEY,
  secretKey: env.MINIO_SECRET_KEY,
});

export async function ensureBucket(bucketName: string): Promise<void> {
  const exists = await minioClient.bucketExists(bucketName).catch(() => false);

  if (!exists) {
    await minioClient.makeBucket(bucketName);
    console.log(`[minio] Bucket "${bucketName}" created`);
  } else {
    console.log(`[minio] Bucket "${bucketName}" ready`);
  }
}
