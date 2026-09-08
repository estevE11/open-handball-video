export function exportCancelled() { return new DOMException('Export cancelled', 'AbortError'); }
export function checkExportCancelled(signal?: AbortSignal) { if (signal?.aborted) throw exportCancelled(); }

export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(exportCancelled());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}
