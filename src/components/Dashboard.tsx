import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { LanguageSelector } from '@/components/app/LanguageSelector';
import { DiagnosticsButton } from '@/components/app/DiagnosticsButton';
import { recordDiagnostic } from '@/lib/diagnostics';
import { ClipOrderDialog } from '@/components/app/ClipOrderDialog';
import { LibraryShell } from '@/components/library/LibraryShell';
import { MatchCard } from '@/components/library/MatchCard';
import { MatchDetailsDialog } from '@/components/library/MatchDetailsDialog';
import { MoveVideoDialog } from '@/components/library/MoveVideoDialog';
import { Button } from '@/components/ui/button';
import { useTranslation, useTranslatedMessage } from '@/lib/i18n';
import { coerceProjectData, downloadProjectJson, readJsonFile } from '@/lib/projectIo';
import { createEmptyProject } from '@/lib/projectDefaults';
import { createId } from '@/lib/ids';
import { readVideoDuration, withProjectClips } from '@/lib/clipTimeline';
import { openElectronClipProject } from '@/lib/electronProjectSession';
import { projectWithLabelSet } from '@/lib/labelSets';
import { matchesLibraryFilter, projectName, type ConfigureMatch } from '@/lib/library';
import { useLibraryView } from '@/hooks/useLibraryView';
import { resolveProjectLabelSet } from '@/store/labelSetStore';
import { importMatchTeams, loadLibraryCatalog, matchWithTeamNames, useLibraryStore } from '@/store/libraryStore';
import { useVideoStore } from '@/store/videoStore';
import { useProjectStore } from '@/store/projectStore';
import type { LabelSet, ProjectData, VideoClip } from '@/types/project';
import type { VideoFile } from '@/types/electron';

