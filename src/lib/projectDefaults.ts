import type { MainLabel, ProjectData } from '@/types/project';
import { createId } from '@/lib/ids';

export const PROJECT_SCHEMA_VERSION = 1 as const;

export function getDefaultMainLabels(): MainLabel[] {
  return [
    {
      id: createId(),
      name: 'Attack',
      color: '#ef4444',
      preRollSec: 2,
      postRollSec: 3,
      hotkey: 'A',
    },
    {
      id: createId(),
      name: 'Defense',
      color: '#3b82f6',
      preRollSec: 2,
      postRollSec: 3,
      hotkey: 'D',
    },
  ];
}

export function createEmptyProject(): ProjectData {
  const now = Date.now();
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId: createId(),
    createdAtMs: now,
    updatedAtMs: now,
    videoMeta: null,
    mainLabels: getDefaultMainLabels(),
    secondaryLabels: [
      { id: createId(), name: 'Player #10', hotkey: '1' },
      { id: createId(), name: 'Player #9', hotkey: '2' },
    ],
    segments: [],
    settings: { fps: 30 },
  };
}


