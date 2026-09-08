import { spawn } from 'node:child_process';
import { readTemporaryVideoExport } from './temporaryVideoExport.js';
import { getSegmentTitles } from './segmentTitles.js';

export type NativeSingleExportOptions = {
  inputPath: string;
  segments: { name?: string; mainLabelId: string; startTimeSec: number; endTimeSec: number }[];
  mainLabels: { id: string; name: string }[];
  addGap: boolean;
};
type NativeExportConfig = { ffmpegPath: string; ffprobePath: string; fontPath: string };

export async function nativeSingleExport(opts: NativeSingleExportOptions, config: NativeExportConfig) {
  return readTemporaryVideoExport((outputPath) => renderNativeSingleExport({ ...opts, outputPath }, config));
}

async function renderNativeSingleExport(
  { inputPath, outputPath, segments, addGap, mainLabels }: NativeSingleExportOptions & { outputPath: string },
  { ffmpegPath, ffprobePath, fontPath }: NativeExportConfig,
) {
  function run(binary: string, args: string[]) {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(binary, args);
      let stdout = ''; let stderr = '';
      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr = (stderr + data.toString()).slice(-6000); });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`Video export failed (${code}): ${stderr}`)));
    });
  }
  if (!segments.length) throw new Error('No segments to export.');
  const probe = JSON.parse(await run(ffprobePath, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,sample_rate', '-of', 'json', inputPath])) as {
    streams: { codec_type: string; width?: number; height?: number; sample_rate?: string }[];
  };
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  if (!video?.width || !video.height) throw new Error('This source has no readable video stream.');
  const { width, height } = video;
  const audio = probe.streams.find((stream) => stream.codec_type === 'audio');
  const hasAudio = !!audio;
  const sampleRate = Number(audio?.sample_rate) || 48000;
  const hasDrawtext = (await run(ffmpegPath, ['-filters'])).includes('drawtext');
  const args = ['-hide_banner', '-y', '-i', inputPath];
  
  let filterComplex = '';
  const concatInputs: string[] = [];

  segments.forEach((seg, i) => {
    const label = mainLabels.find((l) => l.id === seg.mainLabelId);
    const { primaryText, secondaryText } = getSegmentTitles(seg, label);

    let overlayFilter = '';
    if (hasDrawtext) {
      const pText = primaryText.replace(/'/g, "'\\\\''").replace(/:/g, '\\:');
      const sText = secondaryText ? secondaryText.replace(/'/g, "'\\\\''").replace(/:/g, '\\:') : '';

      overlayFilter = `,drawtext=fontfile='${fontPath}':expansion=none:text='${pText}':x=30:y=30:fontsize=44:fontcolor=white:shadowcolor=black@0.6:shadowx=2:shadowy=2`;
      if (secondaryText) {
        overlayFilter += `,drawtext=fontfile='${fontPath}':expansion=none:text='${sText}':x=30:y=85:fontsize=22:fontcolor=white:shadowcolor=black@0.6:shadowx=2:shadowy=2`;
      }
    }

    filterComplex += `[0:v]trim=start=${seg.startTimeSec}:end=${seg.endTimeSec},setpts=PTS-STARTPTS${overlayFilter}[v${i}]; `;
    filterComplex += hasAudio
      ? `[0:a]atrim=start=${seg.startTimeSec}:end=${seg.endTimeSec},asetpts=PTS-STARTPTS[a${i}]; `
      : `anullsrc=r=${sampleRate}:cl=stereo:d=${seg.endTimeSec - seg.startTimeSec},asetpts=PTS-STARTPTS[a${i}]; `;
    
    concatInputs.push(`[v${i}][a${i}]`);

    if (addGap && i < segments.length - 1) {
      filterComplex += `color=c=black:s=${width}x${height}:d=0.5,setpts=PTS-STARTPTS[vg${i}]; `;
      filterComplex += `anullsrc=r=${sampleRate}:cl=stereo:d=0.5,asetpts=PTS-STARTPTS[ag${i}]; `;
      concatInputs.push(`[vg${i}][ag${i}]`);
    }
  });

  filterComplex += `${concatInputs.join('')}concat=n=${concatInputs.length}:v=1:a=1[outv][outa]`;

  args.push('-filter_complex', filterComplex, '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', outputPath);

  await run(ffmpegPath, args);
  return true;
}
