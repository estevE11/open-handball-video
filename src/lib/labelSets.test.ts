// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import { coerceLabelSet } from '../../electron/labelSets';
import { createEmptyProject } from '@/lib/projectDefaults';
import { coerceProjectData } from '@/lib/projectIo';
import { moveLabelInOrder, projectWithLabelSet } from '@/lib/labelSets';
import { listBrowserLabelSets, loadBrowserProject, saveBrowserProject } from '@/lib/browserStorage';
import { flushLabelSets, loadLabelSets, resolveProjectLabelSet, saveLabelSet, useLabelSetStore } from '@/store/labelSetStore';
import type { LabelSet } from '@/types/project';

function fixture(): LabelSet {
  const project = createEmptyProject();
  return { id: project.projectId, name: 'Team A', mainLabels: project.mainLabels, secondaryLabels: project.secondaryLabels, updatedAtMs: 1 };
}
afterEach(async () => { await flushLabelSets().catch(() => {}); vi.restoreAllMocks(); vi.unstubAllGlobals(); useLabelSetStore.setState({ loaded: false, sets: [], pending: 0, error: '' }); });

it('adds label-set storage to an existing library without changing video bytes or analysis', async () => {
  vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('File', NodeFile);
  const project = createEmptyProject();
  const video = new Blob(['original-video']);
  project.videoMeta = { fileName: 'legacy.mp4', fileSize: video.size, fileType: 'video/mp4', lastModified: 1 };
  project.mainLabels[0].name = 'Old custom type';
  const json = JSON.stringify(project);
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('ohv.library.v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('projects', { keyPath: 'id' });
      request.result.createObjectStore('videos');
    };
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction(['projects', 'videos'], 'readwrite');
      tx.objectStore('projects').put({ id: project.projectId, json, name: 'legacy.mp4', updatedAtMs: project.updatedAtMs, videoBytes: video.size, jsonBytes: new Blob([json]).size });
      tx.objectStore('videos').put(video, project.projectId);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
  await saveLabelSet(fixture());
  const restored = await loadBrowserProject(project.projectId);
  expect(restored.data).toEqual(project);
  expect(await restored.file?.text()).toBe('original-video');
});

it('shares stable IDs, locks the chosen set, and retains the binding in project JSON', () => {
  const set = fixture();
  const first = projectWithLabelSet(createEmptyProject(), set);
  const second = projectWithLabelSet(createEmptyProject(), set);
  expect(first.mainLabels).toEqual(second.mainLabels);
  expect(first.secondaryLabels).toEqual(second.secondaryLabels);
  expect(coerceProjectData(JSON.parse(JSON.stringify(first))).labelSetId).toBe(set.id);
  expect(() => projectWithLabelSet(first, { ...set, id: 'another' })).toThrow('cannot be changed');
  expect(() => coerceProjectData({ ...first, labelSetId: {} })).toThrow('Invalid project label set');
});

it('updates shared definitions while preserving annotations on removed labels', () => {
  const set = fixture();
  const project = projectWithLabelSet(createEmptyProject(), set);
  project.segments = [{ id: 'event', name: 'Fast break', mainLabelId: set.mainLabels[0].id, secondaryLabelIds: [set.secondaryLabels[0].id], startTimeSec: 1, endTimeSec: 3, createdAtMs: 1 }];
  const renamed = { ...set, mainLabels: set.mainLabels.map((label) => ({ ...label, name: 'Updated', color: '#123456', preRollSec: 5 })) };
  const updated = projectWithLabelSet(project, renamed);
  expect(updated.mainLabels[0]).toMatchObject({ name: 'Updated', color: '#123456', preRollSec: 5 });
  const archived = projectWithLabelSet(updated, { ...renamed, mainLabels: [], secondaryLabels: [] });
  expect(archived.segments).toEqual(project.segments);
  expect(archived.mainLabels).toHaveLength(1);
  expect(archived.mainLabels[0]).toMatchObject({ id: set.mainLabels[0].id, name: 'Updated', archived: true });
  expect(archived.secondaryLabels[0]).toMatchObject({ id: set.secondaryLabels[0].id, archived: true });
  expect(coerceProjectData(archived).segments).toEqual(project.segments);
});

it('serializes rapid saves and reloads the latest shared definitions', async () => {
  const set = fixture();
  const next = { ...set, name: 'Updated team', mainLabels: set.mainLabels.map((label) => ({ ...label, name: 'Counterattack' })) };
  const first = saveLabelSet(set); const second = saveLabelSet(next);
  await Promise.all([first, second]);
  expect((await listBrowserLabelSets()).find((item) => item.id === set.id)).toEqual(coerceLabelSet(next));
  useLabelSetStore.setState({ sets: [], loaded: false });
  await loadLabelSets();
  expect(useLabelSetStore.getState().sets.find((item) => item.id === set.id)?.name).toBe('Updated team');
});

it('makes legacy project labels reusable without changing their original IDs or annotations', async () => {
  const project = createEmptyProject();
  project.videoMeta = { fileName: 'old-match.mp4', fileSize: 5, fileType: 'video/mp4', lastModified: 1 };
  project.mainLabels[0].name = 'Custom attack';
  project.segments = [{ id: 'event', mainLabelId: project.mainLabels[0].id, secondaryLabelIds: [project.secondaryLabels[0].id], startTimeSec: 1, endTimeSec: 2, createdAtMs: 1 }];
  await saveBrowserProject(project);
  await loadLabelSets();
  expect(useLabelSetStore.getState().sets.find((set) => set.id === `legacy-${project.projectId}`)?.mainLabels).toEqual(project.mainLabels);
  const migrated = await resolveProjectLabelSet(project);
  expect(migrated.labelSetId).toBe(`legacy-${project.projectId}`);
  expect(migrated.mainLabels).toEqual(project.mainLabels);
  expect(migrated.segments).toEqual(project.segments);
  const restored = await resolveProjectLabelSet({ ...migrated, labelSetId: 'imported-set' });
  expect(restored.labelSetId).toBe('imported-set');
  expect((await listBrowserLabelSets()).find((set) => set.id === 'imported-set')?.mainLabels).toEqual(project.mainLabels);
});

it('reports failed shared saves and allows retry without losing the editable set', async () => {
  const set = fixture();
  const save = vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined);
  window.electron = { saveLabelSet: save } as unknown as NonNullable<Window['electron']>;
  try {
    await expect(saveLabelSet(set)).rejects.toThrow('Disk full');
    expect(useLabelSetStore.getState().error).toBe('Disk full');
    expect(useLabelSetStore.getState().sets.find((item) => item.id === set.id)?.name).toBe(set.name);
    await saveLabelSet(set);
    expect(useLabelSetStore.getState()).toMatchObject({ error: '', pending: 0 });
    expect(save).toHaveBeenCalledTimes(2);
  } finally { delete window.electron; }
});


it('reorders active labels by ID without losing archived labels or mutating the original order', () => {
  const labels = [{ id: 'first' }, { id: 'retired', archived: true }, { id: 'second' }, { id: 'third' }];
  expect(moveLabelInOrder(labels, 'third', 'first').map((label) => label.id)).toEqual(['third', 'first', 'second', 'retired']);
  expect(labels.map((label) => label.id)).toEqual(['first', 'retired', 'second', 'third']);
  expect(moveLabelInOrder(labels, 'first', 'first')).toBe(labels);
  expect(moveLabelInOrder(labels, 'missing', 'first')).toBe(labels);
  expect(moveLabelInOrder(labels, 'retired', 'first')).toBe(labels);
  expect(moveLabelInOrder(labels, 'first', 'retired')).toBe(labels);
});
