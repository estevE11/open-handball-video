import { Minus, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Panel } from '@/components/app/Panel';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatTimecode } from '@/lib/time';
import { useProjectStore } from '@/store/projectStore';
import { useVideoStore } from '@/store/videoStore';

const LABEL_COL_W = 180;
const HEADER_H = 28;
const ROW_H = 34;
const MIN_SEG_DUR_SEC = 0.05;

function niceTickEverySec(pps: number): number {
  // Choose a tick spacing that doesn't get too dense.
  const candidates = [0.5, 1, 2, 5, 10, 15, 30, 60];
  for (const c of candidates) {
    if (c * pps >= 80) return c;
  }
  return 120;
}

export function TimelinePanel() {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tracksRef = useRef<HTMLDivElement | null>(null);
  const justDraggedRef = useRef(false);
  const dragMovedRef = useRef(false);

  const mainLabels = useProjectStore((s) => s.mainLabels);
  const segments = useProjectStore((s) => s.segments);
  const selectedSegmentId = useProjectStore((s) => s.selectedSegmentId);
  const setSelectedSegmentId = useProjectStore((s) => s.setSelectedSegmentId);
  const currentTimeSec = useVideoStore((s) => s.currentTimeSec);
  const durationSec = useVideoStore((s) => s.durationSec);
  const setCurrentTimeSec = useVideoStore((s) => s.setCurrentTimeSec);

  const [pps, setPps] = useState(60); // pixels per second
  const [scrubbing, setScrubbing] = useState(false);
  const [resizing, setResizing] = useState<null | { segId: string; edge: 'start' | 'end'; originX: number; originStart: number; originEnd: number }>(
    null,
  );
  const [dragging, setDragging] = useState<null | { segId: string; originX: number; originStart: number; originEnd: number }>(null);

  const updateSegmentTimes = useProjectStore((s) => s.updateSegmentTimes);

  const maxSegEnd = useMemo(() => {
    return segments.reduce((m, s) => Math.max(m, s.endTimeSec), 0);
  }, [segments]);

  const totalSec = Math.max(durationSec || 0, maxSegEnd, 60);
  const timelineW = Math.ceil(totalSec * pps);
  const trackH = mainLabels.length * ROW_H;

  const ticksEvery = niceTickEverySec(pps);
  const ticks = useMemo(() => {
    const out: number[] = [];
    const end = Math.ceil(totalSec / ticksEvery) * ticksEvery;
    for (let t = 0; t <= end; t += ticksEvery) out.push(t);
    return out;
  }, [ticksEvery, totalSec]);

  const clientXToTime = useCallback(
    (clientX: number): number | null => {
    const sc = scrollRef.current;
    const tr = tracksRef.current;
      if (!sc || !tr) return null;
      const rect = tr.getBoundingClientRect();
      // IMPORTANT: `tr` moves as the scroll container scrolls, so its bounding rect already
      // accounts for horizontal scroll. Adding scrollLeft here would double-count.
      const x = clientX - rect.left;
      return x / pps;
    },
    [pps],
  );

  useEffect(() => {
    if (!scrollRef.current) return;
    // Keep playhead visible while playing / moving.
    const sc = scrollRef.current;
    const absX = LABEL_COL_W + currentTimeSec * pps;
    const left = sc.scrollLeft + LABEL_COL_W;
    const right = sc.scrollLeft + sc.clientWidth;
    const pad = 80;
    if (absX < left + pad) sc.scrollLeft = Math.max(0, absX - LABEL_COL_W - pad);
    else if (absX > right - pad) sc.scrollLeft = Math.max(0, absX - sc.clientWidth + pad);
  }, [currentTimeSec, pps]);

  useEffect(() => {
    if (!scrubbing) return;
    function onMove(e: MouseEvent) {
      const t = clientXToTime(e.clientX);
      if (t != null) setCurrentTimeSec(t);
    }
    function onUp() {
      setScrubbing(false);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [clientXToTime, scrubbing, setCurrentTimeSec]);

  useEffect(() => {
    const r = resizing;
    if (!r) return;
    const { segId, edge, originX, originStart, originEnd } = r;
    function onMove(e: MouseEvent) {
      const dx = e.clientX - originX;
      const dt = dx / pps;
      const maxT = durationSec > 0 ? durationSec : Number.POSITIVE_INFINITY;

      let start = originStart;
      let end = originEnd;
      if (edge === 'start') {
        start = Math.max(0, Math.min(originStart + dt, end - MIN_SEG_DUR_SEC));
      } else {
        end = Math.max(start + MIN_SEG_DUR_SEC, Math.min(originEnd + dt, maxT));
      }
      updateSegmentTimes(segId, start, end);
    }
    function onUp() {
      setResizing(null);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [durationSec, pps, resizing, updateSegmentTimes]);

  useEffect(() => {
    const d = dragging;
    if (!d) return;
    const { segId, originX, originStart, originEnd } = d;
    const segDur = originEnd - originStart;
    function onMove(e: MouseEvent) {
      const dx = e.clientX - originX;
      const dt = dx / pps;
      const maxT = durationSec > 0 ? durationSec : Number.POSITIVE_INFINITY;

      let start = originStart + dt;
      let end = start + segDur;

      // Clamp as a unit while preserving duration.
      if (start < 0) {
        start = 0;
        end = start + segDur;
      }
      if (end > maxT) {
        end = maxT;
        start = end - segDur;
        if (start < 0) start = 0;
      }

      if (!dragMovedRef.current && Math.abs(dx) > 2) {
        dragMovedRef.current = true;
      }
      updateSegmentTimes(segId, start, end);
    }
    function onUp() {
      if (dragMovedRef.current) {
        justDraggedRef.current = true;
        window.setTimeout(() => {
          justDraggedRef.current = false;
        }, 0);
      }
      dragMovedRef.current = false;
      setDragging(null);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, durationSec, pps, updateSegmentTimes]);

  return (
    <Panel
      title="Timeline"
      right={
        <div className="flex items-center gap-1">
          <div className="mr-2 hidden font-mono text-xs text-muted-foreground md:block">{formatTimecode(currentTimeSec)}</div>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPps((v) => Math.max(20, v - 10))}>
            <Minus className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPps((v) => Math.min(200, v + 10))}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      <div ref={scrollRef} className="h-full min-w-0 overflow-auto">
        <div style={{ width: LABEL_COL_W + timelineW, height: HEADER_H + trackH }} className="relative">
          {/* Header */}
          <div className="sticky top-0 z-20 flex h-[28px] bg-card">
            <div className="sticky left-0 z-30 flex h-full w-[180px] items-center border-b border-r bg-card px-2 text-xs font-medium text-muted-foreground">
              Labels
            </div>
            <div className="relative h-full flex-1 border-b bg-card">
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 h-full border-l text-[10px] text-muted-foreground"
                  style={{ left: t * pps }}
                >
                  <div className="pl-1 pt-1">{t === 0 ? '0:00' : formatTimecode(t).slice(0, 5)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="flex">
            <div className="sticky left-0 z-10 w-[180px] border-r bg-card">
              {mainLabels.map((l) => (
                <div key={l.id} className="flex h-[34px] items-center gap-2 border-b px-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: l.color }} aria-hidden />
                  <div className="min-w-0 flex-1 truncate text-xs font-medium">{l.name}</div>
                  <div className="rounded border bg-background px-1 font-mono text-[10px] text-muted-foreground">{l.hotkey}</div>
                </div>
              ))}
            </div>

            <div
              ref={tracksRef}
              className="relative"
              style={{ width: timelineW, height: trackH }}
              onMouseDown={(e) => {
                const t = clientXToTime(e.clientX);
                if (t != null) setCurrentTimeSec(t);
                setScrubbing(true);
              }}
            >
              {/* Row stripes + grid */}
              {mainLabels.map((l, idx) => (
                <div
                  key={l.id}
                  className={cn('absolute left-0 right-0 border-b', idx % 2 === 0 ? 'bg-muted/10' : 'bg-muted/0')}
                  style={{ top: idx * ROW_H, height: ROW_H }}
                />
              ))}

              {/* Cursor */}
              <div
                className="absolute top-0 z-20 h-full w-px bg-primary"
                style={{ left: currentTimeSec * pps }}
                aria-hidden
              />

              {/* Segments */}
              {segments.map((seg) => {
                const rowIdx = mainLabels.findIndex((l) => l.id === seg.mainLabelId);
                if (rowIdx < 0) return null;
                const label = mainLabels[rowIdx];
                const isSelected = seg.id === selectedSegmentId;
                const left = seg.startTimeSec * pps;
                const width = Math.max(2, (seg.endTimeSec - seg.startTimeSec) * pps);
                const top = rowIdx * ROW_H + 6;
                const h = ROW_H - 12;
                return (
                  <div
                    key={seg.id}
                    className={cn(
                      "absolute z-10 rounded-sm border border-black/10 transition-shadow",
                      isSelected ? "opacity-100 ring-2 ring-primary ring-offset-1 ring-offset-background z-20" : "opacity-90 hover:opacity-100"
                    )}
                    style={{ left, width, top, height: h, backgroundColor: label.color }}
                    title={`${label.name} ${formatTimecode(seg.startTimeSec)} → ${formatTimecode(seg.endTimeSec)}`}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setSelectedSegmentId(seg.id);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (justDraggedRef.current) return;
                      setSelectedSegmentId(seg.id);
                      setCurrentTimeSec(seg.startTimeSec);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    {/* Resize handles */}
                    <div
                      className="absolute left-0 top-0 h-full w-2 cursor-ew-resize"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setScrubbing(false);
                        setDragging(null);
                        setResizing({
                          segId: seg.id,
                          edge: 'start',
                          originX: e.clientX,
                          originStart: seg.startTimeSec,
                          originEnd: seg.endTimeSec,
                        });
                      }}
                      aria-label="Resize segment start"
                    />
                    <div
                      className="absolute right-0 top-0 h-full w-2 cursor-ew-resize"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setScrubbing(false);
                        setDragging(null);
                        setResizing({
                          segId: seg.id,
                          edge: 'end',
                          originX: e.clientX,
                          originStart: seg.startTimeSec,
                          originEnd: seg.endTimeSec,
                        });
                      }}
                      aria-label="Resize segment end"
                    />

                    {/* Drag body (move segment, keep duration) */}
                    <div
                      className="absolute inset-y-0 left-2 right-2 cursor-grab active:cursor-grabbing"
                      onMouseDown={(e) => {
                        // Left button only.
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        setScrubbing(false);
                        setResizing(null);
                        dragMovedRef.current = false;
                        setDragging({
                          segId: seg.id,
                          originX: e.clientX,
                          originStart: seg.startTimeSec,
                          originEnd: seg.endTimeSec,
                        });
                      }}
                      aria-label="Move segment"
                    />

                    {/* Subtle grips */}
                    <div className="pointer-events-none absolute left-0 top-0 h-full w-2 opacity-30">
                      <div className="mx-auto mt-[6px] h-[14px] w-[2px] rounded bg-black/60" />
                    </div>
                    <div className="pointer-events-none absolute right-0 top-0 h-full w-2 opacity-30">
                      <div className="mx-auto mt-[6px] h-[14px] w-[2px] rounded bg-black/60" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}


