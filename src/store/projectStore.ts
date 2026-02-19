import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Id, MainLabel, ProjectData, SecondaryLabel, Segment, VideoMeta } from '@/types/project';
import { createId } from '@/lib/ids';
import { PROJECT_SCHEMA_VERSION, createEmptyProject } from '@/lib/projectDefaults';

const STORAGE_KEY = 'ohv.project.v1';

type SessionState = {
  /** Blob URL of the currently loaded local video. Never persisted. */
  videoSourceUrl: string | null;
  /** The currently loaded local file (cannot be persisted). */
  videoFile: File | null;
  /** True after Zustand rehydrates from localStorage. */
  hydrated: boolean;
};

export type ProjectState = ProjectData & {
  session: SessionState;

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
  replaceProject: (data: ProjectData) => void;
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
    mainLabels,
    secondaryLabels,
    segments,
    settings,
    lastCreatedSegmentId,
  };
}

function pickProjectData(state: ProjectState): ProjectData {
  const { schemaVersion, projectId, createdAtMs, updatedAtMs, videoMeta, mainLabels, secondaryLabels, segments, settings } = state;
  return { schemaVersion, projectId, createdAtMs, updatedAtMs, videoMeta, mainLabels, secondaryLabels, segments, settings };
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

      return {
        ...base,
        lastCreatedSegmentId: null,
        selectedSegmentId: null,
        session: { videoSourceUrl: null, videoFile: null, hydrated: false },

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
          const old = get().session.videoSourceUrl;
          if (old) URL.revokeObjectURL(old);
          set((s) => ({ session: { ...s.session, videoSourceUrl: null, videoFile: null } }));
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

        upsertMainLabel: (label) => {
          const normalized: MainLabel = {
            ...label,
            hotkey: normalizeHotkey(label.hotkey),
            preRollSec: Math.max(0, label.preRollSec),
            postRollSec: Math.max(0, label.postRollSec),
          };

          set((s) => {
            const idx = s.mainLabels.findIndex((l) => l.id === normalized.id);
            const next = [...s.mainLabels];
            if (idx >= 0) next[idx] = normalized;
            else next.push(normalized);
            return { mainLabels: next, updatedAtMs: nowMs() };
          });
        },

        deleteMainLabel: (id) => {
          set((s) => ({
            mainLabels: s.mainLabels.filter((l) => l.id !== id),
            segments: s.segments.filter((seg) => seg.mainLabelId !== id),
            updatedAtMs: nowMs(),
          }));
        },

        upsertSecondaryLabel: (label) => {
          const normalized: SecondaryLabel = {
            ...label,
            ...(label.hotkey ? { hotkey: normalizeHotkey(label.hotkey) } : {}),
          };

          set((s) => {
            const idx = s.secondaryLabels.findIndex((l) => l.id === normalized.id);
            const next = [...s.secondaryLabels];
            if (idx >= 0) next[idx] = normalized;
            else next.push(normalized);
            return { secondaryLabels: next, updatedAtMs: nowMs() };
          });
        },

        deleteSecondaryLabel: (id) => {
          set((s) => ({
            secondaryLabels: s.secondaryLabels.filter((l) => l.id !== id),
            segments: s.segments.map((seg) => ({
              ...seg,
              secondaryLabelIds: seg.secondaryLabelIds.filter((sid) => sid !== id),
            })),
            updatedAtMs: nowMs(),
          }));
        },

        createSegmentFromTrigger: (mainLabelId, triggerTimeSec) => {
          const state = get();
          const label = state.mainLabels.find((l) => l.id === mainLabelId);
          if (!label) return null;

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

          set((s) => ({
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
          set((s) => ({
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
          set((s) => ({
            segments: s.segments.map((seg) => (seg.id === segmentId ? { ...seg, name } : seg)),
            updatedAtMs: nowMs(),
          }));
        },

        deleteSegment: (segmentId) => {
          set((s) => ({
            segments: s.segments.filter((seg) => seg.id !== segmentId),
            lastCreatedSegmentId: s.lastCreatedSegmentId === segmentId ? null : s.lastCreatedSegmentId,
            selectedSegmentId: s.selectedSegmentId === segmentId ? null : s.selectedSegmentId,
            updatedAtMs: nowMs(),
          }));
        },

        updateSegmentTimes: (segmentId, startTimeSec, endTimeSec) => {
          const start = Math.max(0, startTimeSec);
          const end = Math.max(start + 0.02, endTimeSec);
          set((s) => ({
            segments: s.segments.map((seg) => (seg.id === segmentId ? { ...seg, startTimeSec: start, endTimeSec: end } : seg)),
            updatedAtMs: nowMs(),
          }));
        },

        exportProjectJson: () => {
          const state = get();
          return JSON.stringify(pickProjectData(state), null, 2);
        },

        replaceProject: (data) => {
          if (data.schemaVersion !== PROJECT_SCHEMA_VERSION) {
            // For now, only v1 is supported. (We’ll add migrations when schema evolves.)
            throw new Error(`Unsupported project schemaVersion: ${String(data.schemaVersion)}`);
          }

          set((s) => ({
            ...s,
            ...data,
            updatedAtMs: nowMs(),
            // Don't touch session.videoSourceUrl — browser can't restore it.
            session: s.session,
          }));
        },

        resetProject: () => {
          const oldUrl = get().session.videoSourceUrl;
          if (oldUrl) URL.revokeObjectURL(oldUrl);

          // Clear persisted storage.
          try {
            localStorage.removeItem(STORAGE_KEY);
          } catch {
            // ignore
          }

          const next = createEmptyProject();
          set(() => ({
            ...next,
            lastCreatedSegmentId: null,
            session: { videoSourceUrl: null, videoFile: null, hydrated: true },
          }));
        },

        updateSettings: (partial) => {
          set((s) => ({
            settings: { ...s.settings, ...partial },
            updatedAtMs: nowMs(),
          }));
        },
      };
    },
    {
      name: STORAGE_KEY,
      version: PROJECT_SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
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


