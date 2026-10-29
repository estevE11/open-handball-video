import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { getFFmpeg, resetFFmpeg } from './ffmpegSingleton';
import { abortable, checkExportCancelled } from '../../electron/exportCancellation';
import { diagnosticEngine, diagnosticResources, recordDiagnostic, setDiagnosticContext } from './diagnostics';

export async function withBrowserExport<T>(signal: AbortSignal | undefined, work: (ffmpeg: FFmpeg) => Promise<T>) {
  checkExportCancelled(signal);
  let engine: FFmpeg | undefined;
  let released = false;
  let outcome = 'failed';
  const release = (reason: string) => {
    if (released) return;
    released = true;
    const details = { reason, ...(engine ? diagnosticEngine(engine) : {}), resources: diagnosticResources() };
    resetFFmpeg(engine);
    recordDiagnostic('info', 'export', 'engine.released', details);
  };
  const abort = () => release('cancelled');
  signal?.addEventListener('abort', abort, { once: true });
  try {
    engine = await abortable(getFFmpeg(), signal);
    checkExportCancelled(signal);
    setDiagnosticContext('exportEngine', diagnosticEngine(engine));
    const result = await abortable(work(engine), signal);
    outcome = 'completed';
    return result;
  } finally {
    signal?.removeEventListener('abort', abort);
    // Terminating the worker releases its entire heap, including allocations
    // retained by FFmpeg after individual commands and failed exports.
    if (engine) release(outcome);
  }
}
