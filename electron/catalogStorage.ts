import fs from 'node:fs/promises';
import path from 'node:path';
import { applyLibraryChange, coerceCatalog, emptyCatalog } from './libraryCatalog.js';

export function createCatalogStorage(directory: string) {
  const file = path.join(directory, 'library-catalog.json');
  let writes = Promise.resolve();
  async function read() {
    try { return coerceCatalog(JSON.parse(await fs.readFile(file, 'utf8'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyCatalog(); throw error; }
  }
  return {
    read: async () => { await writes.catch(() => {}); return read(); },
    change: (change: unknown) => {
      const saved = writes.catch(() => {}).then(async () => {
        const catalog = applyLibraryChange(await read(), change);
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(file + '.tmp', JSON.stringify(catalog, null, 2), 'utf8');
        await fs.rename(file + '.tmp', file);
        return catalog;
      });
      writes = saved.then(() => {}, () => {});
      return saved;
    },
  };
}
