import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Id, LabelSet, MainLabel, ProjectData, SecondaryLabel, Segment, VideoMeta } from '@/types/project';
import { coerceProjectData } from '@/lib/projectIo';
import { labelsEqual, projectWithLabelSet } from '@/lib/labelSets';
import { createId } from '@/lib/ids';
import { PROJECT_SCHEMA_VERSION, createEmptyProject } from '@/lib/projectDefaults';

const STORAGE_KEY = 'ohv.project.v1';

type SessionState = {
  /** Blob URL of the currently loaded local video. Never persisted. */
  videoSourceUrl: string | null;
  /** Active video file. Browser library persists it separately in IndexedDB. */
  videoFile: File | null;
  clipSources: { url: string; file: File | null }[];
  /** True after Zustand rehydrates from localStorage. */
  hydrated: boolean;
};

type EditSnapshot = Pick<ProjectData, 'segments' | 'mainLabels' | 'secondaryLabels' | 'settings'> & { selectedSegmentId: Id | null; lastCreatedSegmentId: Id | null };
function snapshot(s: ProjectState): EditSnapshot {
  return { segments: s.segments, mainLabels: s.mainLabels, secondaryLabels: s.secondaryLabels, settings: s.settings, selectedSegmentId: s.selectedSegmentId, lastCreatedSegmentId: s.lastCreatedSegmentId };
}

