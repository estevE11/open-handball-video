import { Check, ChevronsUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
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

  const [mainLabelIds, setMainLabelIds] = useState<string[]>([]);
  const [secondaryIds, setSecondaryIds] = useState<string[]>([]);
  const [isRendering, setIsRendering] = useState(false);
  const [phase, setPhase] = useState<string>('');
  const [ratio, setRatio] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const mainSet = new Set(mainLabelIds);
    const secSet = new Set(secondaryIds);
    return segments
      .filter((seg) => (mainSet.size === 0 ? true : mainSet.has(seg.mainLabelId)))
      .filter((seg) => (secSet.size === 0 ? true : seg.secondaryLabelIds.some((id) => secSet.has(id))))
      .sort((a, b) => a.startTimeSec - b.startTimeSec);
  }, [mainLabelIds, secondaryIds, segments]);

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


