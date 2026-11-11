import { NextResponse } from 'next/server';
import { keyToAppUrl, makeObjectKey, uploadObject } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate mime type: images and pdf
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Неподдерживаемый формат. Загрузите картинку (JPG, PNG, WEBP) или PDF файл.' },
        { status: 400 }
      );
    }

    // Limit size to 15MB
    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: 'Размер файла не должен превышать 15 МБ' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Save to Neon Object Storage (bucket "assets", folder receipts/)
    const key = makeObjectKey('receipts', file.name);
    await uploadObject(key, buffer, file.type);
    const fileUrl = keyToAppUrl(key);

    return NextResponse.json({
      success: true,
      fileUrl,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    });
  } catch (error: any) {
    console.error('File upload error:', error);
    return NextResponse.json({ error: error.message || 'Failed to upload file' }, { status: 500 });
  }
}
