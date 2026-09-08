import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ClipOrderDialog } from '@/components/app/ClipOrderDialog';
import { fileMeta, readVideoDuration, withProjectClips } from '@/lib/clipTimeline';
import type { VideoClip } from '@/types/project';
import { StorageStatus } from '@/components/app/StorageStatus';
import { createEmptyProject } from '@/lib/projectDefaults';
import { createId } from '@/lib/ids';
import { coerceProjectData, downloadProjectJson, readJsonFile } from '@/lib/projectIo';
import { openBrowserProject } from '@/lib/browserProjectSession';
import { deleteBrowserProject, formatBytes, listBrowserProjects, loadBrowserProject, migrateLegacyProject, removeBrowserProjectVideo, requestPersistentStorage, saveBrowserProject, storageError, type StoredProject } from '@/lib/browserStorage';

export function BrowserDashboard({ onOpen }: { onOpen: () => void }) {
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
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-3xl font-bold">Open Handball Video</h1>
        <p className="mt-2 text-muted-foreground">Add one video or several clips for a split match. Videos and projects stay in this browser.</p></div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => videoInput.current?.click()}>Add video</Button>
        <Button disabled={busy} variant="secondary" onClick={() => jsonInput.current?.click()}>Import project JSON</Button>
        <Button disabled={busy} variant="outline" onClick={() => void run(refresh)}>Refresh</Button>
      </div>
    </div>
    <StorageStatus />
    {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm">{error}</p>}
    <input ref={videoInput} type="file" multiple accept="video/*,.mp4,.mov,.webm,.mkv" className="hidden" aria-label="Add video file" onChange={(event) => {
      const files = Array.from(event.target.files ?? []); event.target.value = '';
      if (!files.length) return;
      if (files.length > 1) {
        setPendingClips(files.map((file) => ({ id: createId(), file }))); setError(''); return;
      }
      const file = files[0];
      void run(async () => {
        const data = createEmptyProject();
        data.videoMeta = { fileName: file.name, fileSize: file.size, fileType: file.type, lastModified: file.lastModified };
        await saveBrowserProject(data, file);
        void requestPersistentStorage();
        openBrowserProject(data, file); onOpen();
      });
    }} />
    <input ref={jsonInput} type="file" accept="application/json,.json" className="hidden" aria-label="Import project JSON file" onChange={(event) => {
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
      <p>No saved projects yet.</p><p className="mt-2 text-sm">Add a video to start analyzing, or import an existing project JSON.</p>
    </div>}
    {busy && <p role="status">Loading…</p>}
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => <Card key={project.id}>
        <CardHeader><CardTitle className="truncate text-base" title={project.name}>{project.name}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{formatBytes(project.videoBytes + project.jsonBytes)} · {new Date(project.updatedAtMs).toLocaleDateString()}</p>
          {!project.videoBytes && <p className="text-sm text-muted-foreground">Video not stored. Project data kept. Choose the original video when opening this project.</p>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void run(async () => {
              const { data, files } = await loadBrowserProject(project.id);
              openBrowserProject(data, files.length ? files : undefined); onOpen();
            })}>Open project</Button>
            <Button disabled={busy} variant="outline" onClick={() => downloadProjectJson(coerceProjectData(JSON.parse(project.json)), `${project.name}.json`)}>Export JSON</Button>
            {project.videoBytes > 0 && <Button disabled={busy} variant="outline" onClick={() => {
              if (window.confirm(`Remove the stored video clips for “${project.name}” to free ${formatBytes(project.videoBytes)}? All labels, segments, and settings will be kept. Keep your original video files to attach them again later.`)) {
                void run(async () => { await removeBrowserProjectVideo(project.id); await refresh(); });
              }
            }}>Remove video</Button>}
            <Button disabled={busy} variant="ghost" onClick={() => {
              if (window.confirm(`Delete “${project.name}” and its stored video from this browser?`)) {
                void run(async () => { await deleteBrowserProject(project.id); await refresh(); });
              }
            }}>Delete project</Button>
          </div>
        </CardContent>
      </Card>)}
    </div>
    {pendingClips.length > 0 && <ClipOrderDialog
      items={pendingClips.map((item) => ({ id: item.id, name: item.file.name }))}
      onChange={(ids) => setPendingClips(ids.map((id) => pendingClips.find((item) => item.id === id)!))}
      onCancel={() => { setPendingClips([]); setError(''); }} busy={busy} error={error}
      onStart={() => void run(async () => {
        const clips: VideoClip[] = [];
        for (const item of pendingClips) {
          try { clips.push({ ...fileMeta(item.file), id: item.id, durationSec: await readVideoDuration(item.file) }); }
          catch (err) { throw new Error(`${item.file.name}: ${storageError(err)}`); }
        }
        const data = withProjectClips(createEmptyProject(), clips);
        const files = pendingClips.map((item) => item.file);
        await saveBrowserProject(data, files);
        void requestPersistentStorage();
        openBrowserProject(data, files); onOpen();
      })} />}
  </div>;
}
