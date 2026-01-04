import { create } from 'zustand';

type VideoRuntimeState = {
  currentTimeSec: number;
  durationSec: number;
  isPlaying: boolean;
  playbackRate: 0.5 | 1 | 2;

  setCurrentTimeSec: (t: number) => void;
  setDurationSec: (d: number) => void;
  setIsPlaying: (p: boolean) => void;
  setPlaybackRate: (r: 0.5 | 1 | 2) => void;

  reset: () => void;
};

export const useVideoStore = create<VideoRuntimeState>((set) => ({
  currentTimeSec: 0,
  durationSec: 0,
  isPlaying: false,
  playbackRate: 1,

  setCurrentTimeSec: (t) =>
    set((s) => {
      const next = Math.max(0, t);
      const clamped = s.durationSec > 0 ? Math.min(s.durationSec, next) : next;
      return { currentTimeSec: clamped };
    }),
  setDurationSec: (d) => set({ durationSec: Math.max(0, d) }),
  setIsPlaying: (p) => set({ isPlaying: p }),
  setPlaybackRate: (r) => set({ playbackRate: r }),

  reset: () => set({ currentTimeSec: 0, durationSec: 0, isPlaying: false, playbackRate: 1 }),
}));


