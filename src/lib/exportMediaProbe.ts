import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { diagnosticEngine, diagnosticHistory, diagnosticWorker, exportFailureEvidence, patchDiagnosticContext, recordDiagnostic, setDiagnosticContext } from './diagnostics';

const streamFields = ['codec_type', 'codec_name', 'profile', 'width', 'height', 'pix_fmt', 'avg_frame_rate', 'r_frame_rate',
  'time_base', 'start_time', 'duration', 'bit_rate', 'nb_frames', 'sample_rate', 'channels', 'channel_layout',
  'color_range', 'color_space', 'color_transfer', 'color_primaries'];
const formatFields = ['format_name', 'start_time', 'duration', 'bit_rate', 'size'];
type ProbeData = { streams: Record<string, unknown>[]; format?: Record<string, unknown> };

function pick(data: Record<string, unknown>, fields: string[]) {
  return Object.fromEntries(fields.filter(field => typeof data[field] === 'string' || typeof data[field] === 'number')
    .map(field => [field, data[field]]));
}

/** Request technical stream fields only; filenames, tags and other user metadata are excluded. */
export async function probeExportMedia(ffmpeg: Pick<FFmpeg, 'ffprobe' | 'readFile' | 'deleteFile'>, input: string, output: string, sourceIndex: number) {
  const startedAt = Date.now();
  const engine = diagnosticEngine(ffmpeg, 'probe');
  const details = { ...engine, sourceIndex, commandId: `${engine.engineId}:probe:${engine.probes}`, startedAt: new Date(startedAt).toISOString(), workerBefore: diagnosticWorker(ffmpeg)?.latest };
  setDiagnosticContext('exportProbe', { ...details, status: 'running' });
  const ownsContext = () => (diagnosticHistory().context.exportProbe as { commandId?: string } | undefined)?.commandId === details.commandId;
  recordDiagnostic('info', 'export', 'source.probe_started', details);
  try {
    await ffmpeg.deleteFile(output).catch(() => {});
    // This core can return -1 on success. Validate the fresh JSON instead.
    const exitCode = await ffmpeg.ffprobe(['-v', 'warning', '-show_entries',
      `format=${formatFields.join(',')}:stream=${streamFields.join(',')}`, '-of', 'json', input, '-o', output]);
    const parsed = JSON.parse(new TextDecoder().decode(await ffmpeg.readFile(output) as Uint8Array)) as ProbeData;
    if (!Array.isArray(parsed.streams) || !parsed.streams.length) throw new Error('This clip has no readable video stream.');
    const media = { streams: parsed.streams.slice(0, 8).map(stream => pick(stream, streamFields)),
      format: parsed.format ? pick(parsed.format, formatFields) : undefined };
    const completed = { ...details, ...media, exitCode, elapsedMs: Date.now() - startedAt, workerAfter: diagnosticWorker(ffmpeg)?.latest };
    if (ownsContext()) {
      setDiagnosticContext('exportProbe', { ...completed, status: 'completed' });
      patchDiagnosticContext('exportMedia', { [`source${sourceIndex}`]: completed });
    }
    recordDiagnostic('info', 'export', 'source.probe_completed', completed);
    return media;
  } catch (error) {
    const failed = { ...details, elapsedMs: Date.now() - startedAt, status: 'failed', workerAfter: diagnosticWorker(ffmpeg)?.latest,
      failureEvidence: exportFailureEvidence(ffmpeg, error, details.commandId) };
    if (ownsContext()) setDiagnosticContext('exportProbe', failed);
    recordDiagnostic('warning', 'export', 'source.probe_failed', failed, error);
    throw error;
  } finally { await ffmpeg.deleteFile(output).catch(() => {}); }
}
