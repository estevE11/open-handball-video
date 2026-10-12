import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createLabelSetLibrary } from '../../electron/labelSetLibrary';
import type { LabelSet } from '@/types/project';
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ohv-label-sets-'));
  directories.push(directory);
  const set: LabelSet = { id: 'team', name: 'Team labels', updatedAtMs: 1,
    mainLabels: [{ id: 'attack', name: 'Attack', hotkey: 'A', color: '#123456', preRollSec: 2, postRollSec: 3 }],
    secondaryLabels: [{ id: 'player', name: 'Player', hotkey: '1' }] };
  return { directory, set, library: createLabelSetLibrary(directory) };
}
it('persists concurrent desktop edits atomically and survives a new library instance', async () => {
  const { directory, set, library } = await fixture();
  expect(await library.list()).toEqual([]);
  await Promise.all([library.save(set), library.save({ ...set, id: 'other' }), library.save({ ...set, name: 'Updated team' })]);
  const sets = await createLabelSetLibrary(directory).list();
  expect(sets).toHaveLength(2);
  expect(sets.find((item) => item.id === set.id)?.name).toBe('Updated team');
  expect((await fs.readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
});
it('rejects invalid edits and preserves an unreadable desktop library', async () => {
  const { directory, set, library } = await fixture();
  await library.save(set);
  const file = path.join(directory, 'label-sets.json');
  const original = await fs.readFile(file, 'utf8');
  expect(() => library.save({ ...set, mainLabels: null })).toThrow('Invalid label set');
  expect(await fs.readFile(file, 'utf8')).toBe(original);
  await fs.writeFile(file, 'invalid json');
  await expect(library.save(set)).rejects.toThrow();
  expect(await fs.readFile(file, 'utf8')).toBe('invalid json');
});
