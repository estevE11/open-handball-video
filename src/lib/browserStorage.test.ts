import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@/lib/projectDefaults';
import { calculateCapacity, deleteBrowserProject, formatBytes, getBrowserCapacity, listBrowserProjects, loadBrowserProject, migrateLegacyProject, removeBrowserProjectVideo, saveBrowserProject, storageError, type StoredProject } from '@/lib/browserStorage';

const local = new Map<string, string>();
vi.stubGlobal('window', new EventTarget());
vi.stubGlobal('localStorage', {
  getItem: (key: string) => local.get(key) ?? null,
  setItem: (key: string, value: string) => local.set(key, value),
  removeItem: (key: string) => local.delete(key),
});

function fixture(name = 'match.mp4', size = 32) {
  const file = new File([new Uint8Array(size).fill(42)], name, { type: 'video/mp4', lastModified: 1000 });
  const data = createEmptyProject();
  data.videoMeta = { fileName: name, fileSize: file.size, fileType: file.type, lastModified: file.lastModified };
  return { data, file };
}

beforeEach(async () => {
  for (const project of await listBrowserProjects()) await deleteBrowserProject(project.id);
  local.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('browser project library', () => {
  it('restores original video bytes, metadata, and JSON after saving', async () => {
    const { data, file } = fixture();
    await saveBrowserProject(data, file);
    const restored = await loadBrowserProject(data.projectId);
    expect(restored.data).toEqual(data);
    expect(restored.file?.name).toBe(file.name);
    expect(restored.file?.lastModified).toBe(file.lastModified);
    expect(await restored.file?.arrayBuffer()).toEqual(await file.arrayBuffer());
  });

  it('autosaves labels/settings/segments without rewriting video', async () => {
    const { data, file } = fixture();
    await saveBrowserProject(data, file);
    data.settings.fps = 60;
    data.segments.push({ id: 'segment', mainLabelId: data.mainLabels[0].id, startTimeSec: 1, endTimeSec: 3, secondaryLabelIds: [], createdAtMs: 1000 });
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    await saveBrowserProject(data);
    expect(put).toHaveBeenCalledTimes(1);
    const restored = await loadBrowserProject(data.projectId);
    expect(restored.data).toEqual(data);
    expect(restored.file?.size).toBe(file.size);
  });

  it('keeps projects with duplicate video filenames separate', async () => {
    const a = fixture(); const b = fixture();
    b.data.settings.fps = 24;
    await saveBrowserProject(a.data, a.file);
    await saveBrowserProject(b.data, b.file);
    expect(await listBrowserProjects()).toHaveLength(2);
    expect((await loadBrowserProject(a.data.projectId)).data.settings.fps).toBe(30);
    expect((await loadBrowserProject(b.data.projectId)).data.settings.fps).toBe(24);
  });

  it('deletes both video and JSON and reclaims accounted space', async () => {
    const { data, file } = fixture();
    await saveBrowserProject(data, file);
    await deleteBrowserProject(data.projectId);
    expect(await listBrowserProjects()).toEqual([]);
    await expect(loadBrowserProject(data.projectId)).rejects.toThrow('no longer exists');
    await saveBrowserProject(data);
    expect((await loadBrowserProject(data.projectId)).file).toBeUndefined();
    expect((await listBrowserProjects())[0].videoBytes).toBe(0);
  });

  it('keeps the previous video and JSON when a replacement transaction aborts', async () => {
    const { data, file } = fixture();
    await saveBrowserProject(data, file);
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      const request = originalPut.apply(this, args);
      queueMicrotask(() => this.transaction.abort());
      return request;
    });
    const next = { ...data, settings: { fps: 120 } };
    await expect(saveBrowserProject(next, new File(['replacement'], 'new.mp4'))).rejects.toBeTruthy();
    const restored = await loadBrowserProject(data.projectId);
    expect(restored.data).toEqual(data);
    expect(await restored.file?.arrayBuffer()).toEqual(await file.arrayBuffer());
  });

  it('migrates legacy JSON once without overwriting newer library edits', async () => {
    const { data } = fixture();
    localStorage.setItem('ohv.project.v1', JSON.stringify({ state: data, version: 1 }));
    await migrateLegacyProject();
    expect((await loadBrowserProject(data.projectId)).data).toEqual(data);
    expect(localStorage.getItem('ohv.project.v1')).toBeNull();
    await saveBrowserProject({ ...data, settings: { fps: 60 } });
    localStorage.setItem('ohv.project.v1', JSON.stringify({ state: data, version: 1 }));
    await migrateLegacyProject();
    expect((await loadBrowserProject(data.projectId)).data.settings.fps).toBe(60);
    expect(await listBrowserProjects()).toHaveLength(1);
  });

  it('reports quota errors with an actionable recovery', () => {
    expect(storageError(new DOMException('full', 'QuotaExceededError'))).toContain('Remove a stored video');
  });
});

