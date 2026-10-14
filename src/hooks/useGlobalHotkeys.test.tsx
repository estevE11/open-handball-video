// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGlobalHotkeys } from '@/hooks/useGlobalHotkeys';
import { useProjectStore } from '@/store/projectStore';
import { useVideoStore } from '@/store/videoStore';

beforeEach(() => {
  vi.useFakeTimers();
  useProjectStore.getState().resetProject();
  useProjectStore.getState().setVideoFile(new File(['video'], 'match.mp4'), 'blob:test');
  useVideoStore.getState().reset();
  useVideoStore.getState().setDurationSec(60);
  useVideoStore.getState().setCurrentTimeSec(10);
  useVideoStore.getState().setPlaybackRate(3);
});
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.useRealTimers(); });

function focusedControl(role?: string) {
  const button = document.createElement('button');
  if (role) button.setAttribute('role', role);
  document.body.append(button);
  button.focus();
  return button;
}

it.each(['combobox', 'slider', 'separator', undefined])('keeps playback shortcuts in control when a %s has focus', (role) => {
  renderHook(useGlobalHotkeys);
  const control = focusedControl(role);
  const nativeHandler = vi.fn();
  control.addEventListener('keydown', nativeHandler);
  expect(fireEvent.keyDown(control, { key: ' ' })).toBe(false);
  fireEvent.keyUp(control, { key: ' ' });
  expect(useVideoStore.getState().isPlaying).toBe(true);
  expect(nativeHandler).not.toHaveBeenCalled();
  fireEvent.keyDown(control, { key: 'ArrowRight' });
  expect(useVideoStore.getState().currentTimeSec).toBe(15);
  fireEvent.keyDown(control, { key: 'ArrowLeft' });
  expect(useVideoStore.getState().currentTimeSec).toBe(10);
  fireEvent.keyDown(control, { key: '.' });
  expect(useVideoStore.getState().currentTimeSec).toBeCloseTo(10 + 1 / useProjectStore.getState().settings.fps);
  expect(useVideoStore.getState().isPlaying).toBe(false);
});

it('taps Space once to toggle and holds Space for 1× without repeated toggles', () => {
  renderHook(useGlobalHotkeys);
  const control = focusedControl('combobox');
  fireEvent.keyDown(control, { key: ' ' });
  fireEvent.keyUp(control, { key: ' ' });
  expect(useVideoStore.getState()).toMatchObject({ isPlaying: true, playbackRate: 3 });
  fireEvent.keyDown(control, { key: ' ' });
  act(() => vi.advanceTimersByTime(250));
  expect(useVideoStore.getState()).toMatchObject({ isPlaying: true, playbackRate: 1 });
  fireEvent.keyDown(control, { key: ' ', repeat: true });
  fireEvent.keyDown(control, { key: ' ', repeat: true });
  expect(useVideoStore.getState()).toMatchObject({ isPlaying: true, playbackRate: 1 });
  fireEvent.keyUp(control, { key: ' ' });
  expect(useVideoStore.getState()).toMatchObject({ isPlaying: true, playbackRate: 3 });
  fireEvent.keyDown(control, { key: ' ' });
  fireEvent.keyUp(control, { key: ' ' });
  expect(useVideoStore.getState().isPlaying).toBe(false);
});

it('temporarily plays from paused while holding Space and restores on release or lost focus', () => {
  renderHook(useGlobalHotkeys);
  fireEvent.keyDown(window, { key: ' ' });
  act(() => vi.advanceTimersByTime(250));
  expect(useVideoStore.getState()).toMatchObject({ isPlaying: true, playbackRate: 1 });
  fireEvent.keyUp(window, { key: ' ' });
  expect(useVideoStore.getState()).toMatchObject({ isPlaying: false, playbackRate: 3 });
  fireEvent.keyDown(window, { key: ' ' });
  act(() => vi.advanceTimersByTime(250));
  fireEvent.blur(window);
  expect(useVideoStore.getState()).toMatchObject({ isPlaying: false, playbackRate: 3 });
  fireEvent.keyDown(window, { key: ' ' });
  fireEvent.blur(window);
  act(() => vi.advanceTimersByTime(250));
  expect(useVideoStore.getState()).toMatchObject({ isPlaying: false, playbackRate: 3 });
});

it('keeps 1× until both J and Space are released', () => {
  renderHook(useGlobalHotkeys);
  act(() => useVideoStore.getState().setIsPlaying(true));
  fireEvent.keyDown(window, { key: 'j' });
  fireEvent.keyDown(window, { key: ' ' });
  act(() => vi.advanceTimersByTime(250));
  fireEvent.keyUp(window, { key: 'j' });
  expect(useVideoStore.getState().playbackRate).toBe(1);
  fireEvent.keyUp(window, { key: ' ' });
  expect(useVideoStore.getState()).toMatchObject({ isPlaying: true, playbackRate: 3 });
});

it('leaves typing and dialogs alone and cancels a hold when leaving the video', () => {
  renderHook(useGlobalHotkeys);
  const input = document.createElement('input');
  document.body.append(input);
  fireEvent.keyDown(input, { key: ' ' });
  fireEvent.keyUp(input, { key: ' ' });
  fireEvent.keyDown(input, { key: 'ArrowRight' });
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  const button = focusedControl();
  dialog.append(button);
  document.body.append(dialog);
  fireEvent.keyDown(button, { key: ' ' });
  fireEvent.keyUp(button, { key: ' ' });
  expect(useVideoStore.getState()).toMatchObject({ isPlaying: false, playbackRate: 3, currentTimeSec: 10 });
  fireEvent.keyDown(window, { key: ' ' });
  act(() => { useProjectStore.getState().clearVideoSourceUrl(); useVideoStore.getState().reset(); });
  act(() => vi.advanceTimersByTime(250));
  fireEvent.keyUp(window, { key: ' ' });
  expect(useVideoStore.getState()).toMatchObject({ isPlaying: false, playbackRate: 1 });
});
