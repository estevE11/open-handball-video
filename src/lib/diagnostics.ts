import type { ProjectData, Segment } from '@/types/project';
import { splitSegmentsAcrossClips } from './clipTimeline';

type Details = Record<string, unknown>;
export type DiagnosticEvent = {
  id: string; sessionId: string; time: string; level: 'info' | 'warning' | 'error';
  area: string; code: string; message: string; details?: unknown; error?: unknown; count: number;
  build?: typeof __APP_BUILD__;
  context?: unknown;
  engineLogs?: EngineLog[];
};
type EngineLog = { time: string; message: string; engineId?: string; commandId?: string };
type History = { events: DiagnosticEvent[]; engineLogs: EngineLog[]; context: Details };
export const DIAGNOSTICS_KEY = 'ohv.diagnostics.v1';
const MAX_EVENTS = 600;
const MAX_ENGINE_LOGS = 240;
const MAX_HISTORY_CHARS = 1_000_000;
const MAX_SELECTION = 200;
let droppedEvents = 0;
let droppedLogs = 0;
let normalExitMessages = 0;
const sessionId = id();
let revision = 0;
let persistence: 'localStorage' | 'memory' = 'localStorage';
let persistTimer: ReturnType<typeof setTimeout> | undefined;
const subscribers = new Set<() => void>();

function id() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }

