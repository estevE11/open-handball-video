import { checkExportCancelled, exportCancelled } from '../../electron/exportCancellation';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { monotonicProgress, type ExportProgress } from '../../electron/exportProgress';
import { diagnosticEngine, diagnosticHistory, diagnosticResources, diagnosticWorker, exportFailureEvidence, recordDiagnostic, setDiagnosticContext } from '@/lib/diagnostics';

/** A normal command failure can use a fallback; a thrown engine error cannot. */
export class FFmpegExitError extends Error {
  constructor(code: number) {
    super(`Video export failed (FFmpeg exit code ${code}).`);
    this.name = 'FFmpegExitError';
  }
}

/** Listener lifetime matches one command, even when the shared engine is reused. */
export async function runWasmExportCommand(ffmpeg: Pick<FFmpeg, 'on' | 'off' | 'exec'>, args: string[], onTime?: (seconds: number) => void,
  context: Record<string, unknown> = {}) {
  const engine = diagnosticEngine(ffmpeg, 'command');
  const startedAt = Date.now();
  // Never record raw arguments: input paths and drawtext contain private data.
  const numericOptions = ['-ss', '-t', '-crf', '-r', '-ar', '-ac'];
  const stringOptions = ['-c:v', '-c:a', '-c', '-preset', '-pix_fmt', '-b:a'];
  const settings: Record<string, unknown> = {};
  for (const flag of numericOptions) {
    const at = args.indexOf(flag);
    if (at >= 0 && Number.isFinite(Number(args[at + 1]))) settings[flag] = Number(args[at + 1]);
  }
  for (const flag of stringOptions) {
    const at = args.indexOf(flag);
    if (at >= 0 && /^[\w.-]{1,40}$/.test(args[at + 1] ?? '')) settings[flag] = args[at + 1];
  }
  const operation = diagnosticHistory().context.export as { operationId?: string } | undefined;
  const details = { ...context, operationId: operation?.operationId, ...engine, commandId: `${engine.engineId}:${engine.commands}`,
    startedAt: new Date(startedAt).toISOString(), options: args.filter(arg => /^-[a-z]/i.test(arg)), settings,
    hasVideoFilter: args.includes('-vf'), hasAudioFilter: args.includes('-af'),
    resourcesBefore: diagnosticResources(), workerBefore: diagnosticWorker(ffmpeg)?.latest };
  let lastProgress: { seconds: number; ratio?: number; receivedAt: string } | undefined;
  let progressEvents = 0;
  let lastSnapshot = 0;
  const snapshot = (status: string) => ({ ...details, status, elapsedMs: Date.now() - startedAt, progressEvents, lastProgress });
  setDiagnosticContext('exportCommand', snapshot('running'));
  const updateContext = (value: Record<string, unknown>) => {
    const current = diagnosticHistory().context.exportCommand as { commandId?: string } | undefined;
    if (current?.commandId === details.commandId) setDiagnosticContext('exportCommand', value);
  };
  recordDiagnostic('info', 'export', 'ffmpeg.command_started', details);
  const listener = ({ time, progress }: { time: number; progress?: number }) => {
    // The core can emit INT64_MAX before the first frame has a timestamp.
    if (Number.isSafeInteger(time) && time >= 0) {
      progressEvents++;
      lastProgress = { seconds: time / 1_000_000, ratio: Number.isFinite(progress) ? progress : undefined, receivedAt: new Date().toISOString() };
      if (Date.now() - lastSnapshot >= 1000) { updateContext(snapshot('running')); lastSnapshot = Date.now(); }
      onTime?.(time / 1_000_000);
    }
  };
  ffmpeg.on('progress', listener);
  try {
    // Warnings expose decoder/encoder failures without verbose frame status or
    // container metadata (which can contain user-provided titles).
    const code = await ffmpeg.exec(['-loglevel', 'warning', ...args]);
    if (code !== 0) throw new FFmpegExitError(code);
    const completed = { ...snapshot('completed'), exitCode: code, resourcesAfter: diagnosticResources(), workerAfter: diagnosticWorker(ffmpeg)?.latest };
    updateContext(completed);
    recordDiagnostic('info', 'export', 'ffmpeg.command_completed', completed);
  } catch (error) {
    const failed = { ...snapshot('failed'), resourcesAfter: diagnosticResources(), workerAfter: diagnosticWorker(ffmpeg)?.latest,
      failureEvidence: exportFailureEvidence(ffmpeg, error, details.commandId) };
    updateContext(failed);
    recordDiagnostic('warning', 'export', 'ffmpeg.command_failed', failed, error);
    throw error;
  } finally {
    ffmpeg.off('progress', listener);
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
