import { useProjectStore } from '@/store/projectStore';
import { useVideoStore } from '@/store/videoStore';
import { saveBrowserProject } from '@/lib/browserStorage';
import { matchClipFiles } from '@/lib/clipTimeline';
import type { ProjectData } from '@/types/project';

export function currentProject(): ProjectData {
  return JSON.parse(useProjectStore.getState().exportProjectJson()) as ProjectData;
}

export function openBrowserProject(data: ProjectData, file?: File | File[]) {
  const state = useProjectStore.getState();
  state.resetProject();
  state.replaceProject(data);
  if (file) {
    const files = Array.isArray(file) ? file : [file];
    const clipSources = files.map((item) => ({ url: URL.createObjectURL(item), file: item }));
    useProjectStore.setState((s) => ({ session: { ...s.session,
      videoSourceUrl: clipSources[0]?.url ?? null, videoFile: files[0] ?? null, clipSources,
    } }));
  }
  useVideoStore.getState().reset();
  if (data.clips) useVideoStore.getState().setDurationSec(data.clips.reduce((sum, clip) => sum + clip.durationSec, 0));
}

export async function attachBrowserVideo(file: File) {
  const data = currentProject();
  data.videoMeta = {
    ...(data.videoMeta?.fileSize === file.size ? data.videoMeta : {}),
    fileName: file.name, fileSize: file.size, fileType: file.type, lastModified: file.lastModified,
  };
  data.updatedAtMs = Date.now();
  await saveBrowserProject(data, file);
  if (useProjectStore.getState().projectId !== data.projectId) return;
  openBrowserProject(data, file);
}


export async function attachBrowserClips(files: File[]) {
  const data = currentProject();
  if (!data.clips) {
    if (files.length !== 1) throw new Error('This project needs its original single video.');
    return attachBrowserVideo(files[0]);
  }
  const ordered = matchClipFiles(data.clips, files);
  await saveBrowserProject(data, ordered);
  if (useProjectStore.getState().projectId === data.projectId) openBrowserProject(data, ordered);
}