/** Reports never contain source URLs, local paths, email addresses, or command overlay text. */
export function redactDiagnosticText(text: string): string {
  const redacted = text.slice(0, 12_000)
    .replace(/\b(?:https?|file|blob):[^\s"'<>]+/gi, (url) => {
      // Preserve bundle names and line/column positions so stacks can be mapped to source.
      const suffix = url.endsWith(')') ? ')' : '';
      const candidate = suffix ? url.slice(0, -1) : url;
      const script = /^(?:https?|file):/i.test(candidate) && candidate.match(/\/([^/?#]+\.(?:m?js|tsx?)(?::\d+(?::\d+)?)?)(?:[?#][^\s]*)?$/i);
      return (script ? `[app script:${script[1]}]` : '[url]') + suffix;
    })
    .replace(/(?:[a-z]:[\\/]|\/(?:Users|home|Volumes|private|var|tmp)\/)[^\r\n"'<>]+/gi, '[local path]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:Bearer\s+)[\w.+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(token|password|secret|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/(?:drawtext|Parsed_drawtext)[^\r\n]*/gi, '[text overlay]');
  // Skip the filename matcher for long technical messages without filenames.
  if (!/\.(?:mp4|mov|mkv|webm|avi|m4v|json)\b/i.test(redacted)) return redacted;
  return redacted.replace(/"[^"\r\n]+\.(?:mp4|mov|mkv|webm|avi|m4v|json)"|'[^'\r\n]+\.(?:mp4|mov|mkv|webm|avi|m4v|json)'|[^\s"'<>]+\.(?:mp4|mov|mkv|webm|avi|m4v|json)\b/gi, '[file]');
}

function safe(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth limit]';
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return redactDiagnosticText(value).slice(0, 6000);
  if (value instanceof Error || (typeof DOMException !== 'undefined' && value instanceof DOMException)) {
    return safe({ name: value.name, message: value.message, stack: value.stack, cause: value.cause }, depth + 1);
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) return '[binary omitted]';
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[binary omitted]';
  if (Array.isArray(value)) return value.slice(0, MAX_SELECTION).map(item => safe(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 35).map(([key, item]) => [key,
      /^(?:token|password|secret|authorization|cookie|fileName|filePath|inputPath|videoSourceUrl|json|segments|mainLabels|secondaryLabels)$/i.test(key)
        ? '[omitted]' : safe(item, depth + 1)]));
  }
  return undefined;
}

function readHistory(): History {
  try {
    const raw = localStorage.getItem(DIAGNOSTICS_KEY);
    if (raw && raw.length <= MAX_HISTORY_CHARS) {
      const parsed = JSON.parse(raw);
      if ([1, 2].includes(parsed.version) && Array.isArray(parsed.events) && Array.isArray(parsed.engineLogs)) {
        const counter = (key: string) => Number.isSafeInteger(parsed.retention?.[key]) && parsed.retention[key] >= 0 ? parsed.retention[key] as number : 0;
        droppedEvents = counter('droppedEvents'); droppedLogs = counter('droppedLogs'); normalExitMessages = counter('normalExitMessages');
        return { events: parsed.events.filter((event: DiagnosticEvent) => event && typeof event.id === 'string'
          && typeof event.time === 'string' && ['info', 'warning', 'error'].includes(event.level)).slice(-MAX_EVENTS).map((event: DiagnosticEvent) => safe(event) as DiagnosticEvent),
        engineLogs: parsed.engineLogs.filter((line: { message?: unknown }) => typeof line?.message === 'string').slice(-MAX_ENGINE_LOGS).map((line: EngineLog) => safe(line) as EngineLog),
        context: parsed.context && typeof parsed.context === 'object' ? safe(parsed.context) as Details : {} };
      }
    }
  } catch { persistence = 'memory'; }
  return { events: [], engineLogs: [], context: {} };
}
let history = readHistory();

export function flushDiagnostics() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = undefined;
  try {
    const serialize = () => JSON.stringify({ version: 2, ...history, retention: { droppedEvents, droppedLogs, normalExitMessages } });
    let serialized = serialize();
    let estimatedSize = serialized.length;
    // Count removed entries instead of serializing a megabyte again for every
    // dropped breadcrumb. Leave room for updated retention counters.
    while (estimatedSize > MAX_HISTORY_CHARS - 1000) {
      const firstBreadcrumb = history.events.findIndex(event => event.level !== 'error');
      let removed: unknown;
      if (firstBreadcrumb >= 0) { [removed] = history.events.splice(firstBreadcrumb, 1); droppedEvents++; }
      else if (history.engineLogs.length) { removed = history.engineLogs.shift(); droppedLogs++; }
      else if (history.events.length > 1) { removed = history.events.shift(); droppedEvents++; }
      else break;
      estimatedSize -= JSON.stringify(removed).length + 1;
    }
    if (estimatedSize !== serialized.length) serialized = serialize();
    if (serialized.length > MAX_HISTORY_CHARS) { persistence = 'memory'; return; }
    localStorage.setItem(DIAGNOSTICS_KEY, serialized); persistence = 'localStorage';
  }
  catch { persistence = 'memory'; }
}
function changed(immediate = false) {
  revision++;
  if (immediate) flushDiagnostics();
  else if (!persistTimer) persistTimer = setTimeout(flushDiagnostics, 500);
  for (const notify of subscribers) notify();
}
export function subscribeDiagnostics(notify: () => void) { subscribers.add(notify); return () => { subscribers.delete(notify); }; }
export function diagnosticsRevision() { return revision; }
export function diagnosticHistory() { return history; }
export function clearDiagnostics() { history = { events: [], engineLogs: [], context: {} }; droppedEvents = 0; droppedLogs = 0; normalExitMessages = 0; changed(true); }
export function setDiagnosticContext(key: string, details: Details) {
  const next = safe(details);
  history.context[key] = JSON.stringify(next).length <= 100_000 ? next : { truncated: true };
}
export function patchDiagnosticContext(key: string, details: Details) {
  setDiagnosticContext(key, { ...(history.context[key] as Details | undefined), ...details });
}

/** This is browser JS heap information, not the FFmpeg worker's WASM heap. */
export function diagnosticResources() {
  let jsHeap: { usedBytes?: number; allocatedBytes?: number; limitBytes?: number } | 'unavailable' = 'unavailable';
  let deviceMemoryGiB: number | 'unavailable' = 'unavailable';
  // Optional browser APIs must never make an export fail when unavailable or blocked.
  try {
    const memory = typeof performance !== 'undefined'
      ? (performance as Performance & { memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number; jsHeapSizeLimit?: number } }).memory : undefined;
    if (memory) jsHeap = { usedBytes: memory.usedJSHeapSize, allocatedBytes: memory.totalJSHeapSize, limitBytes: memory.jsHeapSizeLimit };
  } catch { /* Not exposed by this browser. */ }
  try { deviceMemoryGiB = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 'unavailable' : 'unavailable'; }
  catch { /* Not exposed by this browser. */ }
  return {
    sampledAt: new Date().toISOString(),
    visibility: typeof document !== 'undefined' ? document.visibilityState : 'unavailable',
    jsHeap,
    wasmHeap: history.context.exportWorker ? 'capacity samples in context.exportWorker' : 'unavailable',
    deviceMemoryGiB,
  };
}

type WorkerSample = {
  event: string; time: string; sequence: number; commandKind: string | null;
  wasmMemory: { capacityBytes: number | null; peakCapacityBytes: number | null; limitBytes: number | null; usedBytes: null };
  filesystem: Record<string, number | boolean> | null;
  exitCode?: number; abortReason?: string;
  exception?: { name: string; message: string; stack: string | null; wasmFrames: string[] };
};
type WorkerState = { latest: WorkerSample; commandStart?: WorkerSample; failure?: WorkerSample; oomSignal?: WorkerSample; samples: WorkerSample[] };
const OOM_SIGNAL = /\bOOM\b|out of memory|cannot enlarge memory|cannot allocate memory|memory allocation failed|failed to allocate|bad_alloc/i;
const workerStates = new WeakMap<object, WorkerState>();
export function diagnosticWorker(engine: object) {
  const state = workerStates.get(engine);
  return state ? { ...state, samples: [...state.samples] } : undefined;
}

/** Accept only the small numeric/exception schema emitted by our core wrapper. */
export function recordWorkerTelemetry(engine: object, message: string) {
  try {
    if (message.length > 30_000) return false;
    const raw = JSON.parse(message);
    if (raw.telemetryVersion !== 1 || !['ready', 'command-start', 'progress', 'command-end', 'command-error', 'abort'].includes(raw.event)) return false;
    const number = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
    const sample: WorkerSample = {
      event: raw.event, time: Number.isFinite(Date.parse(raw.time)) ? raw.time : new Date().toISOString(), sequence: number(raw.sequence) ?? 0,
      commandKind: ['exec', 'ffprobe'].includes(raw.commandKind) ? raw.commandKind : null,
      wasmMemory: { capacityBytes: number(raw.wasmMemory?.capacityBytes), peakCapacityBytes: number(raw.wasmMemory?.peakCapacityBytes),
        limitBytes: number(raw.wasmMemory?.limitBytes), usedBytes: null },
      filesystem: raw.filesystem ? { ...Object.fromEntries(['memfsFiles', 'memfsLogicalBytes', 'memfsBufferCapacityBytes', 'mountedFiles',
        'mountedLogicalBytes', 'openStreams'].map(key => [key, number(raw.filesystem[key]) ?? 0])), scanTruncated: !!raw.filesystem.scanTruncated } : null,
    };
    if (Number.isInteger(raw.exitCode)) sample.exitCode = raw.exitCode;
    if (typeof raw.abortReason === 'string') sample.abortReason = redactDiagnosticText(raw.abortReason);
    if (raw.exception && typeof raw.exception.message === 'string') sample.exception = {
      name: redactDiagnosticText(String(raw.exception.name ?? 'Error')).slice(0, 100), message: redactDiagnosticText(raw.exception.message),
      stack: typeof raw.exception.stack === 'string' ? redactDiagnosticText(raw.exception.stack) : null,
      wasmFrames: Array.isArray(raw.exception.wasmFrames) ? raw.exception.wasmFrames.filter((frame: unknown) =>
        typeof frame === 'string' && /^wasm-function\[\d+\](?::0x[0-9a-f]+)?$/i.test(frame)).slice(0, 30) : [],
    };
    const previous = workerStates.get(engine);
    const state: WorkerState = { latest: sample,
      commandStart: sample.event === 'command-start' ? sample : previous?.commandStart,
      failure: sample.event === 'command-start' ? undefined : previous?.failure,
      oomSignal: previous?.oomSignal,
      samples: [...(previous?.samples ?? []), sample].slice(-30) };
    if (sample.event === 'command-error' || sample.event === 'abort') state.failure = sample;
    if (!state.oomSignal && OOM_SIGNAL.test([sample.abortReason, sample.exception?.message].filter(Boolean).join('\n'))) state.oomSignal = sample;
    workerStates.set(engine, state);
    const engineId = diagnosticEngine(engine).engineId;
    setDiagnosticContext('exportWorker', { engineId, ...state });
    if (sample.event === 'command-error' || sample.event === 'abort') {
      recordDiagnostic('warning', 'export', 'worker.failure_signal', { engineId, ...sample });
    }
    return true;
  } catch { return false; }
}

export function exportFailureEvidence(engine: object, error: unknown, commandId?: string) {
  const worker = diagnosticWorker(engine);
  const engineId = diagnosticEngine(engine).engineId;
  type Command = { engineId?: string; commandId?: string };
  const active = [history.context.exportCommand, history.context.exportProbe].find(value => (value as Command | undefined)?.engineId === engineId) as Command | undefined;
  const ownCommandId = commandId ?? active?.commandId;
  const warnings = ownCommandId ? history.engineLogs.filter(line => line.engineId === engineId && line.commandId === ownCommandId).map(line => line.message) : [];
  const text = [error instanceof Error ? `${error.name}: ${error.message}` : String(error), worker?.failure?.abortReason,
    worker?.failure?.exception?.message, worker?.oomSignal?.abortReason, worker?.oomSignal?.exception?.message, ...warnings].filter(Boolean).join('\n');
  const explicitOom = OOM_SIGNAL.test(text);
  const capacity = worker?.latest.wasmMemory.capacityBytes ?? null;
  const limit = worker?.latest.wasmMemory.limitBytes ?? null;
  const nearLimit = capacity !== null && limit !== null && limit > 0 ? capacity / limit >= 0.9 : null;
  return { category: explicitOom ? 'out-of-memory' : /RuntimeError|out of bounds|unreachable/i.test(text) ? 'wasm-runtime-trap' : 'command-failure',
    certainty: explicitOom ? 'explicit-signal' : 'undetermined', explicitOomSignal: explicitOom,
    nearConfiguredHeapLimit: nearLimit, wasmCapacityBytes: capacity, wasmLimitBytes: limit,
    // Capacity is allocated address space, not live malloc usage or physical RAM.
    wasmUsedBytes: null, workerFailure: worker?.failure, oomSignal: worker?.oomSignal };
}

const engines = new WeakMap<object, { engineId: string; createdAt: string; commands: number; probes: number }>();
export function diagnosticEngine(engine: object, kind?: 'command' | 'probe') {
  let state = engines.get(engine);
  if (!state) { state = { engineId: id(), createdAt: new Date().toISOString(), commands: 0, probes: 0 }; engines.set(engine, state); }
  if (kind === 'command') state.commands++;
  if (kind === 'probe') state.probes++;
  return { ...state, ageMs: Date.now() - Date.parse(state.createdAt) };
}

export function recordDiagnostic(level: DiagnosticEvent['level'], area: string, code: string, details?: Details, error?: unknown) {
  try {
    const serializedError = safe(error) as { message?: string } | string | undefined;
    const message = typeof serializedError === 'string' ? serializedError : serializedError?.message ?? code;
    let safeDetails = safe(details);
    if (JSON.stringify(safeDetails)?.length > 64_000) safeDetails = { truncated: true };
    const previous = history.events.at(-1);
    if (previous?.code === code && previous.area === area && previous.message === message
      && JSON.stringify(previous.details) === JSON.stringify(safeDetails)
      && previous.sessionId === sessionId && Date.now() - Date.parse(previous.time) < 5000) {
      previous.count++; previous.time = new Date().toISOString(); previous.details = safeDetails;
      changed(level === 'error'); return previous.id;
    }
    const event: DiagnosticEvent = { id: id(), sessionId, time: new Date().toISOString(), level, area, code, message,
      details: safeDetails, error: serializedError, count: 1,
      ...(level === 'error' ? { context: safe(history.context),
        ...(area === 'export' ? { engineLogs: history.engineLogs.slice(-30).map(line => ({ ...line })) } : {}),
        ...(typeof __APP_BUILD__ !== 'undefined' ? { build: __APP_BUILD__ } : {}) } : {}) };
    history.events.push(event);
    if (history.events.length > MAX_EVENTS) {
      // Keep recent failures even when autosave and progress produce many breadcrumbs.
      const errors = history.events.filter(item => item.level === 'error').slice(-50);
      const others = history.events.filter(item => item.level !== 'error').slice(-(MAX_EVENTS - errors.length));
      const keep = new Set([...errors, ...others]);
      droppedEvents += history.events.length - keep.size;
      history.events = history.events.filter(item => keep.has(item));
    }
    changed(level === 'error');
    return event.id;
  } catch { return 'diagnostic-unavailable'; }
}

export function recordEngineLog(message: string, engineId?: string) {
  // Frame-by-frame status would obscure useful codec and failure messages.
  if (/^(?:\[[^\]]+\]\s*)?\s*(?:frame=|size=|out_time|progress=|speed=|fps=|bitrate=|dup_frames=|drop_frames=)/.test(message)) return;
  // This core uses an abort internally for normal command exits. Keep real OOM
  // and other abort reasons, without filling the report with bare Aborted().
  if (/^(?:\[[^\]]+\]\s*)?Aborted\(\)\s*$/.test(message)) { normalExitMessages++; return; }
  type ActiveCommand = { engineId?: string; commandId?: string; status?: string };
  const active = history.context.exportCommand as ActiveCommand | undefined;
  const command = active?.status === 'running' && active.engineId === engineId ? active : history.context.exportProbe as ActiveCommand | undefined;
  history.engineLogs.push({ time: new Date().toISOString(), message: redactDiagnosticText(message).slice(0, 2000), engineId,
    ...(engineId && command?.engineId === engineId && command.status === 'running' ? { commandId: command.commandId } : {}) });
  droppedLogs += Math.max(0, history.engineLogs.length - MAX_ENGINE_LOGS);
  history.engineLogs = history.engineLogs.slice(-MAX_ENGINE_LOGS);
  changed();
}

