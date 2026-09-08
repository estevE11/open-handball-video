import { useReviewStore } from '@/store/reviewStore';
import { useEffect } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { useVideoStore } from '@/store/videoStore';
import { stepVideoFrame } from '@/lib/playbackControls';

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el.isContentEditable
    || !!el.closest?.('[role="combobox"], [role="slider"], [role="dialog"]');
}

export function useGlobalHotkeys() {
  useEffect(() => {
    let heldRate: ReturnType<typeof useVideoStore.getState>['playbackRate'] | null = null;
    function releaseTemporarySpeed() {
      if (heldRate !== null) { useVideoStore.getState().setPlaybackRate(heldRate); heldRate = null; }
    }
    function onKeyUp(event: KeyboardEvent) { if (event.key.toUpperCase() === 'J') releaseTemporarySpeed(); }
    function onKeyDown(e: KeyboardEvent) {
      const project = useProjectStore.getState();
      const video = useVideoStore.getState();
      if (e.defaultPrevented || !project.session.videoSourceUrl) return;
      if (e.altKey || isTypingTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' || key === 'y') {
          e.preventDefault();
          if (key === 'y' || e.shiftKey) project.redo(); else project.undo();
        }
        return;
      }
      if ((e.key === '[' || e.key === ']') && useReviewStore.getState().active) {
        e.preventDefault(); useReviewStore.getState().step(e.key === '[' ? -1 : 1); return;
      }
      if (e.key === ' ') {
        e.preventDefault(); video.setIsPlaying(!video.isPlaying); return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault(); video.setCurrentTimeSec(video.currentTimeSec + (e.key === 'ArrowLeft' ? -5 : 5)); return;
      }
      if (e.key === ',' || e.key === '.') {
        e.preventDefault(); stepVideoFrame(e.key === ',' ? -1 : 1); return;
      }
      const key = e.key.toUpperCase();
      if (key === 'J') {
        e.preventDefault();
        if (heldRate === null) { heldRate = video.playbackRate; video.setPlaybackRate(1); }
        return;
      }
      const main = project.mainLabels.find((label) => label.hotkey.toUpperCase() === key);
      if (main) { e.preventDefault(); project.createSegmentFromTrigger(main.id, video.currentTimeSec); return; }
      const secondary = project.secondaryLabels.find((label) => label.hotkey?.toUpperCase() === key);
      if (secondary) { e.preventDefault(); project.toggleSecondaryOnSelectedSegment(secondary.id); }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', releaseTemporarySpeed);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseTemporarySpeed);
      releaseTemporarySpeed();
    };
  }, []);
}
