import { afterEach, expect, it } from 'vitest';
import { stepVideoFrame } from '@/lib/playbackControls';
import { useProjectStore } from '@/store/projectStore';
import { useVideoStore } from '@/store/videoStore';
import { getSegmentTitles } from '../../electron/segmentTitles';

afterEach(() => { useProjectStore.getState().resetProject(); useVideoStore.getState().reset(); });

it('steps across source boundaries using the adjacent clip frame rate', () => {
  const meta = { fileType: 'video/mp4', fileSize: 10, lastModified: 1, durationSec: 10 };
  useProjectStore.setState({ clips: [
    { ...meta, id: 'a', fileName: 'a.mp4', fps: 25 },
    { ...meta, id: 'b', fileName: 'b.mp4', fps: 50 },
  ] });
  useVideoStore.setState({ currentTimeSec: 10, durationSec: 20, isPlaying: true });
  stepVideoFrame(-1);
  expect(useVideoStore.getState().currentTimeSec).toBeCloseTo(9.96, 5);
  expect(useVideoStore.getState().isPlaying).toBe(false);
  stepVideoFrame(1);
  expect(useVideoStore.getState().currentTimeSec).toBeCloseTo(10, 5);
  stepVideoFrame(1);
  expect(useVideoStore.getState().currentTimeSec).toBeCloseTo(10.02, 5);
});

it('defaults event titles to their type and keeps custom titles separate', () => {
  expect(getSegmentTitles({}, { name: 'Attack' })).toEqual({ primaryText: 'Attack', secondaryText: 'Attack' });
  expect(getSegmentTitles({ name: ' 3:2:1 ' }, { name: 'Attack' })).toEqual({ primaryText: '3:2:1', secondaryText: 'Attack' });
  expect(getSegmentTitles({ name: ' ' }, { name: 'Defense' })).toEqual({ primaryText: 'Defense', secondaryText: 'Defense' });
});
