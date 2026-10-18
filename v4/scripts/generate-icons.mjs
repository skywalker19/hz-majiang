import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Regeneration uses optional sharp; ordinary builds copy the included PNG files.
const require = createRequire(import.meta.url);
const sharp = require(process.env.MAHJONG_SHARP_MODULE || 'sharp');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(root, 'icons/mahjong.svg'));
await mkdir(resolve(root, 'icons'), { recursive: true });
await Promise.all([
  ['apple-touch-icon.png', 180],
  ['icons/favicon-32.png', 32],
  ['icons/icon-192.png', 192],
  ['icons/icon-512.png', 512],
].map(([file, size]) => sharp(source).resize(size, size)
  .flatten({ background: '#073d35' }).png({ compressionLevel: 9 }).toFile(resolve(root, file))));
console.log('Generated mahjong favicon and Home Screen PNG icons');
