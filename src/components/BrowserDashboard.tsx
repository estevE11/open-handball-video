import { projectWithLabelSet } from '@/lib/labelSets';
import { resolveProjectLabelSet } from '@/store/labelSetStore';
import { LanguageSelector } from '@/components/app/LanguageSelector';
import { DiagnosticsButton, ErrorReportAction } from '@/components/app/DiagnosticsButton';
import { recordDiagnostic } from '@/lib/diagnostics';
import { useTranslation, useTranslatedMessage } from '@/lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LibraryShell } from '@/components/library/LibraryShell';
import { MatchCard } from '@/components/library/MatchCard';
import { MatchDetailsDialog } from '@/components/library/MatchDetailsDialog';
import { MoveVideoDialog } from '@/components/library/MoveVideoDialog';
import { matchesLibraryFilter, projectName, type ConfigureMatch } from '@/lib/library';
import { useLibraryView } from '@/hooks/useLibraryView';
import { importMatchTeams, loadLibraryCatalog, matchWithTeamNames, useLibraryStore } from '@/store/libraryStore';
import { ClipOrderDialog } from '@/components/app/ClipOrderDialog';
import { fileMeta, readVideoDuration, withProjectClips } from '@/lib/clipTimeline';
import type { LabelSet, ProjectData, VideoClip } from '@/types/project';
import { StorageStatus } from '@/components/app/StorageStatus';
import { createEmptyProject } from '@/lib/projectDefaults';
import { createId } from '@/lib/ids';
import { coerceProjectData, downloadProjectJson, readJsonFile } from '@/lib/projectIo';
import { openBrowserProject } from '@/lib/browserProjectSession';
import { deleteBrowserProject, duplicateBrowserProject, markBrowserProjectOpened, recommendSoftDelete, formatBytes, listBrowserProjects, loadBrowserProject, migrateLegacyProject, removeBrowserProjectVideo, requestPersistentStorage, saveBrowserProject, storageError, type StoredProject } from '@/lib/browserStorage';

function readLibraryEntry(record: StoredProject): { data: ProjectData; error?: string } {
  try { return { data: coerceProjectData(JSON.parse(record.json)) }; }
  catch (error) {
    return { error: storageError(error), data: { schemaVersion: 1, projectId: record.id, name: record.name, createdAtMs: record.updatedAtMs,
      updatedAtMs: record.updatedAtMs, videoMeta: null, mainLabels: [], secondaryLabels: [], segments: [], settings: { fps: 30 } } };
  }
}

