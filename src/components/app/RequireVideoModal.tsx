import { useMemo, useRef } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { probeVideoFps } from '@/lib/videoProbe';
import { useProjectStore } from '@/store/projectStore';

export function RequireVideoModal() {
  const hydrated = useProjectStore((s) => s.session.hydrated);
  const videoMeta = useProjectStore((s) => s.videoMeta);
  const hasVideoFile = useProjectStore((s) => !!s.session.videoFile);
  const setVideoFile = useProjectStore((s) => s.setVideoFile);
  const setVideoFps = useProjectStore((s) => s.setVideoFps);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const open = hydrated && !!videoMeta && !hasVideoFile;

  const subtitle = useMemo(() => {
    if (!videoMeta) return 'Upload a video file to start.';
    return `This project was restored from auto-save. Please re-upload the original video file: ${videoMeta.fileName}`;
  }, [videoMeta]);

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-[560px]" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Re-upload video</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          Browsers can’t automatically restore access to local files after a reload. Your labels/segments are saved, but you must select the video
          again.
        </div>

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

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
            Choose video…
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}


