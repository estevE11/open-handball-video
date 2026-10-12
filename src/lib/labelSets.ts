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
