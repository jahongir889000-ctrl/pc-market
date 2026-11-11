import { randomUUID } from 'crypto';
import { Files } from 'files-sdk';
import { neon } from 'files-sdk/neon';

/**
 * Neon Object Storage (private bucket "assets", declared in neon.ts).
 * Endpoint, region and credentials come from the AWS_* env vars that
 * `neon deploy` / `neon env pull` write into .env.
 *
 * The database stores an app path (`/api/files/<key>`), never the bytes.
 * /api/files/<key> answers with a short-lived presigned URL on each read.
 */
export const STORAGE_BUCKET = 'assets';
export const FILES_ROUTE_PREFIX = '/api/files/';

const globalForFiles = globalThis as unknown as { neonFiles: Files | undefined };

// Vercel reserves AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION for its own runtime,
// so on Vercel the Neon storage credentials are provided as NEON_STORAGE_*.
// Locally the AWS_* names written by `neon env pull` keep working.
const env = process.env;
const storageConfig = {
  bucket: STORAGE_BUCKET,
  endpoint: env.NEON_STORAGE_ENDPOINT || env.AWS_ENDPOINT_URL_S3,
  region: env.NEON_STORAGE_REGION || env.AWS_REGION,
  accessKeyId: env.NEON_STORAGE_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.NEON_STORAGE_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY,
};

export const files: Files =
  globalForFiles.neonFiles ?? new Files({ adapter: neon(storageConfig) });

if (process.env.NODE_ENV !== 'production') globalForFiles.neonFiles = files;

/** Build an unguessable object key such as `receipts/<uuid>/<safe-name>`. */
export function makeObjectKey(folder: string, originalName: string): string {
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'file';
  return `${folder}/${randomUUID()}/${safeName}`;
}

export function keyToAppUrl(key: string): string {
  return FILES_ROUTE_PREFIX + key.split('/').map(encodeURIComponent).join('/');
}

/** Turn an app URL saved in the DB back into the bucket key (null for non-bucket URLs). */
export function appUrlToKey(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(FILES_ROUTE_PREFIX)) return null;
  return url.slice(FILES_ROUTE_PREFIX.length).split('/').map(decodeURIComponent).join('/');
}

export async function uploadObject(key: string, body: Buffer | Uint8Array, contentType: string) {
  return files.upload(key, body, { contentType });
}

export async function downloadObject(key: string): Promise<{ bytes: Buffer; contentType: string }> {
  const file = await files.download(key);
  return { bytes: Buffer.from(await file.arrayBuffer()), contentType: file.type || 'application/octet-stream' };
}

export async function presignedUrl(key: string, expiresIn = 600): Promise<string> {
  return files.url(key, { expiresIn });
}
