import { coerceLabelSet } from '../../electron/labelSets';
import { applyLibraryChange, coerceCatalog, emptyCatalog, type LibraryChange } from '../../electron/libraryCatalog';
import { createId } from '@/lib/ids';
import type { LabelSet, ProjectData } from '@/types/project';
import { coerceProjectData } from '@/lib/projectIo';
import { projectDiagnosticSummary, recordDiagnostic, setDiagnosticContext, traceDiagnosticTask } from '@/lib/diagnostics';

export type StoredProject = {
  id: string;
  json: string;
  name: string;
  updatedAtMs: number;
  lastOpenedAtMs?: number;
  videoBytes: number;
  /** Immutable media reference; duplicates share bytes without sharing analysis. */
  videoKey?: string;
  jsonBytes: number;
};

let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('ohv.library.v1', 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos');
        if (!db.objectStoreNames.contains('labelSets')) db.createObjectStore('labelSets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('catalog')) db.createObjectStore('catalog');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = undefined; };
        resolve(db);
      };
      request.onerror = () => { database = undefined; recordDiagnostic('error', 'storage', 'database.open_failed', { version: 3 }, request.error); reject(request.error); };
      request.onblocked = () => { database = undefined; recordDiagnostic('warning', 'storage', 'database.upgrade_blocked', { version: 3 }); reject(new Error('Close other app tabs and retry opening storage.')); };
    });
  }
  return database;
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    let reported = false;
    const fail = () => {
      const error = tx.error ?? new Error('Storage transaction was cancelled.');
      if (!reported) recordDiagnostic('error', 'storage', 'transaction.failed', { stores: Array.from(tx.objectStoreNames), mode: tx.mode }, error);
      reported = true; reject(error);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = fail;
    tx.onerror = fail;
  });
}
function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { recordDiagnostic('error', 'storage', 'request.failed', undefined, request.error); reject(request.error); };
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
  const projects = (await result<StoredProject[]>(db.transaction('projects').objectStore('projects').getAll()))
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  setDiagnosticContext('library', { checkedAt: new Date().toISOString(), projectCount: projects.length,
    projectsWithMedia: projects.filter(project => project.videoBytes > 0).length });
  return projects;
}

export async function loadBrowserProject(id: string): Promise<{ data: ProjectData; file?: File; files: File[] }> {
  return traceDiagnosticTask('storage', 'project.load', {}, () => readBrowserProject(id));
}
async function readBrowserProject(id: string): Promise<{ data: ProjectData; file?: File; files: File[] }> {
  const db = await openDatabase();
  const tx = db.transaction(['projects', 'videos']);
  const project = await result<StoredProject | undefined>(tx.objectStore('projects').get(id));
  if (!project) throw new Error('This project no longer exists. Refresh your library.');
  const blob = project.videoBytes ? await result<Blob | Blob[] | undefined>(tx.objectStore('videos').get(project.videoKey ?? id)) : undefined;
  const data = coerceProjectData(JSON.parse(project.json));
  const blobs = blob ? (Array.isArray(blob) ? blob : [blob]) : [];
  if (!blobs.length && data.videoMeta) recordDiagnostic('warning', 'media', 'project.media_unavailable', { expectedStoredBytes: project.videoBytes, expectedClips: data.clips?.length ?? 1 });
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
  return traceDiagnosticTask('storage', 'project.save', { ...projectDiagnosticSummary(data), includesMedia: !!file }, () => writeBrowserProject(data, file));
}
async function writeBrowserProject(data: ProjectData, file?: File | File[]): Promise<void> {
  const files = file ? (Array.isArray(file) ? file : [file]) : undefined;
  if (files && (files.length !== (data.clips?.length ?? 1) || files.length === 0)) {
    throw new Error('Save all project clips together.');
  }
  if (files && data.clips && files.some((item, index) => item.name !== data.clips![index].fileName || item.size !== data.clips![index].fileSize)) {
    throw new Error('Clip files must match their saved order and metadata.');
  }
  const videoBytes = files?.reduce((sum, item) => sum + item.size, 0);
  const json = JSON.stringify(data);
  const nextVideoKey = files ? createId() : undefined;
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
      name: data.name ?? (data.clips && data.clips.length > 1 ? `${data.clips[0].fileName} (+${data.clips.length - 1} clips)` : data.videoMeta?.fileName ?? 'Untitled project'),
      updatedAtMs: data.updatedAtMs,
      lastOpenedAtMs: old?.lastOpenedAtMs,
      videoBytes: videoBytes ?? old?.videoBytes ?? 0,
      ...(nextVideoKey || old?.videoKey ? { videoKey: nextVideoKey ?? old?.videoKey } : {}),
      jsonBytes: new Blob([json]).size,
    };
    projects.put(record);
    if (files) {
      tx.objectStore('videos').put(file, nextVideoKey!);
      if (old?.videoBytes) releaseUnusedMedia(tx, old.videoKey ?? old.id, data.projectId);
    }
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
    if (project) {
      projects.put({ ...project, videoBytes: 0, videoKey: undefined });
      releaseUnusedMedia(tx, project.videoKey ?? id, id);
    }
  };
  await done;
  window.dispatchEvent(new Event('ohv-storage-changed'));
}

