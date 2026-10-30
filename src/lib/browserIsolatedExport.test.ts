import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withIsolatedBrowserExport } from './browserIsolatedExport';
import { clearDiagnostics, createDiagnosticReport } from './diagnostics';

const singleton = vi.hoisted(() => ({ getFFmpeg: vi.fn(), resetFFmpeg: vi.fn() }));
vi.mock('./ffmpegSingleton', () => singleton);

function engine() {
  return {
    on: vi.fn(), off: vi.fn(), exec: vi.fn<(args: string[]) => Promise<number>>().mockResolvedValue(0), ffprobe: vi.fn(async () => -1),
    writeFile: vi.fn<(name: string, data: Uint8Array) => Promise<boolean>>().mockResolvedValue(true), deleteFile: vi.fn(async () => true),
    readFile: vi.fn(async (name: string) => name.startsWith('source-probe_')
      ? new TextEncoder().encode(JSON.stringify({ streams: [{ codec_type: 'video', width: 1440, height: 900 }] }))
      : new Uint8Array([1, 2, 3])),
    createDir: vi.fn(async () => true), deleteDir: vi.fn(async () => true),
    mount: vi.fn<(type: string, options: unknown, directory: string) => Promise<boolean>>().mockResolvedValue(true), unmount: vi.fn(async () => true),
  };
}
let engines: ReturnType<typeof engine>[];
beforeEach(() => {
  engines = [];
  vi.stubGlobal('window', { location: { href: 'https://example.test/' } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([7]))));
  singleton.getFFmpeg.mockImplementation(async () => { const instance = engine(); engines.push(instance); return instance; });
});
afterEach(() => { clearDiagnostics(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

it('uses separate workers for probing, each clip, and final assembly with Blob-mounted completed inputs', async () => {
  const file = new File(['original'], 'private-match.mp4');
  const arrayBuffer = vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('Original must not be copied'));
  const output = await withIsolatedBrowserExport([file], undefined, async (io) => {
    const input = await io.loadSource(0);
    await io.probe(input);
    for (let i = 0; i < 2; i++) await io.exec(['-i', input, '-vf', `drawtext=fontfile=${io.fontName}`, `part_${i}.mp4`], undefined, { stage: 'clip', pieceIndex: i + 1 });
    await io.write('concat.txt', new TextEncoder().encode("file 'part_1.mp4'\nfile 'part_0.mp4'"));
    await io.exec(['-i', 'concat.txt', '-c', 'copy', 'export.mp4'], undefined, { stage: 'concat' });
    return io.read('export.mp4');
  });
  expect([...output]).toEqual([1, 2, 3]);
  expect(engines).toHaveLength(4);
  expect(engines[0].exec).not.toHaveBeenCalled();
  expect(engines.slice(1).every(instance => instance.exec.mock.calls.length === 1)).toBe(true);
  expect(singleton.resetFFmpeg.mock.calls.map(([instance]) => instance)).toEqual(engines);
  expect(arrayBuffer).not.toHaveBeenCalled();
  const final = engines[3];
  const mount = final.mount.mock.calls[0];
  expect(mount[2]).toBe('/completed');
  const blobs = (mount[1] as { blobs: { name: string; data: Blob }[] }).blobs;
  expect(blobs.map(entry => entry.name)).toEqual(['part_0.mp4', 'part_1.mp4']);
  expect(blobs.every(entry => entry.data instanceof Blob)).toBe(true);
  const manifest = final.writeFile.mock.calls.find(([name]) => name === 'concat.txt')![1];
  expect(new TextDecoder().decode(manifest)).toBe("file '/completed/part_1.mp4'\nfile '/completed/part_0.mp4'");
  expect(final.unmount).toHaveBeenCalledWith('/completed');
});

it('retries only the failed clip in a new worker, including clip 47 in a long export', async () => {
  let crashed = false;
  singleton.getFFmpeg.mockImplementation(async () => {
    const instance = engine();
    instance.exec.mockImplementation(async (args) => {
      if (args.at(-1) === 'part_46.mp4' && !crashed) { crashed = true; throw new WebAssembly.RuntimeError('memory access out of bounds'); }
      return 0;
    });
    engines.push(instance); return instance;
  });
  await withIsolatedBrowserExport([new File(['match'], 'match.mp4')], undefined, async (io) => {
    const source = await io.loadSource(0);
    for (let i = 0; i < 55; i++) await io.exec(['-i', source, `part_${i}.mp4`], undefined, { stage: 'clip', selectionIndex: i + 1 });
    await io.write('concat.txt', new TextEncoder().encode(Array.from({ length: 55 }, (_, i) => `file 'part_${i}.mp4'`).join('\n')));
    await io.exec(['-i', 'concat.txt', 'export.mp4'], undefined, { stage: 'concat' });
  });
  const commands = engines.flatMap(instance => instance.exec.mock.calls.map(([args]) => args.at(-1)));
  expect(commands.filter(name => name === 'part_46.mp4')).toHaveLength(2);
  for (let i = 0; i < 55; i++) if (i !== 46) expect(commands.filter(name => name === `part_${i}.mp4`)).toHaveLength(1);
  expect(engines.every(instance => instance.exec.mock.calls.length === 1)).toBe(true);
  expect(singleton.resetFFmpeg).toHaveBeenCalledTimes(57);
  const report = await createDiagnosticReport();
  expect(report.events.find(event => event.code === 'piece.retry')).toMatchObject({ details: { selectionIndex: 47, nextAttempt: 2 } });
});

it('stops after two failed attempts and preserves the original exception', async () => {
  const crash = new WebAssembly.RuntimeError('out of bounds');
  singleton.getFFmpeg.mockImplementation(async () => { const instance = engine(); instance.exec.mockRejectedValue(crash); engines.push(instance); return instance; });
  await expect(withIsolatedBrowserExport([], undefined, io => io.exec(['gap.mp4'], undefined, { stage: 'gap' }))).rejects.toBe(crash);
  expect(engines).toHaveLength(2);
  expect(singleton.resetFFmpeg).toHaveBeenCalledTimes(2);
});

it('rejects empty output and retries it instead of retaining an unusable piece', async () => {
  singleton.getFFmpeg.mockImplementation(async () => { const instance = engine(); instance.readFile.mockResolvedValue(new Uint8Array()); engines.push(instance); return instance; });
  await expect(withIsolatedBrowserExport([], undefined, io => io.exec(['gap.mp4']))).rejects.toThrow('empty clip');
  expect(engines).toHaveLength(2);
});

it('cancels in a worker without starting a retry and permits the next export', async () => {
  const controller = new AbortController();
  let finish!: () => void;
  singleton.getFFmpeg.mockImplementationOnce(async () => {
    const instance = engine(); instance.exec.mockImplementation(() => new Promise(resolve => { finish = () => resolve(0); })); engines.push(instance); return instance;
  });
  const job = withIsolatedBrowserExport([], controller.signal, io => io.exec(['gap.mp4']));
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  controller.abort();
  await expect(job).rejects.toMatchObject({ name: 'AbortError' });
  expect(engines).toHaveLength(1);
  await withIsolatedBrowserExport([], undefined, io => io.exec(['gap.mp4']));
  finish(); await Promise.resolve(); await Promise.resolve();
  expect(engines).toHaveLength(2);
  expect(singleton.resetFFmpeg.mock.calls.map(([instance]) => instance)).toEqual(engines);
});

it('resolves a URL source once and mounts the same File across fresh workers', async () => {
  await withIsolatedBrowserExport(['blob:source'], undefined, async io => {
    const source = await io.loadSource(0);
    await io.probe(source);
    await io.exec(['-i', source, 'part_0.mp4']);
    await io.exec(['-i', source, 'part_1.mp4']);
  });
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === 'blob:source')).toHaveLength(1);
  const files = engines.map(instance => (instance.mount.mock.calls[0][1] as { blobs: { data: File }[] }).blobs[0].data);
  expect(files[0]).toBeInstanceOf(File);
  expect(files.every(file => file === files[0])).toBe(true);
});

it('keeps font bytes intact across worker transfers and retries', async () => {
  const transferred: number[] = [];
  singleton.getFFmpeg.mockImplementation(async () => {
    const instance = engine();
    instance.writeFile.mockImplementation(async (name, data) => {
      if (name === 'font.ttf') transferred.push(data.byteLength);
      // The real FFmpeg client transfers ownership, detaching this buffer.
      structuredClone(data, { transfer: [data.buffer as ArrayBuffer] });
      return true;
    });
    engines.push(instance); return instance;
  });
  await withIsolatedBrowserExport([], undefined, async io => {
    await io.exec(['-vf', 'drawtext=fontfile=font.ttf', 'part_0.mp4']);
    await io.exec(['-vf', 'drawtext=fontfile=font.ttf', 'part_1.mp4']);
  });
  expect(transferred).toEqual([1, 1]);
});
