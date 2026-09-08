import { expect, it, vi } from 'vitest';
import { renderClipExport, type ClipExportBackend, type ExportPiece } from '../../electron/clipExportCore';

function backend(): ClipExportBackend {
  return {
    fontName: 'font.ttf', loadSource: vi.fn(async (index) => `input-${index}`), releaseSource: vi.fn(async () => {}),
    probe: vi.fn(async () => ({ width: 1280, height: 720, hasAudio: true })),
    exec: vi.fn(async () => {}), write: vi.fn(async () => {}), read: vi.fn(async () => new Uint8Array([1, 2])), remove: vi.fn(async () => {}),
  };
}
const pieces: ExportPiece[] = [
  { sourceIndex: 0, startTimeSec: 8, endTimeSec: 10, segmentIndex: 0, primaryText: 'Attack' },
  { sourceIndex: 1, startTimeSec: 0, endTimeSec: 3, segmentIndex: 0, primaryText: 'Attack' },
  { sourceIndex: 0, startTimeSec: 9, endTimeSec: 10, segmentIndex: 1, primaryText: 'Defense' },
  { sourceIndex: 1, startTimeSec: 0, endTimeSec: 5, segmentIndex: 1, primaryText: 'Defense' },
];

it('loads each source once while keeping overlapping tags in export order', async () => {
  const io = backend();
  await renderClipExport(io, pieces, true);
  expect(io.loadSource).toHaveBeenCalledTimes(2);
  expect(io.releaseSource).toHaveBeenCalledTimes(2);
  const concat = vi.mocked(io.write).mock.calls.find(([name]) => name === 'concat.txt')![1];
  expect(new TextDecoder().decode(concat)).toBe("file 'part_0.mp4'\nfile 'part_1.mp4'\nfile 'gap.mp4'\nfile 'part_2.mp4'\nfile 'part_3.mp4'");
  expect(io.remove).toHaveBeenCalledWith('export.mp4');
  expect(io.remove).toHaveBeenCalledWith('gap.mp4');
});

it('releases the current source and partial output when encoding fails', async () => {
  const io = backend();
  vi.mocked(io.exec).mockRejectedValue(new Error('encoding failed'));
  await expect(renderClipExport(io, pieces, true)).rejects.toThrow('encoding failed');
  expect(io.releaseSource).toHaveBeenCalledWith('input-0');
  expect(io.remove).toHaveBeenCalledWith('part_0.mp4');
  expect(io.loadSource).toHaveBeenCalledTimes(1);
});

it('weights live progress by duration and reserves completion until download preparation', async () => {
  const io = backend();
  const events: { phase: string; ratio: number }[] = [];
  io.exec = async (_args, onTime) => { onTime?.(0.5); onTime?.(1); };
  await renderClipExport(io, pieces, true, (phase, ratio) => events.push({ phase, ratio }));
  expect(events.some((event) => event.phase === 'Rendering clip 1 of 4' && Math.abs(event.ratio - (0.1 + 0.5 / 11 * 0.75)) < 0.00001)).toBe(true);
  expect(events.map((event) => event.ratio)).toEqual(events.map((event) => event.ratio).sort((a, b) => a - b));
  expect(events.at(-1)).toEqual({ phase: 'Preparing download', ratio: 0.99 });
});
