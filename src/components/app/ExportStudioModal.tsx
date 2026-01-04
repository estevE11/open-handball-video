import { useMemo, useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatTimecode } from '@/lib/time';
import { exportFilteredSegmentsToMp4 } from '@/lib/exportMp4';
import { useProjectStore } from '@/store/projectStore';

type ExportStudioModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ExportStudioModal({ open, onOpenChange }: ExportStudioModalProps) {
  const mainLabels = useProjectStore((s) => s.mainLabels);
  const secondaryLabels = useProjectStore((s) => s.secondaryLabels);
  const segments = useProjectStore((s) => s.segments);
  const videoFile = useProjectStore((s) => s.session.videoFile);

  const [mainLabelId, setMainLabelId] = useState<string>('__any__');
  const [secondaryId, setSecondaryId] = useState<string>('__any__');
  const [isRendering, setIsRendering] = useState(false);
  const [phase, setPhase] = useState<string>('');
  const [ratio, setRatio] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return segments
      .filter((seg) => (mainLabelId === '__any__' ? true : seg.mainLabelId === mainLabelId))
      .filter((seg) => (secondaryId === '__any__' ? true : seg.secondaryLabelIds.includes(secondaryId)))
      .sort((a, b) => a.startTimeSec - b.startTimeSec);
  }, [mainLabelId, secondaryId, segments]);

  function downloadBlob(filename: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[980px]">
        <DialogHeader>
          <DialogTitle>Export Studio</DialogTitle>
          <DialogDescription>Filter segments and render a single merged MP4.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <div className="text-xs font-medium text-muted-foreground">Main Label</div>
              <Select value={mainLabelId} onValueChange={setMainLabelId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any</SelectItem>
                  {mainLabels.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <div className="text-xs font-medium text-muted-foreground">Secondary Label includes</div>
              <Select value={secondaryId} onValueChange={setSecondaryId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any__">Any</SelectItem>
                  {secondaryLabels.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[220px]">Label</TableHead>
                  <TableHead className="w-[200px]">Start</TableHead>
                  <TableHead className="w-[200px]">End</TableHead>
                  <TableHead>Secondary Tags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                      No segments match the current filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.slice(0, 200).map((seg) => {
                    const label = mainLabels.find((l) => l.id === seg.mainLabelId)?.name ?? 'Unknown';
                    const tags = seg.secondaryLabelIds
                      .map((id) => secondaryLabels.find((s) => s.id === id)?.name)
                      .filter(Boolean)
                      .join(', ');
                    return (
                      <TableRow key={seg.id}>
                        <TableCell className="font-medium">{label}</TableCell>
                        <TableCell className="font-mono text-xs">{formatTimecode(seg.startTimeSec)}</TableCell>
                        <TableCell className="font-mono text-xs">{formatTimecode(seg.endTimeSec)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{tags || '—'}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {videoFile ? `Video: ${videoFile.name}` : 'No video loaded. Upload a video to enable export.'}
            </div>
            <div className="flex items-center gap-2">
              {error ? <div className="max-w-[520px] truncate text-xs text-destructive">{error}</div> : null}
              {isRendering ? (
                <div className="w-[220px] text-right font-mono text-xs text-muted-foreground">
                  {phase} {(ratio * 100).toFixed(0)}%
                </div>
              ) : null}
              <Button
                disabled={!videoFile || filtered.length === 0 || isRendering}
                onClick={async () => {
                  if (!videoFile) return;
                  setIsRendering(true);
                  setError(null);
                  setPhase('ffmpeg:load');
                  setRatio(0);
                  try {
                    console.group('[Export Studio] Render MP4');
                    console.info('videoFile', {
                      name: videoFile.name,
                      size: videoFile.size,
                      type: videoFile.type,
                      lastModified: videoFile.lastModified,
                    });
                    console.info('segments (filtered)', filtered.length);
                    const blob = await exportFilteredSegmentsToMp4(videoFile, filtered, 'export.mp4', {
                      onProgress: (p, r) => {
                        setPhase(p);
                        setRatio(r);
                        console.info('[Export Studio] progress', { phase: p, ratio: r });
                      },
                    });
                    downloadBlob('export.mp4', blob);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Export failed');
                    console.error('[Export Studio] export failed', e);
                  } finally {
                    setIsRendering(false);
                    console.groupEnd();
                  }
                }}
              >
                {isRendering ? 'Rendering…' : 'Render MP4'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


