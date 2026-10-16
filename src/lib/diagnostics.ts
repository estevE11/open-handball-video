import type { ProjectData } from '@/types/project';

type Details = Record<string, unknown>;
export type DiagnosticEvent = {
  id: string; sessionId: string; time: string; level: 'info' | 'warning' | 'error';
  area: string; code: string; message: string; details?: unknown; error?: unknown; count: number;
  build?: typeof __APP_BUILD__;
};
type History = { events: DiagnosticEvent[]; engineLogs: { time: string; message: string }[]; context: Details };
export const DIAGNOSTICS_KEY = 'ohv.diagnostics.v1';
const MAX_EVENTS = 120;
const MAX_ENGINE_LOGS = 80;
const sessionId = id();
let revision = 0;
let persistence: 'localStorage' | 'memory' = 'localStorage';
let persistTimer: ReturnType<typeof setTimeout> | undefined;
const subscribers = new Set<() => void>();

function id() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }

/** Reports never contain source URLs, local paths, email addresses, or command overlay text. */
export function redactDiagnosticText(text: string): string {
  return text.slice(0, 12_000)
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
    .replace(/(?:drawtext|Parsed_drawtext)[^\r\n]*/gi, '[text overlay]')
    .replace(/"[^"\r\n]+\.(?:mp4|mov|mkv|webm|avi|m4v|json)"|'[^'\r\n]+\.(?:mp4|mov|mkv|webm|avi|m4v|json)'|[^\s"'<>]+\.(?:mp4|mov|mkv|webm|avi|m4v|json)\b/gi, '[file]');
}

function safe(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth limit]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactDiagnosticText(value).slice(0, 6000);
  if (value instanceof Error || (typeof DOMException !== 'undefined' && value instanceof DOMException)) {
    return safe({ name: value.name, message: value.message, stack: value.stack, cause: value.cause }, depth + 1);
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) return '[binary omitted]';
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[binary omitted]';
  if (Array.isArray(value)) return value.slice(0, 40).map(item => safe(item, depth + 1));
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
    if (raw && raw.length <= 250_000) {
      const parsed = JSON.parse(raw);
      if (parsed.version === 1 && Array.isArray(parsed.events) && Array.isArray(parsed.engineLogs)) {
        return { events: parsed.events.filter((event: DiagnosticEvent) => event && typeof event.id === 'string'
          && typeof event.time === 'string' && ['info', 'warning', 'error'].includes(event.level)).slice(-MAX_EVENTS).map((event: DiagnosticEvent) => safe(event) as DiagnosticEvent),
        engineLogs: parsed.engineLogs.filter((line: { message?: unknown }) => typeof line?.message === 'string').slice(-MAX_ENGINE_LOGS).map((line: { time: string; message: string }) => ({ time: line.time, message: redactDiagnosticText(line.message) })),
        context: {} };
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
    let serialized = JSON.stringify({ version: 1, events: history.events, engineLogs: history.engineLogs });
    while (serialized.length > 200_000 && history.events.length > 1) {
      const firstBreadcrumb = history.events.findIndex(event => event.level !== 'error');
      history.events.splice(firstBreadcrumb >= 0 ? firstBreadcrumb : 0, 1);
      serialized = JSON.stringify({ version: 1, events: history.events, engineLogs: history.engineLogs });
    }
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
export function clearDiagnostics() { history = { events: [], engineLogs: [], context: {} }; changed(true); }
export function setDiagnosticContext(key: string, details: Details) { history.context[key] = safe(details); }

export function recordDiagnostic(level: DiagnosticEvent['level'], area: string, code: string, details?: Details, error?: unknown) {
  try {
    const serializedError = safe(error) as { message?: string } | string | undefined;
    const message = typeof serializedError === 'string' ? serializedError : serializedError?.message ?? code;
    let safeDetails = safe(details);
    if (JSON.stringify(safeDetails)?.length > 16_000) safeDetails = { truncated: true };
    const previous = history.events.at(-1);
    if (previous?.code === code && previous.area === area && previous.message === message
      && previous.sessionId === sessionId && Date.now() - Date.parse(previous.time) < 5000) {
      previous.count++; previous.time = new Date().toISOString(); previous.details = safeDetails;
      changed(level === 'error'); return previous.id;
    }
    const event: DiagnosticEvent = { id: id(), sessionId, time: new Date().toISOString(), level, area, code, message,
      details: safeDetails, error: serializedError, count: 1,
      ...(level === 'error' && typeof __APP_BUILD__ !== 'undefined' ? { build: __APP_BUILD__ } : {}) };
    history.events.push(event);
    if (history.events.length > MAX_EVENTS) {
      // Keep recent failures even when autosave and progress produce many breadcrumbs.
      const errors = history.events.filter(item => item.level === 'error').slice(-30);
      const others = history.events.filter(item => item.level !== 'error').slice(-(MAX_EVENTS - errors.length));
      const keep = new Set([...errors, ...others]);
      history.events = history.events.filter(item => keep.has(item));
    }
    changed(level === 'error');
    return event.id;
  } catch { return 'diagnostic-unavailable'; }
}

export function recordEngineLog(message: string) {
  // Frame-by-frame status would obscure useful codec and failure messages.
  if (/^(?:\[[^\]]+\]\s*)?\s*(?:frame=|size=|out_time|progress=|speed=|fps=|bitrate=|dup_frames=|drop_frames=)/.test(message)) return;
  history.engineLogs.push({ time: new Date().toISOString(), message: redactDiagnosticText(message).slice(0, 1000) });
  history.engineLogs = history.engineLogs.slice(-MAX_ENGINE_LOGS);
  changed();
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
  return {
    reportVersion: 1, reportId: id(), generatedAt: new Date().toISOString(), sessionId, focusEventId,
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
    storage: { estimate: safe(estimate), persistent, persistenceSupported: !!storage?.persist, diagnosticHistory: persistence },
    project: safe(project), context: history.context, events: [...history.events], engineLogs: [...history.engineLogs],
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
