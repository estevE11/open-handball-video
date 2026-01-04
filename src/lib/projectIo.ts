import type { ProjectData } from '@/types/project';
import { PROJECT_SCHEMA_VERSION, createEmptyProject } from '@/lib/projectDefaults';

export function downloadTextFile(filename: string, contents: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadProjectJson(data: ProjectData, filename = 'project.json') {
  downloadTextFile(filename, JSON.stringify(data, null, 2), 'application/json');
}

export async function readJsonFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text) as unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Very lightweight schema check to protect against obvious bad imports.
 * (We can harden this later with zod once UI is in place.)
 */
export function coerceProjectData(raw: unknown): ProjectData {
  if (!isObject(raw)) throw new Error('Invalid project file: expected an object');
  const v = raw.schemaVersion;
  if (v !== PROJECT_SCHEMA_VERSION) {
    throw new Error(`Unsupported project schemaVersion: ${String(v)}`);
  }

  // Merge over defaults to ensure required keys exist.
  const base = createEmptyProject();
  return {
    ...base,
    ...raw,
    schemaVersion: PROJECT_SCHEMA_VERSION,
  } as ProjectData;
}