export function exportDiagnosticPlan(project: ProjectData, selected: Segment[]) {
  const timeline = new Map([...project.segments].sort((a, b) => a.startTimeSec - b.startTimeSec).map((segment, index) => [segment.id, index + 1]));
  const captured = selected.slice(0, MAX_SELECTION);
  return { totalCount: selected.length, capturedCount: captured.length, truncated: selected.length > captured.length,
    selection: captured.map((segment, index) => ({ exportIndex: index + 1, timelineIndex: timeline.get(segment.id),
      startTimeSec: segment.startTimeSec, endTimeSec: segment.endTimeSec, durationSec: segment.endTimeSec - segment.startTimeSec,
      mainLabelIndex: project.mainLabels.findIndex(label => label.id === segment.mainLabelId) + 1,
      secondaryLabelCount: segment.secondaryLabelIds.length, hasCustomTitle: !!segment.name,
      ...(project.clips ? { sourceRanges: splitSegmentsAcrossClips(project.clips, [segment]).map(part => ({
        sourceIndex: part.sourceIndex, startTimeSec: part.startTimeSec, endTimeSec: part.endTimeSec,
      })) } : { sourceRanges: [{ sourceIndex: 0, startTimeSec: segment.startTimeSec, endTimeSec: segment.endTimeSec }] }),
    })) };
}

