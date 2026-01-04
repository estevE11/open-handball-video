import { useEffect, useState } from 'react';

import { EventLogPanel } from '@/components/app/EventLogPanel';
import { ExportStudioModal } from '@/components/app/ExportStudioModal';
import { RequireVideoModal } from '@/components/app/RequireVideoModal';
import { SettingsModal } from '@/components/app/SettingsModal';
import { TimelinePanel } from '@/components/app/TimelinePanel';
import { TopBar } from '@/components/app/TopBar';
import { VideoPanel } from '@/components/app/VideoPanel';
import { useGlobalHotkeys } from '@/hooks/useGlobalHotkeys';

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  useGlobalHotkeys();

  useEffect(() => {
    // Default to dark mode for a video-analysis “suite” feel.
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <div className="h-full w-full min-w-0 bg-background text-foreground">
      <TopBar onOpenSettings={() => setSettingsOpen(true)} onOpenExport={() => setExportOpen(true)} />

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
