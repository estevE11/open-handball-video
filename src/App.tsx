import { useEffect, useState } from 'react';

import { EventLogPanel } from '@/components/app/EventLogPanel';
import { ExportStudioModal } from '@/components/app/ExportStudioModal';
import { RequireVideoModal } from '@/components/app/RequireVideoModal';
import { SettingsModal } from '@/components/app/SettingsModal';
import { TimelinePanel } from '@/components/app/TimelinePanel';
import { TopBar } from '@/components/app/TopBar';
import { VideoPanel } from '@/components/app/VideoPanel';
import { useGlobalHotkeys } from '@/hooks/useGlobalHotkeys';
import { useProjectStore } from '@/store/projectStore';
import { Dashboard } from '@/components/Dashboard';

// Simple debounce
function useDebouncedEffect(fn: () => void, deps: any[], delay: number) {
  useEffect(() => {
    const handler = setTimeout(fn, delay);
    return () => clearTimeout(handler);
  }, [...deps, delay]);
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const videoSourceUrl = useProjectStore((s) => s.session.videoSourceUrl);
  const videoMeta = useProjectStore((s) => s.videoMeta);
  const clearVideoSourceUrl = useProjectStore((s) => s.clearVideoSourceUrl);
  const projectState = useProjectStore((s) => s);

  useGlobalHotkeys();

  useEffect(() => {
    // Default to dark mode for a video-analysis “suite” feel.
    document.documentElement.classList.add('dark');
  }, []);

  // Auto-save effect for Electron
  useDebouncedEffect(() => {
    if (window.electron && videoMeta?.fileName && videoSourceUrl) {
      // Create a clean project object for saving
      // partializeForPersist is internal to zustand persist, but we can do similar here
      // We rely on pickProjectData logic implicitly via what we pass
      // Actually, we can just grab the state and clean it.
      
      // Let's rely on exportProjectJson logic but parse it back to object for IPC
      const dataStr = projectState.exportProjectJson();
      const data = JSON.parse(dataStr);
      
      console.log('Auto-saving project...', videoMeta.fileName);
      window.electron.saveProject(videoMeta.fileName, data).catch(console.error);
    }
  }, [projectState, videoMeta, videoSourceUrl], 2000);

  // If in Electron and no video loaded, show Dashboard
  if (window.electron && !videoSourceUrl) {
    return <Dashboard />;
  }

  return (
    <div className="h-full w-full min-w-0 bg-background text-foreground">
      <TopBar 
        onOpenSettings={() => setSettingsOpen(true)} 
        onOpenExport={() => setExportOpen(true)} 
        showBackButton={!!window.electron}
        onBack={() => clearVideoSourceUrl()}
      />

      <div className="grid h-[calc(100%-3rem)] grid-rows-[minmax(0,1fr)_minmax(0,320px)] gap-2 p-2">
        <div className="grid min-h-0 min-w-0 grid-cols-[420px_minmax(0,1fr)] gap-2">
          <EventLogPanel />
          <VideoPanel />
        </div>
        <TimelinePanel />
      </div>

      <RequireVideoModal />
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ExportStudioModal open={exportOpen} onOpenChange={setExportOpen} />
    </div>
  );
}
