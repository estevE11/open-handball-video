import fs from 'node:fs/promises';
import path from 'node:path';
import { coerceLabelSet } from './labelSets.js';

/** Serialize read/modify/write updates and replace the library atomically. */
export function createLabelSetLibrary(directory: string) {
  const target = path.join(directory, 'label-sets.json');
  let writes = Promise.resolve();
  async function read() {
    try {
      const raw: unknown = JSON.parse(await fs.readFile(target, 'utf8'));
      if (!Array.isArray(raw)) throw new Error('Invalid label set library.');
      return raw.map(coerceLabelSet);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  return {
    list: async () => { await writes.catch(() => {}); return read(); },
    save: (raw: unknown) => {
      const labelSet = coerceLabelSet(raw);
      writes = writes.catch(() => {}).then(async () => {
        await fs.mkdir(directory, { recursive: true });
        const next = [...(await read()).filter((set) => set.id !== labelSet.id), labelSet];
        await fs.writeFile(target + '.tmp', JSON.stringify(next, null, 2), 'utf8');
        await fs.rename(target + '.tmp', target);
      });
      return writes;
    },
  };
}
