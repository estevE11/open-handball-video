/// <reference types="node" />
import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, it } from 'vitest';
import { runNativeCommand } from '../../electron/nativeCommand';
import { readTemporaryVideoExport } from '../../electron/temporaryVideoExport';

it('stops a running process, waits for exit, removes partial output, and allows retry', async () => {
  const controller = new AbortController();
  let output = '';
  const job = readTemporaryVideoExport(async (file) => {
    output = file;
    await fs.writeFile(file, 'partial');
    const process = runNativeCommand(globalThis.process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await process;
  }, controller.signal);
  await expect(job).rejects.toMatchObject({ name: 'AbortError' });
  await expect(fs.stat(path.dirname(output))).rejects.toMatchObject({ code: 'ENOENT' });
  const bytes = await readTemporaryVideoExport(async (file) => { await fs.writeFile(file, 'ready'); });
  expect(bytes.toString()).toBe('ready');
}, 5000);
