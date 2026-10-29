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
afterEach(() => { diagnostics.flushDiagnostics(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

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
  for (let i = 0; i < 700; i++) {
    diagnostics.recordDiagnostic('info', 'save', `saved.${i}`);
    diagnostics.recordEngineLog(`[fferr] frame=${i} fps=30`);
    diagnostics.recordEngineLog(`codec detail ${i}`);
  }
  const history = diagnostics.diagnosticHistory();
  expect(history.events.length).toBeLessThanOrEqual(600);
  expect(history.events.some(event => event.id === id)).toBe(true);
  expect(history.engineLogs).toHaveLength(240);
  expect(history.engineLogs.some(line => line.message.includes('frame='))).toBe(false);
});

it('retains every selected time range for a 55-clip export without label text or filenames', () => {
  const project = createEmptyProject();
  project.mainLabels[0].name = 'Private tactic';
  project.segments = Array.from({ length: 55 }, (_, index) => ({ id: String(index), name: 'Private clip title',
    startTimeSec: index * 20, endTimeSec: index * 20 + 10, mainLabelId: project.mainLabels[0].id, secondaryLabelIds: [], createdAtMs: 0 }));
  const plan = diagnostics.exportDiagnosticPlan(project, [...project.segments].reverse());
  expect(plan).toMatchObject({ totalCount: 55, capturedCount: 55, truncated: false });
  expect(plan.selection[46]).toMatchObject({ exportIndex: 47, timelineIndex: 9, startTimeSec: 160, endTimeSec: 170, hasCustomTitle: true });
  const json = JSON.stringify(plan);
  expect(json).not.toContain('Private');
});

it('captures split-match source ranges and explicitly marks a capped selection', () => {
  const project = createEmptyProject();
  project.clips = [0, 1].map(index => ({ id: String(index), fileName: 'Private video.mp4', fileSize: 10, fileType: 'video/mp4', lastModified: 0, durationSec: 10 }));
  const segment = { id: 's', startTimeSec: 8, endTimeSec: 12, mainLabelId: project.mainLabels[0].id, secondaryLabelIds: [], createdAtMs: 0 };
  const plan = diagnostics.exportDiagnosticPlan(project, Array.from({ length: 210 }, () => segment));
  expect(plan).toMatchObject({ totalCount: 210, capturedCount: 200, truncated: true });
  expect(plan.selection[0].sourceRanges).toEqual([{ sourceIndex: 0, startTimeSec: 8, endTimeSec: 10 }, { sourceIndex: 1, startTimeSec: 0, endTimeSec: 2 }]);
  expect(JSON.stringify(plan)).not.toContain('Private');
});

it('pins a failure snapshot and its engine output across retries and reloads', async () => {
  diagnostics.setDiagnosticContext('exportCommand', { commandId: 'first:47', engineId: 'first', status: 'running', selectionIndex: 47, startTimeSec: 3200, durationSec: 9 });
  diagnostics.recordEngineLog('Decoder warning', 'first');
  const incidentId = diagnostics.recordDiagnostic('error', 'export', 'export.failed', undefined, 'RuntimeError: index out of bounds');
  diagnostics.setDiagnosticContext('exportCommand', { commandId: 'second:1', engineId: 'second', selectionIndex: 1 });
  diagnostics.flushDiagnostics();
  vi.resetModules();
  const reloaded = await import('./diagnostics');
  const report = await reloaded.createDiagnosticReport(undefined, incidentId);
  expect(report.context.exportCommand).toMatchObject({ commandId: 'second:1' });
  const failure = report.events.find(event => event.id === incidentId)!;
  expect(failure.context).toMatchObject({ exportCommand: { commandId: 'first:47', selectionIndex: 47, startTimeSec: 3200, durationSec: 9 } });
  expect(failure.engineLogs?.[0]).toMatchObject({ message: 'Decoder warning', engineId: 'first', commandId: 'first:47' });
});

it('distinguishes unavailable memory from actual JS heap measurements', () => {
  vi.stubGlobal('performance', {});
  expect(diagnostics.diagnosticResources()).toMatchObject({ jsHeap: 'unavailable', wasmHeap: 'unavailable' });
  vi.stubGlobal('performance', { memory: { usedJSHeapSize: 100, totalJSHeapSize: 200, jsHeapSizeLimit: 1000 } });
  expect(diagnostics.diagnosticResources()).toMatchObject({ jsHeap: { usedBytes: 100, allocatedBytes: 200, limitBytes: 1000 }, wasmHeap: 'unavailable' });
  vi.stubGlobal('performance', { get memory() { throw new Error('Blocked'); } });
  expect(diagnostics.diagnosticResources()).toMatchObject({ jsHeap: 'unavailable' });
});

it('keeps repeated commands with different details and drops only harmless bare abort logs', () => {
  diagnostics.recordDiagnostic('info', 'export', 'ffmpeg.command_started', { commandId: 'one' });
  diagnostics.recordDiagnostic('info', 'export', 'ffmpeg.command_started', { commandId: 'two' });
  expect(diagnostics.diagnosticHistory().events).toHaveLength(2);
  diagnostics.recordEngineLog('[stderr] Aborted()');
  diagnostics.recordEngineLog('[stderr] Aborted(OOM)');
  expect(diagnostics.diagnosticHistory().engineLogs.map(line => line.message)).toEqual(['[stderr] Aborted(OOM)']);
});

it('bounds persisted expanded history while keeping the latest failure context', () => {
  diagnostics.setDiagnosticContext('exportCommand', { selectionIndex: 47, startTimeSec: 3200 });
  const incidentId = diagnostics.recordDiagnostic('error', 'export', 'export.failed', undefined, new Error('Crash'));
  for (let index = 0; index < 400; index++) diagnostics.recordDiagnostic('info', 'export', `detail.${index}`, { detail: 'a'.repeat(4000) });
  diagnostics.flushDiagnostics();
  expect(localStorage.getItem(diagnostics.DIAGNOSTICS_KEY)!.length).toBeLessThanOrEqual(1_000_000);
  expect(diagnostics.diagnosticHistory().events.find(event => event.id === incidentId)?.context).toMatchObject({ exportCommand: { selectionIndex: 47 } });
});

it('still reads version-one diagnostic history', async () => {
  localStorage.setItem(diagnostics.DIAGNOSTICS_KEY, JSON.stringify({ version: 1, events: [{ id: 'old', sessionId: 'old-session', time: new Date().toISOString(),
    level: 'error', area: 'export', code: 'export.failed', message: 'Old crash', count: 1 }], engineLogs: [] }));
  vi.resetModules();
  const reloaded = await import('./diagnostics');
  expect((await reloaded.createDiagnosticReport()).events[0].message).toBe('Old crash');
});

it('keeps a prepared report unchanged when the live context and duplicate events change', async () => {
  diagnostics.setDiagnosticContext('export', { operationId: 'first' });
  diagnostics.recordDiagnostic('info', 'export', 'test.event');
  const report = await diagnostics.createDiagnosticReport();
  diagnostics.setDiagnosticContext('export', { operationId: 'second' });
  diagnostics.recordDiagnostic('info', 'export', 'test.event');
  expect(diagnostics.diagnosticHistory().events[0].count).toBe(2);
  expect(report.events[0].count).toBe(1);
  expect(report.context.export).toMatchObject({ operationId: 'first' });
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
