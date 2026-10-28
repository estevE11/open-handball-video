import { checkExportCancelled, exportCancelled } from '../../electron/exportCancellation';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { monotonicProgress, type ExportProgress } from '../../electron/exportProgress';
import { recordDiagnostic } from '@/lib/diagnostics';

/** A normal command failure can use a fallback; a thrown engine error cannot. */
export class FFmpegExitError extends Error {
  constructor(code: number) {
    super(`Video export failed (FFmpeg exit code ${code}).`);
    this.name = 'FFmpegExitError';
  }
}

/** Listener lifetime matches one command, even when the shared engine is reused. */
export async function runWasmExportCommand(ffmpeg: Pick<FFmpeg, 'on' | 'off' | 'exec'>, args: string[], onTime?: (seconds: number) => void) {
  const details = { options: args.filter(arg => arg.startsWith('-')), videoCodec: args.includes('-c:v') ? args[args.indexOf('-c:v') + 1] : undefined,
    audioCodec: args.includes('-c:a') ? args[args.indexOf('-c:a') + 1] : undefined };
  recordDiagnostic('info', 'export', 'ffmpeg.command_started', details);
  const listener = ({ time }: { time: number }) => {
    // The core can emit INT64_MAX before the first frame has a timestamp.
    if (Number.isSafeInteger(time) && time >= 0) onTime?.(time / 1_000_000);
  };
  if (onTime) ffmpeg.on('progress', listener);
  try {
    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new FFmpegExitError(code);
  } catch (error) {
    recordDiagnostic('warning', 'export', 'ffmpeg.command_failed', details, error);
    throw error;
  } finally {
    if (onTime) ffmpeg.off('progress', listener);
  }
}

export async function withNativeExportProgress(run: (exportId: string) => Promise<Uint8Array>, callback?: ExportProgress, signal?: AbortSignal) {
  checkExportCancelled(signal);
  const exportId = crypto.randomUUID();
  const report = monotonicProgress(callback);
  report('Preparing export', 0);
  const unsubscribe = window.electron!.onExportProgress(({ exportId: id, phase, ratio }) => {
    if (id === exportId && !signal?.aborted) report(phase, Math.min(0.99, ratio));
  });
  const abort = () => { void window.electron!.cancelExport(exportId).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const job = run(exportId);
    if (signal?.aborted) abort();
    const bytes = await job;
    checkExportCancelled(signal);
    report('Export ready', 1);
    return bytes;
  } catch (error) { if (signal?.aborted) throw exportCancelled(); throw error; }
  finally { signal?.removeEventListener('abort', abort); unsubscribe(); }
}
