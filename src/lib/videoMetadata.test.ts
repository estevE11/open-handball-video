/// <reference types="node" />
import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { probeNativeVideo } from '../../electron/videoMetadata';
const require = createRequire(import.meta.url);
it.each(['25', '60000/1001'])('detects native FPS %s from file URLs', async (rate) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ohv-probe-test-'));
  try {
    const source = path.join(folder, 'match #100%.mp4');
    await promisify(execFile)(require('@ffmpeg-installer/ffmpeg').path, ['-v', 'error', '-f', 'lavfi', '-i', `color=s=32x32:r=${rate}`, '-t', '1', '-c:v', 'libx264', source]);
    const meta = await probeNativeVideo(pathToFileURL(source).href, require('@ffprobe-installer/ffprobe').path);
    expect(meta.fps).toBeCloseTo(rate === '25' ? 25 : 60000 / 1001, 5);
    expect(meta.durationSec).toBeCloseTo(1, 1);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});
