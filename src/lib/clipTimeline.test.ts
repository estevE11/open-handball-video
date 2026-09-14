import { describe, expect, it } from 'vitest';
import { clipOffsets, locateClip, matchClipFiles, splitSegmentsAcrossClips, withProjectClips } from '@/lib/clipTimeline';
import { createEmptyProject } from '@/lib/projectDefaults';
import { coerceProjectData } from '@/lib/projectIo';
import type { Segment, VideoClip } from '@/types/project';

const clips: VideoClip[] = [
  { id: 'a', fileName: 'first.mp4', fileSize: 3, fileType: 'video/mp4', lastModified: 1, durationSec: 10 },
  { id: 'b', fileName: 'second.mp4', fileSize: 5, fileType: 'video/mp4', lastModified: 2, durationSec: 20 },
];
const segment = (start: number, end: number): Segment => ({ id: 'tag', mainLabelId: 'label', startTimeSec: start, endTimeSec: end, secondaryLabelIds: [], createdAtMs: 0 });

describe('combined match timeline', () => {
  it('maps boundary, reverse seek and final time to the correct source', () => {
    expect(clipOffsets(clips).map((item) => item.start)).toEqual([0, 10]);
    expect(locateClip(clips, 9.9)).toMatchObject({ index: 0, localTime: 9.9 });
    expect(locateClip(clips, 10)).toMatchObject({ index: 1, localTime: 0 });
    expect(locateClip(clips, 17)).toMatchObject({ index: 1, localTime: 7 });
    expect(locateClip(clips, 5)).toMatchObject({ index: 0, localTime: 5 });
    expect(locateClip(clips, 30)).toMatchObject({ index: 1, localTime: 20 });
  });
  it('splits a tag at a source boundary without adding empty parts', () => {
    expect(splitSegmentsAcrossClips(clips, [segment(8, 14)]).map(({ sourceIndex, startTimeSec, endTimeSec, segmentIndex }) =>
      ({ sourceIndex, startTimeSec, endTimeSec, segmentIndex }))).toEqual([
      { sourceIndex: 0, startTimeSec: 8, endTimeSec: 10, segmentIndex: 0 },
      { sourceIndex: 1, startTimeSec: 0, endTimeSec: 4, segmentIndex: 0 },
    ]);
    expect(splitSegmentsAcrossClips(clips, [segment(0, 10)])).toHaveLength(1);
    expect(splitSegmentsAcrossClips(clips, [segment(30, 35)])).toHaveLength(0);
  });
  it('preserves custom export order while keeping cross-source pieces together', () => {
    const reordered = [{ ...segment(20, 24), id: 'later' }, { ...segment(8, 14), id: 'crossing' }, { ...segment(1, 3), id: 'first' }];
    const parts = splitSegmentsAcrossClips(clips, reordered);
    expect(parts.map((part) => [part.segment.id, part.segmentIndex, part.sourceIndex, part.startTimeSec, part.endTimeSec])).toEqual([
      ['later', 0, 1, 10, 14],
      ['crossing', 1, 0, 8, 10],
      ['crossing', 1, 1, 0, 4],
      ['first', 2, 0, 1, 3],
    ]);
    expect(reordered.map((seg) => seg.id)).toEqual(['later', 'crossing', 'first']);
  });
  it('preserves ordered clip metadata in exported/imported JSON and reads legacy projects', () => {
    const data = withProjectClips(createEmptyProject(), [...clips].reverse());
    expect(coerceProjectData(JSON.parse(JSON.stringify(data)))).toEqual(data);
    expect(data.videoMeta).toMatchObject({ durationSec: 30, fileSize: 8 });
    expect(coerceProjectData(createEmptyProject()).clips).toBeUndefined();
    expect(() => coerceProjectData({ ...data, clips: [{ ...clips[0], durationSec: 0 }] })).toThrow('positive duration');
    expect(() => coerceProjectData({ ...data, clips: [clips[0], clips[0]] })).toThrow('unique ID');
  });
  it('reattaches files in saved order and rejects missing/wrong originals', () => {
    const a = new File(['abc'], 'first.mp4'); const b = new File(['12345'], 'second.mp4');
    expect(matchClipFiles(clips, [b, a])).toEqual([a, b]);
    expect(() => matchClipFiles(clips, [a])).toThrow('all 2 original');
    expect(() => matchClipFiles(clips, [a, new File(['bad'], 'second.mp4')])).toThrow('Missing original clip');
  });
});
