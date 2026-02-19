import { Pause, Play, SkipBack, SkipForward, Upload, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Panel } from '@/components/app/Panel';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { formatTimecode } from '@/lib/time';
import { probeVideoFps } from '@/lib/videoProbe';
import { useProjectStore } from '@/store/projectStore';
import { useVideoStore } from '@/store/videoStore';

export function VideoPanel() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastInternalTimeRef = useRef(0);

  const videoSourceUrl = useProjectStore((s) => s.session.videoSourceUrl);
  const setVideoFile = useProjectStore((s) => s.setVideoFile);
  const setVideoDurationSec = useProjectStore((s) => s.setVideoDurationSec);
  const setVideoFps = useProjectStore((s) => s.setVideoFps);
  const videoMeta = useProjectStore((s) => s.videoMeta);
  const detectedFps = videoMeta?.fps;

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
    if (feedbackDelta < 0.001) return;

    const delta = Math.abs(el.currentTime - currentTimeSec);
    // Only force sync if the difference is significant (e.g. user clicked timeline).
    if (delta > 0.15) {
      el.currentTime = currentTimeSec;
    }
  }, [currentTimeSec]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = isMuted;
  }, [isMuted]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (isPlaying) {
      void el.play().catch(() => setIsPlaying(false));
    } else {
      el.pause();
    }
  }, [isPlaying, setIsPlaying]);

  const right = useMemo(() => {
    return (
      <div className="flex items-center gap-2">
        <div className="font-mono text-xs text-muted-foreground">
          {formatTimecode(currentTimeSec)} / {formatTimecode(durationSec || 0)}
        </div>
      </div>
    );
  }, [currentTimeSec, durationSec]);

  function step(deltaFrames: number) {
    const frameSec = 1 / Math.max(1, detectedFps || 30);
    const next = Math.max(0, currentTimeSec + deltaFrames * frameSec);
    setCurrentTimeSec(next);
  }

  const handleSliderMouseMove = (e: React.MouseEvent) => {
    if (!sliderRef.current || !durationSec) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    setHoverTime(ratio * durationSec);
    setHoverX(x);
  };

  return (
    <Panel title="Player" right={right}>
      <div className="grid h-full min-h-0 min-w-0 grid-rows-[1fr_auto] gap-2 p-2">
        <div className={cn('relative min-h-0 overflow-hidden rounded-md border bg-black')}>
          {videoSourceUrl ? (
            <video
              ref={videoRef}
              src={videoSourceUrl}
              className="h-full w-full object-contain"
              onTimeUpdate={(e) => {
                const t = (e.currentTarget as HTMLVideoElement).currentTime;
                lastInternalTimeRef.current = t;
                setCurrentTimeSec(t);
              }}
              onLoadedMetadata={(e) => {
                const el = e.currentTarget as HTMLVideoElement;
                setDurationSec(el.duration || 0);
                if (el.duration) setVideoDurationSec(el.duration);
              }}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              controls={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="text-sm font-medium text-white">No video loaded</div>
                <div className="text-xs text-white/70">Upload a local video file to start labeling.</div>
                <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload video…
                </Button>
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
              const url = URL.createObjectURL(file);
              setVideoFile(file, url);
              // Detect FPS via ffprobe (async). Only apply if this is still the active file.
              try {
                const fps = await probeVideoFps(file);
                if (fps && useProjectStore.getState().session.videoFile === file) {
                  setVideoFps(fps);
                }
              } catch (err) {
                console.warn('[video] fps probe failed', err);
              }
              e.currentTarget.value = '';
            }}
          />
        </div>

        <div className="rounded-md border bg-card p-2">
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="icon" onClick={() => setIsPlaying(!isPlaying)} aria-label={isPlaying ? 'Pause' : 'Play'}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>

            <Button variant="outline" size="icon" onClick={() => step(-1)} aria-label="Frame backward">
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => step(1)} aria-label="Frame forward">
              <SkipForward className="h-4 w-4" />
            </Button>

            <Button variant="ghost" size="icon" onClick={() => setIsMuted(!isMuted)} aria-label={isMuted ? 'Unmute' : 'Mute'}>
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
              onValueChange={(v) => setPlaybackRate((Number(v) as 0.5 | 1 | 2) ?? 1)}
              disabled={!videoSourceUrl}
            >
              <SelectTrigger className="h-8 w-[110px]">
                <SelectValue placeholder="Speed" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0.5">0.5×</SelectItem>
                <SelectItem value="1">1×</SelectItem>
                <SelectItem value="2">2×</SelectItem>
              </SelectContent>
            </Select>

            {videoMeta?.fileName ? (
              <div className="ml-2 hidden max-w-[260px] truncate text-xs text-muted-foreground md:block">{videoMeta.fileName}</div>
            ) : null}
          </div>
        </div>
      </div>
    </Panel>
  );
}


