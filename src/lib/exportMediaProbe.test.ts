import { afterEach, expect, it, vi } from 'vitest';
import { probeExportMedia } from './exportMediaProbe';
import { clearDiagnostics, diagnosticHistory } from './diagnostics';

afterEach(() => clearDiagnostics());

it('records codecs, frame rates, pixel format and timing without container tags or filenames', async () => {
  const input = { streams: [{ codec_type: 'video', codec_name: 'h264', width: 1440, height: 900, pix_fmt: 'yuv420p',
    avg_frame_rate: '60000/1001', r_frame_rate: '60/1', time_base: '1/15360', tags: { title: 'Private tactics' } },
  { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 }],
  format: { duration: '3953.2', bit_rate: '1715000', format_name: 'mov,mp4,m4a,3gp,3g2,mj2', filename: '/Users/alice/private.mp4', tags: { artist: 'Private person' } } };
  const io = { ffprobe: vi.fn().mockResolvedValue(-1), deleteFile: vi.fn().mockResolvedValue(true),
    readFile: vi.fn().mockResolvedValue(new TextEncoder().encode(JSON.stringify(input))) };
  const media = await probeExportMedia(io, 'input.mp4', 'probe.json', 1);
  expect(media.streams[0]).toMatchObject({ codec_name: 'h264', width: 1440, height: 900, avg_frame_rate: '60000/1001', time_base: '1/15360' });
  expect(diagnosticHistory().context.exportMedia).toMatchObject({ source1: { sourceIndex: 1, exitCode: -1, format: { duration: '3953.2' } } });
  expect(JSON.stringify(diagnosticHistory())).not.toMatch(/Private|alice|tags|filename/);
  const args = io.ffprobe.mock.calls[0][0] as string[];
  expect(args[args.indexOf('-show_entries') + 1]).not.toMatch(/tags|filename/);
  expect(io.deleteFile).toHaveBeenCalledTimes(2);
});

it('retains the failing source and probe timing when the probe itself crashes', async () => {
  const crash = 'RuntimeError: index out of bounds';
  const io = { ffprobe: vi.fn().mockRejectedValue(crash), deleteFile: vi.fn().mockResolvedValue(true), readFile: vi.fn() };
  await expect(probeExportMedia(io, 'input', 'probe.json', 2)).rejects.toBe(crash);
  expect(diagnosticHistory().context.exportProbe).toMatchObject({ sourceIndex: 2, status: 'failed', elapsedMs: expect.any(Number) });
  expect(io.readFile).not.toHaveBeenCalled();
  expect(io.deleteFile).toHaveBeenCalledTimes(2);
});
