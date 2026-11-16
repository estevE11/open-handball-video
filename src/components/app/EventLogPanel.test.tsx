// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventLogPanel } from './EventLogPanel';
import { useProjectStore } from '@/store/projectStore';

let rowTop = 420;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  rowTop = 420;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-radix-scroll-area-viewport')) return new DOMRect(0, 100, 320, 200);
    if (this.classList.contains('group')) return new DOMRect(0, rowTop, 320, 80);
    return new DOMRect();
  });
  const state = useProjectStore.getState();
  state.setVideoFile(new File(['video'], 'match.mp4'), 'blob:test', 600);
  state.createSegmentFromTrigger(state.mainLabels[0].id, 300);
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useProjectStore.getState().resetProject();
});

it('reveals each new row, including a tag inserted earlier in chronological order', () => {
  const { container } = render(<EventLogPanel />);
  const viewport = container.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')!;
  expect(viewport.scrollTop).toBe(0); // Opening an existing project does not jump.
  const add = screen.getByRole('button', { name: 'AttackA' });
  add.focus();
  fireEvent.click(add);
  expect(viewport.scrollTop).toBe(208);
  expect(document.activeElement).toBe(add);

  rowTop = 40;
  act(() => {
    const state = useProjectStore.getState();
    state.createSegmentFromTrigger(state.mainLabels[0].id, 40);
  });
  expect(viewport.scrollTop).toBe(140);
});

it('does not scroll a visible new row or pull the user back after editing or selecting tags', () => {
  const { container } = render(<EventLogPanel />);
  const viewport = container.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]')!;
  viewport.scrollTop = 80;
  rowTop = 150;
  let id = '';
  act(() => {
    const state = useProjectStore.getState();
    id = state.createSegmentFromTrigger(state.mainLabels[0].id, 40)!.id;
  });
  expect(viewport.scrollTop).toBe(80);
  rowTop = 420;
  act(() => useProjectStore.getState().renameSegment(id, 'Custom title'));
  act(() => useProjectStore.getState().toggleSecondaryOnSelectedSegment(useProjectStore.getState().secondaryLabels[0].id));
  act(() => useProjectStore.getState().setSelectedSegmentId(useProjectStore.getState().segments[0].id));
  expect(viewport.scrollTop).toBe(80);
});
