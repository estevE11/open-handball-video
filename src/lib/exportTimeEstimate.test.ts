import { expect, it } from 'vitest';
import { createExportTimeEstimator, formatExportDuration } from './exportTimeEstimate';

it('waits for rendering progress and excludes slow setup from the estimated rate', () => {
  const estimate = createExportTimeEstimator(0);
  estimate.update('Loading export engine', 0.1, 60_000);
  expect(estimate.snapshot(60_000)).toEqual({ elapsedMs: 60_000, remainingMs: null });
  estimate.update('Rendering clip 1 of 2', 0.15, 60_000);
  estimate.update('Rendering clip 1 of 2', 0.5, 70_000);
  expect(estimate.snapshot(70_000).remainingMs).toBeCloseTo(10_000 * 0.5 / 0.35);
});

it('updates for stalls and retries without going negative or counting down to false completion', () => {
  const estimate = createExportTimeEstimator(0);
  estimate.update('Rendering clip 1 of 2', 0.1, 0);
  estimate.update('Rendering clip 1 of 2', 0.5, 10_000);
  const first = estimate.snapshot(10_000).remainingMs!;
  estimate.update('Rendering clip 1 of 2', 0.2, 15_000);
  expect(estimate.snapshot(20_000).remainingMs).toBe(first * 2);
  estimate.update('Preparing download', 1, 21_000);
  expect(estimate.snapshot(22_000).remainingMs).toBeNull();
});

it('requires a sample before estimating, resets on a new export and ignores invalid progress', () => {
  const estimate = createExportTimeEstimator(0);
  estimate.update('Rendering tagged clips', 0.1, 0);
  estimate.update('Rendering tagged clips', NaN, 1000);
  expect(estimate.snapshot(1000).remainingMs).toBeNull();
  estimate.update('Rendering tagged clips', 0.5, 4000);
  expect(estimate.snapshot(4000).remainingMs).toBeGreaterThan(0);
  expect(createExportTimeEstimator(4000).snapshot(5000).remainingMs).toBeNull();
});

it.each([[0, '0:00'], [500, '0:01'], [61_000, '1:01'], [3_661_000, '1:01:01']])('formats %s ms as %s', (ms, expected) => {
  expect(formatExportDuration(ms)).toBe(expected);
});
