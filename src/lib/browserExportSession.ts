import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { getFFmpeg, resetFFmpeg } from './ffmpegSingleton';
import { abortable, checkExportCancelled } from '../../electron/exportCancellation';

export async function withBrowserExport<T>(signal: AbortSignal | undefined, work: (ffmpeg: FFmpeg) => Promise<T>) {
  checkExportCancelled(signal);
  let engine: FFmpeg | undefined;
  const abort = () => resetFFmpeg(engine);
  signal?.addEventListener('abort', abort, { once: true });
  try {
    engine = await abortable(getFFmpeg(), signal);
    checkExportCancelled(signal);
    return await abortable(work(engine), signal);
  } finally { signal?.removeEventListener('abort', abort); }
}
