import { Plus, Trash2 } from 'lucide-react';

import { Panel } from '@/components/app/Panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { formatTimecode } from '@/lib/time';
import { useProjectStore } from '@/store/projectStore';
import { useVideoStore } from '@/store/videoStore';

export function EventLogPanel() {
  const segments = useProjectStore((s) => s.segments);
  const mainLabels = useProjectStore((s) => s.mainLabels);
  const secondaryLabels = useProjectStore((s) => s.secondaryLabels);
  const deleteSegment = useProjectStore((s) => s.deleteSegment);
  const createSegmentFromTrigger = useProjectStore((s) => s.createSegmentFromTrigger);
  const appendSecondaryToLastSegment = useProjectStore((s) => s.appendSecondaryToLastSegment);

  const setCurrentTimeSec = useVideoStore((s) => s.setCurrentTimeSec);
  const currentTimeSec = useVideoStore((s) => s.currentTimeSec);

  const items = [...segments].sort((a, b) => {
    if (a.startTimeSec !== b.startTimeSec) return a.startTimeSec - b.startTimeSec;
    if (a.endTimeSec !== b.endTimeSec) return a.endTimeSec - b.endTimeSec;
    return a.createdAtMs - b.createdAtMs;
  });

  return (
    <Panel
      title="Event Log"
      className="min-h-0"
      right={
        <div className="flex items-center gap-1">
          {mainLabels.slice(0, 3).map((l) => (
            <Button
              key={l.id}
              variant="secondary"
              size="sm"
              className="h-7 gap-2 px-2"
              onClick={() => createSegmentFromTrigger(l.id, currentTimeSec)}
            >
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: l.color }} aria-hidden />
              <span className="max-w-[120px] truncate text-xs">{l.name}</span>
              <span className="rounded border bg-background px-1 font-mono text-[10px] text-muted-foreground">{l.hotkey}</span>
              <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          ))}
        </div>
      }
    >
      <ScrollArea className="h-full min-w-0">
        <div className="flex flex-col gap-2 p-2">
          {secondaryLabels.length ? (
            <div className="flex flex-wrap gap-1 rounded-md border bg-muted/10 p-2">
              <div className="mr-2 text-xs font-medium text-muted-foreground">Quick tags:</div>
              {secondaryLabels.slice(0, 12).map((t) => (
                <Button
                  key={t.id}
                  variant="outline"
                  size="sm"
                  className="h-7 gap-2 px-2 text-xs"
                  onClick={() => appendSecondaryToLastSegment(t.id)}
                >
                  <span className="max-w-[160px] truncate">{t.name}</span>
                  {t.hotkey ? <span className="rounded border bg-background px-1 font-mono text-[10px] text-muted-foreground">{t.hotkey}</span> : null}
                </Button>
              ))}
            </div>
          ) : null}

          {items.length === 0 ? (
            <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
              No segments yet. Load a video and press a label hotkey (e.g. <span className="font-mono">A</span>) to create one.
            </div>
          ) : null}

          {items.map((seg) => {
            const label = mainLabels.find((l) => l.id === seg.mainLabelId);
            const tags = seg.secondaryLabelIds
              .map((id) => secondaryLabels.find((s) => s.id === id)?.name)
              .filter(Boolean) as string[];

            return (
              <div
                key={seg.id}
                className="group flex items-start gap-2 rounded-md border bg-card p-2 hover:bg-muted/20"
              >
                <div
                  className="mt-1 h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: label?.color ?? '#999' }}
                  aria-hidden
                />

                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    setCurrentTimeSec(seg.startTimeSec);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium">{label?.name ?? 'Unknown label'}</div>
                    <div className="shrink-0 font-mono text-xs text-muted-foreground">
                      {formatTimecode(seg.startTimeSec)} → {formatTimecode(seg.endTimeSec)}
                    </div>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {tags.length ? (
                      tags.map((t) => (
                        <Badge key={t} variant="secondary" className="h-5 px-1.5 text-[11px]">
                          {t}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">No secondary tags</span>
                    )}
                  </div>
                </button>

                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('h-8 w-8 opacity-0 group-hover:opacity-100')}
                  onClick={() => deleteSegment(seg.id)}
                  aria-label="Delete segment"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </Panel>
  );
}