export async function traceDiagnosticTask<T>(area: string, code: string, details: Details, work: () => Promise<T>): Promise<T> {
  recordDiagnostic('info', area, `${code}.started`, details);
  const started = Date.now();
  try {
    const result = await work();
    recordDiagnostic('info', area, `${code}.completed`, { ...details, elapsedMs: Date.now() - started });
    return result;
  } catch (error) {
    recordDiagnostic('error', area, `${code}.failed`, { ...details, elapsedMs: Date.now() - started }, error);
    throw error;
  }
}

export function projectDiagnosticSummary(project: Pick<ProjectData, 'videoMeta' | 'clips' | 'segments' | 'mainLabels' | 'secondaryLabels' | 'settings'>) {
  const media = project.clips ?? (project.videoMeta ? [project.videoMeta] : []);
  return { clipCount: media.length, mediaBytes: media.reduce((sum, clip) => sum + clip.fileSize, 0),
    media: media.map(clip => ({ bytes: clip.fileSize, mimeType: clip.fileType, durationSec: clip.durationSec, fps: clip.fps })),
    segmentCount: project.segments.length, mainLabelCount: project.mainLabels.length, secondaryLabelCount: project.secondaryLabels.length,
    invalidSegmentCount: project.segments.filter(segment => !Number.isFinite(segment.startTimeSec) || !Number.isFinite(segment.endTimeSec) || segment.endTimeSec <= segment.startTimeSec).length,
    fps: project.settings.fps };
}

