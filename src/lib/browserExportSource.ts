import type { FFFSType, FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { recordDiagnostic } from './diagnostics';

type SourceEngine = Pick<FFmpeg, 'createDir' | 'deleteDir' | 'mount' | 'unmount' | 'writeFile' | 'deleteFile'>;

/** WORKERFS reads File slices on demand instead of copying a whole match into MEMFS. */
export async function loadBrowserExportSource(engine: SourceEngine, input: File | string, name: string) {
  if (typeof input !== 'string') {
    const directory = `/source-${name}`;
    await engine.createDir(directory);
    try {
      const mounted = await engine.mount('WORKERFS' as FFFSType, { blobs: [{ name, data: input }] }, directory);
      if (!mounted) throw new Error('Could not open the video for export.');
    } catch (error) {
      await engine.deleteDir(directory).catch(() => {});
      throw error;
    }
    recordDiagnostic('info', 'export', 'source.opened', { mode: 'file-mount', bytes: input.size });
    return {
      path: `${directory}/${name}`,
      release: async () => {
        await engine.unmount(directory);
        await engine.deleteDir(directory);
      },
    };
  }

  // Retain URL compatibility for sources that are not supplied as browser Files.
  try {
    await engine.writeFile(name, await fetchFile(input));
  } catch (error) {
    await engine.deleteFile(name).catch(() => {});
    throw error;
  }
  recordDiagnostic('info', 'export', 'source.opened', { mode: 'url-copy' });
  return { path: name, release: async () => { await engine.deleteFile(name); } };
}
