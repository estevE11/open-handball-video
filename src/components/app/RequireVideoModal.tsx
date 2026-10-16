import { useTranslation, useTranslatedMessage } from '@/lib/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { recordDiagnostic } from '@/lib/diagnostics';
import { DiagnosticsButton } from './DiagnosticsButton';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { attachBrowserClips } from '@/lib/browserProjectSession';
import { storageError } from '@/lib/browserStorage';
import { probeVideoFps } from '@/lib/videoProbe';
import { useProjectStore } from '@/store/projectStore';

export function RequireVideoModal({ onBack }: { onBack: () => void }) {
  const t = useTranslation();
  const message = useTranslatedMessage();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const hydrated = useProjectStore((s) => s.session.hydrated);
  const clips = useProjectStore((s) => s.clips);
  const videoMeta = useProjectStore((s) => s.videoMeta);
  const hasVideoFile = useProjectStore((s) => !!s.session.videoFile || (!!window.electron && !!s.session.videoSourceUrl));
  const setVideoFile = useProjectStore((s) => s.setVideoFile);
  const setVideoFps = useProjectStore((s) => s.setVideoFps);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const open = hydrated && !hasVideoFile;
  useEffect(() => {
    if (open && videoMeta) recordDiagnostic('warning', 'media', 'attachment.required', { clipCount: clips?.length ?? 1, bytes: videoMeta.fileSize });
  }, [open, videoMeta, clips]);

  const subtitle = useMemo(() => {
    if (clips) return t("Choose all {0} original clips. Their saved order and tags will be restored.", clips.length);
    if (!videoMeta) return t("Upload a video file to start.");
    return t("Select the original video for this saved project: {0}", videoMeta.fileName);
  }, [videoMeta, clips, t]);

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-[560px]" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t("Attach project video")}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/30 p-3 text-sm">{t("This project has no video saved in this browser. Select the original file or clips; it will be stored with the project for future visits.")}</div>

        {clips && <ol className="max-h-40 list-inside list-decimal overflow-auto text-sm text-muted-foreground">
          {clips.map((clip) => <li key={clip.id}>{clip.fileName}</li>)}
        </ol>}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          multiple={!!clips}
          className="hidden"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            const file = files[0];
            if (!file) return;
            e.currentTarget.value = '';
            setBusy(true); setError('');
            try {
              if (window.electron) setVideoFile(file, URL.createObjectURL(file));
              else await attachBrowserClips(files);
            } catch (err) { recordDiagnostic('error', 'media', 'attachment.failed', { clipCount: files.length }, err); setError(storageError(err)); setBusy(false); return; }
            setBusy(false);
            if (clips) return;
            try {
              const fps = await probeVideoFps(file);
              if (fps && useProjectStore.getState().session.videoFile === file) {
                setVideoFps(fps);
              }
            } catch (err) {
              recordDiagnostic('warning', 'media', 'fps_probe.failed', undefined, err);
              console.warn('[video] fps probe failed', err);
            }
          }}
        />

        <div className="flex justify-end gap-2">
          <DiagnosticsButton />
          {error && <p role="alert" className="text-sm text-destructive">{message(error)}</p>}
          <Button disabled={busy} variant="ghost" onClick={onBack}>{t("Back to projects")}</Button>
          <Button disabled={busy} variant="secondary" onClick={() => fileInputRef.current?.click()}>
            {clips ? t("Choose original clips…") : t("Choose video…")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

