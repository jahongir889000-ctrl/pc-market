// One-off: copy data from the old SQLite file (prisma/dev.db) into Neon Postgres,
// and move receipt files from public/uploads into the Neon Object Storage bucket.
// Run: node --env-file=.env scripts/migrate-sqlite-to-neon.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Files } from 'files-sdk';
import { neon } from 'files-sdk/neon';

const sqlite = new DatabaseSync(path.join('prisma', 'dev.db'), { readOnly: true });
const prisma = new PrismaClient();
const files = new Files({ adapter: neon({ bucket: 'assets' }) });

const BOOL = new Set(['inStock', 'active', 'isCustomPc', 'telegramReceiptSent']);
const DATE = new Set(['createdAt', 'updatedAt']);
const fix = (row) => {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (BOOL.has(k)) out[k] = Boolean(v);
    else if (DATE.has(k)) out[k] = new Date(Number(v));
    else out[k] = v;
  }
  return out;
};
const rows = (table) => sqlite.prepare(`SELECT * FROM "${table}"`).all().map(fix);

const existing = await prisma.product.count();
if (existing > 0) {
  console.log(`Neon already has ${existing} products — nothing to do.`);
  process.exit(0);
}

const categories = rows('Category');
const products = rows('Product');
const games = rows('Game');
const orders = rows('Order');

// Receipts: upload legacy local files to the bucket and rewrite the URL
for (const order of orders) {
  const url = order.paymentReceiptUrl;
  if (!url || !url.startsWith('/uploads/')) continue;
  const local = path.join('public', url);
  if (!existsSync(local)) {
    console.warn(`Missing local receipt for ${order.orderNumber}: ${local}`);
    continue;
  }
  const name = path.basename(local).replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `receipts/${randomUUID()}/${name}`;
  const ext = name.split('.').pop().toLowerCase();
  const contentType = ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
  await files.upload(key, await readFile(local), { contentType });
  order.paymentReceiptUrl = '/api/files/' + key.split('/').map(encodeURIComponent).join('/');
  console.log(`Uploaded receipt ${local} -> ${key}`);
}

await prisma.$transaction([
  prisma.category.createMany({ data: categories }),
  prisma.product.createMany({ data: products }),
  prisma.game.createMany({ data: games }),
  prisma.order.createMany({ data: orders }),
]);

console.log(
  `Copied: ${categories.length} categories, ${products.length} products, ${games.length} games, ${orders.length} orders`,
);
await prisma.$disconnect();
