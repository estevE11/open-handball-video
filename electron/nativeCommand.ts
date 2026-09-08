import { spawn } from 'node:child_process';
import { nativeProgressParser } from './exportProgress.js';
import { checkExportCancelled, exportCancelled } from './exportCancellation.js';

export function runNativeCommand(binary: string, args: string[], options: { cwd?: string; signal?: AbortSignal; onTime?: (seconds: number) => void } = {}) {
  checkExportCancelled(options.signal);
  return new Promise<string>((resolve, reject) => {
    const { signal, onTime } = options;
    const progress = nativeProgressParser(onTime ?? (() => {}));
    const command = onTime ? ['-progress', 'pipe:1', '-nostats', ...args] : args;
    const child = spawn(binary, command, { cwd: options.cwd });
    let stdout = ''; let stderr = '';
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      child.kill('SIGTERM');
      forceKill = setTimeout(() => child.kill('SIGKILL'), 1000);
      forceKill.unref();
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on('data', (data) => {
      if (signal?.aborted) return;
      if (onTime) progress(data.toString()); else stdout += data.toString();
    });
    child.stderr.on('data', (data) => { stderr = (stderr + data.toString()).slice(-6000); });
    child.on('error', reject);
    // Wait for process exit before removing output files, especially on Windows.
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (forceKill) clearTimeout(forceKill);
      if (signal?.aborted) reject(exportCancelled());
      else if (code === 0) resolve(stdout);
      else reject(new Error(`Video export failed (${code}): ${stderr}`));
    });
  });
}
