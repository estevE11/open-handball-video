import { fetchFile } from '@ffmpeg/util';

import { getFFmpeg } from '@/lib/ffmpegSingleton';

function parseRational(r: string | undefined): number | null {
  if (!r) return null;
  const parts = r.split('/');
  if (parts.length !== 2) return null;
  const num = Number(parts[0]);
  const den = Number(parts[1]);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  const v = num / den;
  if (!Number.isFinite(v) || v <= 0) return null;
  return v;
}

function roundFps(v: number): number {
  // keep 3 decimals so 30000/1001 stays 29.97 etc.
  return Math.round(v * 1000) / 1000;
}

export async function probeVideoFps(file: File): Promise<number | null> {
  const ffmpeg = await getFFmpeg();

  const inputName = `probe_${Date.now()}.mp4`;
  const outName = `probe_${Date.now()}.json`;

  // Best-effort cleanup.
  try {
    await ffmpeg.deleteFile(inputName);
  } catch {
    // ignore
  }
  try {
    await ffmpeg.deleteFile(outName);
  } catch {
    // ignore
  }

  await ffmpeg.writeFile(inputName, await fetchFile(file));

  // ffprobe: write json to file, then read it back
  await ffmpeg.ffprobe(
    [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=avg_frame_rate,r_frame_rate',
      '-of',
      'json',
      inputName,
      '-o',
      outName,
    ],
    30_000,
  );

  const raw = (await ffmpeg.readFile(outName)) as Uint8Array;
  const jsonText = new TextDecoder().decode(raw);
  const parsed = JSON.parse(jsonText) as {
    streams?: Array<{ avg_frame_rate?: string; r_frame_rate?: string }>;
  };

  const stream = parsed.streams?.[0];
  const avg = parseRational(stream?.avg_frame_rate);
  const r = parseRational(stream?.r_frame_rate);
  const fps = (avg && avg > 0 ? avg : r) ?? null;

  // Cleanup, but keep ffmpeg loaded.
  void ffmpeg.deleteFile(inputName);
  void ffmpeg.deleteFile(outName);

  if (!fps) return null;
  // Sanity range: typical sports footage.
  if (fps < 1 || fps > 240) return null;
  return roundFps(fps);
}


