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
  const fps = useProjectStore((s) => s.settings.fps);
  const createSegmentFromTrigger = useProjectStore((s) => s.createSegmentFromTrigger);
  const appendSecondaryToLastSegment = useProjectStore((s) => s.appendSecondaryToLastSegment);

  const currentTimeSec = useVideoStore((s) => s.currentTimeSec);
  const isPlaying = useVideoStore((s) => s.isPlaying);
  const setIsPlaying = useVideoStore((s) => s.setIsPlaying);
  const setCurrentTimeSec = useVideoStore((s) => s.setCurrentTimeSec);

  useEffect(() => {
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
        const frameSec = 1 / Math.max(1, fps || 30);
        setCurrentTimeSec(currentTimeSec - frameSec);
        return;
      }

      if (key === 'ARROWRIGHT') {
        e.preventDefault();
        const frameSec = 1 / Math.max(1, fps || 30);
        setCurrentTimeSec(currentTimeSec + frameSec);
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
        appendSecondaryToLastSegment(sec.id);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    appendSecondaryToLastSegment,
    createSegmentFromTrigger,
    currentTimeSec,
    fps,
    isPlaying,
    mainLabels,
    secondaryLabels,
    setCurrentTimeSec,
    setIsPlaying,
  ]);
}


