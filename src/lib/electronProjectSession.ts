import type { ProjectData } from '@/types/project';
import type { VideoFile } from '@/types/electron';
import { coerceProjectData } from '@/lib/projectIo';
import { useProjectStore } from '@/store/projectStore';
import { useVideoStore } from '@/store/videoStore';

export async function openElectronClipProject(raw: ProjectData, videos: VideoFile[]) {
  const data = coerceProjectData(raw);
  if (!data.clips) throw new Error('This project has no clip list.');
  const clipSources = data.clips.map((clip) => {
    const video = videos.find((item) => item.name === clip.fileName && item.size === clip.fileSize);
    if (!video) throw new Error(`Restore ${clip.fileName} to Documents/open-handball-video, then refresh.`);
    return { url: video.url, file: null };
  });
  const clips = await Promise.all(data.clips.map(async (clip, index) => {
    if (clip.fps) return clip;
    const metadata = await window.electron!.probeVideoMetadata(clipSources[index].url);
    // Preserve the saved timeline duration so old tags keep their meaning.
    return { ...clip, fps: metadata.fps };
  }));
  if (clips.some((clip, index) => clip !== data.clips![index])) {
    data.clips = clips;
    if (!(await window.electron!.saveProject(data.electronProjectKey ?? data.projectId, data))) throw new Error('Could not save detected frame rates.');
  }
  useProjectStore.getState().resetProject();
  useProjectStore.getState().replaceProject(data);
  useProjectStore.setState((s) => ({ session: { ...s.session, videoSourceUrl: clipSources[0].url, videoFile: null, clipSources } }));
  useVideoStore.getState().reset();
  useVideoStore.getState().setDurationSec(data.clips.reduce((sum, clip) => sum + clip.durationSec, 0));
}
