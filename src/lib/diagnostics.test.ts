// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEmptyProject } from '@/lib/projectDefaults';

let diagnostics: typeof import('./diagnostics');
beforeEach(async () => {
  vi.resetModules(); localStorage.clear();
  Object.defineProperty(navigator, 'storage', { configurable: true, value: {
    estimate: async () => ({ usage: 100, quota: 1000 }), persisted: async () => true, persist: async () => true,
  } });
  diagnostics = await import('./diagnostics');
});
afterEach(() => { diagnostics.flushDiagnostics(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('retains the original failure and safe metadata without including project contents', async () => {
  const project = createEmptyProject();
  project.videoMeta = { fileName: 'Private match.mp4', fileSize: 123, fileType: 'video/mp4', lastModified: 0 };
  project.mainLabels[0].name = 'Private tactics';
  const error = new DOMException('Not enough disk space', 'QuotaExceededError');
  await expect(diagnostics.traceDiagnosticTask('save', 'project.save', diagnostics.projectDiagnosticSummary(project), async () => { throw error; })).rejects.toBe(error);
  const report = await diagnostics.createDiagnosticReport(diagnostics.projectDiagnosticSummary(project));
  expect(report.events.at(-1)).toMatchObject({ area: 'save', code: 'project.save.failed', error: { name: 'QuotaExceededError', message: 'Not enough disk space' } });
  expect(report.storage).toMatchObject({ persistent: true, estimate: { usage: 100, quota: 1000 } });
  const json = JSON.stringify(report);
  expect(json).not.toContain('Private match'); expect(json).not.toContain('Private tactics');
  expect(report.project).toMatchObject({ mediaBytes: 123, clipCount: 1 });
});

it('redacts local paths, source URLs, credentials, and overlay text from traces', async () => {
  const error = new Error('Could not read file:///Users/alice/Private%20match.mp4?token=secret');
  error.stack = 'Error at https://example.com/assets/app.js:12:34\nhttps://example.com/app.js?token=secret:12\n/Users/alice/Documents/private.mp4';
  diagnostics.recordDiagnostic('error', 'export', 'failed', { token: 'secret', fileName: 'private.mp4', json: '{private project}' }, error);
  diagnostics.recordEngineLog("[fferr] drawtext=text='private label':fontfile=font.ttf");
  diagnostics.recordEngineLog('Contact user@example.com; Authorization: Bearer abcdef1234');
  const json = JSON.stringify(await diagnostics.createDiagnosticReport());
  for (const value of ['alice', 'private.mp4', 'private label', 'user@example.com', 'abcdef1234', '?token=secret', '{private project}']) expect(json).not.toContain(value);
  expect(json).toContain('[text overlay]');
  expect(json).toContain('[app script:app.js:12:34]');
});

it('bounds noisy history while retaining failures and skips frame progress logs', () => {
  const id = diagnostics.recordDiagnostic('error', 'save', 'failed', undefined, new Error('Important failure'));
  for (let i = 0; i < 200; i++) {
    diagnostics.recordDiagnostic('info', 'save', `saved.${i}`);
    diagnostics.recordEngineLog(`[fferr] frame=${i} fps=30`);
    diagnostics.recordEngineLog(`codec detail ${i}`);
  }
  const history = diagnostics.diagnosticHistory();
  expect(history.events.length).toBeLessThanOrEqual(120);
  expect(history.events.some(event => event.id === id)).toBe(true);
  expect(history.engineLogs).toHaveLength(80);
  expect(history.engineLogs.some(line => line.message.includes('frame='))).toBe(false);
});

it('keeps reports usable when local storage is full and persistence APIs are missing', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
  expect(() => diagnostics.recordDiagnostic('error', 'save', 'failed', undefined, new Error('Cannot save'))).not.toThrow();
  const report = await diagnostics.createDiagnosticReport();
  expect(report.storage).toMatchObject({ diagnosticHistory: 'memory', persistenceSupported: false, persistent: 'unsupported', estimate: 'unsupported' });
  expect(report.events.at(-1)?.message).toBe('Cannot save');
});

it('preserves diagnostic errors and engine output across a reload', async () => {
  const incidentId = diagnostics.recordDiagnostic('error', 'export', 'failed', { phase: 'Rendering gaps', ratio: 0.1 }, new Error('FFmpeg exit code 1'));
  diagnostics.recordEngineLog('Unknown encoder: libx264'); diagnostics.flushDiagnostics();
  vi.resetModules();
  const reloaded = await import('./diagnostics');
  const report = await reloaded.createDiagnosticReport(undefined, incidentId);
  expect(report.focusEventId).toBe(incidentId);
  expect(report.events.at(-1)).toMatchObject({ id: incidentId, details: { phase: 'Rendering gaps', ratio: 0.1 } });
  expect(report.engineLogs.at(-1)?.message).toBe('Unknown encoder: libx264');
});

it('does not hang while preparing a report when a browser storage query never settles', async () => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: () => new Promise(() => {}), persisted: async () => false } });
  const pending = diagnostics.createDiagnosticReport();
  await vi.advanceTimersByTimeAsync(1500);
  expect((await pending).storage).toMatchObject({ estimate: 'timed out', persistent: false });
});

it('captures uncaught failures without suppressing them and unregisters handlers', () => {
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const uninstall = diagnostics.installDiagnostics();
  const handler = add.mock.calls.find(([type]) => type === 'error')![1] as (event: ErrorEvent) => void;
  const event = new ErrorEvent('error', { error: new Error('Unhandled crash'), lineno: 12, colno: 9, cancelable: true });
  handler(event);
  expect(event.defaultPrevented).toBe(false);
  expect(diagnostics.diagnosticHistory().events.at(-1)).toMatchObject({ code: 'uncaught', details: { line: 12, column: 9 }, error: { message: 'Unhandled crash' } });
  uninstall();
  expect(remove).toHaveBeenCalledWith('error', handler);
});
