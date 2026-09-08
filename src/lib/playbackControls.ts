import { locateClip } from '@/lib/clipTimeline';
import { useProjectStore } from '@/store/projectStore';
import { useVideoStore } from '@/store/videoStore';

export function stepVideoFrame(direction: -1 | 1) {
  const project = useProjectStore.getState();
  const runtime = useVideoStore.getState();
  // At a boundary, stepping back uses the previous clip's frame rate.
  const clip = project.clips ? locateClip(project.clips, Math.max(0, runtime.currentTimeSec + (direction < 0 ? -1e-8 : 0))) : null;
  const fps = clip?.clip.fps ?? project.videoMeta?.fps ?? project.settings.fps;
  runtime.setIsPlaying(false);
  runtime.setCurrentTimeSec(runtime.currentTimeSec + direction / Math.max(1, fps));
}