async function bounded<T>(read: () => Promise<T>): Promise<T | 'unavailable' | 'timed out'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(read).catch(() => 'unavailable' as const),
      new Promise<'timed out'>(resolve => { timer = setTimeout(() => resolve('timed out'), 1500); })]);
  } finally { clearTimeout(timer); }
}
export async function createDiagnosticReport(project?: Details, focusEventId?: string) {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  const [estimate, persistent] = await Promise.all([
    storage?.estimate ? bounded(() => storage.estimate()) : 'unsupported',
    storage?.persisted ? bounded(() => storage.persisted()) : 'unsupported',
  ]);
  flushDiagnostics();
  // A report is a point-in-time snapshot, even if an export keeps progressing
  // or a later retry changes the live diagnostic context and event counters.
  const snapshot = JSON.parse(JSON.stringify(history)) as History;
  return {
    reportVersion: 2, reportId: id(), generatedAt: new Date().toISOString(), sessionId, focusEventId,
    build: typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : { version: 'test', commit: 'unknown', branch: 'unknown', builtAt: 'unknown' },
    environment: { platform: typeof window !== 'undefined' && window.electron ? 'desktop' : 'browser',
      origin: typeof location !== 'undefined' && location.protocol !== 'file:' ? location.origin : 'desktop',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      language: typeof navigator !== 'undefined' ? navigator.language : 'unknown',
      uiLanguage: typeof document !== 'undefined' ? document.documentElement.lang : 'unknown',
      online: typeof navigator !== 'undefined' ? navigator.onLine : null,
      hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : null,
      crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined', webAssembly: typeof WebAssembly !== 'undefined',
      worker: typeof Worker !== 'undefined', indexedDB: typeof indexedDB !== 'undefined' },
    resources: diagnosticResources(),
    retention: { maxEvents: MAX_EVENTS, maxEngineLogs: MAX_ENGINE_LOGS, maxHistoryChars: MAX_HISTORY_CHARS,
      droppedEvents, droppedLogs, normalExitMessages },
    storage: { estimate: safe(estimate), persistent, persistenceSupported: !!storage?.persist, diagnosticHistory: persistence },
    project: safe(project), ...snapshot,
  };
}

export function installDiagnostics() {
  const onError = (event: ErrorEvent) => recordDiagnostic('error', 'runtime', 'uncaught',
    { line: event.lineno, column: event.colno }, event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => recordDiagnostic('error', 'runtime', 'unhandled_rejection', undefined, event.reason);
  const onHide = () => flushDiagnostics();
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('pagehide', onHide);
  recordDiagnostic('info', 'runtime', 'session.started', { build: typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 'test' });
  return () => {
    window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); window.removeEventListener('pagehide', onHide);
  };
}
