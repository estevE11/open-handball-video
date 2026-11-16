import { expect, it } from 'vitest';
import type { Segment } from '@/types/project';
import { groupExportSegmentsBySecondaryTags } from './exportSegmentOrder';

const labels = ['p1', 'p2', 'goal', 'save'].map(id => ({ id, name: id }));
function segment(id: string, tags: string[], time: number): Segment {
  return { id, mainLabelId: 'attack', secondaryLabelIds: tags, startTimeSec: time, endTimeSec: time + 1, createdAtMs: 0 };
}

it('groups by label order and remaining tags before using time, with untagged clips last', () => {
  const input = [segment('untagged', [], 0), segment('p2-goal', ['goal', 'p2'], 1), segment('save', ['save', 'p1'], 2),
    segment('late', ['goal', 'p1'], 40), segment('early', ['p1', 'goal'], 30), segment('p1', ['p1'], 50), segment('p2', ['p2'], 60)];
  const before = JSON.stringify(input);
  const ordered = groupExportSegmentsBySecondaryTags(input, labels);
  expect(ordered.map(item => item.id)).toEqual(['p1', 'early', 'late', 'save', 'p2', 'p2-goal', 'untagged']);
  expect(new Set(ordered.map(item => item.id)).size).toBe(input.length);
  expect(JSON.stringify(input)).toBe(before);
});

it('follows custom label order rather than label names or tag assignment order', () => {
  const input = [segment('one', ['p1', 'goal'], 10), segment('two', ['goal', 'p2'], 20)];
  expect(groupExportSegmentsBySecondaryTags(input, [labels[1], labels[0], labels[2]]).map(item => item.id)).toEqual(['two', 'one']);
});

it('retains unknown and repeated tag IDs without duplicating clips and keeps equal times stable', () => {
  const input = [segment('late', ['unknown'], 20), segment('one', ['p1', 'p1'], 1), segment('two', ['p1'], 1), segment('early', ['unknown'], 10)];
  expect(groupExportSegmentsBySecondaryTags(input, labels).map(item => item.id)).toEqual(['one', 'two', 'early', 'late']);
  expect(groupExportSegmentsBySecondaryTags([], labels)).toEqual([]);
});
