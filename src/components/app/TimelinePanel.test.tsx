// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TimelinePanel } from './TimelinePanel';
import { useProjectStore } from '@/store/projectStore';
import { useVideoStore } from '@/store/videoStore';

beforeEach(() => {
  vi.useFakeTimers();
  useProjectStore.getState().resetProject();
  const state = useProjectStore.getState();
  state.setVideoFile(new File(['video'], 'match.mp4'), 'blob:test', 120);
  useVideoStore.getState().reset(); useVideoStore.getState().setDurationSec(120);
  state.createSegmentFromTrigger(state.mainLabels[0].id, 12); // 10–15 seconds.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-timeline-segment') ? new DOMRect(100, 20, 300, 22) : new DOMRect();
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); useProjectStore.getState().resetProject(); useVideoStore.getState().reset(); });
const segment = () => useProjectStore.getState().segments[0];
const touch = (x: number, identifier = 1) => ({ clientX: x, clientY: 30, identifier });
function start(target: Element, x = 250) { fireEvent.touchStart(target, { touches: [touch(x)], changedTouches: [touch(x)] }); }
function move(target: Element, x: number, cancelable = true) { return fireEvent.touchMove(target, { touches: [touch(x)], changedTouches: [touch(x)], cancelable }); }
function end(target: Element, x: number) { fireEvent.touchEnd(target, { touches: [], changedTouches: [touch(x)] }); }
function hold() { act(() => vi.advanceTimersByTime(400)); }

it('allows an immediate swipe to scroll without changing a tag, even after pausing the swipe', () => {
  render(<TimelinePanel />);
  const body = screen.getByLabelText('Move segment');
  const before = useProjectStore.getState().exportProjectJson();
  start(body);
  expect(move(body, 200)).toBe(true); // Native scrolling is not cancelled.
  hold(); move(body, 150); end(body, 150);
  expect(useProjectStore.getState().exportProjectJson()).toBe(before);
});

it('moves a held tag, preserves its duration and creates one undo step without seeking', () => {
  render(<TimelinePanel />);
  const body = screen.getByLabelText('Move segment');
  const before = useProjectStore.getState().past.length;
  start(body); hold();
  expect(body.closest('[data-timeline-segment]')?.classList.contains('ring-4')).toBe(true);
  expect(move(body, 310)).toBe(false); // Editing claims the touch gesture.
  expect(segment()).toMatchObject({ startTimeSec: 11, endTimeSec: 16 });
  move(body, 370); end(body, 370);
  expect(segment()).toMatchObject({ startTimeSec: 12, endTimeSec: 17 });
  expect(useProjectStore.getState().past).toHaveLength(before + 1);
  fireEvent.mouseDown(body, { button: 0, clientX: 370 });
  fireEvent.click(body, { detail: 1 });
  expect(useVideoStore.getState().currentTimeSec).toBe(0);
  act(() => useProjectStore.getState().undo());
  expect(segment()).toMatchObject({ startTimeSec: 10, endTimeSec: 15 });
});

it.each(['start', 'end'])('resizes the held %s edge with a wider touch area', edge => {
  render(<TimelinePanel />);
  // Start on the body, 20 px from the edge rather than on the 8 px mouse grip.
  const body = screen.getByLabelText('Move segment');
  const x = edge === 'start' ? 120 : 380;
  start(body, x); hold(); move(body, x + 60); end(body, x + 60);
  expect(segment()).toMatchObject(edge === 'start' ? { startTimeSec: 11, endTimeSec: 15 } : { startTimeSec: 10, endTimeSec: 16 });
});

it.each(['start', 'end'])('keeps a minimum length when resizing the %s edge past the other edge', edge => {
  render(<TimelinePanel />);
  const grip = screen.getByLabelText(edge === 'start' ? 'Resize segment start' : 'Resize segment end');
  const x = edge === 'start' ? 104 : 396;
  start(grip, x); hold(); move(grip, edge === 'start' ? 5000 : -5000);
  expect(segment().endTimeSec - segment().startTimeSec).toBeCloseTo(0.05);
  end(grip, x);
});

it.each([-10000, 10000])('clamps a held tag to the video bounds while preserving length (%s)', x => {
  render(<TimelinePanel />);
  const body = screen.getByLabelText('Move segment');
  start(body); hold(); move(body, x); end(body, x);
  expect(segment()).toMatchObject(x < 0 ? { startTimeSec: 0, endTimeSec: 5 } : { startTimeSec: 115, endTimeSec: 120 });
});

it.each(['touchcancel', 'blur', 'multitouch'])('cancels a pending hold on %s', reason => {
  render(<TimelinePanel />);
  const body = screen.getByLabelText('Move segment');
  const before = useProjectStore.getState().exportProjectJson();
  start(body);
  if (reason === 'blur') fireEvent.blur(window);
  else if (reason === 'multitouch') fireEvent.touchStart(body, { touches: [touch(250), touch(260, 2)], changedTouches: [touch(260, 2)] });
  else fireEvent.touchCancel(body);
  hold(); move(body, 400); end(body, 400);
  expect(useProjectStore.getState().exportProjectJson()).toBe(before);
});

it('finishes the undo group on cancellation and cancels timers on unmount', () => {
  const view = render(<TimelinePanel />);
  const body = screen.getByLabelText('Move segment');
  start(body); hold(); move(body, 310); fireEvent.touchCancel(body);
  act(() => useProjectStore.getState().renameSegment(segment().id, 'Renamed'));
  act(() => useProjectStore.getState().undo());
  expect(segment()).toMatchObject({ startTimeSec: 11, endTimeSec: 16 });
  start(body); view.unmount(); hold();
  expect(segment()).toMatchObject({ startTimeSec: 11, endTimeSec: 16 });
});

it('does not edit if the browser has already claimed the touch or the project changes during a hold', () => {
  render(<TimelinePanel />);
  const body = screen.getByLabelText('Move segment');
  start(body); hold(); move(body, 310, false);
  expect(segment()).toMatchObject({ startTimeSec: 10, endTimeSec: 15 });
  start(body);
  act(() => useProjectStore.getState().resetProject());
  hold();
  expect(useProjectStore.getState().segments).toHaveLength(0);
});

it('keeps tap-to-seek and immediate mouse dragging working', () => {
  render(<TimelinePanel />);
  const body = screen.getByLabelText('Move segment');
  start(body); end(body, 250);
  fireEvent.mouseDown(body, { button: 0, clientX: 250 });
  fireEvent.mouseUp(window); fireEvent.click(body, { detail: 1 });
  expect(useVideoStore.getState().currentTimeSec).toBe(10);
  fireEvent.mouseDown(body, { button: 0, clientX: 250 });
  fireEvent.mouseMove(window, { clientX: 310 }); fireEvent.mouseUp(window);
  expect(segment()).toMatchObject({ startTimeSec: 11, endTimeSec: 16 });
});
