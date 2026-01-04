import { Download, FolderOpen, Settings, Upload } from 'lucide-react';
import { useMemo, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useProjectStore } from '@/store/projectStore';
import { coerceProjectData, readJsonFile } from '@/lib/projectIo';
import { useVideoStore } from '@/store/videoStore';

type TopBarProps = {
  onOpenSettings: () => void;
  onOpenExport: () => void;
};

export function TopBar({ onOpenSettings, onOpenExport }: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const exportProjectJson = useProjectStore((s) => s.exportProjectJson);
  const replaceProject = useProjectStore((s) => s.replaceProject);
  const resetProject = useProjectStore((s) => s.resetProject);
  const clearVideoSourceUrl = useProjectStore((s) => s.clearVideoSourceUrl);
  const updatedAtMs = useProjectStore((s) => s.updatedAtMs);
  const resetVideoRuntime = useVideoStore((s) => s.reset);

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

  async function onLoadProjectFile(file: File) {
    const raw = await readJsonFile(file);
    const data = coerceProjectData(raw);
    replaceProject(data);
    // Force user to re-upload video for the loaded project.
    clearVideoSourceUrl();
    resetVideoRuntime();
  }

  return (
    <div className="flex h-12 items-center gap-2 border-b bg-card px-2">
      <div className="flex items-center gap-2">
        <div className="text-sm font-semibold tracking-tight">Open Handball Video</div>
        <div className="text-xs text-muted-foreground">Sports Video Analysis Tool</div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            // Save JSON
            downloadTextFile(filename, exportProjectJson(), 'application/json');
          }}
        >
          <Download className="mr-2 h-4 w-4" />
          Save Project
        </Button>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            await onLoadProjectFile(file);
            e.currentTarget.value = '';
          }}
        />
        <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
          <FolderOpen className="mr-2 h-4 w-4" />
          Load Project
        </Button>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <Button variant="outline" size="sm" onClick={onOpenExport}>
          <Upload className="mr-2 h-4 w-4" />
          Export Studio
        </Button>

        <Button variant="outline" size="sm" onClick={onOpenSettings}>
          <Settings className="mr-2 h-4 w-4" />
          Labels & Settings
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            resetProject();
            resetVideoRuntime();
          }}
        >
          New
        </Button>
      </div>
    </div>
  );
}


