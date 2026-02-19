import { fetchFile } from '@ffmpeg/util';

import type { Segment } from '@/types/project';
import { getFFmpeg } from '@/lib/ffmpegSingleton';

function toFixedSec(v: number): string {
  return (Math.max(0, v) || 0).toFixed(3);
}

async function safeDelete(ffmpeg: { deleteFile: (path: string) => Promise<boolean> }, path: string) {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // ignore
  }
}

export type ExportMp4Options = {
  onProgress?: (phase: string, ratio: number) => void;
};

export async function exportFilteredSegmentsToMp4(
  videoInput: File | string,
  segments: Segment[],
  outputName = 'export.mp4',
  opts: ExportMp4Options = {},
): Promise<Blob> {
  const onProgress = opts.onProgress ?? (() => {});

  // Expanded group so logs are visible without clicking.
  console.group('[export] start');
  if (videoInput instanceof File) {
    console.info('[export] input video', {
      name: videoInput.name,
      size: videoInput.size,
      type: videoInput.type,
      lastModified: videoInput.lastModified,
    });
  } else {
    console.info('[export] input video URL', videoInput);
  }
  console.info('[export] segments (raw)', segments.length);

  console.info('[export] calling getFFmpeg()…');
  const ffmpeg = await getFFmpeg((p) => onProgress('ffmpeg:load', p.ratio));
  console.info('[export] getFFmpeg() resolved (core loaded)');

  const inputName = `input_${Date.now()}.mp4`;
  await safeDelete(ffmpeg, inputName);
  onProgress('ffmpeg:write-input', 0);
  console.info('[export] writing input to ffmpeg FS', { inputName });
  await ffmpeg.writeFile(inputName, await fetchFile(videoInput));
  onProgress('ffmpeg:write-input', 1);
  console.info('[export] wrote input', { inputName });

  const valid = segments
    .map((s) => ({
      ...s,
      startTimeSec: Math.max(0, s.startTimeSec),
      endTimeSec: Math.max(0, s.endTimeSec),
    }))
    .filter((s) => s.endTimeSec > s.startTimeSec + 0.02)
    .sort((a, b) => a.startTimeSec - b.startTimeSec);

  if (valid.length === 0) {
    console.error('[export] no valid segments after filtering');
    console.groupEnd();
    throw new Error('No segments to export.');
  }
  console.info('[export] segments (valid)', valid.length);

  const clipNames: string[] = [];
  for (let i = 0; i < valid.length; i++) {
    const seg = valid[i]!;
    const clipName = `clip_${i}.mp4`;
    clipNames.push(clipName);
    await safeDelete(ffmpeg, clipName);

    const start = toFixedSec(seg.startTimeSec);
    const dur = toFixedSec(seg.endTimeSec - seg.startTimeSec);

    onProgress('ffmpeg:cut', i / valid.length);
    console.info('[export] cutting clip', {
      i: i + 1,
      total: valid.length,
      clipName,
      start,
      dur,
    });

    // Prefer re-encode for reliability; fall back to stream copy if codec isn't available.
    try {
      await ffmpeg.exec([
        '-hide_banner',
        '-y',
        '-ss',
        start,
        '-t',
        dur,
        '-i',
        inputName,
        '-vf',
        'format=yuv420p',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        clipName,
      ]);
    } catch {
      console.warn('[export] re-encode failed, falling back to -c copy', { clipName });
      await ffmpeg.exec(['-hide_banner', '-y', '-ss', start, '-t', dur, '-i', inputName, '-c', 'copy', clipName]);
    }
  }
  onProgress('ffmpeg:cut', 1);

  const concatList = clipNames.map((n) => `file '${n}'`).join('\n');
  const concatName = `concat_${Date.now()}.txt`;
  await safeDelete(ffmpeg, concatName);
  console.info('[export] writing concat list', { concatName, clips: clipNames.length });
  await ffmpeg.writeFile(concatName, new TextEncoder().encode(concatList));

  const outName = outputName.endsWith('.mp4') ? outputName : `${outputName}.mp4`;
  await safeDelete(ffmpeg, outName);

  onProgress('ffmpeg:concat', 0);
  console.info('[export] concat start', { outName });
  try {
    await ffmpeg.exec(['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', concatName, '-c', 'copy', outName]);
  } catch {
    // If stream copy concat fails (codec mismatch), re-encode the concat.
    console.warn('[export] concat -c copy failed, re-encoding concat');
    await ffmpeg.exec([
      '-hide_banner',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatName,
      '-vf',
      'format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      outName,
    ]);
  }
  onProgress('ffmpeg:concat', 1);
  console.info('[export] concat done', { outName });

  const data = (await ffmpeg.readFile(outName)) as Uint8Array;
  // Ensure we return a Blob backed by a normal ArrayBuffer (not SharedArrayBuffer).
  const copy = new Uint8Array(data.length);
  copy.set(data);

  // Best effort cleanup; keep ffmpeg loaded for next export.
  void safeDelete(ffmpeg, inputName);
  void safeDelete(ffmpeg, concatName);
  for (const n of clipNames) void safeDelete(ffmpeg, n);

  const blob = new Blob([copy], { type: 'video/mp4' });
  console.info('[export] done', { bytes: blob.size });
  console.groupEnd();
  return blob;
}


