import { getSegmentTitles } from '../../../electron/segmentTitles';
import { ArrowDown, ArrowUp, GripVertical, LoaderCircle, Check, ChevronsUpDown } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { formatTimecode } from '@/lib/time';
import { exportClipSequence } from '@/lib/exportClipSequence';
import { exportFilteredSegmentsToMp4 } from '@/lib/exportMp4';
import { useProjectStore } from '@/store/projectStore';

type ExportStudioModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ExportStudioModal({ open, onOpenChange }: ExportStudioModalProps) {
  const projectId = useProjectStore((s) => s.projectId);
  const mainLabels = useProjectStore((s) => s.mainLabels);
  const secondaryLabels = useProjectStore((s) => s.secondaryLabels);
  const segments = useProjectStore((s) => s.segments);
  const clips = useProjectStore((s) => s.clips);
  const clipSources = useProjectStore((s) => s.session.clipSources);
  const videoFile = useProjectStore((s) => s.session.videoFile);
  const videoSourceUrl = useProjectStore((s) => s.session.videoSourceUrl);

  const [mainLabelIds, setMainLabelIds] = useState<string[]>([]);
  const [secondaryIds, setSecondaryIds] = useState<string[]>([]);
  const [excludedSegmentIds, setExcludedSegmentIds] = useState<string[]>([]);
  const [exportOrder, setExportOrder] = useState<{ projectId: string; ids: string[] } | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [addGap, setAddGap] = useState(false);
  const exportController = useRef<AbortController | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [phase, setPhase] = useState<string>('');
  const [ratio, setRatio] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const timelineSegments = useMemo(() => [...segments].sort((a, b) => a.startTimeSec - b.startTimeSec), [segments]);
  const timelineNumbers = useMemo(() => new Map(timelineSegments.map((seg, index) => [seg.id, index + 1])), [timelineSegments]);
  const orderedSegments = useMemo(() => {
    if (exportOrder?.projectId !== projectId) return timelineSegments;
    const ranks = new Map(exportOrder.ids.map((id, index) => [id, index]));
    return [...timelineSegments].sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
  }, [timelineSegments, exportOrder, projectId]);

  function moveSegment(id: string, targetId: string) {
    if (isRendering) return;
    const ids = orderedSegments.map((seg) => seg.id);
    const from = ids.indexOf(id);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    setExportOrder({ projectId, ids });
  }

  const filtered = useMemo(() => {
    const mainSet = new Set(mainLabelIds);
    const secSet = new Set(secondaryIds);
    return orderedSegments
      .filter((seg) => (mainSet.size === 0 ? true : mainSet.has(seg.mainLabelId)))
      .filter((seg) => (secSet.size === 0 ? true : seg.secondaryLabelIds.some((id) => secSet.has(id))));
  }, [mainLabelIds, secondaryIds, orderedSegments]);

  const selectedSegments = useMemo(() => {
    const excluded = new Set(excludedSegmentIds);
    return filtered.filter((seg) => !excluded.has(seg.id));
  }, [filtered, excludedSegmentIds]);

  const mainSummary = useMemo(() => {
    if (mainLabelIds.length === 0) return 'Any';
    if (mainLabelIds.length === 1) return mainLabels.find((l) => l.id === mainLabelIds[0])?.name ?? '1 selected';
    return `${mainLabelIds.length} selected`;
  }, [mainLabelIds, mainLabels]);

  const secondarySummary = useMemo(() => {
    if (secondaryIds.length === 0) return 'Any';
    if (secondaryIds.length === 1) return secondaryLabels.find((l) => l.id === secondaryIds[0])?.name ?? '1 selected';
    return `${secondaryIds.length} selected`;
  }, [secondaryIds, secondaryLabels]);

  function toggleId(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

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

  const activeVideoInput = videoFile || videoSourceUrl;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isRendering) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-[980px]">
        <DialogHeader>
          <DialogTitle>Export Studio</DialogTitle>
          <DialogDescription>Drag clips or use the arrows to set export order. Timeline # shows each clip’s original position. Uncheck clips to leave them out.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <div className="text-xs font-medium text-muted-foreground">Main Label</div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="h-9 justify-between">
                    <span className="truncate">{mainSummary}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[420px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search main labels..." />
                    <CommandList>
                      <CommandEmpty>No labels found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          onSelect={() => setMainLabelIds([])}
                          className="flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <span className={cn('h-4 w-4 rounded-sm border')} aria-hidden />
                            <span>Any</span>
                          </div>
                          {mainLabelIds.length === 0 ? <Check className="h-4 w-4" /> : null}
                        </CommandItem>
                        {mainLabels.map((l) => {
                          const selected = mainLabelIds.includes(l.id);
                          return (
                            <CommandItem key={l.id} onSelect={() => setMainLabelIds((prev) => toggleId(prev, l.id))}>
                              <div className="flex w-full items-center gap-2">
                                <span className="h-4 w-4 rounded-sm" style={{ backgroundColor: l.color }} aria-hidden />
                                <span className="flex-1 truncate">{l.name}</span>
                                {selected ? <Check className="h-4 w-4" /> : null}
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {mainLabelIds.length ? (
                <div className="flex flex-wrap gap-1">
                  {mainLabelIds.slice(0, 6).map((id) => {
                    const label = mainLabels.find((l) => l.id === id);
                    if (!label) return null;
                    return (
                      <Badge
                        key={id}
                        variant="secondary"
                        className="cursor-pointer"
                        onClick={() => setMainLabelIds((prev) => toggleId(prev, id))}
                        title="Click to remove"
                      >
                        {label.name}
                      </Badge>
                    );
                  })}
                  {mainLabelIds.length > 6 ? (
                    <Badge variant="secondary">+{mainLabelIds.length - 6}</Badge>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <div className="text-xs font-medium text-muted-foreground">Secondary Label includes</div>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="h-9 justify-between">
                    <span className="truncate">{secondarySummary}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[420px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search secondary labels..." />
                    <CommandList>
                      <CommandEmpty>No tags found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem onSelect={() => setSecondaryIds([])} className="flex items-center justify-between">
                          <span>Any</span>
                          {secondaryIds.length === 0 ? <Check className="h-4 w-4" /> : null}
                        </CommandItem>
                        {secondaryLabels.map((l) => {
                          const selected = secondaryIds.includes(l.id);
                          return (
                            <CommandItem key={l.id} onSelect={() => setSecondaryIds((prev) => toggleId(prev, l.id))}>
                              <div className="flex w-full items-center gap-2">
                                <span className="flex-1 truncate">{l.name}</span>
                                {l.hotkey ? (
                                  <span className="rounded border bg-background px-1 font-mono text-[10px] text-muted-foreground">
                                    {l.hotkey}
                                  </span>
                                ) : null}
                                {selected ? <Check className="h-4 w-4" /> : null}
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {secondaryIds.length ? (
                <div className="flex flex-wrap gap-1">
                  {secondaryIds.slice(0, 6).map((id) => {
                    const label = secondaryLabels.find((l) => l.id === id);
                    if (!label) return null;
                    return (
                      <Badge
                        key={id}
                        variant="secondary"
                        className="cursor-pointer"
                        onClick={() => setSecondaryIds((prev) => toggleId(prev, id))}
                        title="Click to remove"
                      >
                        {label.name}
                      </Badge>
                    );
                  })}
                  {secondaryIds.length > 6 ? (
                    <Badge variant="secondary">+{secondaryIds.length - 6}</Badge>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2 p-2 rounded-md border bg-muted/10">
            <Checkbox id="add-gap" checked={addGap} onCheckedChange={(v) => setAddGap(!!v)} />
            <Label htmlFor="add-gap" className="text-sm cursor-pointer">Add 0.5s black gap between clips</Label>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">{selectedSegments.length} of {filtered.length} matching clips selected for export</div>
            <Button variant="ghost" size="sm" disabled={isRendering || exportOrder?.projectId !== projectId} onClick={() => setExportOrder(null)}>Reset order</Button>
          </div>
          <div className="max-h-[40vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[70px] whitespace-nowrap">Timeline #</TableHead>
                  <TableHead className="w-[90px]">Order</TableHead>
                  <TableHead className="w-[220px]">Clip / type</TableHead>
                  <TableHead className="w-[100px]">Start</TableHead>
                  <TableHead className="w-[100px]">End</TableHead>
                  <TableHead>Secondary Tags</TableHead>
                  <TableHead className="w-[70px] text-right">Include</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                      No segments match the current filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((seg, index) => {
                    const timelineNumber = timelineNumbers.get(seg.id)!;
                    const titles = getSegmentTitles(seg, mainLabels.find((l) => l.id === seg.mainLabelId));
                    const tags = seg.secondaryLabelIds
                      .map((id) => secondaryLabels.find((s) => s.id === id)?.name)
                      .filter(Boolean)
                      .join(', ');
                    return (
                      <TableRow key={seg.id}
                        className={cn(draggedId === seg.id && 'opacity-50', dropTargetId === seg.id && 'bg-accent')}
                        onDragOver={(event) => {
                          if (isRendering || !draggedId) return;
                          event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTargetId(seg.id);
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (draggedId) moveSegment(draggedId, seg.id);
                          setDraggedId(null); setDropTargetId(null);
                        }}>
                        <TableCell className="font-mono text-xs" aria-label={`Timeline position ${timelineNumber}`}>{timelineNumber}</TableCell>
                        <TableCell>
                          <div className="flex items-center">
                            <Button size="icon" variant="ghost" className="h-7 w-6 cursor-grab active:cursor-grabbing"
                              disabled={isRendering} draggable={!isRendering} aria-label={`Drag clip ${timelineNumber} to reorder`}
                              onDragStart={(event) => {
                                event.dataTransfer.setData('text/plain', seg.id); event.dataTransfer.effectAllowed = 'move'; setDraggedId(seg.id);
                              }}
                              onDragEnd={() => { setDraggedId(null); setDropTargetId(null); }}>
                              <GripVertical className="h-4 w-4" aria-hidden />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-6" disabled={isRendering || index === 0}
                              aria-label={`Move clip ${timelineNumber} up`} onClick={() => moveSegment(seg.id, filtered[index - 1].id)}><ArrowUp className="h-3 w-3" aria-hidden /></Button>
                            <Button size="icon" variant="ghost" className="h-7 w-6" disabled={isRendering || index === filtered.length - 1}
                              aria-label={`Move clip ${timelineNumber} down`} onClick={() => moveSegment(seg.id, filtered[index + 1].id)}><ArrowDown className="h-3 w-3" aria-hidden /></Button>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium"><div>{titles.primaryText}</div><div className="text-xs font-normal text-muted-foreground">{titles.secondaryText}</div></TableCell>
                        <TableCell className="font-mono text-xs">{formatTimecode(seg.startTimeSec)}</TableCell>
                        <TableCell className="font-mono text-xs">{formatTimecode(seg.endTimeSec)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{tags || '—'}</TableCell>
                        <TableCell>
                          <div className="flex justify-end pr-2">
                            <Checkbox
                              aria-label={`Include ${titles.primaryText} at ${formatTimecode(seg.startTimeSec)} in export`}
                              checked={!excludedSegmentIds.includes(seg.id)}
                              disabled={isRendering}
                              onCheckedChange={(checked) => setExcludedSegmentIds((prev) => checked
                                ? prev.filter((id) => id !== seg.id)
                                : [...prev, seg.id])}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {activeVideoInput ? `Video loaded` : 'No video loaded. Upload a video to enable export.'}
            </div>
            <div className="flex items-center gap-2">
              {error ? <div className="max-w-[520px] truncate text-xs text-destructive">{error}</div> : null}
              {phase ? (
                <div className="w-[260px] space-y-1.5">
                  <div className="flex justify-between gap-2 text-xs text-muted-foreground" role="status">
                    <span className="flex items-center gap-1.5">{isRendering && <LoaderCircle aria-hidden className="h-3 w-3 shrink-0 motion-safe:animate-spin" />}{error ? 'Export failed' : phase}</span>
                    <span className="font-mono">{Math.floor(ratio * 100)}%</span>
                  </div>
                  <div role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={100}
                    aria-valuenow={Math.floor(ratio * 100)} aria-valuetext={error ? 'Export failed' : phase}
                    className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full transition-[width] duration-200 ${error ? 'bg-destructive' : 'bg-primary'}`}
                      style={{ width: `${ratio * 100}%` }} />
                  </div>
                </div>
              ) : null}
              {isRendering && <Button variant="outline" disabled={isCancelling} onClick={() => {
                setIsCancelling(true); exportController.current?.abort();
              }}>{isCancelling ? 'Cancelling…' : 'Cancel export'}</Button>}
              <Button
                disabled={!activeVideoInput || selectedSegments.length === 0 || isRendering}
                onClick={async () => {
                  if (!activeVideoInput || selectedSegments.length === 0) return;
                  const controller = new AbortController();
                  exportController.current = controller;
                  setIsRendering(true);
                  setError(null);
                  setPhase('Preparing export');
                  setRatio(0);
                  try {
                    console.group('[Export Studio] Render MP4');
                    console.info('segments (selected)', selectedSegments.length);
                    const options = {
                      addGap, mainLabels, signal: controller.signal,
                      onProgress: (p: string, r: number) => { if (controller.signal.aborted) return; setPhase(r >= 1 ? 'Preparing download' : p); setRatio((previous) => Math.max(previous, Math.min(0.99, Math.max(0, Number.isFinite(r) ? r : 0)))); },
                    };
                    const blob = clips
                      ? await exportClipSequence(clips, clipSources.map((source) => source.file ?? source.url), selectedSegments, options)
                      : await exportFilteredSegmentsToMp4(activeVideoInput, selectedSegments, 'export.mp4', options);
                    if (controller.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
                    downloadBlob('export.mp4', blob);
                    setPhase('Export ready');
                    setRatio(1);
                  } catch (e) {
                    if (controller.signal.aborted) { setPhase('Export cancelled'); setError(null); }
                    else setError(e instanceof Error ? e.message : 'Export failed');
                    console.error('[Export Studio] export failed', e);
                  } finally {
                    setIsRendering(false); setIsCancelling(false); exportController.current = null;
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