describe('capacity forecast', () => {
  const project = (videoBytes: number, jsonBytes: number): StoredProject => ({ id: 'test', json: '{}', name: 'test', updatedAtMs: 0, videoBytes, jsonBytes });
  it('uses remaining quota divided by average complete video plus JSON size', () => {
    const capacity = calculateCapacity([project(900, 100), project(2900, 100), project(0, 100)], { usage: 5000, quota: 16000 });
    expect(capacity).toMatchObject({ totalBytes: 4100, remainingBytes: 11000, averageBytes: 2000, projectsLeft: 5 });
  });
  it('handles an empty library, full storage, and unavailable estimates', () => {
    expect(calculateCapacity([], { usage: 0, quota: 100 }).projectsLeft).toBeNull();
    expect(calculateCapacity([project(10, 1)], { usage: 110, quota: 100 }).projectsLeft).toBe(0);
    expect(calculateCapacity([project(10, 1)], {}).remainingBytes).toBeNull();
    expect(calculateCapacity([project(10, 1)], { quota: 100 }).projectsLeft).toBeNull();
  });
  it('falls back to unknown when storage estimation is not supported', async () => {
    expect((await getBrowserCapacity()).remainingBytes).toBeNull();
  });
  it('formats zero and large sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
  });
});

it('switches projects without carrying video URLs, labels, or selection across', async () => {
  const { openBrowserProject } = await import('@/lib/browserProjectSession');
  const { useProjectStore } = await import('@/store/projectStore');
  const first = fixture(); const second = fixture('second.mp4');
  openBrowserProject(first.data, first.file);
  const oldUrl = useProjectStore.getState().session.videoSourceUrl;
  useProjectStore.getState().setSelectedSegmentId('old-segment');
  second.data.mainLabels = [];
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  openBrowserProject(second.data, second.file);
  expect(revoke).toHaveBeenCalledWith(oldUrl);
  expect(useProjectStore.getState().projectId).toBe(second.data.projectId);
  expect(useProjectStore.getState().mainLabels).toEqual([]);
  expect(useProjectStore.getState().selectedSegmentId).toBeNull();
  expect(useProjectStore.getState().session.videoFile?.name).toBe('second.mp4');
});

it('rejects malformed imports and strips fields that could overwrite store actions', async () => {
  const { coerceProjectData } = await import('@/lib/projectIo');
  const data = createEmptyProject();
  expect(() => coerceProjectData({ ...data, mainLabels: null })).toThrow('Invalid project');
  expect(() => coerceProjectData({ ...data, segments: [{ id: 'invalid' }] })).toThrow('Invalid project');
  expect(coerceProjectData({ ...data, resetProject: 'invalid', session: {} })).toEqual(data);
});

it('rejects an oversized video before any records are written', async () => {
  const original = navigator.storage;
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: async () => ({ quota: 100, usage: 90 }) } });
  try {
    const { data, file } = fixture('large.mp4', 200);
    await expect(saveBrowserProject(data, file)).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(await listBrowserProjects()).toEqual([]);
  } finally {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: original });
  }
});


