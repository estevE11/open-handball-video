import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'ohv-analysis-layout-v1';
const SIDEBAR_MIN = 320;
const PLAYER_MIN_WIDTH = 480;
const PLAYER_MIN_HEIGHT = 240;
// Panel header + time ruler + two 34px label rows + horizontal scrollbar.
const TIMELINE_MIN = 156;
const HANDLE_SIZE = 8;
const DEFAULTS = { sidebarWidth: 420, timelineHeight: TIMELINE_MIN };
type Dimensions = typeof DEFAULTS;
type Axis = 'sidebarWidth' | 'timelineHeight';

function readDimensions(): Dimensions {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return {
      sidebarWidth: Number.isFinite(value?.sidebarWidth) ? Math.max(SIDEBAR_MIN, value.sidebarWidth) : DEFAULTS.sidebarWidth,
      timelineHeight: Number.isFinite(value?.timelineHeight) ? Math.max(TIMELINE_MIN, value.timelineHeight) : DEFAULTS.timelineHeight,
    };
  } catch { return DEFAULTS; }
}
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(value, max)); }

export function AnalysisLayout({ sidebar, player, timeline }: { sidebar: ReactNode; player: ReactNode; timeline: ReactNode }) {
  const t = useTranslation();
  const id = useId();
  const layoutRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ axis: Axis; start: number; value: number; pointerId: number; handle: HTMLDivElement } | null>(null);
  const [dragging, setDragging] = useState<Axis | null>(null);
  const [dimensions, setDimensions] = useState(readDimensions);
  const [size, setSize] = useState({ width: SIDEBAR_MIN + PLAYER_MIN_WIDTH + HANDLE_SIZE, height: PLAYER_MIN_HEIGHT + TIMELINE_MIN + HANDLE_SIZE });
  const sidebarMax = Math.max(SIDEBAR_MIN, size.width - PLAYER_MIN_WIDTH - HANDLE_SIZE);
  const timelineMax = Math.max(TIMELINE_MIN, size.height - PLAYER_MIN_HEIGHT - HANDLE_SIZE);
  const sidebarWidth = clamp(dimensions.sidebarWidth, SIDEBAR_MIN, sidebarMax);
  const timelineHeight = clamp(dimensions.timelineHeight, TIMELINE_MIN, timelineMax);

  useEffect(() => {
    const element = layoutRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(dimensions)); } catch { /* Resizing still works without storage. */ }
  }, [dimensions]);

  const finishDrag = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    setDragging(null);
  }, []);
  useEffect(() => {
    window.addEventListener('blur', finishDrag);
    return () => { window.removeEventListener('blur', finishDrag); };
  }, [finishDrag]);

  function resize(axis: Axis, value: number) {
    const next = axis === 'sidebarWidth' ? clamp(value, SIDEBAR_MIN, sidebarMax) : clamp(value, TIMELINE_MIN, timelineMax);
    setDimensions((previous) => ({ ...previous, [axis]: Math.round(next) }));
  }
  function startDrag(event: PointerEvent<HTMLDivElement>, axis: Axis) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { axis, start: axis === 'sidebarWidth' ? event.clientX : event.clientY,
      value: axis === 'sidebarWidth' ? sidebarWidth : timelineHeight, pointerId: event.pointerId, handle: event.currentTarget };
    setDragging(axis);
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const delta = drag.axis === 'sidebarWidth' ? event.clientX - drag.start : drag.start - event.clientY;
    resize(drag.axis, drag.value + delta);
  }
  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>, axis: Axis) {
    // Keep unmodified playback shortcuts consistent, including on the dividers.
    if (!event.altKey) return;
    const direction = axis === 'sidebarWidth'
      ? ({ ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[event.key]
      : ({ ArrowDown: -1, ArrowUp: 1 } as Record<string, number>)[event.key];
    if (!direction) return;
    event.preventDefault(); event.stopPropagation();
    resize(axis, (axis === 'sidebarWidth' ? sidebarWidth : timelineHeight) + direction * (event.shiftKey ? 50 : 10));
  }
  function handle(axis: Axis) {
    const vertical = axis === 'sidebarWidth';
    return <div role="separator" tabIndex={0} aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={vertical ? t('Resize sidebar') : t('Resize timeline')} aria-controls={`${id}-${vertical ? 'sidebar' : 'timeline'}`}
      aria-valuemin={vertical ? SIDEBAR_MIN : TIMELINE_MIN} aria-valuemax={Math.round(vertical ? sidebarMax : timelineMax)}
      aria-valuenow={Math.round(vertical ? sidebarWidth : timelineHeight)}
      title={t('Drag to resize. Alt + arrow keys resize; double-click resets.')}
      className={cn('group flex touch-none items-center justify-center rounded-sm outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-1 focus-visible:ring-ring',
        vertical ? 'cursor-col-resize' : 'cursor-row-resize', dragging === axis && 'bg-accent')}
      onPointerDown={(event) => startDrag(event, axis)} onPointerMove={moveDrag} onPointerUp={finishDrag}
      onPointerCancel={finishDrag} onLostPointerCapture={finishDrag} onKeyDown={(event) => resizeWithKeyboard(event, axis)}
      onDoubleClick={() => resize(axis, DEFAULTS[axis])}>
      <span aria-hidden className={cn('rounded-full bg-border group-hover:bg-muted-foreground', vertical ? 'h-10 w-1' : 'h-1 w-10')} />
    </div>;
  }

  return <div className="min-h-0 min-w-0 flex-1 overflow-auto p-2">
    <div ref={layoutRef} className="grid h-full w-full" style={{ minWidth: SIDEBAR_MIN + PLAYER_MIN_WIDTH + HANDLE_SIZE,
      minHeight: PLAYER_MIN_HEIGHT + TIMELINE_MIN + HANDLE_SIZE, gridTemplateRows: `minmax(${PLAYER_MIN_HEIGHT}px, 1fr) ${HANDLE_SIZE}px ${timelineHeight}px` }}>
      <div className="grid min-h-0 min-w-0" style={{ gridTemplateColumns: `${sidebarWidth}px ${HANDLE_SIZE}px minmax(${PLAYER_MIN_WIDTH}px, 1fr)` }}>
        <div id={`${id}-sidebar`} className="grid min-h-0 min-w-0">{sidebar}</div>
        {handle('sidebarWidth')}
        <div className="grid min-h-0 min-w-0">{player}</div>
      </div>
      {handle('timelineHeight')}
      <div id={`${id}-timeline`} className="grid min-h-0 min-w-0">{timeline}</div>
    </div>
  </div>;
}
