import { getSegmentTitles } from '../../electron/segmentTitles';
import { fetchFile } from '@ffmpeg/util';
import { getFFmpeg } from '@/lib/ffmpegSingleton';
import { splitSegmentsAcrossClips } from '@/lib/clipTimeline';
import type { MainLabel, Segment, VideoClip } from '@/types/project';
import { renderClipExport, type ExportPiece } from '../../electron/clipExportCore';

export async function exportClipSequence(clips: VideoClip[], inputs: (File | string)[], segments: Segment[],
  opts: { addGap?: boolean; mainLabels: MainLabel[]; onProgress?: (phase: string, ratio: number) => void }) {
  if (inputs.length !== clips.length) throw new Error('Restore all original clips before exporting.');
  const pieces: ExportPiece[] = splitSegmentsAcrossClips(clips, segments).map((part) => {
    const label = opts.mainLabels.find((item) => item.id === part.segment.mainLabelId);
    return { ...part, ...getSegmentTitles(part.segment, label) };
  });
  if (!pieces.length) throw new Error('No segments to export.');
  if (window.electron && inputs.every((input) => typeof input === 'string' && input.startsWith('file://'))) {
    const data = await window.electron.runNativeClipExport({
      inputPaths: inputs as string[], pieces, addGap: !!opts.addGap,
    });
    return new Blob([new Uint8Array(data)], { type: 'video/mp4' });
  }
  opts.onProgress?.('Loading export engine', 0);
  const ffmpeg = await getFFmpeg();
  const fontName = 'sequence-font.ttf';
  const probeName = 'sequence-probe.json';
  try {
    const font = await fetch(new URL('fonts/Roboto-Bold.ttf', window.location.href));
    if (!font.ok) throw new Error('Could not load the font for export labels.');
    await ffmpeg.writeFile(fontName, new Uint8Array(await font.arrayBuffer()));
    const data = await renderClipExport({
      fontName,
      loadSource: async (index) => {
        const name = `sequence-input-${index}`;
        try { await ffmpeg.writeFile(name, await fetchFile(inputs[index])); }
        catch (error) { await ffmpeg.deleteFile(name).catch(() => {}); throw error; }
        return name;
      },
      releaseSource: async (name) => { await ffmpeg.deleteFile(name); },
      probe: async (name) => {
        await ffmpeg.deleteFile(probeName).catch(() => {});
        // This core's ffprobe can return -1 on success; validate its fresh JSON output.
        await ffmpeg.ffprobe(['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', name, '-o', probeName]);
        const json = JSON.parse(new TextDecoder().decode(await ffmpeg.readFile(probeName) as Uint8Array)) as {
          streams: { codec_type: string; width?: number; height?: number }[];
        };
        const video = json.streams.find((stream) => stream.codec_type === 'video');
        if (!video?.width || !video.height) throw new Error('This clip has no readable video stream.');
        return { width: video.width, height: video.height, hasAudio: json.streams.some((stream) => stream.codec_type === 'audio') };
      },
      exec: async (args) => { const code = await ffmpeg.exec(args); if (code !== 0) throw new Error(`Video export failed (FFmpeg exit code ${code}).`); },
      write: async (name, data) => { await ffmpeg.writeFile(name, data); },
      read: async (name) => await ffmpeg.readFile(name) as Uint8Array,
      remove: async (name) => { await ffmpeg.deleteFile(name); },
    }, pieces, !!opts.addGap, opts.onProgress);
    return new Blob([new Uint8Array(data)], { type: 'video/mp4' });
  } finally {
    await Promise.all([fontName, probeName].map((name) => ffmpeg.deleteFile(name).catch(() => {})));
  }
}
