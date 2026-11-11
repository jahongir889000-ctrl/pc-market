import { NextResponse } from 'next/server';
import { files, presignedUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

// Serves files from the private Neon bucket by redirecting to a short-lived presigned URL.
// Only the "receipts/" folder is exposed, and keys contain a random UUID.
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  const key = parts.map((p) => decodeURIComponent(p)).join('/');

  if (!key.startsWith('receipts/') || key.includes('..')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    if (!(await files.exists(key))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const url = await presignedUrl(key, 600);
    return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('File read error:', error);
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }
}
