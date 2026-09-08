import { useEffect, useRef, useState } from 'react';
import { EventLogPanel } from '@/components/app/EventLogPanel';
import { ExportStudioModal } from '@/components/app/ExportStudioModal';
import { RequireVideoModal } from '@/components/app/RequireVideoModal';
import { SettingsModal } from '@/components/app/SettingsModal';
import { TimelinePanel } from '@/components/app/TimelinePanel';
import { TopBar } from '@/components/app/TopBar';
import { VideoPanel } from '@/components/app/VideoPanel';
import { StorageStatus } from '@/components/app/StorageStatus';
import { useGlobalHotkeys } from '@/hooks/useGlobalHotkeys';
import { useProjectStore } from '@/store/projectStore';
import { useVideoStore } from '@/store/videoStore';
import { Dashboard } from '@/components/Dashboard';
import { BrowserDashboard } from '@/components/BrowserDashboard';
import { currentProject } from '@/lib/browserProjectSession';
import { saveBrowserProject, storageError } from '@/lib/browserStorage';
import type { ProjectData } from '@/types/project';

let saves = Promise.resolve();
function saveProject(data: ProjectData) {
  saves = saves.catch(() => {}).then(async () => {
    if (window.electron) {
      if (data.videoMeta && !(await window.electron.saveProject(data.electronProjectKey ?? data.videoMeta.fileName, data))) {
        throw new Error('Could not save this project. Please retry.');
      }
    } else await saveBrowserProject(data);
  });
  return saves;
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [saveStatus, setSaveStatus] = useState('');
  const [saveError, setSaveError] = useState('');
  const saveFailed = useRef(false);
  const videoSourceUrl = useProjectStore((s) => s.session.videoSourceUrl);

  useGlobalHotkeys();

  useEffect(() => { document.documentElement.classList.add('dark'); }, []);

  // Subscribe immediately so even an edit followed by navigation is saved.
  // Serialize writes so older snapshots can never finish after newer ones.
  useEffect(() => {
    let pending = 0;
    let active = true;
    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (!state.session.videoSourceUrl || (state.updatedAtMs === previous.updatedAtMs && state.mainLabels === previous.mainLabels && state.secondaryLabels === previous.secondaryLabels && state.segments === previous.segments && state.videoMeta === previous.videoMeta && state.clips === previous.clips && state.settings === previous.settings)) return;
      const data = currentProject();
      pending++;
      setSaveStatus('Saving…');
      void saveProject(data).then(() => {
        saveFailed.current = false;
        if (active) { setSaveError(''); setSaveStatus(pending > 1 ? 'Saving…' : 'Saved'); }
      }).catch((err: unknown) => {
        saveFailed.current = true;
        if (active) { setSaveError(storageError(err)); setSaveStatus('Not saved'); }
      }).finally(() => { pending--; });
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pending || saveFailed.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { active = false; unsubscribe(); window.removeEventListener('beforeunload', beforeUnload); };
  }, []);

  async function backToLibrary() {
    try {
      await saveProject(currentProject());
      setSaveError(''); saveFailed.current = false;
      useProjectStore.getState().clearVideoSourceUrl();
      useVideoStore.getState().reset();
      setSettingsOpen(false); setExportOpen(false);
      setLibraryOpen(true);
    } catch (err) { setSaveError(storageError(err)); }
  }

  if (window.electron && !videoSourceUrl) return <Dashboard />;
  if (!window.electron && libraryOpen) return <BrowserDashboard onOpen={() => { setLibraryOpen(false); setSaveStatus('Saved'); }} />;

  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-background text-foreground">
      <TopBar onOpenSettings={() => setSettingsOpen(true)} onOpenExport={() => setExportOpen(true)} showBackButton onBack={() => void backToLibrary()} />
      {!window.electron && <StorageStatus />}
      <div className="px-3 py-1 text-xs" role={saveError ? 'alert' : 'status'}>
        {saveError || saveStatus}
        {saveError && <button className="ml-3 underline" onClick={() => {
          // Trigger the same tracked save path, including unload protection.
          useProjectStore.setState({ updatedAtMs: Date.now() });
        }}>Retry save</button>}
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-2 p-2">
        <div className="grid min-h-0 min-w-0 grid-cols-[minmax(260px,420px)_minmax(0,1fr)] gap-2">
          <EventLogPanel /><VideoPanel />
        </div>
        <TimelinePanel />
      </div>
      <RequireVideoModal onBack={() => void backToLibrary()} />
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ExportStudioModal open={exportOpen} onOpenChange={setExportOpen} />
    </div>
  );
}
