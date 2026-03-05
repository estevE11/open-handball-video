import { useEffect, useRef } from 'react';

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
  const savedPlaybackRateRef = useRef<0.5 | 1 | 2 | 2.5 | 3>(1);
  const jHeldRef = useRef(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const videoState = useVideoStore.getState();
      const projectState = useProjectStore.getState();

      if (key === ' ') {
        e.preventDefault();
        videoState.setIsPlaying(!videoState.isPlaying);
        return;
      }

      if (key === 'ArrowLeft') {
        e.preventDefault();
        videoState.setCurrentTimeSec(videoState.currentTimeSec - 20);
        return;
      }

      if (key === 'ArrowRight') {
        e.preventDefault();
        videoState.setCurrentTimeSec(videoState.currentTimeSec + 20);
        return;
      }

      if (key === 'J' && !jHeldRef.current) {
        e.preventDefault();
        savedPlaybackRateRef.current = videoState.playbackRate;
        jHeldRef.current = true;
        videoState.setPlaybackRate(1);
        return;
      }

      const main = projectState.mainLabels.find((l) => l.hotkey.toUpperCase() === key);
      if (main) {
        e.preventDefault();
        projectState.createSegmentFromTrigger(main.id, videoState.currentTimeSec);
        return;
      }

      const sec = projectState.secondaryLabels.find((s) => (s.hotkey ?? '').toUpperCase() === key);
      if (sec) {
        e.preventDefault();
        projectState.toggleSecondaryOnSelectedSegment(sec.id);
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (key === 'J' && jHeldRef.current) {
        jHeldRef.current = false;
        useVideoStore.getState().setPlaybackRate(savedPlaybackRateRef.current);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);
}
