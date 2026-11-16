import { create } from 'zustand';

const MUTE_STORAGE_KEY = 'ohv.playback.muted.v1';

function savedMuteSetting() {
  try { return localStorage.getItem(MUTE_STORAGE_KEY) === 'true'; }
  catch { return false; }
}

type VideoRuntimeState = {
  currentTimeSec: number;
  durationSec: number;
  isPlaying: boolean;
  isMuted: boolean;
  playbackRate: 0.5 | 1 | 2 | 2.5 | 3;

  setCurrentTimeSec: (t: number) => void;
  setDurationSec: (d: number) => void;
  setIsPlaying: (p: boolean) => void;
  setIsMuted: (m: boolean) => void;
  setPlaybackRate: (r: 0.5 | 1 | 2 | 2.5 | 3) => void;

  reset: () => void;
};

export const useVideoStore = create<VideoRuntimeState>((set) => ({
  currentTimeSec: 0,
  durationSec: 0,
  isPlaying: false,
  isMuted: savedMuteSetting(),
  playbackRate: 1,

  setCurrentTimeSec: (t) =>
    set((s) => {
      const next = Math.max(0, t);
      const clamped = s.durationSec > 0 ? Math.min(s.durationSec, next) : next;
      return { currentTimeSec: clamped };
    }),
  setDurationSec: (d) => {
    if (!Number.isFinite(d)) return;
    set({ durationSec: Math.max(0, d) });
  },
  setIsPlaying: (p) => set({ isPlaying: p }),
  setIsMuted: (m) => {
    try { localStorage.setItem(MUTE_STORAGE_KEY, String(m)); } catch { /* Keep playback working when storage is unavailable. */ }
    set({ isMuted: m });
  },
  setPlaybackRate: (r) => set({ playbackRate: r }),

  reset: () => set({ currentTimeSec: 0, durationSec: 0, isPlaying: false, playbackRate: 1 }),
}));


