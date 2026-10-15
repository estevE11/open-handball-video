import type { ProjectData } from '@/types/project';
import { coerceMatchMetadata } from '../../electron/libraryCatalog';
import { PROJECT_SCHEMA_VERSION, createEmptyProject } from '@/lib/projectDefaults';

export function downloadTextFile(filename: string, contents: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadProjectJson(data: ProjectData, filename = 'project.json') {
  downloadTextFile(filename, JSON.stringify(data, null, 2), 'application/json');
}

export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text) as unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Validate imported JSON before it reaches the editor or persistent library. */
export function coerceProjectData(raw: unknown): ProjectData {
  if (!isObject(raw)) throw new Error('Invalid project file: expected an object');
  if (raw.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error(`Unsupported project schemaVersion: ${String(raw.schemaVersion)}`);
  }
  const base = createEmptyProject();
  const data = { ...base, ...raw };
  const text = (v: unknown) => typeof v === 'string';
  const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const optionalText = (v: unknown) => v === undefined || text(v);
  const labels = data.mainLabels;
  const secondary = data.secondaryLabels;
  const segments = data.segments;
  const meta = data.videoMeta;
  if (!text(data.projectId) || !data.projectId || !number(data.createdAtMs) || !number(data.updatedAtMs)
    || !isObject(data.settings) || !number(data.settings.fps) || data.settings.fps <= 0
    || !Array.isArray(labels) || !labels.every((l: unknown) => isObject(l) && text(l.id) && text(l.name)
      && text(l.color) && text(l.hotkey) && optionalText(l.defaultName) && (l.archived === undefined || typeof l.archived === 'boolean') && number(l.preRollSec) && number(l.postRollSec))
    || !Array.isArray(secondary) || !secondary.every((l: unknown) => isObject(l) && text(l.id) && text(l.name) && optionalText(l.hotkey) && (l.archived === undefined || typeof l.archived === 'boolean'))
    || !Array.isArray(segments) || !segments.every((s: unknown) => isObject(s) && text(s.id) && text(s.mainLabelId)
      && optionalText(s.name) && number(s.startTimeSec) && number(s.endTimeSec) && number(s.createdAtMs)
      && Array.isArray(s.secondaryLabelIds) && s.secondaryLabelIds.every(text))
    || (meta !== null && (!isObject(meta) || !text(meta.fileName) || !text(meta.fileType)
      || !number(meta.fileSize) || !number(meta.lastModified)
      || (meta.durationSec !== undefined && !number(meta.durationSec)) || (meta.fps !== undefined && !number(meta.fps))))) {
    throw new Error('Invalid project file: malformed labels, segments, settings, or video metadata.');
  }
  if (data.clips !== undefined) {
    if (!Array.isArray(data.clips) || data.clips.length === 0 || !data.clips.every((clip: unknown) =>
      isObject(clip) && text(clip.id) && !!clip.id && text(clip.fileName) && text(clip.fileType)
      && number(clip.fileSize) && number(clip.lastModified) && number(clip.durationSec) && Number(clip.durationSec) > 0
      && (clip.fps === undefined || (number(clip.fps) && Number(clip.fps) > 0)))
      || new Set(data.clips.map((clip) => clip.id)).size !== data.clips.length) {
      throw new Error('Invalid project file: each clip needs a unique ID and a positive duration.');
    }
    if (!meta) throw new Error('Invalid project file: clips require video metadata.');
    // Total match time and stored size always derive from the source list.
    data.videoMeta = { ...meta, durationSec: data.clips.reduce((sum, clip) => sum + clip.durationSec, 0),
      fileSize: data.clips.reduce((sum, clip) => sum + clip.fileSize, 0) };
  }
  if (data.labelSetId !== undefined && (typeof data.labelSetId !== 'string' || !data.labelSetId)) {
    throw new Error('Invalid project label set.');
  }
  if (data.name !== undefined && (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 200)) throw new Error('Enter a video name.');
  if (data.folderId !== undefined && data.folderId !== null && (typeof data.folderId !== 'string' || !data.folderId)) throw new Error('Invalid folder.');
  const match = data.match === undefined ? undefined : coerceMatchMetadata(data.match);
  if (data.electronProjectKey !== undefined && (typeof data.electronProjectKey !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(data.electronProjectKey))) {
    throw new Error('Invalid desktop project key.');
  }
  // Only schema fields may enter the store; imported keys must not replace actions/session.
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: data.projectId,
    createdAtMs: data.createdAtMs,
    updatedAtMs: data.updatedAtMs,
    ...(data.name !== undefined ? { name: data.name.trim() } : {}),
    ...(data.folderId !== undefined ? { folderId: data.folderId } : {}),
    ...(match ? { match } : {}),
    videoMeta: data.videoMeta,
    ...(data.electronProjectKey ? { electronProjectKey: data.electronProjectKey } : {}),
    ...(data.clips ? { clips: data.clips } : {}),
    ...(data.labelSetId ? { labelSetId: data.labelSetId } : {}),
    mainLabels: labels,
    secondaryLabels: secondary,
    segments,
    settings: { fps: data.settings.fps },
  } as ProjectData;
}
