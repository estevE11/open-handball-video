import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { monotonicProgress, type ExportProgress } from '../../electron/exportProgress';

/** Listener lifetime matches one command, even when the shared engine is reused. */
export async function runWasmExportCommand(ffmpeg: Pick<FFmpeg, 'on' | 'off' | 'exec'>, args: string[], onTime?: (seconds: number) => void) {
  const listener = ({ time }: { time: number }) => {
    // The core can emit INT64_MAX before the first frame has a timestamp.
    if (Number.isSafeInteger(time) && time >= 0) onTime?.(time / 1_000_000);
  };
  if (onTime) ffmpeg.on('progress', listener);
  try {
    const code = await ffmpeg.exec(args);
    if (code !== 0) throw new Error(`Video export failed (FFmpeg exit code ${code}).`);
  } finally {
    if (onTime) ffmpeg.off('progress', listener);
  }
}

export async function withNativeExportProgress(run: (exportId: string) => Promise<Uint8Array>, callback?: ExportProgress) {
  const exportId = crypto.randomUUID();
  const report = monotonicProgress(callback);
  report('Preparing export', 0);
  const unsubscribe = window.electron!.onExportProgress(({ exportId: id, phase, ratio }) => {
    if (id === exportId) report(phase, Math.min(0.99, ratio));
  });
  try {
    const bytes = await run(exportId);
    report('Export ready', 1);
    return bytes;
  } finally { unsubscribe(); }
}
