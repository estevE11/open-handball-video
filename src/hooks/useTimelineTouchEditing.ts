import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import { useProjectStore } from '@/store/projectStore';

const HOLD_MS = 400;
const MIN_DURATION = 0.05;
type Edit = { id: string; edge: 'move' | 'start' | 'end'; start: number; end: number };
type Gesture = { identifier: number; x: number; phase: 'pending' | 'pan' | 'edit'; edit: Edit | null };

export function useTimelineTouchEditing(scrollRef: RefObject<HTMLDivElement | null>, pps: number, durationSec: number, onActivate: () => void) {
  const projectId = useProjectStore(state => state.projectId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const suppressMouseUntil = useRef(0);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    let gesture: Gesture | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clearHold = () => { clearTimeout(timer); timer = undefined; };
    function finish(suppress = true) {
      clearHold();
      if (gesture?.phase === 'edit') useProjectStore.getState().endHistoryGroup();
      if (gesture && suppress) suppressMouseUntil.current = Date.now() + 800;
      gesture = null; setEditingId(null);
    }
    function start(event: TouchEvent) {
      if (event.touches.length !== 1) { finish(); return; }
      finish(false); suppressMouseUntil.current = 0;
      const touch = event.touches[0];
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest<HTMLElement>('[data-timeline-segment]');
      const segment = useProjectStore.getState().segments.find(item => item.id === row?.dataset.timelineSegment);
      let edit: Edit | null = null;
      if (segment && row) {
        const bounds = row.getBoundingClientRect();
        const edgeWidth = Math.min(24, bounds.width / 3);
        const edge = touch.clientX <= bounds.left + edgeWidth ? 'start' : touch.clientX >= bounds.right - edgeWidth ? 'end' : 'move';
        edit = { id: segment.id, edge, start: segment.startTimeSec, end: segment.endTimeSec };
      }
      const pending: Gesture = { identifier: touch.identifier, x: touch.clientX, phase: 'pending', edit };
      gesture = pending;
      if (!edit) return;
      timer = setTimeout(() => {
        const state = useProjectStore.getState();
        if (gesture !== pending || pending.phase !== 'pending' || state.projectId !== projectId || !state.segments.some(item => item.id === edit.id)) return;
        pending.phase = 'edit'; onActivate();
        state.beginHistoryGroup(); state.setSelectedSegmentId(edit.id);
        setEditingId(edit.id);
      }, HOLD_MS);
    }
    function move(event: TouchEvent) {
      if (!gesture) return;
      if (event.touches.length !== 1) { finish(); return; }
      const touch = Array.from(event.touches).find(item => item.identifier === gesture!.identifier);
      if (!touch) return;
      if (gesture.phase === 'pending') {
        // The first uncancelled touchmove belongs to native scrolling. Never
        // activate an edit later in that same scroll, even if the finger stops.
        clearHold(); gesture.phase = 'pan'; return;
      }
      if (gesture.phase !== 'edit' || !gesture.edit) return;
      if (!event.cancelable) { finish(); return; }
      event.preventDefault();
      const { id, edge, start: originalStart, end: originalEnd } = gesture.edit;
      const state = useProjectStore.getState();
      const current = state.segments.find(item => item.id === id);
      if (!current) { finish(); return; }
      const delta = (touch.clientX - gesture.x) / pps;
      const max = durationSec > 0 ? durationSec : Infinity;
      let start = originalStart, end = originalEnd;
      if (edge === 'start') start = Math.max(0, Math.min(originalStart + delta, end - MIN_DURATION));
      else if (edge === 'end') end = Math.max(start + MIN_DURATION, Math.min(originalEnd + delta, max));
      else {
        const length = originalEnd - originalStart;
        start = Math.max(0, Math.min(originalStart + delta, Math.max(0, max - length)));
        end = Math.min(max, start + length);
      }
      if (start !== current.startTimeSec || end !== current.endTimeSec) state.updateSegmentTimes(id, start, end);
    }
    function end(event: TouchEvent) {
      if (!gesture || !Array.from(event.changedTouches).some(item => item.identifier === gesture!.identifier)) return;
      if (gesture.phase === 'edit' && event.cancelable) event.preventDefault();
      finish(gesture.phase !== 'pending');
    }
    const cancel = () => finish();
    const hide = () => { if (document.hidden) finish(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') finish(); };
    const contextMenu = (event: Event) => { if (gesture?.edit) event.preventDefault(); };
    // A non-passive first touchmove can claim editing after a hold. Quick swipes
    // remain uncancelled, preserving the browser's two-axis scroll and inertia.
    viewport.addEventListener('touchstart', start, { passive: true });
    viewport.addEventListener('touchmove', move, { passive: false });
    viewport.addEventListener('touchend', end, { passive: false });
    viewport.addEventListener('touchcancel', cancel);
    viewport.addEventListener('contextmenu', contextMenu);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', hide);
    return () => {
      finish();
      viewport.removeEventListener('touchstart', start);
      viewport.removeEventListener('touchmove', move);
      viewport.removeEventListener('touchend', end);
      viewport.removeEventListener('touchcancel', cancel);
      viewport.removeEventListener('contextmenu', contextMenu);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [scrollRef, pps, durationSec, projectId, onActivate]);

  const suppressCompatibilityMouse = useCallback((event: ReactMouseEvent) => {
    if (event.type === 'click' && event.detail === 0) return;
    const source = event.nativeEvent as MouseEvent & { sourceCapabilities?: { firesTouchEvents: boolean } };
    if (Date.now() < suppressMouseUntil.current && source.sourceCapabilities?.firesTouchEvents !== false) {
      event.preventDefault(); event.stopPropagation();
    }
  }, []);
  return { editingId, suppressCompatibilityMouse };
}
