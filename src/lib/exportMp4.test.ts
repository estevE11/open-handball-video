import { afterEach, expect, it, vi } from 'vitest';
import { exportFilteredSegmentsToMp4 } from '@/lib/exportMp4';

const ffmpeg = vi.hoisted(() => ({
  writeFile: vi.fn(), deleteFile: vi.fn().mockResolvedValue(true), exec: vi.fn().mockResolvedValue(0),
  readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
}));
vi.mock('@/lib/ffmpegSingleton', () => ({ getFFmpeg: async () => ffmpeg }));
vi.mock('@ffmpeg/util', () => ({ fetchFile: async () => new Uint8Array([1]) }));
vi.stubGlobal('window', { location: { href: 'https://example.test/' } });
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
const segments = [{ id: 's', startTimeSec: 0, endTimeSec: 1, mainLabelId: 'label', secondaryLabelIds: [], createdAtMs: 0 }];
afterEach(() => { vi.clearAllMocks(); ffmpeg.exec.mockResolvedValue(0); });

it('frees temporary input, clips and completed output after export', async () => {
  const blob = await exportFilteredSegmentsToMp4(new File(['video'], 'video.mp4'), segments);
  expect(blob.size).toBe(3);
  expect(ffmpeg.deleteFile).toHaveBeenCalledWith('export.mp4');
  expect(ffmpeg.deleteFile).toHaveBeenCalledWith('clip_0.mp4');
  expect(ffmpeg.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/^input_/));
  expect(ffmpeg.deleteFile).toHaveBeenCalledWith('font.ttf');
});

it('reports nonzero FFmpeg exit codes and frees temporary files after failed export', async () => {
  ffmpeg.exec.mockResolvedValue(1);
  await expect(exportFilteredSegmentsToMp4(new File(['video'], 'video.mp4'), segments)).rejects.toThrow('exit code 1');
  expect(ffmpeg.deleteFile).toHaveBeenCalledWith(expect.stringMatching(/^input_/));
  expect(ffmpeg.deleteFile).toHaveBeenCalledWith('clip_0.mp4');
  expect(ffmpeg.deleteFile).toHaveBeenCalledWith('font.ttf');
});

it('renders an individual title large and its unchanged tag type small', async () => {
  await exportFilteredSegmentsToMp4(new File(['video'], 'video.mp4'), [{ ...segments[0], name: '3:2:1' }], 'export.mp4', {
    mainLabels: [{ id: 'label', name: 'Attack', defaultName: 'Attack', color: '#fff', hotkey: 'A', preRollSec: 1, postRollSec: 1 }],
  });
  const filters = ffmpeg.exec.mock.calls.flat().flat().filter((arg: string) => arg.includes('drawtext')).join(' ');
  expect(filters).toContain("text='3\\:2\\:1':x=30:y=30:fontsize=44");
  expect(filters).toContain("text='Attack':x=30:y=85:fontsize=22");
});

it('uses native export bytes directly without leaving an intermediate beside the source', async () => {
  const electron = { runNativeExport: vi.fn(async () => new Uint8Array([4, 5, 6])), readFile: vi.fn() };
  Object.assign(window, { electron });
  try {
    const blob = await exportFilteredSegmentsToMp4('file:///videos/match.mp4', segments);
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([4, 5, 6]);
    expect(electron.runNativeExport).toHaveBeenCalledWith({ inputPath: '/videos/match.mp4', segments, addGap: false, mainLabels: [] });
    expect(electron.readFile).not.toHaveBeenCalled();
  } finally { delete window.electron; }
});
