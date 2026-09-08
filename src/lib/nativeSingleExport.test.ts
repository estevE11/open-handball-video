/// <reference types="node" />
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { nativeSingleExport } from '../../electron/nativeSingleExport';

const require = createRequire(import.meta.url);
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path as string;
const ffprobePath = require('@ffprobe-installer/ffprobe').path as string;
const run = promisify(execFile);

it.each([{ addGap: false, audio: false }, { addGap: true, audio: false }, { addGap: false, audio: true }, { addGap: true, audio: true }])('exports a native source with %j', async ({ addGap, audio }) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ohv-silent-test-'));
  try {
    const inputPath = path.join(directory, 'silent #100%.mp4');
    const outputPath = path.join(directory, 'out.mp4');
    await run(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=25', ...(audio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'] : []), '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', inputPath]);
    const progress: number[] = [];
    const bytes = await nativeSingleExport({ inputPath: pathToFileURL(inputPath).href, addGap, mainLabels: [{ id: 'attack', name: 'Attack' }], segments: [
      { name: '3:2:1', mainLabelId: 'attack', startTimeSec: 0.5, endTimeSec: 1.5 },
      { mainLabelId: 'attack', startTimeSec: 2, endTimeSec: 3 },
    ] }, { ffmpegPath, ffprobePath, fontPath: path.resolve('public/fonts/Roboto-Bold.ttf') }, (_, ratio) => progress.push(ratio));
    expect(progress.some((ratio) => ratio > 0.1 && ratio <= 0.98)).toBe(true);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(1);
    // The renderer returns bytes without creating extra files beside the original.
    expect(await fs.readdir(directory)).toEqual(['silent #100%.mp4']);
    await fs.writeFile(outputPath, bytes);
    const probe = JSON.parse((await run(ffprobePath, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', outputPath])).stdout);
    expect(Number(probe.format.duration)).toBeCloseTo(addGap ? 2.5 : 2, 1);
    expect(probe.streams.map((stream: { codec_type: string }) => stream.codec_type)).toEqual(['video', 'audio']);
    // Decode each clip and the optional black gap, verifying there are no missing parts.
    for (const [time, black] of [[0.5, false], [addGap ? 2 : 1.5, false], ...(addGap ? [[1.25, true]] : [])]) {
      const frame = await run(ffmpegPath, ['-v', 'error', '-ss', String(time), '-i', outputPath, '-frames:v', '1', '-vf', 'crop=2:2:200:180,format=rgb24', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer' });
      const [r, g, b] = frame.stdout;
      if (black) expect(r + g + b).toBeLessThan(30);
      else expect(b).toBeGreaterThan(150);
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}, 30_000);
