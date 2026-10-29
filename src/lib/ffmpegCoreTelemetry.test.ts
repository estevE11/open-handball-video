import { afterEach, expect, it, vi } from 'vitest';
import { instrumentFFmpegCore, type TelemetryCore } from './ffmpegCoreTelemetry.js';
import { clearDiagnostics, diagnosticWorker, exportFailureEvidence, recordWorkerTelemetry } from './diagnostics';

afterEach(() => clearDiagnostics());

function instrument(run: (core: TelemetryCore) => void, limit = 2_147_483_648) {
  const core: TelemetryCore = { HEAPU8: new Uint8Array(65536), ret: 0, exec: () => run(core), ffprobe: () => {},
    setLogger: vi.fn(), setProgress: vi.fn() };
  const samples: Record<string, unknown>[] = [];
  instrumentFFmpegCore(core, limit);
  core.setLogger(({ message }) => { samples.push(JSON.parse(message)); recordWorkerTelemetry(core, message); });
  return { core, samples };
}

it('captures allocated heap growth without claiming that capacity is live RAM usage', () => {
  const { core, samples } = instrument(core => { core.HEAPU8 = new Uint8Array(131072); });
  core.exec();
  expect(samples[0]).toMatchObject({ event: 'ready', wasmMemory: { capacityBytes: 65536, usedBytes: null } });
  expect(samples.at(-1)).toMatchObject({ event: 'command-end', wasmMemory: { capacityBytes: 131072, peakCapacityBytes: 131072,
    limitBytes: 2_147_483_648, usedBytes: null } });
  expect(diagnosticWorker(core)?.commandStart?.wasmMemory.capacityBytes).toBe(65536);
});

it('retains the original WebAssembly trap and does not call an out-of-bounds access OOM', () => {
  // A real WASM memory load outside a one-page memory, without allocating large buffers.
  const bytes = new Uint8Array([0,97,115,109,1,0,0,0, 1,5,1,96,0,1,127, 3,2,1,0, 5,4,1,1,1,1,
    7,8,1,4,102,97,105,108,0,0, 10,11,1,9,0,65,128,128,4,40,2,0,11]);
  const wasm = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports as { fail: () => number };
  const { core } = instrument(() => wasm.fail());
  expect(() => core.exec()).toThrow(WebAssembly.RuntimeError);
  expect(diagnosticWorker(core)?.failure).toMatchObject({ event: 'command-error', exception: { name: 'RuntimeError', stack: expect.any(String) } });
  expect(exportFailureEvidence(core, new WebAssembly.RuntimeError('memory access out of bounds'))).toMatchObject({
    category: 'wasm-runtime-trap', certainty: 'undetermined', explicitOomSignal: false, nearConfiguredHeapLimit: false });
});

it('recognizes an explicit OOM and preserves it if a later command only reports a generic trap', () => {
  const { core } = instrument(core => {
    core.onAbort?.('OOM');
    throw new WebAssembly.RuntimeError('Aborted(OOM)');
  });
  expect(() => core.exec()).toThrow('Aborted(OOM)');
  recordWorkerTelemetry(core, JSON.stringify({ telemetryVersion: 1, event: 'command-start', sequence: 2,
    commandKind: 'exec', wasmMemory: { capacityBytes: 65536, limitBytes: 2_147_483_648 } }));
  expect(exportFailureEvidence(core, 'RuntimeError: index out of bounds')).toMatchObject({
    category: 'out-of-memory', certainty: 'explicit-signal', explicitOomSignal: true, oomSignal: { abortReason: 'OOM' } });
});

it('keeps a bare normal-exit abort separate from allocation failures', () => {
  const { core, samples } = instrument(core => core.onAbort?.(''));
  core.exec();
  expect(samples.some(sample => sample.event === 'abort')).toBe(false);
  expect(exportFailureEvidence(core, 'exit code 1').explicitOomSignal).toBe(false);
});

it('reports logical mounted sizes separately from in-memory file buffers without disclosing names', () => {
  const workerfs = { stream_ops: {} };
  const { core, samples } = instrument(() => {});
  core.FS = {
    filesystems: { WORKERFS: workerfs }, streams: [null, {}, {}],
    readdir: (directory: string) => directory === '/' ? ['.', '..', 'private-output.mp4', 'source-private'] : ['private-source.mov'],
    stat: (name: string) => ({ mode: name === '/source-private' ? 0x4000 : 0x8000, size: name.endsWith('.mov') ? 847580621 : 100 }),
    lookupPath: (name: string) => ({ node: { stream_ops: name.endsWith('.mov') ? workerfs.stream_ops : {}, contents: new Uint8Array(120) } }),
  };
  core.exec();
  expect(samples.at(-1)).toMatchObject({ filesystem: { memfsFiles: 1, memfsLogicalBytes: 100, memfsBufferCapacityBytes: 120,
    mountedFiles: 1, mountedLogicalBytes: 847580621, openStreams: 2 } });
  expect(JSON.stringify(samples)).not.toContain('private');
});

it('does not alter an export when the telemetry receiver fails', () => {
  const { core } = instrument(() => {});
  core.setLogger(() => { throw new Error('Receiver failed'); });
  expect(() => core.exec()).not.toThrow();
});

it('treats proximity to the configured heap ceiling as evidence, not proof of OOM', () => {
  const engine = {};
  recordWorkerTelemetry(engine, JSON.stringify({ telemetryVersion: 1, event: 'command-error', sequence: 1, commandKind: 'exec',
    wasmMemory: { capacityBytes: 2_000_000_000, limitBytes: 2_147_483_648, usedBytes: 123 },
    exception: { name: 'RuntimeError', message: 'index out of bounds', stack: 'at /Users/alice/private.mp4', wasmFrames: ['wasm-function[123]:0x456', 'private label'] } }));
  const result = exportFailureEvidence(engine, 'RuntimeError: index out of bounds');
  expect(result).toMatchObject({ category: 'wasm-runtime-trap', certainty: 'undetermined', explicitOomSignal: false,
    nearConfiguredHeapLimit: true, wasmUsedBytes: null });
  expect(result.workerFailure?.exception?.wasmFrames).toEqual(['wasm-function[123]:0x456']);
  expect(JSON.stringify(result)).not.toContain('alice');
});
