/// <reference types="node" />
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
import { exportFilteredSegmentsToMp4 } from '@/lib/exportMp4';
import { exportClipSequence } from '@/lib/exportClipSequence';
import { fileMeta } from '@/lib/clipTimeline';

const adapter = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), readFile: vi.fn(), exec: vi.fn(), ffprobe: vi.fn() }));
vi.mock('@/lib/ffmpegSingleton', () => ({ getFFmpeg: async () => adapter }));
import { nativeClipExport } from '../../electron/nativeClipExport';

const require = createRequire(import.meta.url);
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path as string;
const ffprobePath = require('@ffprobe-installer/ffprobe').path as string;
const run = promisify(execFile);

it.each(['native', 'wasm'])('%s renders a tag across clips with mixed formats and audio, with gaps only between tags', async (mode) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ohv-test-'));
  try {
    const red = path.join(directory, 'red.mp4'); const blue = path.join(directory, 'blue.mp4');
    await run(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:r=25', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', red]);
    await run(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=60', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', blue]);
    let bytes: Uint8Array;
    const progress: number[] = [];
    if (mode === 'native') bytes = await nativeClipExport({ inputPaths: [red, blue], addGap: true, pieces: [
      { sourceIndex: 0, startTimeSec: 1, endTimeSec: 2, segmentIndex: 0, primaryText: '3:2:1', secondaryText: 'Attack' },
      { sourceIndex: 1, startTimeSec: 0, endTimeSec: 1, segmentIndex: 0, primaryText: '3:2:1', secondaryText: 'Attack' },
      { sourceIndex: 1, startTimeSec: 1, endTimeSec: 1.5, segmentIndex: 1, primaryText: 'Defense' },
    ] }, { ffmpegPath, ffprobePath, fontPath: path.resolve('public/fonts/Roboto-Bold.ttf') }, (_, ratio) => progress.push(ratio));
    else {
      vi.stubGlobal('self', { location: { href: 'http://localhost/ffmpeg-core.js' } });
      type Core = {
        FS: { writeFile: (name: string, data: Uint8Array) => void; readFile: (name: string) => Uint8Array; unlink: (name: string) => void; readdir: (name: string) => string[] };
        setProgress: (callback: (event: { time: number; progress: number }) => void) => void;
        setLogger: (callback: (entry: { message: string }) => void) => void;
        exec: (...args: string[]) => void; ffprobe: (...args: string[]) => void; ret: number; reset: () => void;
      };
      const core: Core = await require('@ffmpeg/core')({ wasmBinary: await fs.readFile(require.resolve('@ffmpeg/core/wasm')) });
      core.setLogger(() => {});
      const progressListeners = new Set<(event: { time: number; progress: number }) => void>();
      adapter.on.mockImplementation((_event, callback) => progressListeners.add(callback));
      adapter.off.mockImplementation((_event, callback) => progressListeners.delete(callback));
      core.setProgress((event) => progressListeners.forEach((callback) => callback(event)));
      adapter.writeFile.mockImplementation(async (name: string, data: Uint8Array) => core.FS.writeFile(name, data));
      adapter.readFile.mockImplementation(async (name: string) => core.FS.readFile(name));
      adapter.deleteFile.mockImplementation(async (name: string) => core.FS.unlink(name));
      adapter.exec.mockImplementation(async (args: string[]) => { core.exec('-stats_period', '0.01', ...args); const code = core.ret; core.reset(); return code; });
      adapter.ffprobe.mockImplementation(async (args: string[]) => { core.ffprobe(...args); const code = core.ret; core.reset(); return code; });
      vi.stubGlobal('window', { location: { href: 'http://localhost/' } });
      vi.stubGlobal('FileReader', class {
        result: ArrayBuffer | null = null;
        onload?: () => void;
        readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then((data) => { this.result = data; this.onload?.(); }); }
      });
      vi.stubGlobal('fetch', async () => new Response(new Uint8Array(await fs.readFile('public/fonts/Roboto-Bold.ttf'))));
      const files = await Promise.all([red, blue].map(async (name) => new File([new Uint8Array(await fs.readFile(name))], path.basename(name))));
      const clips = files.map((file, index) => ({ ...fileMeta(file), id: String(index), durationSec: 2 }));
      const blob = await exportClipSequence(clips, files, [
        { id: 'a', name: '3:2:1', mainLabelId: 'attack', startTimeSec: 1, endTimeSec: 3, secondaryLabelIds: [], createdAtMs: 0 },
        { id: 'b', mainLabelId: 'defense', startTimeSec: 3, endTimeSec: 3.5, secondaryLabelIds: [], createdAtMs: 0 },
      ], { onProgress: (_, ratio) => progress.push(ratio), addGap: true, mainLabels: [
        { id: 'attack', name: 'Attack', color: '#fff', hotkey: 'A', preRollSec: 2, postRollSec: 3 },
        { id: 'defense', name: 'Defense', color: '#fff', hotkey: 'D', preRollSec: 2, postRollSec: 3 },
      ] });
      bytes = new Uint8Array(await blob.arrayBuffer());
      // Exercise the original single-video exporter with the same real WASM core.
      // Use enough frames to get live timestamps before the encoder flushes its buffer.
      const longSource = path.join(directory, 'long-red.mp4');
      await run(ffmpegPath, ['-v', 'error', '-y', '-stream_loop', '3', '-i', red, '-c', 'copy', longSource]);
      const singleFile = new File([new Uint8Array(await fs.readFile(longSource))], 'long-red.mp4');
      const singleProgress: number[] = [];
      const single = await exportFilteredSegmentsToMp4(singleFile, [
        { id: 'single', name: '3:2:1', mainLabelId: 'attack', startTimeSec: 0, endTimeSec: 8, secondaryLabelIds: [], createdAtMs: 0 },
      ], 'single.mp4', { onProgress: (_, ratio) => singleProgress.push(ratio), mainLabels: [{ id: 'attack', name: 'Attack', color: '#fff', hotkey: 'A', preRollSec: 2, postRollSec: 3 }] });
      expect(singleProgress.some((ratio) => ratio > 0.15 && ratio < 0.85)).toBe(true);
      expect(singleProgress).toEqual([...singleProgress].sort((a, b) => a - b));
      expect(singleProgress.at(-1)).toBe(1);
      const singleOutput = path.join(directory, 'single.mp4');
      await fs.writeFile(singleOutput, new Uint8Array(await single.arrayBuffer()));
      await expectTitleBands(singleOutput);

      for (const addGap of [false, true]) {
        const silent = await exportFilteredSegmentsToMp4(files[1], [
          { id: 'silent-a', name: '3:2:1', mainLabelId: 'attack', startTimeSec: 0, endTimeSec: 0.75, secondaryLabelIds: [], createdAtMs: 0 },
          { id: 'silent-b', mainLabelId: 'attack', startTimeSec: 1, endTimeSec: 1.75, secondaryLabelIds: [], createdAtMs: 0 },
        ], 'silent-export.mp4', { addGap, mainLabels: [{ id: 'attack', name: 'Attack', color: '#fff', hotkey: 'A', preRollSec: 2, postRollSec: 3 }] });
        const silentOutput = path.join(directory, 'silent-export.mp4');
        await fs.writeFile(silentOutput, new Uint8Array(await silent.arrayBuffer()));
        const info = JSON.parse((await run(ffprobePath, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', silentOutput])).stdout);
        expect(Number(info.format.duration)).toBeCloseTo(addGap ? 2 : 1.5, 1);
        expect(info.streams.map((stream: { codec_type: string }) => stream.codec_type)).toEqual(['video']);
        await expectTitleBands(silentOutput);
        if (addGap) {
          const frame = await run(ffmpegPath, ['-v', 'error', '-ss', '1', '-i', silentOutput, '-frames:v', '1', '-vf', 'crop=2:2:200:180,format=rgb24', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer' });
          expect(frame.stdout[0] + frame.stdout[1] + frame.stdout[2]).toBeLessThan(30);
        }
      }
      expect(progressListeners.size).toBe(0);
      expect(core.FS.readdir('/').filter((name) => /^(sequence-|part_|gap|concat|export|audio-probe|silent-export)/.test(name))).toEqual([]);
    }
    expect(progress.some((ratio) => ratio > 0.1 && ratio < 0.85)).toBe(true);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(progress.at(-1)).toBe(mode === 'native' ? 0.99 : 1);
    const output = path.join(directory, 'export.mp4'); await fs.writeFile(output, bytes);
    await expectTitleBands(output);
    const probe = JSON.parse((await run(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output])).stdout);
    expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(3);
    expect(Number(probe.format.duration)).toBeLessThan(3.2);
    expect(probe.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video')).toMatchObject({ width: 320, height: 240, r_frame_rate: '30/1' });
    expect(probe.streams.find((stream: { codec_type: string }) => stream.codec_type === 'audio')).toMatchObject({ sample_rate: '48000', channels: 2 });
    // Decode real pixels away from the text to prove source order and the single black gap.
    for (const [time, channel] of [[0.5, 'red'], [1.5, 'blue'], [2.25, 'black'], [2.8, 'blue']] as const) {
      const frame = await run(ffmpegPath, ['-v', 'error', '-ss', String(time), '-i', output, '-frames:v', '1', '-vf', 'crop=2:2:200:180,format=rgb24', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer' });
      const [r, g, b] = frame.stdout;
      if (channel === 'red') expect(r).toBeGreaterThan(150);
      if (channel === 'blue') expect(b).toBeGreaterThan(150);
      if (channel === 'black') expect(r + g + b).toBeLessThan(30);
    }
    expect((await fs.stat(red)).size).toBeGreaterThan(0);
    expect((await fs.stat(blue)).size).toBeGreaterThan(0);
  } finally { vi.unstubAllGlobals(); await fs.rm(directory, { recursive: true, force: true }); }
}, 60_000);

async function expectTitleBands(output: string) {
  // White glyphs in two separate bands prove both title and type reached encoded pixels.
  for (const [y, height] of [[30, 44], [85, 22]]) {
    const frame = await run(ffmpegPath, ['-v', 'error', '-ss', '0.5', '-i', output, '-frames:v', '1', '-vf', `crop=220:${height}:30:${y},format=rgb24`, '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer' });
    let whitePixels = 0;
    for (let i = 0; i < frame.stdout.length; i += 3) {
      if (frame.stdout[i] > 190 && frame.stdout[i + 1] > 190 && frame.stdout[i + 2] > 190) whitePixels++;
    }
    expect(whitePixels).toBeGreaterThan(100);
  }
}
