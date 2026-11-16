// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { useVideoStore } from './videoStore';

afterEach(() => { vi.restoreAllMocks(); useVideoStore.getState().setIsMuted(false); useVideoStore.getState().reset(); localStorage.clear(); });

it('retains mute when switching videos and restores both mute choices after a reload', async () => {
  useVideoStore.getState().setIsMuted(true);
  useVideoStore.getState().setCurrentTimeSec(20);
  useVideoStore.getState().setIsPlaying(true);
  useVideoStore.getState().reset();
  expect(useVideoStore.getState()).toMatchObject({ isMuted: true, currentTimeSec: 0, isPlaying: false });
  vi.resetModules();
  const reloaded = (await import('./videoStore')).useVideoStore;
  expect(reloaded.getState().isMuted).toBe(true);
  reloaded.getState().setIsMuted(false);
  vi.resetModules();
  expect((await import('./videoStore')).useVideoStore.getState().isMuted).toBe(false);
});

it('writes the preference only when mute changes, not on playback updates', () => {
  const write = vi.spyOn(Storage.prototype, 'setItem');
  useVideoStore.getState().setIsMuted(true);
  expect(write).toHaveBeenCalledOnce();
  useVideoStore.getState().setDurationSec(600);
  useVideoStore.getState().setCurrentTimeSec(60);
  useVideoStore.getState().setIsPlaying(true);
  useVideoStore.getState().reset();
  expect(write).toHaveBeenCalledOnce();
});

it('keeps mute usable if browser storage is blocked', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  vi.resetModules();
  const unavailable = (await import('./videoStore')).useVideoStore;
  expect(unavailable.getState().isMuted).toBe(false);
  expect(() => unavailable.getState().setIsMuted(true)).not.toThrow();
  unavailable.getState().reset();
  expect(unavailable.getState().isMuted).toBe(true);
});

it.each([NaN, Infinity, -Infinity])('keeps duration finite when media reports unavailable duration %s', (duration) => {
  useVideoStore.getState().reset();
  useVideoStore.getState().setDurationSec(duration);
  expect(useVideoStore.getState().durationSec).toBe(0);
  useVideoStore.getState().setDurationSec(120);
  useVideoStore.getState().setDurationSec(duration);
  expect(useVideoStore.getState().durationSec).toBe(120);
});
