import { FFmpegExitError, runWasmExportCommand, withNativeExportProgress } from '@/lib/exportProgress';
import { monotonicProgress } from '../../electron/exportProgress';
import { getSegmentTitles } from '../../electron/segmentTitles';
import { loadBrowserExportSource } from '@/lib/browserExportSource';

import type { MainLabel, Segment } from '@/types/project';
import { withBrowserExport } from '@/lib/browserExportSession';
import { checkExportCancelled } from '../../electron/exportCancellation';
import { recordDiagnostic } from '@/lib/diagnostics';

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
  signal?: AbortSignal;
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
  const onProgress = monotonicProgress((phase, ratio) => { if (!opts.signal?.aborted) opts.onProgress?.(phase, ratio); });
  checkExportCancelled(opts.signal);
  const addGap = opts.addGap ?? false;
  const mainLabels = opts.mainLabels ?? [];

  // ELECTRON NATIVE EXPORT PATH
  if (window.electron && typeof videoInput === 'string' && videoInput.startsWith('file://')) {
    const inputPath = videoInput;

    try {
      const data = await withNativeExportProgress((exportId) => window.electron!.runNativeExport({
        exportId,
        inputPath,
        segments,
        addGap,
        mainLabels
      }), onProgress, opts.signal);

      // Ensure we return a Blob backed by a normal ArrayBuffer (not SharedArrayBuffer).
      const buffer = new Uint8Array(data.length);
      buffer.set(data);
      const blob = new Blob([buffer], { type: 'video/mp4' });
      
      return blob;
    } catch (err) {
      checkExportCancelled(opts.signal);
      recordDiagnostic('error', 'export', 'native.failed', undefined, err);
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
  onProgress('Loading export engine', 0);
  return withBrowserExport(opts.signal, async (ffmpeg) => {
  console.info('[export] getFFmpeg() resolved (core loaded)');

  const temporaryFiles = new Set<string>();
  let commandProgress: ((seconds: number) => void) | undefined;
  const runFFmpeg = (args: string[]) => runWasmExportCommand(ffmpeg, args, commandProgress);
  let result: Blob;
  let source: Awaited<ReturnType<typeof loadBrowserExportSource>> | undefined;

  try {
    // Load font file for overlays
    const fontName = 'font.ttf';
    temporaryFiles.add(fontName);
    try {
      // Construct font URL relative to the current page to handle Electron file:// and Vite dev/prod
      const fontUrl = new URL('fonts/Roboto-Bold.ttf', window.location.href).href;
      console.info('[export] fetching font from', fontUrl);
      const fontResponse = await fetch(fontUrl, { signal: opts.signal });
      if (!fontResponse.ok) throw new Error(`HTTP error! status: ${fontResponse.status}`);
      const fontData = await fontResponse.arrayBuffer();
      await ffmpeg.writeFile(fontName, new Uint8Array(fontData));
      console.info('[export] font loaded');
    } catch (err) {
      checkExportCancelled(opts.signal);
      console.warn('[export] failed to load font, overlay might look poor or fail', err);
      recordDiagnostic('warning', 'export', 'font.load_failed', undefined, err);
    }

    onProgress('Loading source video', 0.03);
    try {
      source = await loadBrowserExportSource(ffmpeg, videoInput, `input_${Date.now()}.mp4`);
    } catch (err) {
      console.error('[export] failed to fetch video input', err);
      throw new Error(`Could not load video file for export. If you are using Electron, ensure the file still exists at the original path. (Error: ${err})`);
    }
    const inputName = source.path;
    onProgress('Preparing clips', 0.1);
    console.info('[export] wrote input', { inputName });

    const valid = segments
      .map((s) => ({
        ...s,
        startTimeSec: Math.max(0, s.startTimeSec),
        endTimeSec: Math.max(0, s.endTimeSec),
      }))
      .filter((s) => s.endTimeSec > s.startTimeSec + 0.02);

    if (valid.length === 0) {
      console.error('[export] no valid segments after filtering');
      throw new Error('No segments to export.');
    }
    if (valid.length !== segments.length) recordDiagnostic('warning', 'export', 'segments.skipped', { requestedCount: segments.length, validCount: valid.length, minimumDurationSec: 0.02 });
    console.info('[export] segments (valid)', valid.length);

    // If addGap is enabled, we create a 0.5s black clip matching the first clip's settings
    const gapName = 'gap.mp4';
    if (addGap) {
      temporaryFiles.add(gapName);
      onProgress('Rendering gaps', 0.1);
      commandProgress = (seconds) => onProgress('Rendering gaps', 0.1 + Math.min(1, seconds / 0.5) * 0.05);
      console.info('[export] creating 0.5s black gap clip');
      await safeDelete(ffmpeg, gapName);
      const probeName = `audio-probe_${Date.now()}.json`;
      temporaryFiles.add(probeName);
      await safeDelete(ffmpeg, probeName);
      // Validate fresh output: this WASM core's ffprobe can report -1 on success.
      recordDiagnostic('info', 'export', 'gap.audio_probe_started');
      await ffmpeg.ffprobe(['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', inputName, '-o', probeName]);
      const probe = JSON.parse(new TextDecoder().decode(await ffmpeg.readFile(probeName) as Uint8Array)) as {
        streams: { codec_type: string }[];
      };
      const hasAudio = probe.streams.some((stream) => stream.codec_type === 'audio');
      recordDiagnostic('info', 'export', 'gap.audio_probe_completed', { hasAudio, streamCount: probe.streams.length });
      // Preserve video-only sources; only mute an audio stream when one exists.
      await runFFmpeg([
        '-hide_banner',
        '-y',
        '-ss', '0',
        '-t', '0.5',
        '-i', inputName,
        '-vf', 'drawbox=t=fill:c=black',
        ...(hasAudio ? ['-af', 'volume=0'] : ['-an']),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-c:a', 'aac',
        gapName
      ]);
      onProgress('Rendering gaps', 0.15);
    }

    const totalDuration = valid.reduce((sum, seg) => sum + seg.endTimeSec - seg.startTimeSec, 0);
    let renderedDuration = 0;
    const clipNames: string[] = [];
    for (let i = 0; i < valid.length; i++) {
      const seg = valid[i]!;
      const clipName = `clip_${i}.mp4`;
      clipNames.push(clipName);
      temporaryFiles.add(clipName);
      await safeDelete(ffmpeg, clipName);

      const start = toFixedSec(seg.startTimeSec);
      const dur = toFixedSec(seg.endTimeSec - seg.startTimeSec);

      // Overlay logic
      const label = mainLabels.find(l => l.id === seg.mainLabelId);
      const { primaryText, secondaryText } = getSegmentTitles(seg, label);

      let vf = 'format=yuv420p';
      vf += `,drawtext=fontfile=${fontName}:expansion=none:text='${escapeFfmpegText(primaryText)}':x=30:y=30:fontsize=44:fontcolor=white:shadowcolor=black@0.6:shadowx=2:shadowy=2`;
      if (secondaryText) {
        vf += `,drawtext=fontfile=${fontName}:expansion=none:text='${escapeFfmpegText(secondaryText)}':x=30:y=85:fontsize=22:fontcolor=white:shadowcolor=black@0.6:shadowx=2:shadowy=2`;
      }

      const phase = `Rendering clip ${i + 1} of ${valid.length}`;
      commandProgress = (seconds) => onProgress(phase, 0.15 + (renderedDuration + Math.min(Number(dur), seconds)) / totalDuration * 0.7);
      commandProgress(0);
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
        await runFFmpeg([
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
        checkExportCancelled(opts.signal);
        if (!(err instanceof FFmpegExitError)) throw err;
        console.warn('[export] re-encode failed, falling back to -c copy (no overlay)', { clipName, err });
        await runFFmpeg(['-hide_banner', '-y', '-ss', start, '-t', dur, '-i', inputName, '-c', 'copy', clipName]);
      }

      renderedDuration += seg.endTimeSec - seg.startTimeSec;
      onProgress(phase, 0.15 + renderedDuration / totalDuration * 0.7);
      if (addGap && i < valid.length - 1) {
        clipNames.push(gapName);
      }
    }

    // Encoding no longer needs the original; release it before concatenation.
    await source.release();
    source = undefined;
    const concatList = clipNames.map((n) => `file '${n}'`).join('\n');
    const concatName = `concat_${Date.now()}.txt`;
    temporaryFiles.add(concatName);
    await safeDelete(ffmpeg, concatName);
    console.info('[export] writing concat list', { concatName, clips: clipNames.length });
    await ffmpeg.writeFile(concatName, new TextEncoder().encode(concatList));

    const outName = outputName.endsWith('.mp4') ? outputName : `${outputName}.mp4`;
    temporaryFiles.add(outName);
    await safeDelete(ffmpeg, outName);

    const outputDuration = totalDuration + (addGap ? (valid.length - 1) * 0.5 : 0);
    commandProgress = (seconds) => onProgress('Merging tagged clips', 0.85 + Math.min(1, seconds / outputDuration) * 0.13);
    commandProgress(0);
    console.info('[export] concat start', { outName });
    try {
      // Try stream copy first (fastest)
      await runFFmpeg(['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', concatName, '-c', 'copy', outName]);
    } catch (err) {
      checkExportCancelled(opts.signal);
      if (!(err instanceof FFmpegExitError)) throw err;
      // If stream copy concat fails (codec mismatch), re-encode the concat.
      console.warn('[export] concat -c copy failed, re-encoding concat');
      await runFFmpeg([
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
    onProgress('Preparing download', 0.99);
    console.info('[export] concat done', { outName });

    const data = (await ffmpeg.readFile(outName)) as Uint8Array;
    // Ensure we return a Blob backed by a normal ArrayBuffer (not SharedArrayBuffer).
    const copy = new Uint8Array(data.length);
    copy.set(data);

    const blob = new Blob([copy], { type: 'video/mp4' });
    console.info('[export] done', { bytes: blob.size });
    result = blob;
  } finally {
    await source?.release().catch(() => {});
    await Promise.all([...temporaryFiles].map((path) => safeDelete(ffmpeg, path)));
    console.groupEnd();
  }
  onProgress('Export ready', 1);
  checkExportCancelled(opts.signal);
  return result;
  });
}
