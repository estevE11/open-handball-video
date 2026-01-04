import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const srcDir = path.join(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'umd');
const outDir = path.join(root, 'public', 'ffmpeg');

const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  await Promise.all(
    files.map(async (f) => {
      const from = path.join(srcDir, f);
      const to = path.join(outDir, f);
      await fs.copyFile(from, to);
    }),
  );
  console.log(`[copy-ffmpeg-core] Copied ${files.join(', ')} -> public/ffmpeg/`);
}

main().catch((err) => {
  console.error('[copy-ffmpeg-core] Failed:', err);
  process.exit(1);
});


