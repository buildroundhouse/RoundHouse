import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

// Run from the deployment environment, where the real storage endpoint is
// reachable. Never log credentials or signed URLs, and touch only our probe.
export async function checkHostedStorage() {
  if (!process.env.NEON_STORAGE_BUCKET) return;
  const require = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url));
  const { S3Client, PutBucketCorsCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const bucket = process.env.NEON_STORAGE_BUCKET;
  const origins = (process.env.NEON_STORAGE_ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
  if (!origins.length || origins.some(v => new URL(v).origin !== v)) throw new Error('Storage requires exact browser origins');
  const client = new S3Client({ endpoint: process.env.NEON_STORAGE_ENDPOINT,
    region: process.env.NEON_STORAGE_REGION || 'us-east-2', forcePathStyle: true,
    credentials: { accessKeyId: process.env.NEON_STORAGE_ACCESS_KEY_ID, secretAccessKey: process.env.NEON_STORAGE_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const Key = `deployment-checks/${randomUUID()}`;
  const content = 'RoundHouse private storage deployment check';
  let created = false;
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  try {
    await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: [{
      AllowedOrigins: origins, AllowedMethods: ['PUT'], AllowedHeaders: ['content-type', 'x-amz-*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 300,
    }] } }));
    const putUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key, ContentType: 'text/plain', ContentLength: Buffer.byteLength(content) }), { expiresIn: 60 });
    const preflight = await fetch(putUrl, { method: 'OPTIONS', headers: {
      Origin: origins[0], 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type',
    }, signal: AbortSignal.timeout(15000) });
    assert(preflight.ok && preflight.headers.get('access-control-allow-origin') === origins[0], 'Storage browser preflight failed');
    const put = await fetch(putUrl, { method: 'PUT', headers: { 'Content-Type': 'text/plain', Origin: origins[0] }, body: content, signal: AbortSignal.timeout(15000) });
    assert(put.ok, `Storage upload failed (${put.status})`);
    created = true;
    const getUrl = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key }), { expiresIn: 60 });
    const get = await fetch(getUrl, { signal: AbortSignal.timeout(15000) });
    assert(get.ok && await get.text() === content, 'Storage download verification failed');
    const anonymous = new URL(getUrl); anonymous.search = '';
    const denied = await fetch(anonymous, { signal: AbortSignal.timeout(15000) });
    assert([401, 403, 404].includes(denied.status), 'Storage unexpectedly permits anonymous reads');
    console.log('Storage check passed: browser preflight, signed upload, matching download, private access.');
  } catch (error) {
    // SDK errors can contain signed URLs; expose a safe error name/status only.
    console.error('Storage check failed', { name: error.name, status: error.$metadata?.httpStatusCode });
    throw new Error('Hosted storage verification failed');
  } finally {
    if (created) await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
    client.destroy();
  }
}
