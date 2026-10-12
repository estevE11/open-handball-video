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
    || !!el.closest?.('[role="textbox"], [role="dialog"]');
}

export function useGlobalHotkeys() {
  useEffect(() => {
    let heldRate: ReturnType<typeof useVideoStore.getState>['playbackRate'] | null = null;
    let heldProjectId: string | null = null;
    const heldKeys = new Set<'space' | 'j'>();
    let spacePress: { projectId: string; wasPlaying: boolean; held: boolean } | null = null;
    let spaceTimer: ReturnType<typeof setTimeout> | null = null;
    function sameVideo(projectId: string | null) {
      const project = useProjectStore.getState();
      return project.projectId === projectId && !!project.session.videoSourceUrl;
    }
    function holdNormalSpeed(key: 'space' | 'j') {
      if (heldKeys.has(key)) return;
      heldKeys.add(key);
      const video = useVideoStore.getState();
      if (heldRate === null) { heldRate = video.playbackRate; heldProjectId = useProjectStore.getState().projectId; }
      video.setPlaybackRate(1);
    }
    function releaseNormalSpeed(key: 'space' | 'j') {
      heldKeys.delete(key);
      if (heldKeys.size || heldRate === null) return;
      if (sameVideo(heldProjectId)) useVideoStore.getState().setPlaybackRate(heldRate);
      heldRate = null; heldProjectId = null;
    }
    function cancelHolds(restore = true) {
      if (spaceTimer !== null) clearTimeout(spaceTimer);
      spaceTimer = null;
      if (restore && spacePress?.held && sameVideo(spacePress.projectId)) useVideoStore.getState().setIsPlaying(spacePress.wasPlaying);
      if (restore && heldRate !== null && sameVideo(heldProjectId)) useVideoStore.getState().setPlaybackRate(heldRate);
      spacePress = null; heldRate = null; heldProjectId = null; heldKeys.clear();
    }
    function consume(event: KeyboardEvent) { event.preventDefault(); event.stopPropagation(); }
    function onKeyUp(event: KeyboardEvent) {
      if (event.key === ' ' && spacePress) {
        consume(event);
        if (spaceTimer !== null) clearTimeout(spaceTimer);
        spaceTimer = null;
        const press = spacePress;
        spacePress = null;
        if (press.held) releaseNormalSpeed('space');
        if (sameVideo(press.projectId)) {
          const video = useVideoStore.getState();
          video.setIsPlaying(press.held ? press.wasPlaying : !video.isPlaying);
        }
      } else if (event.key.toUpperCase() === 'J' && heldKeys.has('j')) {
        consume(event); releaseNormalSpeed('j');
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      const project = useProjectStore.getState();
      const video = useVideoStore.getState();
      if (e.defaultPrevented || !project.session.videoSourceUrl) return;
      if (e.altKey || isTypingTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' || key === 'y') {
          consume(e);
          if (key === 'y' || e.shiftKey) project.redo(); else project.undo();
        }
        return;
      }
      if ((e.key === '[' || e.key === ']') && useReviewStore.getState().active) {
        consume(e); useReviewStore.getState().step(e.key === '[' ? -1 : 1); return;
      }
      if (e.key === ' ') {
        consume(e);
        if (e.repeat || spacePress) return;
        spacePress = { projectId: project.projectId, wasPlaying: video.isPlaying, held: false };
        // A tap toggles on release; a hold never interrupts ongoing playback.
        spaceTimer = setTimeout(() => {
          spaceTimer = null;
          if (!spacePress || !sameVideo(spacePress.projectId)) return;
          spacePress.held = true;
          holdNormalSpeed('space');
          useVideoStore.getState().setIsPlaying(true);
        }, 250);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        consume(e); video.setCurrentTimeSec(video.currentTimeSec + (e.key === 'ArrowLeft' ? -5 : 5)); return;
      }
      if (e.key === ',' || e.key === '.') {
        consume(e); stepVideoFrame(e.key === ',' ? -1 : 1); return;
      }
      const key = e.key.toUpperCase();
      if (key === 'J') {
        consume(e); holdNormalSpeed('j');
        return;
      }
      const main = project.mainLabels.find((label) => !label.archived && label.hotkey.toUpperCase() === key);
      if (main) { consume(e); project.createSegmentFromTrigger(main.id, video.currentTimeSec); return; }
      const secondary = project.secondaryLabels.find((label) => !label.archived && label.hotkey?.toUpperCase() === key);
      if (secondary) { consume(e); project.toggleSecondaryOnSelectedSegment(secondary.id); }
    }
    function onBlur() { cancelHolds(); }
    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (state.projectId !== previous.projectId || !state.session.videoSourceUrl) cancelHolds(false);
    });
    // Capture before focused controls can open menus or change slider values.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      unsubscribe(); cancelHolds();
    };
  }, []);
}
