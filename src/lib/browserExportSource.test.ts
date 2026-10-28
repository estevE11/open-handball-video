import { afterEach, expect, it, vi } from 'vitest';
import { loadBrowserExportSource } from './browserExportSource';

const fetchFile = vi.hoisted(() => vi.fn(async () => new Uint8Array([1, 2, 3])));
vi.mock('@ffmpeg/util', () => ({ fetchFile }));
afterEach(() => vi.clearAllMocks());

function engine() {
  return { createDir: vi.fn().mockResolvedValue(true), deleteDir: vi.fn().mockResolvedValue(true),
    mount: vi.fn().mockResolvedValue(true), unmount: vi.fn().mockResolvedValue(true),
    writeFile: vi.fn().mockResolvedValue(true), deleteFile: vi.fn().mockResolvedValue(true) };
}

it('mounts local video for on-demand reads without allocating a complete input buffer', async () => {
  const io = engine();
  const file = new File(['video'], 'original.mov');
  const arrayBuffer = vi.spyOn(file, 'arrayBuffer');
  const source = await loadBrowserExportSource(io, file, 'input.mp4');
  expect(source.path).toBe('/source-input.mp4/input.mp4');
  expect(io.mount).toHaveBeenCalledWith('WORKERFS', { blobs: [{ name: 'input.mp4', data: file }] }, '/source-input.mp4');
  expect(arrayBuffer).not.toHaveBeenCalled();
  expect(fetchFile).not.toHaveBeenCalled();
  expect(io.writeFile).not.toHaveBeenCalled();
  await source.release();
  expect(io.unmount).toHaveBeenCalledExactlyOnceWith('/source-input.mp4');
  expect(io.deleteDir).toHaveBeenCalledExactlyOnceWith('/source-input.mp4');
});

it.each([false, 'throws'])('cleans up a failed file mount (%s) without copying the whole video', async (result) => {
  const io = engine();
  if (result === false) io.mount.mockResolvedValue(false);
  else io.mount.mockRejectedValue(new Error('mount failed'));
  await expect(loadBrowserExportSource(io, new File(['video'], 'original.mov'), 'input')).rejects.toThrow();
  expect(io.deleteDir).toHaveBeenCalledExactlyOnceWith('/source-input');
  expect(fetchFile).not.toHaveBeenCalled();
  expect(io.writeFile).not.toHaveBeenCalled();
});

it('retains URL source support and deletes the copied source after use', async () => {
  const io = engine();
  const source = await loadBrowserExportSource(io, 'blob:source', 'input.mp4');
  expect(fetchFile).toHaveBeenCalledWith('blob:source');
  expect(io.writeFile).toHaveBeenCalledWith('input.mp4', new Uint8Array([1, 2, 3]));
  await source.release();
  expect(io.deleteFile).toHaveBeenCalledExactlyOnceWith('input.mp4');
  expect(io.mount).not.toHaveBeenCalled();
});
