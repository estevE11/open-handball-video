import { expect, it, vi } from 'vitest';
import { monotonicProgress, nativeProgressParser } from '../../electron/exportProgress';
import { runWasmExportCommand, withNativeExportProgress } from '@/lib/exportProgress';

it('keeps progress finite, bounded and monotonic during retries', () => {
  const values: number[] = [];
  const report = monotonicProgress((_, value) => values.push(value));
  for (const value of [0, 0.4, 0.2, NaN, -1, Infinity, 2]) report('Rendering', value);
  expect(values).toEqual([0, 0.4, 0.4, 0.4, 1]);
});

it('parses native timestamps across arbitrary stdout chunks and ignores invalid times', () => {
  const times: number[] = [];
  const parse = nativeProgressParser((time) => times.push(time));
  parse('frame=20\nout_time_u'); parse('s=1250000\r\nout_time_us=N/A\n');
  parse('out_time_us=9223372036854776000\nout_time_us=-1\nout_time_us=2500000\nprogress=end\n');
  expect(times).toEqual([1.25, 2.5]);
});

it.each([0, 1])('removes WASM progress listeners after exit code %s', async (code) => {
  let listener: ((event: { time: number }) => void) | undefined;
  const io = { on: vi.fn((_event, callback) => { listener = callback; }), off: vi.fn(), exec: vi.fn(async () => {
    listener?.({ time: 9223372036854776000 }); listener?.({ time: 2500000 }); listener?.({ time: NaN }); return code;
  }) };
  const onTime = vi.fn();
  const job = runWasmExportCommand(io, [], onTime);
  if (code) await expect(job).rejects.toThrow('exit code 1'); else await job;
  expect(onTime.mock.calls).toEqual([[2.5]]);
  expect(io.off).toHaveBeenCalledWith('progress', listener);
});

it.each([false, true])('isolates native jobs and unsubscribes on failure=%s', async (fail) => {
  let listener: ((event: { exportId: string; phase: string; ratio: number }) => void) | undefined;
  const unsubscribe = vi.fn();
  vi.stubGlobal('window', { electron: { onExportProgress: (callback: typeof listener) => { listener = callback; return unsubscribe; } } });
  const values: number[] = [];
  try {
    const job = withNativeExportProgress(async (id) => {
      listener?.({ exportId: 'another-job', phase: 'Rendering', ratio: 0.8 });
      listener?.({ exportId: id, phase: 'Rendering', ratio: 0.3 });
      listener?.({ exportId: id, phase: 'Rendering', ratio: 0.1 });
      listener?.({ exportId: id, phase: 'Ready', ratio: 1 });
      if (fail) throw new Error('export failed');
      return new Uint8Array([1]);
    }, (_, value) => values.push(value));
    if (fail) await expect(job).rejects.toThrow('export failed'); else await job;
    expect(values).toEqual(fail ? [0, 0.3, 0.3, 0.99] : [0, 0.3, 0.3, 0.99, 1]);
    expect(unsubscribe).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});

it('cancels only the matching native job and waits for its cleanup', async () => {
  const controller = new AbortController();
  let reject!: (error: Error) => void;
  let id = '';
  const unsubscribe = vi.fn();
  const cancelExport = vi.fn(async (exportId) => { expect(exportId).toBe(id); reject(new Error('terminated')); });
  vi.stubGlobal('window', { electron: { cancelExport, onExportProgress: () => unsubscribe } });
  try {
    const job = withNativeExportProgress((exportId) => { id = exportId; return new Promise((_resolve, fail) => { reject = fail; }); }, undefined, controller.signal);
    controller.abort();
    await expect(job).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelExport).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});
