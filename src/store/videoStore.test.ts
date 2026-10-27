import { afterEach, expect, it } from 'vitest';
import { useVideoStore } from './videoStore';

afterEach(() => useVideoStore.getState().reset());

it.each([NaN, Infinity, -Infinity])('keeps duration finite when media reports unavailable duration %s', (duration) => {
  useVideoStore.getState().reset();
  useVideoStore.getState().setDurationSec(duration);
  expect(useVideoStore.getState().durationSec).toBe(0);
  useVideoStore.getState().setDurationSec(120);
  useVideoStore.getState().setDurationSec(duration);
  expect(useVideoStore.getState().durationSec).toBe(120);
});