export function BrowserDashboard({ onOpen, onManageLabelSets, chooseLabelSet, configureMatch }: { onOpen: () => void; onManageLabelSets: () => void; chooseLabelSet: () => Promise<LabelSet | null>; configureMatch: ConfigureMatch }) {
  const t = useTranslation();
  const message = useTranslatedMessage();
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const teams = useLibraryStore(state => state.catalog.teams);
  const { scope, setScope, search, setSearch, teamId, setTeamId } = useLibraryView();
  const [editing, setEditing] = useState<ProjectData | null>(null), [moving, setMoving] = useState<ProjectData | null>(null);
  const [pendingClips, setPendingClips] = useState<{ id: string; file: File }[]>([]);
  const videoInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const entries = projects.map(record => ({ record, ...readLibraryEntry(record) }));

  async function refresh() { const [projects] = await Promise.all([listBrowserProjects(), loadLibraryCatalog(true)]); setProjects(projects); }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (err) { recordDiagnostic('error', 'library', 'browser.action_failed', undefined, err); setError(storageError(err)); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    void migrateLegacyProject().catch((err: unknown) => {
      recordDiagnostic('error', 'storage', 'legacy.migration_failed', undefined, err);
      if (active) setError(`Could not migrate the previous autosave: ${storageError(err)}`);
    }).then(listBrowserProjects).then((list) => {
      if (active) setProjects(list);
    }).catch((err: unknown) => { recordDiagnostic('error', 'library', 'browser.load_failed', undefined, err); if (active) setError(storageError(err)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);

  return <div className="flex h-screen flex-col gap-5 overflow-auto bg-background p-4 text-foreground md:p-8">
    <header>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-2xl font-bold sm:text-3xl">Open Handball Video</h1>
        <div className="flex flex-wrap items-center justify-end gap-2"><DiagnosticsButton /><LanguageSelector compact /></div>
      </div>
      <p className="mt-2 text-muted-foreground">{t("Add one video or several clips for a split match. Videos and projects stay in this browser.")}</p>
    </header>
    <StorageStatus />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={() => videoInput.current?.click()}>{t("Add video")}</Button>
        <Button disabled={busy} variant="secondary" onClick={() => jsonInput.current?.click()}>{t("Import project JSON")}</Button>
        <Button disabled={busy} variant="outline" onClick={() => void run(refresh)}>{t("Refresh")}</Button>
      </div>
      <Button className="ml-auto" variant="outline" onClick={onManageLabelSets}>{t('Manage label sets')}</Button>
    </div>
    {error && <div role="alert" className="space-y-2 rounded-md border border-destructive p-3 text-sm"><p>{message(error)}</p><ErrorReportAction /></div>}
    <input ref={videoInput} type="file" multiple accept="video/*,.mp4,.mov,.webm,.mkv" className="hidden" aria-label={t("Add video file")} onChange={(event) => {
      const files = Array.from(event.target.files ?? []); event.target.value = '';
      if (!files.length) return;
      if (files.length > 1) {
        setPendingClips(files.map((file) => ({ id: createId(), file }))); setError(''); return;
      }
      const file = files[0];
      void run(async () => {
        const labelSet = await chooseLabelSet();
        if (!labelSet) return;
        const data = projectWithLabelSet(createEmptyProject(), labelSet);
        data.videoMeta = { fileName: file.name, fileSize: file.size, fileType: file.type, lastModified: file.lastModified };
        const details = await configureMatch({ name: file.name });
        if (!details) return;
        Object.assign(data, details, { folderId: scope === 'all' ? null : scope });
        await saveBrowserProject(data, file);
        void requestPersistentStorage();
        await markBrowserProjectOpened(data.projectId);
        openBrowserProject(data, file); onOpen();
      });
    }} />
    <input ref={jsonInput} type="file" accept="application/json,.json" className="hidden" aria-label={t("Import project JSON file")} onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (!file) return;
      void run(async () => {
        const data = coerceProjectData(await readJsonFile(file));
        // Imports are copies: never overwrite another project's edits or video.
        data.projectId = createId(); data.updatedAtMs = Date.now();
        delete data.electronProjectKey;
        data.folderId = scope === 'all' ? null : scope;
        data.match = await importMatchTeams(data.match);
        await saveBrowserProject(data);
        await refresh();
      });
    }} />
    <LibraryShell scope={scope} onScopeChange={setScope} search={search} onSearchChange={setSearch} teamId={teamId} onTeamChange={setTeamId}>
      {!busy && projects.length === 0 && <div className="rounded-md border p-12 text-center text-muted-foreground">
        <p>{t("No saved projects yet.")}</p><p className="mt-2 text-sm">{t("Add a video to start analyzing, or import an existing project JSON.")}</p>
      </div>}
      {busy && <p role="status">{t("Loading…")}</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {entries.filter(entry => matchesLibraryFilter(entry.data, scope, teamId, search, teams)).map(({ record: project, data, error: unreadable }) => {
          const shared = project.videoBytes > 0 && projects.some(other => other.id !== project.id && other.videoBytes > 0 && (other.videoKey ?? other.id) === (project.videoKey ?? project.id));
          return <MatchCard key={project.id} project={data} bytes={project.videoBytes + project.jsonBytes} lastOpenedAtMs={project.lastOpenedAtMs}
            busy={busy} missingVideo={!project.videoBytes} onEdit={() => void run(async () => setEditing((await loadBrowserProject(project.id)).data))} onMove={() => void run(async () => setMoving((await loadBrowserProject(project.id)).data))}
            onDuplicate={() => void run(async () => { await duplicateBrowserProject(project.id, t('{0} (copy)', project.name.slice(0, 180))); await refresh(); })}
            onOpen={() => void run(async () => {
              const { data, files } = await loadBrowserProject(project.id);
              const linked = await resolveProjectLabelSet(data);
              await saveBrowserProject(linked); await markBrowserProjectOpened(data.projectId);
              openBrowserProject(linked, files.length ? files : undefined); onOpen();
            })}
            onExport={() => void run(async () => {
              const linked = await resolveProjectLabelSet((await loadBrowserProject(project.id)).data);
              downloadProjectJson({ ...linked, ...(linked.match ? { match: matchWithTeamNames(linked.match) } : {}) }, `${project.name}.json`);
            })}
            onRemoveVideo={project.videoBytes ? () => {
              if (window.confirm(shared ? t('Remove the video from “{0}”? Other copies keep their video and analysis.', project.name) : t("Remove the stored video clips for “{0}” to free {1}? All labels, segments, and settings will be kept. Keep your original video files to attach them again later.", project.name, formatBytes(project.videoBytes)))) {
                void run(async () => { await removeBrowserProjectVideo(project.id); await refresh(); });
              }
            } : undefined}
            onDelete={() => {
              if (window.confirm(t("Delete “{0}” and its stored video from this browser?", project.name))) void run(async () => { await deleteBrowserProject(project.id); await refresh(); });
            }}>
            {unreadable && <p role="note" className="text-xs text-destructive">{message(unreadable)}</p>}
            {recommendSoftDelete(project) && <p className="rounded border border-amber-500/40 p-2 text-xs" role="note">{t("Recommended to soft-delete: not opened for 30 days. Remove the videos to free space while keeping all project data.")}</p>}
          </MatchCard>;
        })}
      </div>
      {!busy && projects.length > 0 && !entries.some(entry => matchesLibraryFilter(entry.data, scope, teamId, search, teams)) && <p className="rounded-md border p-8 text-center text-sm text-muted-foreground">{t('No videos match this folder or filter.')}</p>}
    </LibraryShell>
    {editing && <MatchDetailsDialog initial={{ name: projectName(editing), match: editing.match }} onCancel={() => setEditing(null)} onSave={async details => {
      await saveBrowserProject({ ...editing, ...details, updatedAtMs: Date.now() }); await refresh(); setEditing(null);
    }} />}
    {moving && <MoveVideoDialog name={projectName(moving)} initial={moving.folderId} onClose={() => setMoving(null)} onSave={async folderId => {
      await saveBrowserProject({ ...moving, folderId, updatedAtMs: Date.now() }); await refresh();
    }} />}
    {pendingClips.length > 0 && <ClipOrderDialog
      items={pendingClips.map((item) => ({ id: item.id, name: item.file.name }))}
      onChange={(ids) => setPendingClips(ids.map((id) => pendingClips.find((item) => item.id === id)!))}
      onCancel={() => { setPendingClips([]); setError(''); }} busy={busy} error={error}
      onStart={() => void run(async () => {
        const labelSet = await chooseLabelSet();
        if (!labelSet) return;
        const clips: VideoClip[] = [];
        for (const item of pendingClips) {
          try { clips.push({ ...fileMeta(item.file), id: item.id, durationSec: await readVideoDuration(item.file) }); }
          catch (err) { throw new Error(`${item.file.name}: ${storageError(err)}`); }
        }
        const data = withProjectClips(projectWithLabelSet(createEmptyProject(), labelSet), clips);
        const details = await configureMatch({ name: projectName(data) });
        if (!details) return;
        Object.assign(data, details, { folderId: scope === 'all' ? null : scope });
        const files = pendingClips.map((item) => item.file);
        await saveBrowserProject(data, files);
        void requestPersistentStorage();
        await markBrowserProjectOpened(data.projectId);
        openBrowserProject(data, files); onOpen();
      })} />}
  </div>;
}
