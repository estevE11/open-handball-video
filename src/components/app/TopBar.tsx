import { useTranslation } from '@/lib/i18n';
import { Undo2, Redo2, ChevronLeft, Download, Maximize, Minimize, Settings, Upload } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { DiagnosticsButton } from './DiagnosticsButton';
import { Separator } from '@/components/ui/separator';
import { useProjectStore } from '@/store/projectStore';
import { recordDiagnostic } from '@/lib/diagnostics';

type TopBarProps = {
  onOpenSettings: () => void;
  onOpenExport: () => void;
  showBackButton?: boolean;
  onBack?: () => void;
};

export function TopBar({ onOpenSettings, onOpenExport, showBackButton, onBack }: TopBarProps) {
  const t = useTranslation();

  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const exportProjectJson = useProjectStore((s) => s.exportProjectJson);
  const updatedAtMs = useProjectStore((s) => s.updatedAtMs);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [changingFullscreen, setChangingFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const fullscreenSupported = fullscreen || (document.fullscreenEnabled !== false && typeof document.documentElement.requestFullscreen === 'function');

  useEffect(() => {
    const syncFullscreen = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  async function toggleFullscreen() {
    if (changingFullscreen || !fullscreenSupported) return;
    setChangingFullscreen(true); setFullscreenError(false);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setFullscreen(!!document.fullscreenElement);
    } catch (error) {
      recordDiagnostic('warning', 'ui', 'fullscreen.failed', undefined, error);
      setFullscreenError(true);
    } finally { setChangingFullscreen(false); }
  }

  const filename = useMemo(() => {
    const d = new Date(updatedAtMs);
    const safe = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(
      d.getHours(),
    ).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    return `open-handball-video_${safe}.json`;
  }, [updatedAtMs]);

  function downloadTextFile(name: string, contents: string, mimeType: string) {
    const blob = new Blob([contents], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-12 items-center gap-2 border-b bg-card px-2">
      <div className="flex items-center gap-2">
        {showBackButton && (
          <Button variant="ghost" size="sm" onClick={onBack} aria-label={t("Back to projects")} className="mr-1 h-8 w-8 p-0">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="text-sm font-semibold tracking-tight">Open Handball Video</div>
        <div className="text-xs text-muted-foreground">{t("Sports Video Analysis Tool")}</div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <DiagnosticsButton compact />
        <Button variant="ghost" size="icon" aria-label={t("Undo edit")} title={t("Undo (Ctrl/Cmd+Z)")} disabled={!canUndo} onClick={() => useProjectStore.getState().undo()}><Undo2 className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" aria-label={t("Redo edit")} title={t("Redo (Ctrl/Cmd+Shift+Z)")} disabled={!canRedo} onClick={() => useProjectStore.getState().redo()}><Redo2 className="h-4 w-4" /></Button>
        {!window.electron && (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                // Save JSON
                downloadTextFile(filename, exportProjectJson(), 'application/json');
              }}
            >
              <Download className="mr-2 h-4 w-4" />{t("Export JSON")}</Button>

            <Separator orientation="vertical" className="mx-1 h-6" />
          </>
        )}

        <Button variant="outline" size="sm" onClick={onOpenExport}>
          <Upload className="mr-2 h-4 w-4" />{t("Export Studio")}</Button>

        <Button variant="outline" size="sm" onClick={onOpenSettings}>
          <Settings className="mr-2 h-4 w-4" />{t("Labels & Settings")}</Button>

        {fullscreenError && <span role="alert" className="max-w-48 text-xs text-destructive">{t("Could not change fullscreen mode. Try again.")}</span>}
        <Button variant="ghost" size="icon" onClick={() => void toggleFullscreen()} disabled={!fullscreenSupported || changingFullscreen}
          aria-label={fullscreen ? t("Exit fullscreen") : t("Enter fullscreen")} aria-pressed={fullscreen}
          title={fullscreenSupported ? (fullscreen ? t("Exit fullscreen") : t("Enter fullscreen")) : t("Fullscreen is not supported by this browser.")}>
          {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

