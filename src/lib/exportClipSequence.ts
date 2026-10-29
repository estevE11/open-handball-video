import { runWasmExportCommand, withNativeExportProgress } from '@/lib/exportProgress';
import { monotonicProgress } from '../../electron/exportProgress';
import { getSegmentTitles } from '../../electron/segmentTitles';
import { loadBrowserExportSource } from '@/lib/browserExportSource';
import { withBrowserExport } from '@/lib/browserExportSession';
import { checkExportCancelled } from '../../electron/exportCancellation';
import { splitSegmentsAcrossClips } from '@/lib/clipTimeline';
import type { MainLabel, Segment, VideoClip } from '@/types/project';
import { renderClipExport, type ExportPiece } from '../../electron/clipExportCore';
import { probeExportMedia } from './exportMediaProbe';

export async function exportClipSequence(clips: VideoClip[], inputs: (File | string)[], segments: Segment[],
  opts: { signal?: AbortSignal; addGap?: boolean; mainLabels: MainLabel[]; onProgress?: (phase: string, ratio: number) => void }) {
  const report = monotonicProgress((phase, ratio) => { if (!opts.signal?.aborted) opts.onProgress?.(phase, ratio); });
  checkExportCancelled(opts.signal);
  if (inputs.length !== clips.length) throw new Error('Restore all original clips before exporting.');
  const pieces: ExportPiece[] = splitSegmentsAcrossClips(clips, segments).map((part) => {
    const label = opts.mainLabels.find((item) => item.id === part.segment.mainLabelId);
    return { ...part, ...getSegmentTitles(part.segment, label) };
  });
  if (!pieces.length) throw new Error('No segments to export.');
  if (window.electron && inputs.every((input) => typeof input === 'string' && input.startsWith('file://'))) {
    const data = await withNativeExportProgress((exportId) => window.electron!.runNativeClipExport({
      exportId,
      inputPaths: inputs as string[], pieces, addGap: !!opts.addGap,
    }), report, opts.signal);
    return new Blob([new Uint8Array(data)], { type: 'video/mp4' });
  }
  report('Loading export engine', 0);
  return withBrowserExport(opts.signal, async (ffmpeg) => {
  const fontName = 'sequence-font.ttf';
  const probeName = 'sequence-probe.json';
  let result: Blob;
  const sources = new Map<string, Awaited<ReturnType<typeof loadBrowserExportSource>>>();
  try {
    const font = await fetch(new URL('fonts/Roboto-Bold.ttf', window.location.href), { signal: opts.signal });
    if (!font.ok) throw new Error('Could not load the font for export labels.');
    await ffmpeg.writeFile(fontName, new Uint8Array(await font.arrayBuffer()));
    const data = await renderClipExport({
      fontName,
      loadSource: async (index) => {
        checkExportCancelled(opts.signal);
        const source = await loadBrowserExportSource(ffmpeg, inputs[index], `sequence-input-${index}`);
        sources.set(source.path, source);
        return source.path;
      },
      releaseSource: async (name) => {
        await sources.get(name)?.release();
        sources.delete(name);
      },
      probe: async (name) => {
        checkExportCancelled(opts.signal);
        const sourceIndex = Number(name.match(/sequence-input-(\d+)$/)?.[1] ?? 0);
        const json = await probeExportMedia(ffmpeg, name, probeName, sourceIndex);
        const video = json.streams.find((stream) => stream.codec_type === 'video');
        if (!video?.width || !video.height) throw new Error('This clip has no readable video stream.');
        return { width: Number(video.width), height: Number(video.height), hasAudio: json.streams.some((stream) => stream.codec_type === 'audio') };
      },
      exec: (args, onTime, context) => {
        checkExportCancelled(opts.signal);
        return runWasmExportCommand(ffmpeg, args, onTime, context);
      },
      write: async (name, data) => { await ffmpeg.writeFile(name, data); },
      read: async (name) => await ffmpeg.readFile(name) as Uint8Array,
      remove: async (name) => { await ffmpeg.deleteFile(name); },
    }, pieces, !!opts.addGap, report);
    result = new Blob([new Uint8Array(data)], { type: 'video/mp4' });
  } finally {
    await Promise.all([...sources.values()].map(source => source.release().catch(() => {})));
    await Promise.all([fontName, probeName].map((name) => ffmpeg.deleteFile(name).catch(() => {})));
  }
  report('Export ready', 1);
  checkExportCancelled(opts.signal);
  return result;
  });
}
