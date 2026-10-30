import { FFmpegExitError, withNativeExportProgress } from '@/lib/exportProgress';
import { monotonicProgress } from '../../electron/exportProgress';
import { getSegmentTitles } from '../../electron/segmentTitles';

import type { MainLabel, Segment } from '@/types/project';
import { withIsolatedBrowserExport } from '@/lib/browserIsolatedExport';
import { checkExportCancelled } from '../../electron/exportCancellation';
import { recordDiagnostic } from '@/lib/diagnostics';

function toFixedSec(v: number): string {
  return (Math.max(0, v) || 0).toFixed(3);
}

function escapeFfmpegText(text: string): string {
  // ffmpeg drawtext needs ':' and '\' escaped.
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "'\\\\''");
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

  onProgress('Loading export engine', 0);
  return withIsolatedBrowserExport([videoInput], opts.signal, async (backend) => {
    let commandProgress: ((seconds: number) => void) | undefined;
    let commandContext: Record<string, unknown> = {};
    const runFFmpeg = (args: string[]) => backend.exec(args, commandProgress, commandContext);
    const fontName = backend.fontName;
    const inputName = await backend.loadSource(0);
    onProgress('Preparing clips', 0.1);

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

    checkExportCancelled(opts.signal);
    let media: Awaited<ReturnType<typeof backend.probeMedia>> | undefined;
    try { media = await backend.probeMedia(inputName); }
    catch (error) {
      checkExportCancelled(opts.signal);
      // Stream metadata is required for gaps; otherwise preserve best-effort probing.
      if (addGap) throw error;
    }

    // If addGap is enabled, we create a 0.5s black clip matching the first clip's settings
    const gapName = 'gap.mp4';
    if (addGap) {

      onProgress('Rendering gaps', 0.1);
      commandContext = { stage: 'gap', sourceIndex: 0, durationSec: 0.5 };
      commandProgress = (seconds) => onProgress('Rendering gaps', 0.1 + Math.min(1, seconds / 0.5) * 0.05);
      console.info('[export] creating 0.5s black gap clip');
      const hasAudio = media!.streams.some((stream) => stream.codec_type === 'audio');
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
      commandContext = { stage: 'clip', sourceIndex: 0, renderIndex: i + 1, renderCount: valid.length,
        selectionIndex: segments.findIndex(segment => segment.id === seg.id) + 1,
        startTimeSec: Number(start), endTimeSec: seg.endTimeSec, durationSec: Number(dur),
        secondaryOverlay: !!secondaryText };
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

      renderedDuration += seg.endTimeSec - seg.startTimeSec;
      onProgress(phase, 0.15 + renderedDuration / totalDuration * 0.7);
      if (addGap && i < valid.length - 1) {
        clipNames.push(gapName);
      }
    }

    const concatList = clipNames.map((n) => `file '${n}'`).join('\n');
    const concatName = `concat_${Date.now()}.txt`;

    console.info('[export] writing concat list', { concatName, clips: clipNames.length });
    await backend.write(concatName, new TextEncoder().encode(concatList));

    const outName = outputName.endsWith('.mp4') ? outputName : `${outputName}.mp4`;


    const outputDuration = totalDuration + (addGap ? (valid.length - 1) * 0.5 : 0);
    commandContext = { stage: 'concat', renderedClips: valid.length, inputCount: clipNames.length, expectedDurationSec: outputDuration };
    commandProgress = (seconds) => onProgress('Merging tagged clips', 0.85 + Math.min(1, seconds / outputDuration) * 0.13);
    commandProgress(0);
    console.info('[export] concat start', { outName });
    try {
      // Try stream copy first (fastest)
      await runFFmpeg(['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', concatName, '-c', 'copy', outName]);
    } catch (err) {
      checkExportCancelled(opts.signal);
      if (!(err instanceof FFmpegExitError)) throw err;
      commandContext = { ...commandContext, stage: 'concat-encode-fallback' };
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

    const data = (await backend.read(outName)) as Uint8Array;
    // Ensure we return a Blob backed by a normal ArrayBuffer (not SharedArrayBuffer).
    const copy = new Uint8Array(data.length);
    copy.set(data);

    const blob = new Blob([copy], { type: 'video/mp4' });
    console.info('[export] done', { bytes: blob.size });
    onProgress('Export ready', 1);
    checkExportCancelled(opts.signal);
    return blob;
  });
}
