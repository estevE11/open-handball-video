import { afterEach, expect, it, vi } from 'vitest';
import { exportFilteredSegmentsToMp4 } from '@/lib/exportMp4';

const ffmpeg = vi.hoisted(() => ({
  on: vi.fn(), off: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn().mockResolvedValue(true), exec: vi.fn().mockResolvedValue(0),
  createDir: vi.fn(), deleteDir: vi.fn().mockResolvedValue(true), mount: vi.fn().mockResolvedValue(true), unmount: vi.fn(),
  readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}));
const resetFFmpeg = vi.hoisted(() => vi.fn());
vi.mock('@/lib/ffmpegSingleton', () => ({ getFFmpeg: async () => ffmpeg, resetFFmpeg }));
vi.mock('@ffmpeg/util', () => ({ fetchFile: async () => new Uint8Array([1]) }));
vi.stubGlobal('window', { location: { href: 'https://example.test/' } });
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
const segments = [{ id: 's', startTimeSec: 0, endTimeSec: 1, mainLabelId: 'label', secondaryLabelIds: [], createdAtMs: 0 }];
afterEach(() => { vi.clearAllMocks(); ffmpeg.exec.mockReset().mockResolvedValue(0); });

it('frees temporary input, clips and completed output after export', async () => {
  const blob = await exportFilteredSegmentsToMp4(new File(['video'], 'video.mp4'), segments);
  expect(blob.size).toBe(3);
  expect(ffmpeg.deleteFile).toHaveBeenCalledWith('export.mp4');
  expect(ffmpeg.deleteFile).toHaveBeenCalledWith('clip_0.mp4');
  expect(ffmpeg.unmount).toHaveBeenCalledWith(expect.stringMatching(/^\/source-input_/));
  expect(ffmpeg.unmount.mock.invocationCallOrder[0]).toBeLessThan(ffmpeg.exec.mock.invocationCallOrder[1]);
  expect(ffmpeg.writeFile.mock.calls.some(([name]) => /^input_/.test(name))).toBe(false);
  expect(resetFFmpeg).toHaveBeenCalledExactlyOnceWith(ffmpeg);
  expect(ffmpeg.deleteFile).toHaveBeenCalledWith('font.ttf');
});

it('reports nonzero FFmpeg exit codes and frees temporary files after failed export', async () => {
  ffmpeg.exec.mockResolvedValue(1);
  await expect(exportFilteredSegmentsToMp4(new File(['video'], 'video.mp4'), segments)).rejects.toThrow('exit code 1');
  expect(ffmpeg.unmount).toHaveBeenCalledWith(expect.stringMatching(/^\/source-input_/));
  expect(ffmpeg.deleteFile).toHaveBeenCalledWith('clip_0.mp4');
  expect(ffmpeg.deleteFile).toHaveBeenCalledWith('font.ttf');
});

it.each([new WebAssembly.RuntimeError('index out of bounds'), 'RuntimeError: index out of bounds'])(
  'discards a crashed engine without attempting stream-copy fallback (%s)', async (crash) => {
    ffmpeg.exec.mockRejectedValueOnce(crash);
    await expect(exportFilteredSegmentsToMp4(new File(['video'], 'video.mp4'), segments)).rejects.toBe(crash);
    expect(ffmpeg.exec).toHaveBeenCalledOnce();
    expect(resetFFmpeg).toHaveBeenCalledExactlyOnceWith(ffmpeg);
  },
);

it('keeps stream-copy fallback for an ordinary encoding exit failure', async () => {
  ffmpeg.exec.mockResolvedValueOnce(1);
  await exportFilteredSegmentsToMp4(new File(['video'], 'video.mp4'), segments);
  expect(ffmpeg.exec).toHaveBeenCalledTimes(3);
  expect(ffmpeg.exec.mock.calls[1][0]).toContain('copy');
});

it('does not retry concatenation after a runtime crash', async () => {
  const crash = 'RuntimeError: memory access out of bounds';
  ffmpeg.exec.mockResolvedValueOnce(0).mockRejectedValueOnce(crash);
  await expect(exportFilteredSegmentsToMp4(new File(['video'], 'video.mp4'), segments)).rejects.toBe(crash);
  expect(ffmpeg.exec).toHaveBeenCalledTimes(2);
  expect(resetFFmpeg).toHaveBeenCalledExactlyOnceWith(ffmpeg);
});

it('renders an individual title large and its unchanged tag type small', async () => {
  await exportFilteredSegmentsToMp4(new File(['video'], 'video.mp4'), [{ ...segments[0], name: '3:2:1' }], 'export.mp4', {
    mainLabels: [{ id: 'label', name: 'Attack', defaultName: 'Attack', color: '#fff', hotkey: 'A', preRollSec: 1, postRollSec: 1 }],
  });
  const filters = ffmpeg.exec.mock.calls.flat().flat().filter((arg: string) => arg.includes('drawtext')).join(' ');
  expect(filters).toContain("text='3\\:2\\:1':x=30:y=30:fontsize=44");
  expect(filters).toContain("text='Attack':x=30:y=85:fontsize=22");
});

it('renders and concatenates browser clips in the requested nonchronological order', async () => {
  const reordered = [
    { ...segments[0], id: 'later', startTimeSec: 20, endTimeSec: 21 },
    { ...segments[0], id: 'earlier', startTimeSec: 2, endTimeSec: 3 },
  ];
  await exportFilteredSegmentsToMp4(new File(['video'], 'video.mp4'), reordered);
  const cuts = ffmpeg.exec.mock.calls.map(([args]) => args as string[]).filter((args) => args.includes('-ss'));
  expect(cuts.map((args) => Number(args[args.indexOf('-ss') + 1]))).toEqual([20, 2]);
  const concat = ffmpeg.writeFile.mock.calls.find(([name]) => /^concat_.*\.txt$/.test(name))!;
  expect(new TextDecoder().decode(concat[1])).toBe("file 'clip_0.mp4'\nfile 'clip_1.mp4'");
  expect(reordered.map((seg) => seg.id)).toEqual(['later', 'earlier']);
});

it('uses native export bytes directly without leaving an intermediate beside the source', async () => {
  const electron = { onExportProgress: vi.fn(() => () => {}), runNativeExport: vi.fn(async () => new Uint8Array([4, 5, 6])), readFile: vi.fn() };
  Object.assign(window, { electron });
  try {
    const blob = await exportFilteredSegmentsToMp4('file:///videos/match%20%23100%25.mp4', segments);
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([4, 5, 6]);
    expect(electron.runNativeExport).toHaveBeenCalledWith({ exportId: expect.any(String), inputPath: 'file:///videos/match%20%23100%25.mp4', segments, addGap: false, mainLabels: [] });
    expect(electron.readFile).not.toHaveBeenCalled();
  } finally { delete window.electron; }
});
