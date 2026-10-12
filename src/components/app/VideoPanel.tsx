import { useTranslation, useTranslatedMessage } from '@/lib/i18n';
import { advanceReviewAt, useReviewStore } from '@/store/reviewStore';
import { Pause, Play, SkipBack, SkipForward, Upload, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Panel } from '@/components/app/Panel';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { stepVideoFrame } from '@/lib/playbackControls';
import { locateClip } from '@/lib/clipTimeline';
import { formatTimecode } from '@/lib/time';
import { attachBrowserVideo } from '@/lib/browserProjectSession';
import { storageError } from '@/lib/browserStorage';
import { probeVideoFps } from '@/lib/videoProbe';
import { useProjectStore } from '@/store/projectStore';
import { useVideoStore } from '@/store/videoStore';

export function VideoPanel() {
  const t = useTranslation();
  const message = useTranslatedMessage();
  const reviewing = useReviewStore((s) => s.active);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastInternalTimeRef = useRef(Number.NaN);

  const clips = useProjectStore((s) => s.clips);
  const clipSources = useProjectStore((s) => s.session.clipSources);
  const videoSourceUrl = useProjectStore((s) => s.session.videoSourceUrl);
  const setVideoFile = useProjectStore((s) => s.setVideoFile);
  const setVideoDurationSec = useProjectStore((s) => s.setVideoDurationSec);
  const setVideoFps = useProjectStore((s) => s.setVideoFps);
  const videoMeta = useProjectStore((s) => s.videoMeta);


  const currentTimeSec = useVideoStore((s) => s.currentTimeSec);
  const durationSec = useVideoStore((s) => s.durationSec);
  const isPlaying = useVideoStore((s) => s.isPlaying);
  const isMuted = useVideoStore((s) => s.isMuted);
  const playbackRate = useVideoStore((s) => s.playbackRate);
  const setCurrentTimeSec = useVideoStore((s) => s.setCurrentTimeSec);
  const setDurationSec = useVideoStore((s) => s.setDurationSec);
  const setIsPlaying = useVideoStore((s) => s.setIsPlaying);
  const setIsMuted = useVideoStore((s) => s.setIsMuted);
  const setPlaybackRate = useVideoStore((s) => s.setPlaybackRate);

  const activeClip = clips ? locateClip(clips, currentTimeSec) : null;
  const clipIndex = activeClip?.index ?? 0;
  const clipOffset = activeClip?.start ?? 0;
  const activeUrl = clips ? clipSources[clipIndex]?.url : videoSourceUrl;
  const hasNextClip = !!clips && clipIndex < clips.length - 1;
  const [playbackError, setPlaybackError] = useState('');

  const [scrubValue, setScrubValue] = useState<number[]>([0]);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const sliderRef = useRef<HTMLDivElement | null>(null);

  const canScrub = durationSec > 0;
  const sliderValue = isScrubbing ? scrubValue : [currentTimeSec];

  // Keep the HTMLVideoElement synced with store state.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!Number.isFinite(currentTimeSec)) return;

    // If the change is coming from the video itself (feedback loop), skip sync.
    const feedbackDelta = Math.abs(currentTimeSec - lastInternalTimeRef.current);
    lastInternalTimeRef.current = Number.NaN;
    if (feedbackDelta < 0.001) return;

    if (el.readyState === 0) return;
    const localTime = Math.max(0, currentTimeSec - clipOffset);
    const delta = Math.abs(el.currentTime - localTime);
    // Preserve sub-frame precision so keyboard and button frame steps reach the player.
    if (delta > 0.0001) {
      el.currentTime = localTime;
    }
  }, [currentTimeSec, clipOffset, activeUrl]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.playbackRate = playbackRate;
  }, [playbackRate, activeUrl]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = isMuted;
  }, [isMuted, activeUrl]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (isPlaying) {
      void el.play().catch(() => { if (videoRef.current === el) setIsPlaying(false); });
    } else {
      el.pause();
    }
  }, [isPlaying, setIsPlaying, activeUrl]);

  useEffect(() => {
    if (!reviewing || !isPlaying) return;
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video && !video.paused && video.readyState > 0) advanceReviewAt(video.currentTime + clipOffset);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reviewing, isPlaying, clipOffset]);

  const right = useMemo(() => {
    return (
      <div className="flex items-center gap-2">
        <div className="font-mono text-xs text-muted-foreground">
          {formatTimecode(currentTimeSec)} / {formatTimecode(durationSec || 0)}
        </div>
      </div>
    );
  }, [currentTimeSec, durationSec]);

  const handleSliderMouseMove = (e: React.MouseEvent) => {
    if (!sliderRef.current || !durationSec) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    setHoverTime(ratio * durationSec);
    setHoverX(x);
  };

  return (
    <Panel title={t("Player")} right={right}>
      <div className="grid h-full min-h-0 min-w-0 grid-rows-[1fr_auto] gap-2 p-2">
        <div className={cn('relative min-h-0 overflow-hidden rounded-md border bg-black')}>
          {activeUrl ? (
            <video
              key={activeUrl}
              ref={videoRef}
              src={activeUrl}
              className="h-full w-full object-contain"
              onTimeUpdate={(e) => {
                if (e.currentTarget !== videoRef.current) return;
                const t = e.currentTarget.currentTime + clipOffset;
                lastInternalTimeRef.current = t;
                setCurrentTimeSec(t);
                if (useVideoStore.getState().isPlaying) advanceReviewAt(t);
              }}
              onLoadedMetadata={(e) => {
                const el = e.currentTarget;
                if (el !== videoRef.current) return;
                setPlaybackError('');
                if (clips) {
                  setDurationSec(clips.reduce((sum, clip) => sum + clip.durationSec, 0));
                  el.currentTime = Math.min(el.duration, Math.max(0, useVideoStore.getState().currentTimeSec - clipOffset));
                } else {
                  setDurationSec(el.duration || 0);
                  if (el.duration) setVideoDurationSec(el.duration);
                }
                el.playbackRate = playbackRate; el.muted = isMuted;
                if (useVideoStore.getState().isPlaying) void el.play().catch(() => { if (videoRef.current === el) setIsPlaying(false); });
              }}
              onPlay={() => setIsPlaying(true)}
              onPause={(e) => { if (e.currentTarget === videoRef.current && !(e.currentTarget.ended && (hasNextClip || useReviewStore.getState().active))) setIsPlaying(false); }}
              onEnded={(event) => {
                if (event.currentTarget !== videoRef.current || !event.currentTarget.ended) return;
                if (advanceReviewAt(activeClip?.end ?? durationSec)) return;
                if (hasNextClip && activeClip) setCurrentTimeSec(activeClip.end);
                else setIsPlaying(false);
              }}
              onError={() => { setIsPlaying(false); setPlaybackError('This clip could not be played. Check that the original video is supported by your browser.'); }}
              controls={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="text-sm font-medium text-white">{t("No video loaded")}</div>
                <div className="text-xs text-white/70">{t("Upload a local video file to start labeling.")}</div>
                <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />{t("Upload video…")}</Button>
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              e.currentTarget.value = '';
              try {
                if (window.electron) setVideoFile(file, URL.createObjectURL(file));
                else await attachBrowserVideo(file);
              } catch (err) { window.alert(message(storageError(err))); return; }
              // Detect FPS via ffprobe (async). Only apply if this is still the active file.
              try {
                const fps = await probeVideoFps(file);
                if (fps && useProjectStore.getState().session.videoFile === file) {
                  setVideoFps(fps);
                }
              } catch (err) {
                console.warn('[video] fps probe failed', err);
              }
            }}
          />
        </div>

        <div className="rounded-md border bg-card p-2">
          {playbackError && <p role="alert" className="mb-2 text-xs text-destructive">{message(playbackError)}</p>}
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="icon" onClick={() => setIsPlaying(!isPlaying)} aria-label={isPlaying ? t("Pause") : t("Play")}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>

            <Button variant="outline" size="icon" onClick={() => stepVideoFrame(-1)} aria-label={t("Frame backward")} title={t("Previous frame (,)")}>
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => stepVideoFrame(1)} aria-label={t("Frame forward")} title={t("Next frame (.)")}>
              <SkipForward className="h-4 w-4" />
            </Button>

            <Button variant="ghost" size="icon" onClick={() => setIsMuted(!isMuted)} aria-label={isMuted ? t("Unmute") : t("Mute")}>
              {isMuted ? <VolumeX className="h-4 w-4 text-destructive" /> : <Volume2 className="h-4 w-4" />}
            </Button>

            <div className="mx-2 h-6 w-px bg-border" />

            <div className="relative min-w-0 flex-1" ref={sliderRef} onMouseMove={handleSliderMouseMove} onMouseLeave={() => setHoverTime(null)}>
              {hoverTime !== null && (
                <div 
                  className="absolute bottom-full mb-2 -translate-x-1/2 pointer-events-none z-50 px-2 py-1 bg-popover text-popover-foreground border rounded shadow-md text-[10px] font-mono whitespace-nowrap transition-opacity duration-150"
                  style={{ left: hoverX }}
                >
                  {formatTimecode(hoverTime)}
                </div>
              )}
              <Slider
                value={sliderValue}
                min={0}
                max={Math.max(0.001, durationSec || 0.001)}
                step={0.01}
                disabled={!canScrub}
                onValueChange={(v) => {
                  setIsScrubbing(true);
                  setScrubValue(v);
                }}
                onValueCommit={(v) => {
                  setCurrentTimeSec(v[0] ?? 0);
                  setIsScrubbing(false);
                }}
              />
            </div>

            <div className="mx-2 h-6 w-px bg-border" />

            <Select
              value={String(playbackRate)}
              onValueChange={(v) => setPlaybackRate((Number(v) as 0.5 | 1 | 2 | 2.5 | 3) ?? 1)}
              disabled={!videoSourceUrl}
            >
              <SelectTrigger aria-label={t("Playback speed")} className="h-8 w-[110px]">
                <SelectValue placeholder={t("Speed")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0.5">0.5×</SelectItem>
                <SelectItem value="1">1×</SelectItem>
                <SelectItem value="2">2×</SelectItem>
                <SelectItem value="2.5">2.5×</SelectItem>
                <SelectItem value="3">3×</SelectItem>
              </SelectContent>
            </Select>

            {videoMeta?.fileName ? (
              <div className="ml-2 hidden max-w-[260px] truncate text-xs text-muted-foreground md:block">{activeClip ? t("Clip {0}/{1}: {2}", clipIndex + 1, clips?.length ?? 0, activeClip.clip.fileName) : videoMeta.fileName}</div>
            ) : null}
          </div>
        </div>
      </div>
    </Panel>
  );
}


