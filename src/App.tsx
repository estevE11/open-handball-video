import { LabelSetsModal } from '@/components/app/LabelSetsModal';
import { flushLabelSets, loadLabelSets, updateLabelSetLabels, useLabelSetStore } from '@/store/labelSetStore';
import { useTranslation, useTranslatedMessage, useLanguageStore } from '@/lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { EventLogPanel } from '@/components/app/EventLogPanel';
import { AnalysisLayout } from '@/components/app/AnalysisLayout';
import { ExportStudioModal } from '@/components/app/ExportStudioModal';
import { RequireVideoModal } from '@/components/app/RequireVideoModal';
import { SettingsModal } from '@/components/app/SettingsModal';
import { TimelinePanel } from '@/components/app/TimelinePanel';
import { TopBar } from '@/components/app/TopBar';
import { VideoPanel } from '@/components/app/VideoPanel';
import { ErrorReportAction } from '@/components/app/DiagnosticsButton';
import { projectDiagnosticSummary, setDiagnosticContext, traceDiagnosticTask } from '@/lib/diagnostics';
import { useGlobalHotkeys } from '@/hooks/useGlobalHotkeys';
import { useProjectStore } from '@/store/projectStore';
import { useVideoStore } from '@/store/videoStore';
import { Dashboard } from '@/components/Dashboard';
import { BrowserDashboard } from '@/components/BrowserDashboard';
import { currentProject } from '@/lib/browserProjectSession';
import { saveBrowserProject, storageError } from '@/lib/browserStorage';
import type { LabelSet, ProjectData } from '@/types/project';
import { MatchDetailsDialog } from '@/components/library/MatchDetailsDialog';
import { loadLibraryCatalog } from '@/store/libraryStore';
import type { ConfigureMatch, MatchDetails } from '@/lib/library';

let saves = Promise.resolve();
function saveProject(data: ProjectData) {
  saves = saves.catch(() => {}).then(() => traceDiagnosticTask('save', 'autosave', { ...projectDiagnosticSummary(data), native: !!window.electron }, async () => {
    setDiagnosticContext('save', { state: 'saving', time: new Date().toISOString() });
    await flushLabelSets();
    if (window.electron) {
      if (data.videoMeta && !(await window.electron.saveProject(data.electronProjectKey ?? data.videoMeta.fileName, data))) {
        throw new Error('Could not save this project. Please retry.');
      }
    } else await saveBrowserProject(data);
    setDiagnosticContext('save', { state: 'saved', time: new Date().toISOString() });
  }).catch(error => { setDiagnosticContext('save', { state: 'failed', time: new Date().toISOString() }); throw error; }));
  return saves;
}

