import { FFmpeg } from '@ffmpeg/ffmpeg';
import workerURL from '@ffmpeg/ffmpeg/worker?url';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

let ffmpegSingleton: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

export type FfmpegProgress = {
  ratio: number; // 0..1
};

export async function getFFmpeg(onProgress?: (p: FfmpegProgress) => void): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton;
  if (loadPromise) return loadPromise;

  console.info('[ffmpeg] getFFmpeg() creating instance');
  const ffmpeg = new FFmpeg();
  if (onProgress) {
    ffmpeg.on('progress', ({ progress }) => onProgress({ ratio: progress }));
  }
  ffmpeg.on('log', ({ type, message }) => {
    // Forward ffmpeg internal logs to the console for debugging.
    const fn = type === 'fferr' ? console.warn : console.debug;
    fn(`[ffmpeg:${type}] ${message}`);
  });

  loadPromise = (async () => {
    // With module workers, use the official ESM core exports so `import()` works reliably in dev.
    onProgress?.({ ratio: 0 });
    const classWorkerURL = workerURL;
    console.info('[ffmpeg] env', {
      crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : undefined,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      userAgent: navigator.userAgent,
    });
    // Preflight fetch to surface 404/MIME issues immediately.
    try {
      const head = async (url: string) => {
        const r = await fetch(url, { method: 'HEAD' });
        return {
          url,
          ok: r.ok,
          status: r.status,
          contentType: r.headers.get('content-type'),
          contentLength: r.headers.get('content-length'),
        };
      };
      console.info('[ffmpeg] preflight', {
        worker: await head(classWorkerURL),
        core: await head(coreURL),
        wasm: await head(wasmURL),
      });
    } catch (e) {
      console.warn('[ffmpeg] preflight failed (non-fatal)', e);
    }
    console.info('[ffmpeg] load() starting', { classWorkerURL, coreURL, wasmURL });
    const t0 = performance.now();
    try {
      // Add a slow-load warning so we know it's truly hanging.
      const warnTimer = window.setTimeout(() => {
        console.warn('[ffmpeg] load() still pending after 10s', { classWorkerURL, coreURL, wasmURL });
      }, 10_000);
      try {
        await ffmpeg.load({ classWorkerURL, coreURL, wasmURL });
      } finally {
        window.clearTimeout(warnTimer);
      }
    } catch (e) {
      console.error('[ffmpeg] load() failed', e);
      throw e;
    } finally {
      const dt = Math.round(performance.now() - t0);
      console.info('[ffmpeg] load() finished', { ms: dt });
    }
    onProgress?.({ ratio: 1 });
    ffmpegSingleton = ffmpeg;
    return ffmpeg;
  })();

  return loadPromise;
}


