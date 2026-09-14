import type { ProjectData, Segment, VideoClip, VideoMeta } from '@/types/project';

export function clipOffsets(clips: VideoClip[]) {
  let offset = 0;
  return clips.map((clip, index) => {
    const start = offset;
    offset += clip.durationSec;
    return { clip, index, start, end: offset };
  });
}

export function locateClip(clips: VideoClip[], time: number) {
  const offsets = clipOffsets(clips);
  const selected = offsets.find((item) => time < item.end) ?? offsets.at(-1);
  if (!selected) return null;
  return { ...selected, localTime: Math.max(0, Math.min(selected.clip.durationSec, time - selected.start)) };
}

export function splitSegmentsAcrossClips(clips: VideoClip[], segments: Segment[]) {
  const offsets = clipOffsets(clips);
  // Preserve export order; only the pieces within a segment follow source order.
  return segments.flatMap((segment, segmentIndex) =>
    offsets.flatMap(({ index, start, end }) => {
      const from = Math.max(start, segment.startTimeSec);
      const to = Math.min(end, segment.endTimeSec);
      return to > from ? [{ sourceIndex: index, startTimeSec: from - start, endTimeSec: to - start, segmentIndex, segment }] : [];
    }));
}

export function matchClipFiles(clips: VideoClip[], files: File[]): File[] {
  if (files.length !== clips.length) throw new Error(`Choose all ${clips.length} original clips to restore this project.`);
  const remaining = [...files];
  return clips.map((clip) => {
    const index = remaining.findIndex((file) => file.name === clip.fileName && file.size === clip.fileSize);
    if (index < 0) throw new Error(`Missing original clip: ${clip.fileName} (${clip.fileSize} bytes). Choose the original files; their saved order will be restored.`);
    return remaining.splice(index, 1)[0];
  });
}

export function withProjectClips(data: ProjectData, clips: VideoClip[]): ProjectData {
  if (!clips.length) throw new Error('Add at least one clip.');
  return { ...data, clips, videoMeta: {
    ...clips[0], fileSize: clips.reduce((sum, clip) => sum + clip.fileSize, 0),
    durationSec: clips.reduce((sum, clip) => sum + clip.durationSec, 0),
  }, updatedAtMs: Date.now() };
}

export function fileMeta(file: File): VideoMeta {
  return { fileName: file.name, fileSize: file.size, fileType: file.type, lastModified: file.lastModified };
}

/** Read only media headers, without copying a whole match into FFmpeg memory. */
export function readVideoDuration(source: File | string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    const cleanup = () => {
      clearTimeout(timeout);
      video.onloadedmetadata = null; video.onerror = null;
      video.removeAttribute('src'); video.load();
      if (typeof source !== 'string') URL.revokeObjectURL(url);
    };
    const fail = () => { cleanup(); reject(new Error('Could not read this clip. Choose a video supported by your browser.')); };
    const timeout = setTimeout(fail, 30_000);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) { fail(); return; }
      cleanup(); resolve(duration);
    };
    video.onerror = fail;
    video.src = url;
  });
}
