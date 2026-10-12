import { projectWithLabelSet } from '@/lib/labelSets';
import { resolveProjectLabelSet } from '@/store/labelSetStore';
import { LanguageSelector } from '@/components/app/LanguageSelector';
import { useTranslation, useTranslatedMessage, useLanguageStore } from '@/lib/i18n';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ClipOrderDialog } from '@/components/app/ClipOrderDialog';
import { fileMeta, readVideoDuration, withProjectClips } from '@/lib/clipTimeline';
import type { LabelSet, VideoClip } from '@/types/project';
import { StorageStatus } from '@/components/app/StorageStatus';
import { createEmptyProject } from '@/lib/projectDefaults';
import { createId } from '@/lib/ids';
import { coerceProjectData, downloadProjectJson, readJsonFile } from '@/lib/projectIo';
import { openBrowserProject } from '@/lib/browserProjectSession';
import { deleteBrowserProject, markBrowserProjectOpened, recommendSoftDelete, formatBytes, listBrowserProjects, loadBrowserProject, migrateLegacyProject, removeBrowserProjectVideo, requestPersistentStorage, saveBrowserProject, storageError, type StoredProject } from '@/lib/browserStorage';

export function BrowserDashboard({ onOpen, onManageLabelSets, chooseLabelSet }: { onOpen: () => void; onManageLabelSets: () => void; chooseLabelSet: () => Promise<LabelSet | null> }) {
  const t = useTranslation();
  const language = useLanguageStore((s) => s.language);
  const message = useTranslatedMessage();
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [pendingClips, setPendingClips] = useState<{ id: string; file: File }[]>([]);
  const videoInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  async function refresh() { setProjects(await listBrowserProjects()); }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (err) { setError(storageError(err)); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    void migrateLegacyProject().catch((err: unknown) => {
      if (active) setError(`Could not migrate the previous autosave: ${storageError(err)}`);
    }).then(listBrowserProjects).then((list) => {
      if (active) setProjects(list);
    }).catch((err: unknown) => { if (active) setError(storageError(err)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);

  return <div className="flex h-screen flex-col gap-5 overflow-auto bg-background p-4 text-foreground md:p-8">
    <header>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Open Handball Video</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={() => videoInput.current?.click()}>{t("Add video")}</Button>
          <Button disabled={busy} variant="secondary" onClick={() => jsonInput.current?.click()}>{t("Import project JSON")}</Button>
          <Button disabled={busy} variant="outline" onClick={() => void run(refresh)}>{t("Refresh")}</Button>
          <Button variant="outline" onClick={onManageLabelSets}>{t('Manage label sets')}</Button>
          <LanguageSelector compact />
        </div>
      </div>
      <p className="mt-2 text-muted-foreground">{t("Add one video or several clips for a split match. Videos and projects stay in this browser.")}</p>
    </header>
    <StorageStatus />
    {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm">{message(error)}</p>}
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
        await saveBrowserProject(data);
        await refresh();
      });
    }} />
    {!busy && projects.length === 0 && <div className="rounded-md border p-12 text-center text-muted-foreground">
      <p>{t("No saved projects yet.")}</p><p className="mt-2 text-sm">{t("Add a video to start analyzing, or import an existing project JSON.")}</p>
    </div>}
    {busy && <p role="status">{t("Loading…")}</p>}
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => <Card key={project.id}>
        <CardHeader><CardTitle className="truncate text-base" title={project.name}>{project.name}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{formatBytes(project.videoBytes + project.jsonBytes)} · {new Date(project.updatedAtMs).toLocaleDateString(language)}</p>
          <p className="text-xs text-muted-foreground">{t("Last opened:")}{' '}{project.lastOpenedAtMs ? new Date(project.lastOpenedAtMs).toLocaleDateString(language) : t("Not yet recorded")}</p>
          {recommendSoftDelete(project) && <p className="rounded border border-amber-500/40 p-2 text-sm" role="note">{t("Recommended to soft-delete: not opened for 30 days. Remove the videos to free space while keeping all project data.")}</p>}
          {!project.videoBytes && <p className="text-sm text-muted-foreground">{t("Video not stored. Project data kept. Choose the original video when opening this project.")}</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void run(async () => {
              const { data, files } = await loadBrowserProject(project.id);
              const linked = await resolveProjectLabelSet(data);
              await saveBrowserProject(linked);
              await markBrowserProjectOpened(data.projectId);
              openBrowserProject(linked, files.length ? files : undefined); onOpen();
            })}>{t("Open project")}</Button>
            <Button disabled={busy} variant="outline" onClick={() => void run(async () => downloadProjectJson(await resolveProjectLabelSet(coerceProjectData(JSON.parse(project.json))), `${project.name}.json`))}>{t("Export JSON")}</Button>
            {project.videoBytes > 0 && <Button disabled={busy} variant="outline" onClick={() => {
              if (window.confirm(t("Remove the stored video clips for “{0}” to free {1}? All labels, segments, and settings will be kept. Keep your original video files to attach them again later.", project.name, formatBytes(project.videoBytes)))) {
                void run(async () => { await removeBrowserProjectVideo(project.id); await refresh(); });
              }
            }}>{recommendSoftDelete(project) ? t("Soft-delete videos") : t("Remove video")}</Button>}
            <Button disabled={busy} variant="ghost" onClick={() => {
              if (window.confirm(t("Delete “{0}” and its stored video from this browser?", project.name))) {
                void run(async () => { await deleteBrowserProject(project.id); await refresh(); });
              }
            }}>{t("Delete project")}</Button>
          </div>
        </CardContent>
      </Card>)}
    </div>
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
        const files = pendingClips.map((item) => item.file);
        await saveBrowserProject(data, files);
        void requestPersistentStorage();
        await markBrowserProjectOpened(data.projectId);
        openBrowserProject(data, files); onOpen();
      })} />}
  </div>;
}
