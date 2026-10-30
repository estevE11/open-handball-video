import { withNativeExportProgress } from '@/lib/exportProgress';
import { monotonicProgress } from '../../electron/exportProgress';
import { getSegmentTitles } from '../../electron/segmentTitles';
import { withIsolatedBrowserExport } from '@/lib/browserIsolatedExport';
import { checkExportCancelled } from '../../electron/exportCancellation';
import { splitSegmentsAcrossClips } from '@/lib/clipTimeline';
import type { MainLabel, Segment, VideoClip } from '@/types/project';
import { renderClipExport, type ExportPiece } from '../../electron/clipExportCore';

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
  return withIsolatedBrowserExport(inputs, opts.signal, async (backend) => {
    const data = await renderClipExport(backend, pieces, !!opts.addGap, report);
    checkExportCancelled(opts.signal);
    report('Export ready', 1);
    return new Blob([new Uint8Array(data)], { type: 'video/mp4' });
  });
}