it('removes only the video atomically, preserving JSON and other projects', async () => {
  const first = fixture(); const second = fixture('other.mp4');
  first.data.videoMeta = { ...first.data.videoMeta!, durationSec: 120, fps: 25 };
  first.data.settings.fps = 25;
  first.data.segments.push({ id: 's', mainLabelId: first.data.mainLabels[0].id, startTimeSec: 10, endTimeSec: 15, secondaryLabelIds: [], createdAtMs: 1 });
  await saveBrowserProject(first.data, first.file);
  await saveBrowserProject(second.data, second.file);
  const before = await listBrowserProjects();
  const changed = vi.fn();
  window.addEventListener('ohv-storage-changed', changed);
  try {
    await removeBrowserProjectVideo(first.data.projectId);
    const restored = await loadBrowserProject(first.data.projectId);
    expect(restored.data).toEqual(first.data);
    expect(restored.file).toBeUndefined();
    const after = await listBrowserProjects();
    expect(after.find((project) => project.id === first.data.projectId)).toEqual({
      ...before.find((project) => project.id === first.data.projectId), videoBytes: 0,
    });
    expect(calculateCapacity(before, {}).totalBytes - calculateCapacity(after, {}).totalBytes).toBe(first.file.size);
    expect((await loadBrowserProject(second.data.projectId)).file?.size).toBe(second.file.size);
    expect(changed).toHaveBeenCalledTimes(1);
    await removeBrowserProjectVideo(first.data.projectId);
    expect((await loadBrowserProject(first.data.projectId)).data).toEqual(first.data);
  } finally { window.removeEventListener('ohv-storage-changed', changed); }
});

it('keeps both video and size accounting when video removal aborts', async () => {
  const { data, file } = fixture();
  await saveBrowserProject(data, file);
  const originalDelete = IDBObjectStore.prototype.delete;
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementationOnce(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['delete']>) {
    const request = originalDelete.apply(this, args);
    queueMicrotask(() => this.transaction.abort());
    return request;
  });
  await expect(removeBrowserProjectVideo(data.projectId)).rejects.toBeTruthy();
  const restored = await loadBrowserProject(data.projectId);
  expect(restored.data).toEqual(data);
  expect(restored.file?.size).toBe(file.size);
  expect((await listBrowserProjects())[0].videoBytes).toBe(file.size);
});

it('persists, removes, and restores all ordered clips together without affecting JSON', async () => {
  const { withProjectClips, fileMeta } = await import('@/lib/clipTimeline');
  const files = [new File(['part-b'], 'b.mp4'), new File(['part-aaa'], 'a.mp4')];
  const data = withProjectClips(createEmptyProject(), files.map((file, index) => ({ ...fileMeta(file), id: `clip-${index}`, durationSec: 10 + index })));
  await saveBrowserProject(data, files);
  let restored = await loadBrowserProject(data.projectId);
  expect(restored.data.clips?.map((clip) => clip.fileName)).toEqual(['b.mp4', 'a.mp4']);
  expect(await Promise.all(restored.files.map((file) => file.text()))).toEqual(['part-b', 'part-aaa']);
  expect((await listBrowserProjects())[0].videoBytes).toBe(14);
  await saveBrowserProject({ ...data, settings: { fps: 60 } });
  expect((await loadBrowserProject(data.projectId)).files).toHaveLength(2);
  await removeBrowserProjectVideo(data.projectId);
  restored = await loadBrowserProject(data.projectId);
  expect(restored.files).toEqual([]);
  expect(restored.data.clips).toEqual(data.clips);
  expect(restored.data.settings.fps).toBe(60);
  await saveBrowserProject(restored.data, files);
  expect((await loadBrowserProject(data.projectId)).files).toHaveLength(2);
  await expect(saveBrowserProject(data, [files[0]])).rejects.toThrow('all project clips');
  expect((await loadBrowserProject(data.projectId)).files).toHaveLength(2);
});
