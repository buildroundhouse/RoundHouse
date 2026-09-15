import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, PutBucketCorsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

// Separate namespace keeps historical Google Storage references unchanged.
export const NEON_OBJECT_PREFIX = "/objects/neon/";
export const neonStorageEnabled = () => Boolean(process.env.NEON_STORAGE_BUCKET);
let corsReady: Promise<void> | undefined;

function storage() {
  const bucket = process.env.NEON_STORAGE_BUCKET;
  const endpoint = process.env.NEON_STORAGE_ENDPOINT;
  const accessKeyId = process.env.NEON_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.NEON_STORAGE_SECRET_ACCESS_KEY;
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("Neon storage is not configured");
  }
  return {
    bucket,
    client: new S3Client({
      endpoint, region: process.env.NEON_STORAGE_REGION || "us-east-2",
      forcePathStyle: true, credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    }),
  };
}

export function neonObjectKey(path: string): string {
  const id = path.slice(NEON_OBJECT_PREFIX.length);
  if (!path.startsWith(NEON_OBJECT_PREFIX) || !/^[a-f0-9-]{36}$/.test(id)) {
    throw new Error("Invalid Neon object path");
  }
  return `uploads/${id}`;
}

export async function createNeonUpload(contentType?: string, size?: number) {
  const { client, bucket } = storage();
  const origins = (process.env.NEON_STORAGE_ALLOWED_ORIGINS || "").split(",").map(v => v.trim()).filter(Boolean);
  if (!origins.length || origins.some(v => new URL(v).origin !== v)) {
    throw new Error("Configure exact browser origins for Neon storage");
  }
  corsReady ??= client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: {
    CORSRules: [{ AllowedOrigins: origins, AllowedMethods: ["PUT"], AllowedHeaders: ["content-type", "x-amz-*"], ExposeHeaders: ["ETag"], MaxAgeSeconds: 300 }],
  } })).then(() => undefined).catch(error => { corsReady = undefined; throw error; });
  await corsReady;
  const objectPath = `${NEON_OBJECT_PREFIX}${randomUUID()}`;
  const uploadURL = await getSignedUrl(client, new PutObjectCommand({
    Bucket: bucket, Key: neonObjectKey(objectPath), ContentType: contentType, ContentLength: size,
  }), { expiresIn: 900 });
  return { uploadURL, objectPath };
}

export async function downloadNeonObject(path: string): Promise<Response> {
  const { client, bucket } = storage();
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: neonObjectKey(path) }));
  const headers = new Headers({
    "Content-Type": result.ContentType || "application/octet-stream",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    // Uploaded HTML/SVG must never execute on the application's origin.
    "Content-Security-Policy": "sandbox; default-src 'none'",
  });
  if (result.ContentLength != null) headers.set("Content-Length", String(result.ContentLength));
  return new Response(result.Body?.transformToWebStream() ?? null, { headers });
}

export async function deleteNeonObject(path: string): Promise<void> {
  const { client, bucket } = storage();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: neonObjectKey(path) }));
}
