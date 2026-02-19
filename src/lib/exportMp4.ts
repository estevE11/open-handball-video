import { fetchFile } from '@ffmpeg/util';

import type { MainLabel, Segment } from '@/types/project';
import { getFFmpeg } from '@/lib/ffmpegSingleton';

function toFixedSec(v: number): string {
  return (Math.max(0, v) || 0).toFixed(3);
}

function escapeFfmpegText(text: string): string {
  // ffmpeg drawtext needs ':' and '\' escaped.
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "'\\\\''");
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
  addGap?: boolean;
  mainLabels?: MainLabel[];
};

export async function exportFilteredSegmentsToMp4(
  videoInput: File | string,
  segments: Segment[],
  outputName = 'export.mp4',
  opts: ExportMp4Options = {},
): Promise<Blob> {
  const onProgress = opts.onProgress ?? (() => {});
  const addGap = opts.addGap ?? false;
  const mainLabels = opts.mainLabels ?? [];

  // ELECTRON NATIVE EXPORT PATH
  if (window.electron && typeof videoInput === 'string' && videoInput.startsWith('file://')) {
    const inputPath = decodeURIComponent(videoInput.replace(/^file:\/\//, ''));
    // Use a unique temp path for the native export
    const outputPath = inputPath.replace(/\.[^/.]+$/, "") + `_export_${Date.now()}.mp4`;
    
    console.info('[export] using native electron export', { inputPath, outputPath });
    onProgress('native:export', 0);
    
    try {
      await window.electron.runNativeExport({
        inputPath,
        outputPath,
        segments,
        addGap,
        mainLabels
      });
      onProgress('native:export', 1);

      // Read the resulting file back as a blob
      const data = await window.electron.readFile(outputPath);
      
      // Ensure we return a Blob backed by a normal ArrayBuffer (not SharedArrayBuffer).
      const buffer = new Uint8Array(data.length);
      buffer.set(data);
      const blob = new Blob([buffer], { type: 'video/mp4' });
      
      return blob;
    } catch (err) {
      console.error('[export] native export failed', err);
      throw new Error(`Native export failed: ${err}. Ensure FFmpeg is installed on your system.`);
    }
  }

  // BROWSER / WASM EXPORT PATH
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

  // Load font file for overlays
  const fontName = 'font.ttf';
  try {
    // Construct font URL relative to the current page to handle Electron file:// and Vite dev/prod
    const fontUrl = new URL('fonts/Roboto-Bold.ttf', window.location.href).href;
    console.info('[export] fetching font from', fontUrl);
    const fontResponse = await fetch(fontUrl);
    if (!fontResponse.ok) throw new Error(`HTTP error! status: ${fontResponse.status}`);
    const fontData = await fontResponse.arrayBuffer();
    await ffmpeg.writeFile(fontName, new Uint8Array(fontData));
    console.info('[export] font loaded');
  } catch (err) {
    console.warn('[export] failed to load font, overlay might look poor or fail', err);
  }

  const inputName = `input_${Date.now()}.mp4`;
  await safeDelete(ffmpeg, inputName);
  onProgress('ffmpeg:write-input', 0);
  console.info('[export] writing input to ffmpeg FS', { inputName });
  try {
    let videoData: Uint8Array;
    if (typeof videoInput === 'string' && videoInput.startsWith('file://') && window.electron) {
      // Strip protocol and handle URL encoding (spaces, etc)
      const filePath = decodeURIComponent(videoInput.replace(/^file:\/\//, ''));
      console.info('[export] reading local file via electron', filePath);
      videoData = await window.electron.readFile(filePath);
    } else {
      videoData = await fetchFile(videoInput);
    }
    await ffmpeg.writeFile(inputName, videoData);
  } catch (err) {
    console.error('[export] failed to fetch video input', err);
    throw new Error(`Could not load video file for export. If you are using Electron, ensure the file still exists at the original path. (Error: ${err})`);
  }
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

  // If addGap is enabled, we create a 0.5s black clip matching the first clip's settings
  const gapName = 'gap.mp4';
  if (addGap) {
    onProgress('ffmpeg:create-gap', 0);
    console.info('[export] creating 0.5s black gap clip');
    await safeDelete(ffmpeg, gapName);
    // Take a small bit from the beginning and make it black/silent
    await ffmpeg.exec([
      '-hide_banner',
      '-y',
      '-ss', '0',
      '-t', '0.5',
      '-i', inputName,
      '-vf', 'drawbox=t=fill:c=black',
      '-af', 'volume=0',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-c:a', 'aac',
      gapName
    ]);
    onProgress('ffmpeg:create-gap', 1);
  }

  const clipNames: string[] = [];
  for (let i = 0; i < valid.length; i++) {
    const seg = valid[i]!;
    const clipName = `clip_${i}.mp4`;
    clipNames.push(clipName);
    await safeDelete(ffmpeg, clipName);

    const start = toFixedSec(seg.startTimeSec);
    const dur = toFixedSec(seg.endTimeSec - seg.startTimeSec);

    // Overlay logic
    const label = mainLabels.find(l => l.id === seg.mainLabelId);
    const primaryText = label?.defaultName || label?.name || 'Tag';
    const secondaryText = (label?.defaultName && label?.name !== label?.defaultName) ? label?.name : null;

    let vf = 'format=yuv420p';
    vf += `,drawtext=fontfile=${fontName}:text='${escapeFfmpegText(primaryText)}':x=30:y=30:fontsize=44:fontcolor=white:shadowcolor=black@0.6:shadowx=2:shadowy=2`;
    if (secondaryText) {
      vf += `,drawtext=fontfile=${fontName}:text='${escapeFfmpegText(secondaryText)}':x=30:y=85:fontsize=22:fontcolor=white:shadowcolor=black@0.6:shadowx=2:shadowy=2`;
    }

    onProgress('ffmpeg:cut', i / valid.length);
    console.info('[export] cutting clip', {
      i: i + 1,
      total: valid.length,
      clipName,
      start,
      dur,
      vf,
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
        vf,
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
    } catch (err) {
      console.warn('[export] re-encode failed, falling back to -c copy (no overlay)', { clipName, err });
      await ffmpeg.exec(['-hide_banner', '-y', '-ss', start, '-t', dur, '-i', inputName, '-c', 'copy', clipName]);
    }

    if (addGap && i < valid.length - 1) {
      clipNames.push(gapName);
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
    // Try stream copy first (fastest)
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
  void safeDelete(ffmpeg, fontName);
  if (addGap) void safeDelete(ffmpeg, gapName);
  // Only delete clips that were actually created uniquely
  for (let i = 0; i < valid.length; i++) void safeDelete(ffmpeg, `clip_${i}.mp4`);

  const blob = new Blob([copy], { type: 'video/mp4' });
  console.info('[export] done', { bytes: blob.size });
  console.groupEnd();
  return blob;
}


