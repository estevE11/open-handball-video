import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Read completed bytes before removing every intermediate, including on failures. */
export async function readTemporaryVideoExport(render: (outputPath: string) => Promise<unknown>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ohv-single-export-'));
  try {
    const outputPath = path.join(directory, 'export.mp4');
    await render(outputPath);
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
