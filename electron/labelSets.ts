export type MainLabel = {
  id: string;
  name: string;
  defaultName?: string;
  color: string;
  preRollSec: number;
  postRollSec: number;
  hotkey: string;
  /** Retained in project snapshots only, to keep historical tags readable. */
  archived?: boolean;
};
export type SecondaryLabel = { id: string; name: string; hotkey?: string; archived?: boolean };
export type LabelSet = { id: string; name: string; mainLabels: MainLabel[]; secondaryLabels: SecondaryLabel[]; updatedAtMs: number };

/** Shared validation for browser storage, imported projects, and desktop IPC. */
export function coerceLabelSet(raw: unknown): LabelSet {
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const text = (value: unknown): value is string => typeof value === 'string';
  const optionalText = (value: unknown) => value === undefined || text(value);
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (!object(raw) || !text(raw.id) || !raw.id || !text(raw.name) || !number(raw.updatedAtMs)
    || !Array.isArray(raw.mainLabels) || !raw.mainLabels.every((label: unknown) => object(label)
      && text(label.id) && !!label.id && text(label.name) && text(label.color) && text(label.hotkey)
      && optionalText(label.defaultName) && number(label.preRollSec) && number(label.postRollSec))
    || !Array.isArray(raw.secondaryLabels) || !raw.secondaryLabels.every((label: unknown) => object(label)
      && text(label.id) && !!label.id && text(label.name) && optionalText(label.hotkey))
    || new Set([...raw.mainLabels, ...raw.secondaryLabels].map((label) => label.id)).size !== raw.mainLabels.length + raw.secondaryLabels.length) {
    throw new Error('Invalid label set. Check its name, labels, hotkeys, and timing values.');
  }
  return {
    id: raw.id, name: raw.name, updatedAtMs: raw.updatedAtMs as number,
    mainLabels: raw.mainLabels.map((label) => ({ id: label.id, name: label.name, color: label.color,
      hotkey: label.hotkey.trim().slice(0, 1).toUpperCase(), preRollSec: label.preRollSec, postRollSec: label.postRollSec,
      ...(label.defaultName !== undefined ? { defaultName: label.defaultName } : {}),
    })),
    secondaryLabels: raw.secondaryLabels.map((label) => ({ id: label.id, name: label.name,
      ...(label.hotkey !== undefined ? { hotkey: label.hotkey.trim().slice(0, 1).toUpperCase() } : {}),
    })),
  };
}