export type ProjectState = ProjectData & {
  session: SessionState;
  past: EditSnapshot[];
  future: EditSnapshot[];
  undo: () => void;
  redo: () => void;
  beginHistoryGroup: () => void;
  endHistoryGroup: () => void;

  /** Replace the *session* video URL (does not persist). */
  setVideoSourceUrl: (url: string | null) => void;
  /**
   * Set the persisted video metadata (so session restore can prompt for re-upload),
   * plus the non-persisted blob URL for actual playback.
   */
  setVideoFile: (file: File, videoSourceUrl: string, durationSec?: number) => void;
  setElectronVideo: (videoUrl: string, meta: VideoMeta) => void;
  setVideoDurationSec: (durationSec: number) => void;
  setVideoFps: (fps: number) => void;
  clearVideoSourceUrl: () => void;

  applyLabelSet: (labelSet: LabelSet) => void;

  upsertMainLabel: (label: MainLabel) => void;
  deleteMainLabel: (id: Id) => void;
  upsertSecondaryLabel: (label: SecondaryLabel) => void;
  deleteSecondaryLabel: (id: Id) => void;

  createSegmentFromTrigger: (mainLabelId: Id, triggerTimeSec: number) => Segment | null;
  toggleSecondaryOnSelectedSegment: (secondaryLabelId: Id) => void;
  renameSegment: (segmentId: Id, name: string) => void;
  deleteSegment: (segmentId: Id) => void;
  updateSegmentTimes: (segmentId: Id, startTimeSec: number, endTimeSec: number) => void;

  /** Export *persisted* project data as a stable JSON string. */
  exportProjectJson: () => string;
  /** Import/replace project data (used for "Load Project"). */
  replaceProject: (data: unknown) => void;
  /** Start fresh and clear persisted data. */
  resetProject: () => void;

  updateSettings: (partial: Partial<ProjectData['settings']>) => void;

  /** Internal. */
  _setHydrated: (hydrated: boolean) => void;
  /** Currently selected segment (for manual tag editing or append). */
  selectedSegmentId: Id | null;
  setSelectedSegmentId: (id: Id | null) => void;
  /** Internal: last segment created (for “append secondary tag”). */
  lastCreatedSegmentId: Id | null;
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function nowMs() {
  return Date.now();
}

function normalizeHotkey(hotkey: string): string {
  return hotkey.trim().slice(0, 1).toUpperCase();
}

function safeVideoMeta(file: File, durationSec?: number): VideoMeta {
  return {
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type,
    lastModified: file.lastModified,
    ...(typeof durationSec === 'number' && Number.isFinite(durationSec) ? { durationSec } : {}),
  };
}

function partializeForPersist(state: ProjectState): ProjectData & { lastCreatedSegmentId: Id | null } {
  const {
    schemaVersion,
    projectId,
    createdAtMs,
    updatedAtMs,
    videoMeta,
    clips,
    electronProjectKey,
    labelSetId,
    mainLabels,
    secondaryLabels,
    segments,
    settings,
    lastCreatedSegmentId,
  } = state;

  return {
    schemaVersion,
    projectId,
    createdAtMs,
    updatedAtMs,
    videoMeta,
    clips,
    electronProjectKey,
    labelSetId,
    mainLabels,
    secondaryLabels,
    segments,
    settings,
    lastCreatedSegmentId,
  };
}

function pickProjectData(state: ProjectState): ProjectData {
  const { schemaVersion, projectId, createdAtMs, updatedAtMs, videoMeta, clips, electronProjectKey, labelSetId, mainLabels, secondaryLabels, segments, settings } = state;
  return { schemaVersion, projectId, createdAtMs, updatedAtMs, videoMeta, clips, electronProjectKey, labelSetId, mainLabels, secondaryLabels, segments, settings };
}

function migrateToV1(persistedState: unknown): Partial<ProjectState> {
  // We keep this intentionally permissive; UI can validate deeper later.
  if (!persistedState || typeof persistedState !== 'object') return {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = persistedState as any;
  if (s.schemaVersion !== 1) return {};
  return s;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => {
      const base = createEmptyProject();
      let grouping = false;
      let groupRecorded = false;
      const edit = (update: (state: ProjectState) => Partial<ProjectState>) => {
        set((state) => {
          const change = update(state);
          return { ...change, past: grouping && groupRecorded ? state.past : [...state.past.slice(-99), snapshot(state)], future: [] };
        });
        if (grouping) groupRecorded = true;
      };

      return {
        ...base,
        past: [], future: [],
        beginHistoryGroup: () => { grouping = true; groupRecorded = false; },
        endHistoryGroup: () => { grouping = false; groupRecorded = false; },
        undo: () => {
          const state = get(); const previous = state.past.at(-1);
          if (!previous) return;
          grouping = false; groupRecorded = false;
          set({ ...previous, past: state.past.slice(0, -1), future: [...state.future, snapshot(state)], updatedAtMs: nowMs() });
        },
        redo: () => {
          const state = get(); const next = state.future.at(-1);
          if (!next) return;
          grouping = false; groupRecorded = false;
          set({ ...next, past: [...state.past, snapshot(state)], future: state.future.slice(0, -1), updatedAtMs: nowMs() });
        },
        lastCreatedSegmentId: null,
        selectedSegmentId: null,
        session: { videoSourceUrl: null, videoFile: null, clipSources: [], hydrated: false },

        _setHydrated: (hydrated) => {
          set((s) => ({ session: { ...s.session, hydrated } }));
        },

        setSelectedSegmentId: (id) => {
          set({ selectedSegmentId: id });
        },

        setVideoSourceUrl: (url) => {
          set((s) => ({ session: { ...s.session, videoSourceUrl: url } }));
        },

        clearVideoSourceUrl: () => {
          const session = get().session;
          for (const url of new Set([session.videoSourceUrl, ...session.clipSources.map((source) => source.url)])) {
            if (url) URL.revokeObjectURL(url);
          }
          set((s) => ({ session: { ...s.session, videoSourceUrl: null, videoFile: null, clipSources: [] } }));
        },

        setVideoFile: (file, videoSourceUrl, durationSec) => {
          // If we already had a blob URL, free it.
          const old = get().session.videoSourceUrl;
          if (old && old !== videoSourceUrl) URL.revokeObjectURL(old);

          set((s) => ({
            videoMeta: safeVideoMeta(file, durationSec),
            updatedAtMs: nowMs(),
            session: { ...s.session, videoSourceUrl, videoFile: file },
          }));
        },

        setElectronVideo: (videoUrl, meta) => {
           set((s) => ({
             videoMeta: meta,
             updatedAtMs: nowMs(),
             session: { ...s.session, videoSourceUrl: videoUrl, videoFile: null },
           }));
        },

        setVideoDurationSec: (durationSec) => {
          if (!Number.isFinite(durationSec) || durationSec <= 0) return;
          set((s) => ({
            videoMeta: s.videoMeta ? { ...s.videoMeta, durationSec } : s.videoMeta,
            updatedAtMs: nowMs(),
          }));
        },

        setVideoFps: (fps) => {
          if (!Number.isFinite(fps) || fps <= 0) return;
          set((s) => ({
            videoMeta: s.videoMeta ? { ...s.videoMeta, fps } : s.videoMeta,
            updatedAtMs: nowMs(),
          }));
        },

        applyLabelSet: (labelSet) => {
          const state = get();
          const next = projectWithLabelSet(pickProjectData(state), labelSet);
          if (state.labelSetId === next.labelSetId && labelsEqual(state.mainLabels, next.mainLabels)
            && labelsEqual(state.secondaryLabels, next.secondaryLabels)) return;
          set({ labelSetId: next.labelSetId, mainLabels: next.mainLabels, secondaryLabels: next.secondaryLabels,
            past: [], future: [], updatedAtMs: nowMs() });
        },

        upsertMainLabel: (label) => {
          const normalized: MainLabel = {
            ...label,
            hotkey: normalizeHotkey(label.hotkey),
            preRollSec: Math.max(0, label.preRollSec),
            postRollSec: Math.max(0, label.postRollSec),
          };

          edit((s) => {
            const idx = s.mainLabels.findIndex((l) => l.id === normalized.id);
            const next = [...s.mainLabels];
            if (idx >= 0) next[idx] = normalized;
            else next.push(normalized);
            return { mainLabels: next, updatedAtMs: nowMs() };
          });
        },

        deleteMainLabel: (id) => {
          edit((s) => ({
            mainLabels: s.mainLabels.flatMap((label) => label.id !== id ? [label] : s.labelSetId && s.segments.some((seg) => seg.mainLabelId === id) ? [{ ...label, archived: true }] : []),
            segments: s.labelSetId ? s.segments : s.segments.filter((seg) => seg.mainLabelId !== id),
            updatedAtMs: nowMs(),
          }));
        },

        upsertSecondaryLabel: (label) => {
          const normalized: SecondaryLabel = {
            ...label,
            ...(label.hotkey ? { hotkey: normalizeHotkey(label.hotkey) } : {}),
          };

          edit((s) => {
            const idx = s.secondaryLabels.findIndex((l) => l.id === normalized.id);
            const next = [...s.secondaryLabels];
            if (idx >= 0) next[idx] = normalized;
            else next.push(normalized);
            return { secondaryLabels: next, updatedAtMs: nowMs() };
          });
        },

        deleteSecondaryLabel: (id) => {
          edit((s) => ({
            secondaryLabels: s.secondaryLabels.flatMap((label) => label.id !== id ? [label] : s.labelSetId && s.segments.some((seg) => seg.secondaryLabelIds.includes(id)) ? [{ ...label, archived: true }] : []),
            segments: s.labelSetId ? s.segments : s.segments.map((seg) => ({
              ...seg,
              secondaryLabelIds: seg.secondaryLabelIds.filter((sid) => sid !== id),
            })),
            updatedAtMs: nowMs(),
          }));
        },

        createSegmentFromTrigger: (mainLabelId, triggerTimeSec) => {
          const state = get();
          const label = state.mainLabels.find((l) => l.id === mainLabelId);
          if (!label || label.archived) return null;

          const duration = state.videoMeta?.durationSec;
          const start = Math.max(0, triggerTimeSec - label.preRollSec);
          const rawEnd = triggerTimeSec + label.postRollSec;
          const endUpper = typeof duration === 'number' && Number.isFinite(duration) ? duration : Number.POSITIVE_INFINITY;
          const end = Math.max(start + 0.001, clamp(rawEnd, 0, endUpper));

          const segment: Segment = {
            id: createId(),
            startTimeSec: start,
            endTimeSec: end,
            mainLabelId,
            secondaryLabelIds: [],
            createdAtMs: nowMs(),
          };

          edit((s) => ({
            segments: [...s.segments, segment],
            lastCreatedSegmentId: segment.id,
            selectedSegmentId: segment.id,
            updatedAtMs: nowMs(),
          }));

          return segment;
        },

        toggleSecondaryOnSelectedSegment: (secondaryLabelId) => {
          const segId = get().selectedSegmentId || get().lastCreatedSegmentId;
          if (!segId) return;
          edit((s) => ({
            segments: s.segments.map((seg) => {
              if (seg.id !== segId) return seg;
              const hasTag = seg.secondaryLabelIds.includes(secondaryLabelId);
              const nextIds = hasTag
                ? seg.secondaryLabelIds.filter((id) => id !== secondaryLabelId)
                : [...seg.secondaryLabelIds, secondaryLabelId];
              return { ...seg, secondaryLabelIds: nextIds };
            }),
            updatedAtMs: nowMs(),
          }));
        },

        renameSegment: (segmentId, name) => {
          edit((s) => ({
            segments: s.segments.map((seg) => (seg.id === segmentId ? { ...seg, name: name.trim() || undefined } : seg)),
            updatedAtMs: nowMs(),
          }));
        },

        deleteSegment: (segmentId) => {
          edit((s) => ({
            segments: s.segments.filter((seg) => seg.id !== segmentId),
            lastCreatedSegmentId: s.lastCreatedSegmentId === segmentId ? null : s.lastCreatedSegmentId,
            selectedSegmentId: s.selectedSegmentId === segmentId ? null : s.selectedSegmentId,
            updatedAtMs: nowMs(),
          }));
        },

        updateSegmentTimes: (segmentId, startTimeSec, endTimeSec) => {
          const start = Math.max(0, startTimeSec);
          const end = Math.max(start + 0.02, endTimeSec);
          edit((s) => ({
            segments: s.segments.map((seg) => (seg.id === segmentId ? { ...seg, startTimeSec: start, endTimeSec: end } : seg)),
            updatedAtMs: nowMs(),
          }));
        },

        exportProjectJson: () => {
          const state = get();
          return JSON.stringify(pickProjectData(state), null, 2);
        },

        replaceProject: (raw) => {
          const data = coerceProjectData(raw);
          grouping = false; groupRecorded = false;

          set((s) => ({
            ...s,
            clips: undefined,
            electronProjectKey: undefined,
            labelSetId: undefined,
            ...data,
            past: [], future: [],
            updatedAtMs: nowMs(),
            selectedSegmentId: null,
            lastCreatedSegmentId: null,
            // The caller restores the associated video session separately.
            session: s.session,
          }));
        },

        resetProject: () => {
          grouping = false; groupRecorded = false;
          get().clearVideoSourceUrl();

          // Clear persisted storage.
          try {
            if (window.electron) localStorage.removeItem(STORAGE_KEY);
          } catch {
            // ignore
          }

          const next = createEmptyProject();
          set(() => ({
            ...next,
            past: [], future: [],
            clips: undefined,
            electronProjectKey: undefined,
            labelSetId: undefined,
            lastCreatedSegmentId: null,
            selectedSegmentId: null,
            session: { videoSourceUrl: null, videoFile: null, clipSources: [], hydrated: true },
          }));
        },

        updateSettings: (partial) => {
          edit((s) => ({
            settings: { ...s.settings, ...partial },
            updatedAtMs: nowMs(),
          }));
        },
      };
    },
    {
      name: STORAGE_KEY,
      version: PROJECT_SCHEMA_VERSION,
      storage: createJSONStorage(() => window.electron ? localStorage : {
        getItem: () => null, setItem: () => {}, removeItem: () => {},
      }),
      partialize: partializeForPersist,
      migrate: (persistedState) => migrateToV1(persistedState),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('Failed to rehydrate project store', error);
        }
        state?._setHydrated(true);
      },
    },
  ),
);