type Entry = { project: ProjectData; video?: VideoFile; saved: boolean };
const key = (project: ProjectData) => project.electronProjectKey ?? project.videoMeta?.fileName ?? project.projectId;
export function Dashboard({ onManageLabelSets, chooseLabelSet, configureMatch }: { onManageLabelSets: () => void; chooseLabelSet: () => Promise<LabelSet | null>; configureMatch: ConfigureMatch }) {
  const t = useTranslation(), message = useTranslatedMessage();
  const teams = useLibraryStore(state => state.catalog.teams);
  const [selected, setSelected] = useState<string[]>([]), [pending, setPending] = useState<VideoFile[]>([]);
  const [projects, setProjects] = useState<ProjectData[]>([]), [videos, setVideos] = useState<VideoFile[]>([]);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const { scope, setScope, search, setSearch, teamId, setTeamId } = useLibraryView();
  const [editing, setEditing] = useState<ProjectData | null>(null), [moving, setMoving] = useState<ProjectData | null>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  async function fetchVideos() {
    if (!window.electron) return;
    const [list, saved, split] = await Promise.all([window.electron.getVideos(), window.electron.getSavedProjects(), window.electron.getClipProjects(), loadLibraryCatalog(true)]);
    const valid = new Map<string, ProjectData>();
    for (const raw of [...saved, ...split]) { try { const project = coerceProjectData(raw); valid.set(project.projectId, project); } catch (error) { recordDiagnostic('warning', 'storage', 'desktop.invalid_project', undefined, error); } }
    setProjects([...valid.values()]); setVideos(list.sort((a, b) => b.modifiedAt - a.modifiedAt));
    setSelected(previous => previous.filter(path => list.some(video => video.path === path)));
  }
  async function run(action: () => Promise<void>) {
    setLoading(true); setError('');
    try { await action(); } catch (error) { recordDiagnostic('error', 'library', 'desktop.action_failed', undefined, error); setError(error instanceof Error ? error.message : 'Could not read projects.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void run(fetchVideos); }, []);
  async function save(data: ProjectData) {
    if (!(await window.electron!.saveProject(key(data), data))) throw new Error('Could not save this project. Please retry.');
  }
  async function sourceProject(video: VideoFile): Promise<ProjectData | null> {
    const raw = await window.electron!.loadProject(video.name);
    let data: ProjectData;
    if (raw === null) {
      const labelSet = await chooseLabelSet(); if (!labelSet) return null;
      const details = await configureMatch({ name: video.name }); if (!details) return null;
      data = { ...projectWithLabelSet(createEmptyProject(), labelSet), ...details, folderId: scope === 'all' ? null : scope };
    } else data = await resolveProjectLabelSet(coerceProjectData(raw));
    const metadata = await window.electron!.probeVideoMetadata(video.url);
    data.videoMeta = { ...data.videoMeta, ...metadata, fileName: video.name, fileSize: video.size, fileType: data.videoMeta?.fileType || 'video/mp4', lastModified: video.modifiedAt };
    await save(data);
    return data;
  }
  async function ensure(entry: Entry) { return entry.saved ? entry.project : sourceProject(entry.video!); }
  async function open(data: ProjectData) {
    const linked = await resolveProjectLabelSet(data);
    if (linked.clips) { await openElectronClipProject(linked, videos); return; }
    const video = videos.find(video => video.name === linked.videoMeta?.fileName && video.size === linked.videoMeta.fileSize);
    if (!video) throw new Error('Restore the original video to Documents/open-handball-video, then refresh.');
    await save(linked);
    useProjectStore.getState().resetProject(); useVideoStore.getState().reset();
    useProjectStore.getState().replaceProject(linked);
    useProjectStore.getState().setElectronVideo(video.url, linked.videoMeta!);
  }
  const entries: Entry[] = videos.map(video => {
    const saved = projects.find(project => key(project) === video.name);
    return { video, saved: !!saved, project: saved ?? { schemaVersion: 1, projectId: video.path, createdAtMs: video.createdAt, updatedAtMs: video.modifiedAt,
      videoMeta: { fileName: video.name, fileSize: video.size, fileType: 'video/mp4', lastModified: video.modifiedAt }, mainLabels: [], secondaryLabels: [], segments: [], settings: { fps: 30 } } };
  });
  entries.push(...projects.filter(project => !videos.some(video => key(project) === video.name)).map(project => ({ project, saved: true })));
  const filtered = entries.filter(entry => matchesLibraryFilter(entry.project, scope, teamId, search, teams));
  return <div className="flex h-screen flex-col gap-5 overflow-auto bg-background p-4 text-foreground md:p-8">
    <header><div className="flex flex-wrap items-start justify-between gap-4"><h1 className="text-2xl font-bold sm:text-3xl">Open Handball Video</h1><div className="flex flex-wrap items-center justify-end gap-2"><DiagnosticsButton /><LanguageSelector compact /></div></div>
      <p className="mt-2 text-muted-foreground">{t('Open a video, or select several clips below to create a split match.')}</p></header>
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2">
      <Button disabled={selected.length < 2 || loading} onClick={() => { setError(''); setPending(selected.map(path => videos.find(video => video.path === path)!)); }}>{t('Arrange selected clips ({0})', selected.length)}</Button>
      <Button variant="secondary" disabled={loading} onClick={() => jsonInput.current?.click()}>{t('Import project JSON')}</Button>
      <Button variant="outline" disabled={loading} onClick={() => void run(fetchVideos)}><RefreshCw className="h-4 w-4" />{t('Refresh')}</Button>
    </div><Button variant="outline" className="ml-auto" onClick={onManageLabelSets}>{t('Manage label sets')}</Button></div>
    <input type="file" ref={jsonInput} accept="application/json,.json" className="hidden" aria-label={t('Import project JSON file')} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      void run(async () => { const data = coerceProjectData(await readJsonFile(file)); data.projectId = createId(); data.electronProjectKey = data.projectId;
        data.folderId = scope === 'all' ? null : scope; data.match = await importMatchTeams(data.match); data.updatedAtMs = Date.now(); await save(data); await fetchVideos(); });
    }} />
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{message(error)}</p><DiagnosticsButton /></div>}
    <LibraryShell scope={scope} onScopeChange={setScope} search={search} onSearchChange={setSearch} teamId={teamId} onTeamChange={setTeamId}>
      {!entries.length && !loading && <div className="rounded-md border p-10 text-center text-muted-foreground"><p>{t('No videos found in "Documents/open-handball-video"')}</p><p className="mt-2 text-sm">{t('Add .mp4, .mov, or .webm files there.')}</p></div>}
      {entries.length > 0 && !filtered.length && !loading && <p className="rounded-md border p-8 text-center text-muted-foreground">{t('No videos match this folder or filter.')}</p>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map(entry => <MatchCard key={entry.project.projectId} project={entry.project} bytes={entry.project.videoMeta?.fileSize} busy={loading}
        openLabel={entry.project.clips ? t('Open match: {0} ({1} clips)', projectName(entry.project), entry.project.clips.length) : undefined}
        onOpen={() => void run(async () => { const data = await ensure(entry); if (data) await open(data); })}
        onEdit={() => void run(async () => { if (entry.saved) setEditing(entry.project); else { await ensure(entry); await fetchVideos(); } })}
        onMove={() => void run(async () => { const data = await ensure(entry); if (data) setMoving(data); })}
        onDuplicate={() => void run(async () => { const data = await ensure(entry); if (!data) return;
          const id = createId(); await save({ ...data, projectId: id, electronProjectKey: id, name: t('{0} (copy)', projectName(data).slice(0, 180)), createdAtMs: Date.now(), updatedAtMs: Date.now(), segments: data.segments.map(segment => ({ ...segment, id: createId() })) }); await fetchVideos(); })}
        onExport={() => void run(async () => { const data = await ensure(entry); if (data) downloadProjectJson({ ...data, ...(data.match ? { match: matchWithTeamNames(data.match) } : {}) }, `${projectName(data)}.json`); })}>
        {entry.video && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selected.includes(entry.video.path)} onChange={event => setSelected(previous => event.target.checked ? [...previous, entry.video!.path] : previous.filter(path => path !== entry.video!.path))} />{t('Include in split match')}</label>}
      </MatchCard>)}</div>
    </LibraryShell>
    {editing && <MatchDetailsDialog initial={{ name: projectName(editing), match: editing.match }} onCancel={() => setEditing(null)} onSave={async details => { await save({ ...editing, ...details, updatedAtMs: Date.now() }); await fetchVideos(); setEditing(null); }} />}
    {moving && <MoveVideoDialog name={projectName(moving)} initial={moving.folderId} onClose={() => setMoving(null)} onSave={async folderId => { await save({ ...moving, folderId, updatedAtMs: Date.now() }); await fetchVideos(); }} />}
    {pending.length > 0 && <ClipOrderDialog items={pending.map(video => ({ id: video.path, name: video.name }))} onChange={ids => setPending(ids.map(id => pending.find(video => video.path === id)!))}
      busy={loading} error={error} onCancel={() => setPending([])} onStart={() => void run(async () => {
        const labelSet = await chooseLabelSet(); if (!labelSet) return;
        const clips: VideoClip[] = [];
        for (const video of pending) { const metadata = await window.electron!.probeVideoMetadata(video.url);
          clips.push({ ...metadata, id: createId(), fileName: video.name, fileSize: video.size, fileType: 'video/mp4', lastModified: video.modifiedAt, durationSec: metadata.durationSec ?? await readVideoDuration(video.url) }); }
        const data = withProjectClips(projectWithLabelSet(createEmptyProject(), labelSet), clips);
        const details = await configureMatch({ name: projectName(data) }); if (!details) return;
        Object.assign(data, details, { folderId: scope === 'all' ? null : scope, electronProjectKey: data.projectId }); await save(data); await open(data);
      })} />}
  </div>;
}
