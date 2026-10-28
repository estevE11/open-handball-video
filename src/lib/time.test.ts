import { describe, expect, it } from 'vitest';
import { formatTimecode } from './time';

describe('formatTimecode', () => {
  it.each([
    [0, '00.000'],
    [5.123, '05.123'],
    [1.001, '01.001'],
    [59.999, '59.999'],
    [60, '01:00.000'],
    [725.123, '12:05.123'],
    [3599.999, '59:59.999'],
    [3600, '01:00:00.000'],
    [4205.123, '01:10:05.123'],
    [360000, '100:00:00.000'],
    [59.9996, '01:00.000'],
    [3599.9996, '01:00:00.000'],
    [-1, '00.000'],
  ])('formats %s seconds as %s', (seconds, expected) => {
    expect(formatTimecode(seconds)).toBe(expected);
  });

  it.each([NaN, Infinity, -Infinity])('keeps unavailable time readable for %s', (seconds) => {
    expect(formatTimecode(seconds)).toBe('--:--');
  });
});
