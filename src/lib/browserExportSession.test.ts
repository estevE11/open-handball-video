import { afterEach, expect, it, vi } from 'vitest';
import { withBrowserExport } from '@/lib/browserExportSession';
const engine = vi.hoisted(() => ({ getFFmpeg: vi.fn(), resetFFmpeg: vi.fn() }));
vi.mock('@/lib/ffmpegSingleton', () => engine);
afterEach(() => vi.resetAllMocks());

it('releases a completed engine and acquires a fresh one for the next export', async () => {
  const first = {};
  const next = {};
  engine.getFFmpeg.mockResolvedValueOnce(first).mockResolvedValueOnce(next);
  await expect(withBrowserExport(undefined, async (instance) => {
    expect(instance).toBe(first);
    expect(engine.resetFFmpeg).not.toHaveBeenCalled();
    return 'first';
  })).resolves.toBe('first');
  expect(engine.resetFFmpeg).toHaveBeenCalledExactlyOnceWith(first);
  await expect(withBrowserExport(undefined, async (instance) => {
    expect(instance).toBe(next);
    return 'next';
  })).resolves.toBe('next');
  expect(engine.resetFFmpeg.mock.calls).toEqual([[first], [next]]);
});

it('discards a failed engine without replacing the original error', async () => {
  const first = {};
  const crash = new WebAssembly.RuntimeError('index out of bounds');
  engine.getFFmpeg.mockResolvedValue(first);
  await expect(withBrowserExport(undefined, async () => { throw crash; })).rejects.toBe(crash);
  expect(engine.resetFFmpeg).toHaveBeenCalledExactlyOnceWith(first);
});

it.each(['load', 'render'])('cancels during %s and lets a new export run', async (phase) => {
  const controller = new AbortController();
  const first = {};
  let complete!: () => void;
  const pending = new Promise<void>((resolve) => { complete = resolve; });
  engine.getFFmpeg.mockReturnValue(phase === 'load' ? pending.then(() => first) : Promise.resolve(first));
  const work = vi.fn(async () => { await pending; return 'old'; });
  const job = withBrowserExport(controller.signal, work);
  await Promise.resolve(); await Promise.resolve();
  controller.abort();
  await expect(job).rejects.toMatchObject({ name: 'AbortError' });
  expect(engine.resetFFmpeg).toHaveBeenCalledOnce();
  const next = {};
  engine.getFFmpeg.mockResolvedValue(next);
  await expect(withBrowserExport(undefined, async () => 'new')).resolves.toBe('new');
  complete();
  await Promise.resolve();
  expect(engine.resetFFmpeg).toHaveBeenCalledTimes(2);
  expect(engine.resetFFmpeg).toHaveBeenLastCalledWith(next);
});
