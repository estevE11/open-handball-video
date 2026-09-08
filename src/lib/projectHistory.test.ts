// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { useProjectStore } from '@/store/projectStore';
beforeEach(() => useProjectStore.getState().resetProject());
it('undoes and redoes create, title, secondary tags and deletion without touching the video', () => {
  const store = useProjectStore;
  const state = store.getState();
  const segment = state.createSegmentFromTrigger(state.mainLabels[0].id, 10)!;
  state.renameSegment(segment.id, '3:2:1');
  state.toggleSecondaryOnSelectedSegment(state.secondaryLabels[0].id);
  const edited = store.getState().segments;
  state.deleteSegment(segment.id);
  state.undo(); expect(store.getState().segments).toEqual(edited);
  state.undo(); expect(store.getState().segments[0].secondaryLabelIds).toEqual([]);
  state.undo(); expect(store.getState().segments[0].name).toBeUndefined();
  state.undo(); expect(store.getState().segments).toEqual([]);
  for (let i = 0; i < 3; i++) state.redo();
  expect(store.getState().segments).toEqual(edited);
  expect(store.getState().session).toBe(state.session);
  expect(JSON.parse(state.exportProjectJson())).not.toHaveProperty('past');
});
it('groups drags, clears redo on new edits, and isolates history between projects', () => {
  const state = useProjectStore.getState();
  const segment = state.createSegmentFromTrigger(state.mainLabels[0].id, 10)!;
  state.beginHistoryGroup();
  for (let i = 1; i <= 10; i++) state.updateSegmentTimes(segment.id, i, i + 5);
  state.endHistoryGroup(); state.undo();
  expect(useProjectStore.getState().segments[0]).toEqual(segment);
  state.renameSegment(segment.id, 'New');
  expect(useProjectStore.getState().future).toEqual([]);
  state.replaceProject(JSON.parse(state.exportProjectJson()));
  expect(useProjectStore.getState().past).toEqual([]);
  state.undo(); expect(useProjectStore.getState().segments[0].name).toBe('New');
});