export default function App() {
  const t = useTranslation();
  const language = useLanguageStore((s) => s.language);
  const message = useTranslatedMessage();
  const [setsOpen, setSetsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newMatch, setNewMatch] = useState<Parameters<ConfigureMatch>[0] | null>(null);
  const matchSelection = useRef<((details: MatchDetails | null) => void) | null>(null);
  const configureMatch: ConfigureMatch = async (initial) => {
    await loadLibraryCatalog();
    matchSelection.current?.(null);
    setNewMatch(initial);
    return new Promise(resolve => { matchSelection.current = resolve; });
  };
  function finishMatch(details: MatchDetails | null) {
    setNewMatch(null); matchSelection.current?.(details); matchSelection.current = null;
  }
  const selection = useRef<((set: LabelSet | null) => void) | null>(null);
  async function chooseLabelSet(): Promise<LabelSet | null> {
    await loadLabelSets();
    selection.current?.(null);
    setPickerOpen(true);
    return new Promise((resolve) => { selection.current = resolve; });
  }
  function finishSelection(set: LabelSet | null) {
    setPickerOpen(false);
    selection.current?.(set);
    selection.current = null;
  }
  const labelSetModals = <>
    {setsOpen && <LabelSetsModal open onOpenChange={setSetsOpen} />}
    {pickerOpen && <LabelSetsModal open onOpenChange={(open) => { if (!open) finishSelection(null); }} onSelect={finishSelection} />}
    {newMatch && <MatchDetailsDialog initial={newMatch} creating onCancel={() => finishMatch(null)} onSave={details => finishMatch(details)} />}
  </>;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [saveStatus, setSaveStatus] = useState('');
  const [saveError, setSaveError] = useState('');
  const saveFailed = useRef(false);
  const videoSourceUrl = useProjectStore((s) => s.session.videoSourceUrl);

  useGlobalHotkeys();

  useEffect(() => { document.documentElement.classList.add('dark'); }, []);
  useEffect(() => {
    void loadLabelSets().catch(() => {});
    const unsubscribe = useLabelSetStore.subscribe((state, previous) => {
      if (state.sets === previous.sets) return;
      const project = useProjectStore.getState();
      if (!project.session.videoSourceUrl || !project.labelSetId) return;
      const set = state.sets.find((item) => item.id === project.labelSetId);
      if (set) project.applyLabelSet(set);
    });
    return unsubscribe;
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);

  // Subscribe immediately so even an edit followed by navigation is saved.
  // Serialize writes so older snapshots can never finish after newer ones.
  useEffect(() => {
    let pending = 0;
    let active = true;
    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (!state.session.videoSourceUrl || (state.updatedAtMs === previous.updatedAtMs && state.mainLabels === previous.mainLabels && state.secondaryLabels === previous.secondaryLabels && state.segments === previous.segments && state.videoMeta === previous.videoMeta && state.clips === previous.clips && state.settings === previous.settings)) return;
      if (state.labelSetId && (state.mainLabels !== previous.mainLabels || state.secondaryLabels !== previous.secondaryLabels)) {
        void updateLabelSetLabels(state.labelSetId, state.mainLabels, state.secondaryLabels).catch(() => {});
      }
      const data = currentProject();
      pending++;
      setSaveStatus('Saving…');
      void saveProject(data).then(() => {
        saveFailed.current = false;
        if (active) { setSaveError(''); setSaveStatus(pending > 1 ? "Saving…" : "Saved"); }
      }).catch((err: unknown) => {
        saveFailed.current = true;
        if (active) { setSaveError(storageError(err)); setSaveStatus('Not saved'); }
      }).finally(() => { pending--; });
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pending || saveFailed.current || useLabelSetStore.getState().pending || useLabelSetStore.getState().error) { event.preventDefault(); event.returnValue = ''; }
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

  if (window.electron && !videoSourceUrl) return <><Dashboard onManageLabelSets={() => setSetsOpen(true)} chooseLabelSet={chooseLabelSet} configureMatch={configureMatch} />{labelSetModals}</>;
  if (!window.electron && libraryOpen) return <><BrowserDashboard onManageLabelSets={() => setSetsOpen(true)} chooseLabelSet={chooseLabelSet} configureMatch={configureMatch} onOpen={() => { setLibraryOpen(false); setSaveStatus('Saved'); }} />{labelSetModals}</>;

  return (
    <><div className="flex h-full w-full min-w-0 flex-col bg-background text-foreground">
      <TopBar onOpenSettings={() => setSettingsOpen(true)} onOpenExport={() => setExportOpen(true)} showBackButton onBack={() => void backToLibrary()} />
      <div className="px-3 py-1 text-xs" role={saveError ? 'alert' : 'status'}>
        {message(saveError || saveStatus)}
        {saveError && <button className="ml-3 underline" onClick={() => {
          // Trigger the same tracked save path, including unload protection.
          useProjectStore.setState({ updatedAtMs: Date.now() });
        }}>{t("Retry save")}</button>}
        {saveError && <div className="mt-2"><ErrorReportAction /></div>}
      </div>
      <AnalysisLayout sidebar={<EventLogPanel />} player={<VideoPanel />} timeline={<TimelinePanel />} />
      <RequireVideoModal onBack={() => void backToLibrary()} />
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ExportStudioModal open={exportOpen} onOpenChange={setExportOpen} />
    </div>{labelSetModals}</>
  );
}
