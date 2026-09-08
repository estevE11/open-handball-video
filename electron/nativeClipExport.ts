import { runNativeCommand } from './nativeCommand.js';
import { checkExportCancelled } from './exportCancellation.js';
import { monotonicProgress, type ExportProgress } from './exportProgress.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderClipExport, type ExportPiece } from './clipExportCore.js';

export async function nativeClipExport(opts: { inputPaths: string[]; pieces: ExportPiece[]; addGap: boolean },
  config: { ffmpegPath: string; ffprobePath: string; fontPath: string }, onProgress: ExportProgress = () => {}, signal?: AbortSignal) {
  checkExportCancelled(signal);
  const report = monotonicProgress(onProgress);
  report('Preparing export', 0);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ohv-export-'));
  const run = (binary: string, args: string[], onTime?: (seconds: number) => void) => runNativeCommand(binary, args, { cwd: directory, signal, onTime });
  try {
    await fs.copyFile(config.fontPath, path.join(directory, 'font.ttf'));
    return await renderClipExport({
      fontName: 'font.ttf',
      loadSource: async (index) => {
        let source = opts.inputPaths[index];
        if (source?.startsWith('file:')) source = fileURLToPath(source);
        if (!source || !path.isAbsolute(source)) throw new Error('An original clip is missing.');
        await fs.access(source); return source;
      },
      releaseSource: async () => {},
      probe: async (source) => {
        const json = JSON.parse(await run(config.ffprobePath, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', source])) as {
          streams: { codec_type: string; width?: number; height?: number }[];
        };
        const video = json.streams.find((stream) => stream.codec_type === 'video');
        if (!video?.width || !video.height) throw new Error('This clip has no readable video stream.');
        return { width: video.width, height: video.height, hasAudio: json.streams.some((stream) => stream.codec_type === 'audio') };
      },
      exec: async (args, onTime) => { await run(config.ffmpegPath, args, onTime); },
      write: (name, data) => fs.writeFile(path.join(directory, name), data),
      read: (name) => fs.readFile(path.join(directory, name), { signal }),
      remove: (name) => fs.rm(path.join(directory, name), { force: true }),
    }, opts.pieces, opts.addGap, report);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
