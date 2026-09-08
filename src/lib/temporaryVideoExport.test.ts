/// <reference types="node" />
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { readTemporaryVideoExport } from '../../electron/temporaryVideoExport';

it('returns completed bytes and removes its temporary directory', async () => {
  let output = '';
  const bytes = await readTemporaryVideoExport(async (outputPath) => {
    output = outputPath;
    await fs.writeFile(outputPath, new Uint8Array([1, 2, 3]));
  });
  expect([...bytes]).toEqual([1, 2, 3]);
  await expect(fs.stat(path.dirname(output))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['render', 'read'])('cleans up when %s fails', async (failure) => {
  let output = '';
  await expect(readTemporaryVideoExport(async (outputPath) => {
    output = outputPath;
    if (failure === 'render') {
      await fs.writeFile(outputPath, 'partial video');
      throw new Error('FFmpeg failed');
    }
    // No completed output simulates a failed read after the renderer resolves.
  })).rejects.toThrow(failure === 'render' ? 'FFmpeg failed' : 'ENOENT');
  await expect(fs.stat(path.dirname(output))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('isolates simultaneous exports', async () => {
  const directories: string[] = [];
  const results = await Promise.all([7, 9].map((value) => readTemporaryVideoExport(async (output) => {
    directories.push(path.dirname(output));
    await fs.writeFile(output, new Uint8Array([value]));
  })));
  expect(results.map((bytes) => [...bytes])).toEqual([[7], [9]]);
  expect(new Set(directories).size).toBe(2);
  for (const directory of directories) await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
});
