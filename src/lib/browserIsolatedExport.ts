import type { FFFSType } from '@ffmpeg/ffmpeg';
import type { ClipExportBackend } from '../../electron/clipExportCore';
import { checkExportCancelled } from '../../electron/exportCancellation';
import { withBrowserExport } from './browserExportSession';
import { loadBrowserExportSource } from './browserExportSource';
import { probeExportMedia } from './exportMediaProbe';
import { runWasmExportCommand } from './exportProgress';
import { recordDiagnostic } from './diagnostics';

type Media = Awaited<ReturnType<typeof probeExportMedia>>;
type Backend = ClipExportBackend & { probeMedia: (name: string) => Promise<Media> };

/** Completed MP4s belong to the active job, never to a reusable WASM heap.
 * Every probe, render attempt and final assembly gets a separately released worker.
 * These temporary Blobs survive a piece retry, but intentionally not a page reload.
 */
export async function withIsolatedBrowserExport<T>(inputs: (File | string)[], signal: AbortSignal | undefined,
  work: (backend: Backend) => Promise<T>): Promise<T> {
  checkExportCancelled(signal);
  const fontResponse = await fetch(new URL('fonts/Roboto-Bold.ttf', window.location.href), { signal });
  if (!fontResponse.ok) throw new Error('Could not load the font for export labels.');
  const font = new Uint8Array(await fontResponse.arrayBuffer());
  checkExportCancelled(signal);
  const sources = new Map<number, Promise<File>>();
  const probes = new Map<string, Promise<Media>>();
  const completed = new Map<string, Blob>();
  const manifests = new Map<string, Uint8Array>();
  const sourceName = (index: number) => `source-${index}`;
  const sourceIndex = (name: string) => inputs.findIndex((_, index) => name === sourceName(index));
  const sourceFile = (index: number) => {
    if (!sources.has(index)) sources.set(index, (async () => {
      checkExportCancelled(signal);
      const input = inputs[index];
      if (typeof input !== 'string') return input;
      // Resolve URL inputs once, then mount their Blob slices on each worker too.
      const response = await fetch(input, { signal });
      if (!response.ok) throw new Error('Could not open the video for export.');
      const blob = await response.blob();
      checkExportCancelled(signal);
      return new File([blob], `source-${index}`, { type: blob.type });
    })());
    return sources.get(index)!;
  };
  const probeMedia = (name: string) => {
    checkExportCancelled(signal);
    const index = sourceIndex(name);
    if (index < 0) throw new Error('Unknown export source.');
    if (!probes.has(name)) probes.set(name, (async () => {
      const file = await sourceFile(index);
      checkExportCancelled(signal);
      return withBrowserExport(signal, async (engine) => {
        const source = await loadBrowserExportSource(engine, file, name);
        try {
          checkExportCancelled(signal);
          const media = await probeExportMedia(engine, source.path, `source-probe_${index}.json`, index);
          checkExportCancelled(signal);
          return media;
        } finally { await source.release().catch(() => {}); }
      });
    })());
    return probes.get(name)!;
  };
  const backend: Backend = {
    fontName: 'font.ttf',
    loadSource: async (index) => {
      checkExportCancelled(signal);
      if (!inputs[index]) throw new Error('Restore all original clips before exporting.');
      return sourceName(index);
    },
    // Source Files are job-owned; individual worker mounts are released below.
    releaseSource: async () => {},
    probeMedia,
    probe: async (name) => {
      const media = await probeMedia(name);
      const video = media.streams.find(stream => stream.codec_type === 'video');
      if (!video?.width || !video.height) throw new Error('This clip has no readable video stream.');
      return { width: Number(video.width), height: Number(video.height), hasAudio: media.streams.some(stream => stream.codec_type === 'audio') };
    },
    exec: async (args, onTime, context = {}) => {
      const output = args.at(-1)!;
      // Retry the exact failed command once, never replay already completed clips.
      for (let attempt = 1; attempt <= 2; attempt++) {
        checkExportCancelled(signal);
        try {
          const files = await Promise.all(inputs.map(async (_, index) => args.includes(sourceName(index))
            ? { index, file: await sourceFile(index) } : null));
          checkExportCancelled(signal);
          const blob = await withBrowserExport(signal, async (engine) => {
            const mounts: Awaited<ReturnType<typeof loadBrowserExportSource>>[] = [];
            let stagedMounted = false;
            let stagedCreated = false;
            try {
              const command = [...args];
              for (const entry of files) {
                if (!entry) continue;
                checkExportCancelled(signal);
                const source = await loadBrowserExportSource(engine, entry.file, sourceName(entry.index));
                mounts.push(source);
                for (let i = 0; i < command.length; i++) if (command[i] === sourceName(entry.index)) command[i] = source.path;
              }
              checkExportCancelled(signal);
              const lists = [...manifests].filter(([name]) => args.includes(name));
              if (lists.length) {
                await engine.createDir('/completed'); stagedCreated = true;
                checkExportCancelled(signal);
                stagedMounted = await engine.mount('WORKERFS' as FFFSType,
                  { blobs: [...completed].map(([name, data]) => ({ name, data })) }, '/completed');
                if (!stagedMounted) throw new Error('Could not open completed clips for assembly.');
                for (const [name, data] of lists) {
                  const text = new TextDecoder().decode(data).replace(/file '([^']+)'/g, (_, path: string) => {
                    if (!completed.has(path)) throw new Error('A completed export clip is missing.');
                    return `file '/completed/${path}'`;
                  });
                  await engine.writeFile(name, new TextEncoder().encode(text));
                }
              }
              if (args.some(arg => arg.includes('drawtext='))) await engine.writeFile(backend.fontName, new Uint8Array(font));
              checkExportCancelled(signal);
              await runWasmExportCommand(engine, command, onTime, { ...context, attempt, isolatedWorker: true });
              checkExportCancelled(signal);
              const bytes = await engine.readFile(output);
              if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('The export engine produced an empty clip.');
              return new Blob([new Uint8Array(bytes)], { type: 'video/mp4' });
            } finally {
              await Promise.all(mounts.map(source => source.release().catch(() => {})));
              if (stagedMounted) await engine.unmount('/completed').catch(() => {});
              if (stagedCreated) await engine.deleteDir('/completed').catch(() => {});
              // Filesystem cleanup is also useful to adapters; worker termination
              // in withBrowserExport remains the definitive heap cleanup.
              await Promise.all([output, backend.fontName, ...manifests.keys()].map(name => engine.deleteFile(name).catch(() => {})));
            }
          });
          checkExportCancelled(signal);
          completed.set(output, blob);
          recordDiagnostic('info', 'export', 'piece.retained', { ...context, attempt, bytes: blob.size,
            completedFiles: completed.size, retainedBytes: [...completed.values()].reduce((sum, file) => sum + file.size, 0) });
          return;
        } catch (error) {
          checkExportCancelled(signal);
          if (attempt === 2) throw error;
          recordDiagnostic('warning', 'export', 'piece.retry', { ...context, failedAttempt: attempt, nextAttempt: attempt + 1 }, error);
        }
      }
    },
    write: async (name, data) => { checkExportCancelled(signal); manifests.set(name, data); },
    read: async (name) => {
      checkExportCancelled(signal);
      const blob = completed.get(name);
      if (!blob) throw new Error('A completed export clip is missing.');
      return new Uint8Array(await blob.arrayBuffer());
    },
    remove: async (name) => { completed.delete(name); manifests.delete(name); },
  };
  try { return await work(backend); }
  finally { completed.clear(); manifests.clear(); sources.clear(); probes.clear(); }
}
