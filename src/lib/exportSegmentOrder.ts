import type { SecondaryLabel, Segment } from '@/types/project';

/** Keep each clip once, independent of the order its tags were assigned. */
export function groupExportSegmentsBySecondaryTags(segments: readonly Segment[], labels: readonly SecondaryLabel[]) {
  const ranks = new Map(labels.map((label, index) => [label.id, index]));
  // Retain unrecognized IDs from older projects without merging unrelated groups.
  const unknown = [...new Set(segments.flatMap(segment => segment.secondaryLabelIds).filter(id => !ranks.has(id)))].sort();
  for (const id of unknown) ranks.set(id, ranks.size);
  const entries = segments.map((segment, index) => ({ segment, index,
    tags: [...new Set(segment.secondaryLabelIds)].map(id => ranks.get(id)!).sort((a, b) => a - b),
  }));
  return entries.sort((a, b) => {
    if (!a.tags.length && b.tags.length) return 1;
    if (a.tags.length && !b.tags.length) return -1;
    for (let i = 0; i < Math.min(a.tags.length, b.tags.length); i++) {
      if (a.tags[i] !== b.tags[i]) return a.tags[i] - b.tags[i];
    }
    return a.tags.length - b.tags.length || a.segment.startTimeSec - b.segment.startTimeSec || a.index - b.index;
  }).map(entry => entry.segment);
}
