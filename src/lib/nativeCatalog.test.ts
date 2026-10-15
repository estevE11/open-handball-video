import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createCatalogStorage } from '../../electron/catalogStorage';

it('serializes catalog changes, survives reopening, and leaves the last committed catalog intact on failure', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ohv-catalog-'));
  try {
    const storage = createCatalogStorage(directory);
    await Promise.all([
      storage.change({ kind: 'folder', folder: { id: 'season', name: '2026', parentId: null } }),
      storage.change({ kind: 'team', team: { id: 'club', name: 'Club A' } }),
    ]);
    const before = await storage.read();
    expect(before.folders[0].name).toBe('2026'); expect(before.teams[0].name).toBe('Club A');
    expect(await createCatalogStorage(directory).read()).toEqual(before);
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('Disk full'));
    await expect(storage.change({ kind: 'team', team: { id: 'club', name: 'Changed' } })).rejects.toThrow('Disk full');
    expect(await storage.read()).toEqual(before);
    rename.mockRestore();
    await storage.change({ kind: 'team', team: { id: 'club', name: 'New name' } });
    expect((await storage.read()).teams[0]).toEqual({ id: 'club', name: 'New name' });
  } finally { vi.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true }); }
});
