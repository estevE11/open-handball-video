import type { LabelSet, MainLabel, ProjectData, SecondaryLabel } from '@/types/project';

/** Keep annotations on removed labels; retired labels cannot create new tags. */
export function projectWithLabelSet(project: ProjectData, labelSet: LabelSet): ProjectData {
  if (project.labelSetId && project.labelSetId !== labelSet.id) throw new Error('This video already has a label set. It cannot be changed.');
  const mainIds = new Set(labelSet.mainLabels.map((label) => label.id));
  const secondaryIds = new Set(labelSet.secondaryLabels.map((label) => label.id));
  const taggedMainIds = new Set(project.segments.map((segment) => segment.mainLabelId));
  const taggedSecondaryIds = new Set(project.segments.flatMap((segment) => segment.secondaryLabelIds));
  return { ...project, labelSetId: labelSet.id,
    mainLabels: [...labelSet.mainLabels, ...project.mainLabels.filter((label) => !mainIds.has(label.id) && taggedMainIds.has(label.id)).map((label) => ({ ...label, archived: true }))],
    secondaryLabels: [...labelSet.secondaryLabels, ...project.secondaryLabels.filter((label) => !secondaryIds.has(label.id) && taggedSecondaryIds.has(label.id)).map((label) => ({ ...label, archived: true }))],
  };
}


export function labelsEqual(left: (MainLabel | SecondaryLabel)[], right: (MainLabel | SecondaryLabel)[]) {
  return left.length === right.length && left.every((label, index) => {
    const a: Record<string, unknown> = label;
    const b: Record<string, unknown> = right[index];
    return Object.keys({ ...a, ...b }).every((key) => a[key] === b[key]);
  });
}

/** Move active labels without changing their IDs or discarding historical labels. */
export function moveLabelInOrder<T extends { id: string; archived?: boolean }>(labels: T[], id: string, targetId: string): T[] {
  const active = labels.filter((label) => !label.archived);
  const from = active.findIndex((label) => label.id === id);
  const to = active.findIndex((label) => label.id === targetId);
  if (from < 0 || to < 0 || from === to) return labels;
  const [label] = active.splice(from, 1);
  active.splice(to, 0, label);
  return [...active, ...labels.filter((label) => label.archived)];
}
