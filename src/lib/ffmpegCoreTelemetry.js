// Loaded as an ESM asset by the official FFmpeg worker. No source names, paths,
// command arguments or video contents are included in telemetry messages.
export function instrumentFFmpegCore(core, heapLimitBytes = null) {
  let logger;
  let sequence = 0;
  let active = null;
  let peakCapacityBytes = 0;
  let lastSampleAt = 0;
  let lastCapacityBytes = 0;

  const filesystem = () => {
    const result = { memfsFiles: 0, memfsLogicalBytes: 0, memfsBufferCapacityBytes: 0,
      mountedFiles: 0, mountedLogicalBytes: 0, openStreams: 0, scanTruncated: false };
    const fs = core.FS;
    if (!fs?.readdir || !fs.stat || !fs.lookupPath) return null;
    let visited = 0;
    const visit = (directory, depth) => {
      for (const name of fs.readdir(directory)) {
        if (name === '.' || name === '..') continue;
        if (++visited > 512) { result.scanTruncated = true; return; }
        const path = `${directory === '/' ? '' : directory}/${name}`;
        if (path === '/dev' || path === '/proc') continue;
        const stat = fs.stat(path);
        if ((stat.mode & 0xf000) === 0x4000) {
          if (depth < 2) visit(path, depth + 1);
          else result.scanTruncated = true;
        } else if ((stat.mode & 0xf000) === 0x8000) {
          const node = fs.lookupPath(path).node;
          // WORKERFS children can lack node.mount; their read operations still
          // identify the filesystem without mistaking logical source bytes for RAM.
          const workerfs = fs.filesystems?.WORKERFS;
          if (workerfs && (node.mount?.type === workerfs || node.stream_ops === workerfs.stream_ops)) {
            result.mountedFiles++; result.mountedLogicalBytes += stat.size;
          } else {
            result.memfsFiles++; result.memfsLogicalBytes += stat.size;
            result.memfsBufferCapacityBytes += node.contents?.byteLength ?? 0;
          }
        }
      }
    };
    try {
      visit('/', 0);
      result.openStreams = fs.streams?.filter(Boolean).length ?? 0;
      return result;
    } catch { return { ...result, scanTruncated: true }; }
  };

  const emit = (event, extra = {}) => {
    try {
      const capacityBytes = core.HEAPU8?.byteLength ?? null;
      if (capacityBytes !== null) peakCapacityBytes = Math.max(peakCapacityBytes, capacityBytes);
      logger?.({ type: 'ohv-telemetry', message: JSON.stringify({ telemetryVersion: 1, event,
        time: new Date().toISOString(), sequence, commandKind: active,
        wasmMemory: { capacityBytes, peakCapacityBytes, limitBytes: heapLimitBytes, usedBytes: null },
        filesystem: filesystem(), ...extra }) });
      lastSampleAt = Date.now(); lastCapacityBytes = capacityBytes;
    } catch { /* Diagnostics must never change command behavior. */ }
  };

  const setLogger = core.setLogger.bind(core);
  core.setLogger = (next) => { logger = next; setLogger(next); emit('ready'); };
  const setProgress = core.setProgress.bind(core);
  core.setProgress = (next) => setProgress((event) => {
    if (Date.now() - lastSampleAt >= 1000 || core.HEAPU8?.byteLength !== lastCapacityBytes) emit('progress');
    next(event);
  });
  const onAbort = core.onAbort;
  core.onAbort = (reason) => {
    // Bare aborts are also used for successful exits by this FFmpeg build.
    if (String(reason ?? '').trim()) emit('abort', { abortReason: String(reason).slice(0, 2000) });
    onAbort?.call(core, reason);
  };
  for (const kind of ['exec', 'ffprobe']) {
    const run = core[kind].bind(core);
    core[kind] = (...args) => {
      active = kind; sequence++; emit('command-start');
      try {
        const result = run(...args);
        emit('command-end', { exitCode: core.ret });
        return result;
      } catch (error) {
        const message = String(error?.message ?? error);
        const stack = typeof error?.stack === 'string' ? error.stack.slice(0, 8000) : null;
        emit('command-error', { exception: { name: error?.name ?? 'Error', message, stack,
          wasmFrames: stack?.match(/wasm-function\[\d+\](?::0x[0-9a-f]+)?/gi)?.slice(0, 30) ?? [] } });
        throw error;
      } finally { active = null; }
    };
  }
  return core;
}

export default async function createDiagnosticCore(options) {
  const url = new URL(import.meta.url);
  const original = url.searchParams.get('core');
  if (!original) throw new Error('Missing FFmpeg core URL.');
  const limit = Number(url.searchParams.get('heapLimitBytes'));
  const createCore = (await import(/* @vite-ignore */ original)).default;
  return instrumentFFmpegCore(await createCore(options), Number.isSafeInteger(limit) && limit > 0 ? limit : null);
}
