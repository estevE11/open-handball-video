import type { ProjectData } from '@/types/project';
import { coerceProjectData } from '@/lib/projectIo';

export type StoredProject = {
  id: string;
  json: string;
  name: string;
  updatedAtMs: number;
  lastOpenedAtMs?: number;
  videoBytes: number;
  jsonBytes: number;
};

let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('ohv.library.v1', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('projects', { keyPath: 'id' });
        request.result.createObjectStore('videos');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = undefined; };
        resolve(db);
      };
      request.onerror = () => { database = undefined; reject(request.error); };
      request.onblocked = () => { database = undefined; reject(new Error('Close other app tabs and retry opening storage.')); };
    });
  }
  return database;
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Storage transaction was cancelled.'));
    tx.onerror = () => reject(tx.error ?? new Error('Could not write browser storage.'));
  });
}
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function storageError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'Browser storage is full. Remove a stored video or delete a saved project to free space, then retry. Your last saved copy is unchanged.';
  }
  return error instanceof Error ? error.message : 'Browser storage is unavailable. Check your browser settings and retry.';
}

export async function listBrowserProjects(): Promise<StoredProject[]> {
  const db = await openDatabase();
  return (await result<StoredProject[]>(db.transaction('projects').objectStore('projects').getAll()))
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export async function loadBrowserProject(id: string): Promise<{ data: ProjectData; file?: File; files: File[] }> {
  const db = await openDatabase();
  const tx = db.transaction(['projects', 'videos']);
  const [project, blob] = await Promise.all([
    result<StoredProject | undefined>(tx.objectStore('projects').get(id)),
    result<Blob | Blob[] | undefined>(tx.objectStore('videos').get(id)),
  ]);
  if (!project) throw new Error('This project no longer exists. Refresh your library.');
  const data = coerceProjectData(JSON.parse(project.json));
  const blobs = blob ? (Array.isArray(blob) ? blob : [blob]) : [];
  const metadata = data.clips ?? (data.videoMeta ? [data.videoMeta] : []);
  if (blobs.length && blobs.length !== metadata.length) throw new Error('Some project clips are missing from storage. Restore the original clips.');
  const files = blobs.map((item, index) => new File([item], metadata[index].fileName, {
    type: metadata[index].fileType, lastModified: metadata[index].lastModified,
  }));
  return { data, file: files[0], files };
}

// Separate stores let autosave update only JSON, without rewriting large videos.
// Video imports/replacements commit both records atomically.
export async function saveBrowserProject(data: ProjectData, file?: File | File[]): Promise<void> {
  const files = file ? (Array.isArray(file) ? file : [file]) : undefined;
  if (files && (files.length !== (data.clips?.length ?? 1) || files.length === 0)) {
    throw new Error('Save all project clips together.');
  }
  if (files && data.clips && files.some((item, index) => item.name !== data.clips![index].fileName || item.size !== data.clips![index].fileSize)) {
    throw new Error('Clip files must match their saved order and metadata.');
  }
  const videoBytes = files?.reduce((sum, item) => sum + item.size, 0);
  const json = JSON.stringify(data);
  if (files) {
    // Check before the browser starts copying a potentially multi-GB video.
    const estimate = await navigator.storage?.estimate?.().catch(() => ({}));
    const { remainingBytes } = calculateCapacity([], estimate ?? {});
    if (remainingBytes !== null && (videoBytes ?? 0) + new Blob([json]).size > remainingBytes) {
      throw new DOMException('Insufficient browser storage for this video.', 'QuotaExceededError');
    }
  }
  const db = await openDatabase();
  const tx = db.transaction(['projects', 'videos'], 'readwrite');
  const done = completed(tx);
  const projects = tx.objectStore('projects');
  const previous = projects.get(data.projectId);
  previous.onsuccess = () => {
    const old = previous.result as StoredProject | undefined;
    const record: StoredProject = {
      id: data.projectId, json,
      name: data.clips && data.clips.length > 1 ? `${data.clips[0].fileName} (+${data.clips.length - 1} clips)` : data.videoMeta?.fileName ?? 'Untitled project',
      updatedAtMs: data.updatedAtMs,
      lastOpenedAtMs: old?.lastOpenedAtMs,
      videoBytes: videoBytes ?? old?.videoBytes ?? 0,
      jsonBytes: new Blob([json]).size,
    };
    projects.put(record);
    if (file) tx.objectStore('videos').put(file, data.projectId);
  };
  await done;
  window.dispatchEvent(new Event('ohv-storage-changed'));
}

/** Opening is tracked separately from edits, imports, and background saves. */
export async function markBrowserProjectOpened(id: string, openedAtMs = Date.now()) {
  const db = await openDatabase();
  const tx = db.transaction('projects', 'readwrite');
  const done = completed(tx);
  const projects = tx.objectStore('projects');
  const request = projects.get(id);
  request.onsuccess = () => {
    const project = request.result as StoredProject | undefined;
    if (!project) { tx.abort(); return; }
    projects.put({ ...project, lastOpenedAtMs: openedAtMs });
  };
  await done;
}

export function recommendSoftDelete(project: StoredProject, now = Date.now()) {
  return project.videoBytes > 0 && typeof project.lastOpenedAtMs === 'number'
    && now - project.lastOpenedAtMs >= 30 * 24 * 60 * 60 * 1000;
}

/** Release video storage without changing the project's JSON or original video metadata. */
export async function removeBrowserProjectVideo(id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(['projects', 'videos'], 'readwrite');
  const done = completed(tx);
  const projects = tx.objectStore('projects');
  const request = projects.get(id);
  request.onsuccess = () => {
    const project = request.result as StoredProject | undefined;
    if (project) projects.put({ ...project, videoBytes: 0 });
    tx.objectStore('videos').delete(id);
  };
  await done;
  window.dispatchEvent(new Event('ohv-storage-changed'));
}

export async function deleteBrowserProject(id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(['projects', 'videos'], 'readwrite');
  const done = completed(tx);
  tx.objectStore('projects').delete(id);
  tx.objectStore('videos').delete(id);
  await done;
  window.dispatchEvent(new Event('ohv-storage-changed'));
}

export function calculateCapacity(projects: StoredProject[], estimate: StorageEstimate) {
  const totalBytes = projects.reduce((sum, project) => sum + project.videoBytes + project.jsonBytes, 0);
  // Metadata-only imports are incomplete projects and would distort the forecast.
  const complete = projects.filter((project) => project.videoBytes > 0);
  const averageBytes = complete.length
    ? complete.reduce((sum, project) => sum + project.videoBytes + project.jsonBytes, 0) / complete.length
    : null;
  const usage = typeof estimate.usage === 'number' && Number.isFinite(estimate.usage) && estimate.usage >= 0 ? estimate.usage : null;
  const quota = typeof estimate.quota === 'number' && Number.isFinite(estimate.quota) && estimate.quota > 0 ? estimate.quota : null;
  const remainingBytes = quota !== null && usage !== null ? Math.max(0, quota - usage) : null;
  const projectsLeft = remainingBytes !== null && averageBytes !== null ? Math.floor(remainingBytes / averageBytes) : null;
  return { totalBytes, averageBytes, usage, quota, remainingBytes, projectsLeft };
}

export async function getBrowserCapacity() {
  const [projects, estimate, persistent] = await Promise.all([
    listBrowserProjects(),
    navigator.storage?.estimate?.().catch(() => ({})) ?? Promise.resolve({}),
    navigator.storage?.persisted?.().catch(() => false) ?? Promise.resolve(false),
  ]);
  return { ...calculateCapacity(projects, estimate), persistent };
}

export async function requestPersistentStorage(): Promise<boolean> {
  return navigator.storage?.persist?.().catch(() => false) ?? false;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length);
  return `${(bytes / 1024 ** exponent).toFixed(1)} ${units[exponent - 1]}`;
}

// Preserve the old browser-only autosave; remove it only after a successful import.
export async function migrateLegacyProject(): Promise<void> {
  const legacy = localStorage.getItem('ohv.project.v1');
  if (!legacy) return;
  const data = coerceProjectData(JSON.parse(legacy).state);
  if (data.videoMeta || data.segments.length) {
    const projects = await listBrowserProjects();
    if (!projects.some((project) => project.id === data.projectId)) await saveBrowserProject(data);
  }
  localStorage.removeItem('ohv.project.v1');
}
