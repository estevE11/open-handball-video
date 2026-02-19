import { Edit2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Panel } from '@/components/app/Panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const toggleSecondaryOnSelectedSegment = useProjectStore((s) => s.toggleSecondaryOnSelectedSegment);
  const selectedSegmentId = useProjectStore((s) => s.selectedSegmentId);
  const setSelectedSegmentId = useProjectStore((s) => s.setSelectedSegmentId);
  const upsertMainLabel = useProjectStore((s) => s.upsertMainLabel);

  const setCurrentTimeSec = useVideoStore((s) => s.setCurrentTimeSec);
  const currentTimeSec = useVideoStore((s) => s.currentTimeSec);

  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [tempLabelName, setTempLabelName] = useState('');

  const items = [...segments].sort((a, b) => {
    if (a.startTimeSec !== b.startTimeSec) return a.startTimeSec - b.startTimeSec;
    if (a.endTimeSec !== b.endTimeSec) return a.endTimeSec - b.endTimeSec;
    return a.createdAtMs - b.createdAtMs;
  });

  const selectedSegment = segments.find((s) => s.id === selectedSegmentId);
  const selectedLabel = selectedSegment ? mainLabels.find((l) => l.id === selectedSegment.mainLabelId) : null;

  const saveLabelName = () => {
    if (!editingLabelId) return;
    const label = mainLabels.find((l) => l.id === editingLabelId);
    if (label && tempLabelName.trim()) {
      upsertMainLabel({ ...label, name: tempLabelName.trim() });
    }
    setEditingLabelId(null);
  };

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
            <div className="flex flex-col gap-2 rounded-md border bg-muted/10 p-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium text-muted-foreground">
                  {selectedSegment ? (
                    <span className="flex items-center gap-1.5">
                      Target: 
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: selectedLabel?.color }} />
                      <span className="text-foreground">{selectedLabel?.name}</span>
                      <span className="font-mono">({formatTimecode(selectedSegment.startTimeSec)})</span>
                    </span>
                  ) : (
                    "Select a segment to add tags"
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {secondaryLabels.slice(0, 12).map((t) => {
                  const isActive = selectedSegment?.secondaryLabelIds.includes(t.id);
                  return (
                    <Button
                      key={t.id}
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      className="h-7 gap-2 px-2 text-xs"
                      disabled={!selectedSegment}
                      onClick={() => toggleSecondaryOnSelectedSegment(t.id)}
                    >
                      <span className="max-w-[160px] truncate">{t.name}</span>
                      {t.hotkey ? (
                        <span className={cn(
                          "rounded border px-1 font-mono text-[10px]",
                          isActive ? "bg-primary-foreground/20 border-primary-foreground/20 text-primary-foreground" : "bg-background text-muted-foreground"
                        )}>
                          {t.hotkey}
                        </span>
                      ) : null}
                    </Button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {items.length === 0 ? (
            <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
              No segments yet. Load a video and press a label hotkey (e.g. <span className="font-mono">A</span>) to create one.
            </div>
          ) : null}

          {items.map((seg) => {
            const isSelected = seg.id === selectedSegmentId;
            const label = mainLabels.find((l) => l.id === seg.mainLabelId);
            const tags = seg.secondaryLabelIds
              .map((id) => secondaryLabels.find((s) => s.id === id)?.name)
              .filter(Boolean) as string[];

            return (
              <div
                key={seg.id}
                className={cn(
                  "group flex items-start gap-2 rounded-md border p-2 hover:bg-muted/20 transition-colors",
                  isSelected ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "bg-card"
                )}
                onClick={() => setSelectedSegmentId(seg.id)}
              >
                <div
                  className="mt-1 h-3 w-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: label?.color ?? '#999' }}
                  aria-hidden
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    {editingLabelId === label?.id ? (
                      <Input
                        autoFocus
                        value={tempLabelName}
                        onChange={(e) => setTempLabelName(e.target.value)}
                        onBlur={saveLabelName}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveLabelName();
                          if (e.key === 'Escape') setEditingLabelId(null);
                        }}
                        className="h-6 py-0 px-1 text-sm bg-background"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <button
                        type="button"
                        className="truncate text-sm font-medium hover:underline flex items-center gap-1.5"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedSegmentId(seg.id);
                          setCurrentTimeSec(seg.startTimeSec);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (label) {
                            setEditingLabelId(label.id);
                            setTempLabelName(label.name);
                          }
                        }}
                        title="Double-click to rename primary tag"
                      >
                        {label?.name ?? 'Unknown label'}
                        <Edit2 
                          className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" 
                          onClick={(e) => {
                            e.stopPropagation();
                            if (label) {
                              setEditingLabelId(label.id);
                              setTempLabelName(label.name);
                            }
                          }}
                        />
                      </button>
                    )}
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
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('h-8 w-8 opacity-0 group-hover:opacity-100')}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSegment(seg.id);
                  }}
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


