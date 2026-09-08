import { create } from 'zustand';
import { useProjectStore } from './projectStore';
import { useVideoStore } from './videoStore';

type ReviewState = {
  selectedIds: string[]; queue: string[]; index: number; active: boolean; loop: boolean;
  select: (ids: string[]) => void; toggle: (id: string) => void;
  start: () => void; stop: () => void; step: (direction: -1 | 1) => void; setLoop: (loop: boolean) => void;
};
function seek(id: string, play: boolean) {
  const project = useProjectStore.getState();
  const segment = project.segments.find((item) => item.id === id);
  if (!segment) return false;
  project.setSelectedSegmentId(id);
  useVideoStore.getState().setCurrentTimeSec(segment.startTimeSec);
  useVideoStore.getState().setIsPlaying(play);
  return true;
}
export const useReviewStore = create<ReviewState>((set, get) => ({
  selectedIds: [], queue: [], index: 0, active: false, loop: false,
  select: (selectedIds) => set({ selectedIds }),
  toggle: (id) => set((s) => ({ selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter((item) => item !== id) : [...s.selectedIds, id] })),
  setLoop: (loop) => set({ loop }),
  start: () => {
    const duration = useVideoStore.getState().durationSec;
    const queue = useProjectStore.getState().segments.filter((seg) => get().selectedIds.includes(seg.id) && seg.endTimeSec > seg.startTimeSec && (!duration || seg.startTimeSec < duration))
      .sort((a, b) => a.startTimeSec - b.startTimeSec).map((seg) => seg.id);
    if (!queue.length) return;
    set({ queue, index: 0, active: true }); seek(queue[0], true);
  },
  stop: () => { set({ active: false }); useVideoStore.getState().setIsPlaying(false); },
  step: (direction) => {
    const s = get();
    let index = s.index + direction;
    if (s.loop && s.queue.length) index = (index + s.queue.length) % s.queue.length;
    if (index < 0 || index >= s.queue.length) { get().stop(); return; }
    set({ index });
    if (!seek(s.queue[index], useVideoStore.getState().isPlaying)) get().stop();
  },
}));

/** Return true if review handled this boundary instead of ordinary source playback. */
export function advanceReviewAt(time: number) {
  const review = useReviewStore.getState();
  if (!review.active) return false;
  const segment = useProjectStore.getState().segments.find((seg) => seg.id === review.queue[review.index]);
  if (!segment) { review.stop(); return true; }
  const duration = useVideoStore.getState().durationSec;
  const end = duration ? Math.min(duration, segment.endTimeSec) : segment.endTimeSec;
  if (time < end - 0.001) return false;
  if (review.index === review.queue.length - 1 && !review.loop) {
    review.stop(); useVideoStore.getState().setCurrentTimeSec(end);
  } else review.step(1);
  return true;
}

useProjectStore.subscribe((state, previous) => {
  if (state.projectId !== previous.projectId || (!state.session.videoSourceUrl && previous.session.videoSourceUrl)) {
    useReviewStore.setState({ selectedIds: [], queue: [], index: 0, active: false, loop: false });
  }
});
