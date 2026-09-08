import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);

export async function probeNativeVideo(source: string, ffprobePath: string) {
  const input = source.startsWith('file:') ? fileURLToPath(source) : source;
  const { stdout } = await run(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=avg_frame_rate,r_frame_rate:format=duration', '-of', 'json', input]);
  const data = JSON.parse(stdout) as { streams?: { avg_frame_rate?: string; r_frame_rate?: string }[]; format?: { duration?: string } };
  const rational = (value?: string) => {
    const [n, d] = (value ?? '').split('/').map(Number);
    const fps = n / d;
    return Number.isFinite(fps) && fps > 0 ? fps : undefined;
  };
  if (!data.streams?.length) throw new Error('This file has no readable video stream.');
  const fps = rational(data.streams[0].avg_frame_rate) ?? rational(data.streams[0].r_frame_rate);
  const durationSec = Number(data.format?.duration);
  return { fps, durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : undefined };
}