export async function deleteBrowserProject(id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(['projects', 'videos'], 'readwrite');
  const done = completed(tx);
  const request = tx.objectStore('projects').get(id);
  request.onsuccess = () => {
    const project = request.result as StoredProject | undefined;
    tx.objectStore('projects').delete(id);
    if (project?.videoBytes) releaseUnusedMedia(tx, project.videoKey ?? id, id);
  };
  await done;
  window.dispatchEvent(new Event('ohv-storage-changed'));
}

export function calculateCapacity(projects: StoredProject[], estimate: StorageEstimate) {
  const media = new Set<string>();
  const totalBytes = projects.reduce((sum, project) => {
    const key = project.videoKey ?? project.id;
    const bytes = media.has(key) ? 0 : project.videoBytes;
    media.add(key);
    return sum + bytes + project.jsonBytes;
  }, 0);
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
  if (!navigator.storage?.persist) { recordDiagnostic('warning', 'storage', 'persistence.unsupported'); return false; }
  try {
    const granted = await navigator.storage.persist();
    recordDiagnostic(granted ? 'info' : 'warning', 'storage', granted ? 'persistence.granted' : 'persistence.not_granted');
    return granted;
  } catch (error) { recordDiagnostic('warning', 'storage', 'persistence.request_failed', undefined, error); return false; }
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


export async function listBrowserLabelSets(): Promise<LabelSet[]> {
  const db = await openDatabase();
  const sets = await result<unknown[]>(db.transaction('labelSets').objectStore('labelSets').getAll());
  return sets.map(coerceLabelSet);
}

export async function saveBrowserLabelSet(raw: LabelSet): Promise<void> {
  const labelSet = coerceLabelSet(raw);
  const db = await openDatabase();
  const tx = db.transaction('labelSets', 'readwrite');
  const done = completed(tx);
  tx.objectStore('labelSets').put(labelSet);
  await done;
}

function releaseUnusedMedia(tx: IDBTransaction, key: string, excluding: string) {
  const request = tx.objectStore('projects').getAll();
  request.onsuccess = () => {
    if (!(request.result as StoredProject[]).some(project => project.id !== excluding && project.videoBytes > 0 && (project.videoKey ?? project.id) === key)) tx.objectStore('videos').delete(key);
  };
}
export async function duplicateBrowserProject(id: string, name: string): Promise<ProjectData> {
  if (!name.trim()) throw new Error('Enter a video name.');
  const db = await openDatabase();
  const tx = db.transaction('projects', 'readwrite');
  const done = completed(tx);
  let copy: ProjectData | undefined;
  let error: unknown;
  const request = tx.objectStore('projects').get(id);
  request.onsuccess = () => {
    try {
    const record = request.result as StoredProject | undefined;
    if (!record) { tx.abort(); return; }
    const original = coerceProjectData(JSON.parse(record.json));
    copy = { ...original, projectId: createId(), name: name.trim().slice(0, 200), createdAtMs: Date.now(), updatedAtMs: Date.now(),
      segments: original.segments.map(segment => ({ ...segment, id: createId() })) };
    delete copy.electronProjectKey;
    const json = JSON.stringify(copy);
    tx.objectStore('projects').put({ ...record, id: copy.projectId, name: copy.name!, json, jsonBytes: new Blob([json]).size,
      updatedAtMs: copy.updatedAtMs, lastOpenedAtMs: undefined, ...(record.videoBytes ? { videoKey: record.videoKey ?? id } : {}) });
    } catch (failure) { error = failure; tx.abort(); }
  };
  try { await done; } catch (failure) { throw error ?? failure; }
  window.dispatchEvent(new Event('ohv-storage-changed'));
  return copy!;
}
export async function getBrowserCatalog() {
  const db = await openDatabase();
  const raw = await result(db.transaction('catalog').objectStore('catalog').get('library'));
  return raw === undefined ? emptyCatalog() : coerceCatalog(raw);
}
export async function changeBrowserCatalog(change: LibraryChange) {
  const db = await openDatabase();
  const tx = db.transaction('catalog', 'readwrite');
  const done = completed(tx);
  let next = emptyCatalog();
  let error: unknown;
  const request = tx.objectStore('catalog').get('library');
  request.onsuccess = () => {
    try { next = applyLibraryChange(request.result === undefined ? emptyCatalog() : coerceCatalog(request.result), change); tx.objectStore('catalog').put(next, 'library'); }
    catch (failure) { error = failure; tx.abort(); }
  };
  try { await done; } catch (failure) { throw error ?? failure; }
  return next;
}
