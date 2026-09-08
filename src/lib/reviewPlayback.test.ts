// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { useProjectStore } from '@/store/projectStore';
import { useVideoStore } from '@/store/videoStore';
import { advanceReviewAt, useReviewStore } from '@/store/reviewStore';
beforeEach(() => { useProjectStore.getState().resetProject(); useVideoStore.getState().reset(); });
it('reviews selected ranges in timeline order, skips gaps and stops at the final end', () => {
  const state = useProjectStore.getState();
  const a = state.createSegmentFromTrigger(state.mainLabels[0].id, 10)!;
  const b = state.createSegmentFromTrigger(state.mainLabels[0].id, 30)!;
  state.createSegmentFromTrigger(state.mainLabels[1].id, 20);
  useReviewStore.getState().select([b.id, a.id]); useReviewStore.getState().start();
  expect(useVideoStore.getState().currentTimeSec).toBe(a.startTimeSec);
  expect(advanceReviewAt(a.endTimeSec - 1)).toBe(false);
  expect(advanceReviewAt(a.endTimeSec)).toBe(true);
  expect(useVideoStore.getState().currentTimeSec).toBe(b.startTimeSec);
  advanceReviewAt(b.endTimeSec);
  expect(useVideoStore.getState().isPlaying).toBe(false);
  expect(useVideoStore.getState().currentTimeSec).toBe(b.endTimeSec);
});
it('loops, supports previous/next, handles removed tags and resets across projects', () => {
  const state = useProjectStore.getState();
  const a = state.createSegmentFromTrigger(state.mainLabels[0].id, 10)!;
  useReviewStore.getState().select([a.id]); useReviewStore.getState().setLoop(true); useReviewStore.getState().start();
  advanceReviewAt(a.endTimeSec); expect(useVideoStore.getState().currentTimeSec).toBe(a.startTimeSec);
  expect(useReviewStore.getState().active).toBe(true);
  useReviewStore.getState().step(-1); expect(useVideoStore.getState().isPlaying).toBe(true);
  state.deleteSegment(a.id); advanceReviewAt(10); expect(useReviewStore.getState().active).toBe(false);
  state.resetProject(); expect(useReviewStore.getState().selectedIds).toEqual([]);
});
it('does not interrupt a selected tag spanning a source boundary', () => {
  const state = useProjectStore.getState();
  const tag = state.createSegmentFromTrigger(state.mainLabels[0].id, 10)!;
  useReviewStore.getState().select([tag.id]); useReviewStore.getState().start();
  expect(advanceReviewAt(10)).toBe(false);
  expect(useReviewStore.getState().active).toBe(true);
});
