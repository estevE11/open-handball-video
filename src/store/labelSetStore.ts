import { create } from 'zustand';
import { recordDiagnostic } from '@/lib/diagnostics';
import { coerceLabelSet } from '../../electron/labelSets';
import { createEmptyProject } from '@/lib/projectDefaults';
import { createId } from '@/lib/ids';
import { listBrowserLabelSets, listBrowserProjects, saveBrowserLabelSet, storageError } from '@/lib/browserStorage';
import { coerceProjectData } from '@/lib/projectIo';
import { labelsEqual, projectWithLabelSet } from '@/lib/labelSets';
import type { LabelSet, MainLabel, ProjectData, SecondaryLabel } from '@/types/project';

export const DEFAULT_LABEL_SET_ID = 'default-handball';
let loading: Promise<void> | undefined;
let writes: Promise<void> = Promise.resolve();

export const useLabelSetStore = create<{
  sets: LabelSet[]; loaded: boolean; pending: number; error: string;
}>(() => ({ sets: [], loaded: false, pending: 0, error: '' }));

export async function loadLabelSets() {
  if (useLabelSetStore.getState().loaded) return;
  if (!loading) {
    loading = (async () => {
      try {
        const raw = window.electron ? await window.electron.getLabelSets() : await listBrowserLabelSets();
        const sets = raw.map(coerceLabelSet);
        useLabelSetStore.setState({ sets, error: '' });
        if (!sets.length) {
          const data = createEmptyProject();
          await saveLabelSet({ id: DEFAULT_LABEL_SET_ID, name: 'Default handball labels',
            mainLabels: data.mainLabels, secondaryLabels: data.secondaryLabels, updatedAtMs: Date.now() });
        }
        const projects = window.electron ? await window.electron.getSavedProjects()
          : (await listBrowserProjects()).map((project) => { try { return JSON.parse(project.json) as unknown; } catch { return null; } });
        for (const raw of projects) {
          let project: ProjectData;
          try { project = coerceProjectData(raw); } catch { continue; }
          const id = project.labelSetId ?? `legacy-${project.projectId}`;
          if (!useLabelSetStore.getState().sets.some((set) => set.id === id)) {
            await saveLabelSet({ id, name: project.videoMeta?.fileName ?? 'Imported label set',
              mainLabels: project.mainLabels.filter((label) => !label.archived),
              secondaryLabels: project.secondaryLabels.filter((label) => !label.archived), updatedAtMs: Date.now() });
          }
        }
        useLabelSetStore.setState({ loaded: true });
      } catch (error) { recordDiagnostic('error', 'storage', 'label_sets.load_failed', undefined, error); useLabelSetStore.setState({ error: storageError(error) }); throw error; }
      finally { loading = undefined; }
    })();
  }
  return loading;
}

export function saveLabelSet(raw: LabelSet): Promise<void> {
  const labelSet = coerceLabelSet(raw);
  const electron = window.electron;
  // Queue before notifying subscribers: project autosave waits for its shared set.
  writes = writes.catch(() => {}).then(async () => {
    try {
      if (electron) await electron.saveLabelSet(labelSet);
      else await saveBrowserLabelSet(labelSet);
      useLabelSetStore.setState({ error: '' });
    } catch (error) { recordDiagnostic('error', 'save', 'label_set.save_failed', undefined, error); useLabelSetStore.setState({ error: storageError(error) }); throw error; }
    finally { useLabelSetStore.setState((state) => ({ pending: state.pending - 1 })); }
  });
  useLabelSetStore.setState((state) => ({ sets: [...state.sets.filter((set) => set.id !== labelSet.id), labelSet], pending: state.pending + 1 }));
  return writes;
}

export function editLabelSet(id: string, change: Partial<Pick<LabelSet, 'name' | 'mainLabels' | 'secondaryLabels'>>) {
  const current = useLabelSetStore.getState().sets.find((set) => set.id === id);
  if (!current) return Promise.reject(new Error('This label set is unavailable. Please retry.'));
  return saveLabelSet({ ...current, ...change, updatedAtMs: Date.now() });
}

export function flushLabelSets() { return writes; }
export function updateLabelSetLabels(id: string, mainLabels: MainLabel[], secondaryLabels: SecondaryLabel[]) {
  const labelSet = useLabelSetStore.getState().sets.find((set) => set.id === id);
  if (!labelSet) return Promise.reject(new Error('This label set is unavailable. Please retry.'));
  const labels = { mainLabels: mainLabels.filter((label) => !label.archived), secondaryLabels: secondaryLabels.filter((label) => !label.archived) };
  if (labelsEqual(labels.mainLabels, labelSet.mainLabels) && labelsEqual(labels.secondaryLabels, labelSet.secondaryLabels)) return flushLabelSets();
  return saveLabelSet({ ...labelSet, ...labels, updatedAtMs: Date.now() });
}
export async function createLabelSet(name: string): Promise<LabelSet> {
  await loadLabelSets();
  const data = createEmptyProject();
  const labelSet = { id: createId(), name, mainLabels: data.mainLabels, secondaryLabels: data.secondaryLabels, updatedAtMs: Date.now() };
  await saveLabelSet(labelSet);
  return labelSet;
}

/** Migrate existing videos and restore missing imported sets from embedded labels. */
export async function resolveProjectLabelSet(project: ProjectData): Promise<ProjectData> {
  await loadLabelSets();
  const id = project.labelSetId ?? `legacy-${project.projectId}`;
  let labelSet = useLabelSetStore.getState().sets.find((set) => set.id === id);
  if (!labelSet) {
    labelSet = { id, name: project.videoMeta?.fileName ?? 'Imported label set',
      mainLabels: project.mainLabels.filter((label) => !label.archived), secondaryLabels: project.secondaryLabels.filter((label) => !label.archived), updatedAtMs: Date.now() };
    await saveLabelSet(labelSet);
  }
  return projectWithLabelSet(project, labelSet);
}
