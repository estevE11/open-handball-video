import { useEffect } from 'react';

import { useProjectStore } from '@/store/projectStore';
import { useVideoStore } from '@/store/videoStore';

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useGlobalHotkeys() {
  const mainLabels = useProjectStore((s) => s.mainLabels);
  const secondaryLabels = useProjectStore((s) => s.secondaryLabels);
  const fps = useProjectStore((s) => s.videoMeta?.fps ?? 30);
  const createSegmentFromTrigger = useProjectStore((s) => s.createSegmentFromTrigger);
  const toggleSecondaryOnSelectedSegment = useProjectStore((s) => s.toggleSecondaryOnSelectedSegment);

  const currentTimeSec = useVideoStore((s) => s.currentTimeSec);
  const isPlaying = useVideoStore((s) => s.isPlaying);
  const playbackRate = useVideoStore((s) => s.playbackRate);
  const setIsPlaying = useVideoStore((s) => s.setIsPlaying);
  const setCurrentTimeSec = useVideoStore((s) => s.setCurrentTimeSec);
  const setPlaybackRate = useVideoStore((s) => s.setPlaybackRate);

  useEffect(() => {
    let savedPlaybackRate: 0.5 | 1 | 2 | 2.5 | 3 = 1;

    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;

      if (key === ' ') {
        e.preventDefault();
        setIsPlaying(!isPlaying);
        return;
      }

      if (key === 'ARROWLEFT') {
        e.preventDefault();
        setCurrentTimeSec(Math.max(0, currentTimeSec - 20));
        return;
      }

      if (key === 'ARROWRIGHT') {
        e.preventDefault();
        setCurrentTimeSec(currentTimeSec + 20);
        return;
      }

      if (key === 'J') {
        e.preventDefault();
        savedPlaybackRate = playbackRate;
        setPlaybackRate(1);
        return;
      }

      const main = mainLabels.find((l) => l.hotkey.toUpperCase() === key);
      if (main) {
        e.preventDefault();
        createSegmentFromTrigger(main.id, currentTimeSec);
        return;
      }

      const sec = secondaryLabels.find((s) => (s.hotkey ?? '').toUpperCase() === key);
      if (sec) {
        e.preventDefault();
        toggleSecondaryOnSelectedSegment(sec.id);
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (key === 'J') {
        setPlaybackRate(savedPlaybackRate);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    toggleSecondaryOnSelectedSegment,
    createSegmentFromTrigger,
    currentTimeSec,
    fps,
    isPlaying,
    playbackRate,
    mainLabels,
    secondaryLabels,
    setCurrentTimeSec,
    setIsPlaying,
    setPlaybackRate,
  ]);
}


