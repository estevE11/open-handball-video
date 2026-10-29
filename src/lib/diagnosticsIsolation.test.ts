import { afterEach, expect, it, vi } from 'vitest';
import { runWasmExportCommand } from './exportProgress';
import { clearDiagnostics, diagnosticEngine, diagnosticHistory, exportFailureEvidence, recordEngineLog, setDiagnosticContext } from './diagnostics';
import { probeExportMedia } from './exportMediaProbe';

afterEach(() => clearDiagnostics());

it.each(['completed', 'failed', 'progress'])('keeps the newer command context after a late %s from an older engine', async (outcome) => {
  let finish!: (code: number) => void;
  let reject!: (reason: Error) => void;
  let progress: ((event: { time: number }) => void) | undefined;
  const old = { on: vi.fn((_event, callback) => { progress = callback; }), off: vi.fn(),
    exec: vi.fn(() => new Promise<number>((resolve, fail) => { finish = resolve; reject = fail; })) };
  const pending = runWasmExportCommand(old, [], undefined, { selectionIndex: 47 });
  const settled = outcome === 'failed' ? expect(pending).rejects.toThrow('Terminated old worker') : pending;
  const next = { on: vi.fn(), off: vi.fn(), exec: vi.fn(async () => 0) };
  await runWasmExportCommand(next, [], undefined, { selectionIndex: 1 });
  const newCommand = diagnosticHistory().context.exportCommand;
  if (outcome === 'progress') {
    progress?.({ time: 1_000_000 });
    expect(diagnosticHistory().context.exportCommand).toEqual(newCommand);
  }
  if (outcome === 'failed') reject(new Error('Terminated old worker'));
  else finish(0);
  await settled;
  expect(diagnosticHistory().context.exportCommand).toEqual(newCommand);
});

it('does not classify one engine as OOM based on another engine warning', () => {
  const old = {};
  setDiagnosticContext('exportCommand', { engineId: diagnosticEngine(old).engineId, commandId: 'old-command', status: 'running' });
  recordEngineLog('[stderr] Cannot allocate memory', diagnosticEngine(old).engineId);
  expect(exportFailureEvidence({}, new WebAssembly.RuntimeError('index out of bounds'))).toMatchObject({
    category: 'wasm-runtime-trap', explicitOomSignal: false,
  });
});

it('retains a probe OOM warning under its own engine and command when another engine has command context', () => {
  const old = {};
  const current = {};
  setDiagnosticContext('exportCommand', { engineId: diagnosticEngine(old).engineId, commandId: 'old-command', status: 'running' });
  setDiagnosticContext('exportProbe', { engineId: diagnosticEngine(current).engineId, commandId: 'new-probe', status: 'running' });
  recordEngineLog('[stderr] Cannot allocate memory', diagnosticEngine(current).engineId);
  expect(diagnosticHistory().engineLogs.at(-1)?.commandId).toBe('new-probe');
  expect(exportFailureEvidence(current, 'exit code -1', 'new-probe')).toMatchObject({ category: 'out-of-memory', explicitOomSignal: true });
  expect(exportFailureEvidence(old, 'exit code -1', 'old-command').explicitOomSignal).toBe(false);
});

it.each(['completed', 'failed'])('keeps the newer source metadata after an older probe %s', async (outcome) => {
  let finish!: () => void;
  let reject!: (reason: Error) => void;
  const media = new TextEncoder().encode(JSON.stringify({ streams: [{ codec_type: 'video', codec_name: 'h264' }] }));
  const old = { ffprobe: vi.fn(() => new Promise<number>((resolve, fail) => { finish = () => resolve(-1); reject = fail; })),
    readFile: vi.fn(async () => media), deleteFile: vi.fn(async () => true) };
  const pending = probeExportMedia(old, 'old-source', 'old-probe', 0);
  const settled = outcome === 'failed' ? expect(pending).rejects.toThrow('Terminated old probe') : pending;
  await Promise.resolve(); await Promise.resolve();
  const next = { ffprobe: vi.fn(async () => -1), readFile: vi.fn(async () => media), deleteFile: vi.fn(async () => true) };
  await probeExportMedia(next, 'new-source', 'new-probe', 1);
  const newProbe = diagnosticHistory().context.exportProbe;
  const newMedia = diagnosticHistory().context.exportMedia;
  if (outcome === 'failed') reject(new Error('Terminated old probe'));
  else finish();
  await settled;
  expect(diagnosticHistory().context.exportProbe).toEqual(newProbe);
  expect(diagnosticHistory().context.exportMedia).toEqual(newMedia);
});
