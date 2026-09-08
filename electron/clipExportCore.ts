/** Shared by the native and WebAssembly exporters. No browser or Node dependencies. */
export type ExportPiece = {
  sourceIndex: number;
  startTimeSec: number;
  endTimeSec: number;
  segmentIndex: number;
  primaryText: string;
  secondaryText?: string;
};
export type MediaInfo = { width: number; height: number; hasAudio: boolean };
export type ClipExportBackend = {
  loadSource: (index: number) => Promise<string>;
  releaseSource: (name: string) => Promise<void>;
  probe: (name: string) => Promise<MediaInfo>;
  exec: (args: string[]) => Promise<void>;
  write: (name: string, data: Uint8Array) => Promise<void>;
  read: (name: string) => Promise<Uint8Array>;
  remove: (name: string) => Promise<void>;
  fontName: string;
};

function escapeText(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "'\\\\''").replace(/[\r\n]/g, ' ');
}

export async function renderClipExport(backend: ClipExportBackend, pieces: ExportPiece[], addGap: boolean,
  onProgress: (phase: string, ratio: number) => void = () => {}) {
  if (!pieces.length) throw new Error('No segments to export.');
  const files = new Set<string>();
  let loaded: string | undefined;
  const outputs = pieces.map((_, index) => `part_${index}.mp4`);
  let dimensions: { width: number; height: number } | undefined;
  let rendered = 0;
  const encode = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-r', '30', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k'];
  try {
    // Only one original clip is copied into WASM memory at a time.
    for (const sourceIndex of new Set(pieces.map((piece) => piece.sourceIndex))) {
      loaded = await backend.loadSource(sourceIndex);
      const info = await backend.probe(loaded);
      dimensions ??= { width: Math.max(2, Math.floor(info.width / 2) * 2), height: Math.max(2, Math.floor(info.height / 2) * 2) };
      const { width, height } = dimensions;
      for (const [index, piece] of pieces.entries()) {
        if (piece.sourceIndex !== sourceIndex) continue;
        const duration = piece.endTimeSec - piece.startTimeSec;
        if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid export segment duration.');
        files.add(outputs[index]);
        const args = ['-hide_banner', '-y', '-ss', piece.startTimeSec.toFixed(6), '-i', loaded];
        if (!info.hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
        let filter = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
        filter += `,drawtext=fontfile=${backend.fontName}:expansion=none:text='${escapeText(piece.primaryText)}':x=30:y=30:fontsize=44:fontcolor=white:shadowcolor=black@0.6:shadowx=2:shadowy=2`;
        if (piece.secondaryText) filter += `,drawtext=fontfile=${backend.fontName}:expansion=none:text='${escapeText(piece.secondaryText)}':x=30:y=85:fontsize=22:fontcolor=white`;
        args.push('-t', duration.toFixed(6), '-map', '0:v:0', '-map', info.hasAudio ? '0:a:0' : '1:a:0',
          '-vf', filter, '-af', 'apad', ...encode, outputs[index]);
        await backend.exec(args);
        onProgress('Rendering tagged clips', ++rendered / pieces.length * 0.9);
      }
      await backend.releaseSource(loaded); loaded = undefined;
    }
    const concat: string[] = [];
    if (addGap && pieces.some((piece, index) => index > 0 && piece.segmentIndex !== pieces[index - 1].segmentIndex)) {
      files.add('gap.mp4');
      await backend.exec(['-hide_banner', '-y', '-f', 'lavfi', '-i', `color=c=black:s=${dimensions!.width}x${dimensions!.height}:r=30`,
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '0.5', ...encode, 'gap.mp4']);
    }
    pieces.forEach((piece, index) => {
      if (addGap && index > 0 && piece.segmentIndex !== pieces[index - 1].segmentIndex) concat.push("file 'gap.mp4'");
      concat.push(`file '${outputs[index]}'`);
    });
    files.add('concat.txt'); files.add('export.mp4');
    await backend.write('concat.txt', new TextEncoder().encode(concat.join('\n')));
    onProgress('Merging tagged clips', 0.95);
    await backend.exec(['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-c', 'copy', '-movflags', '+faststart', 'export.mp4']);
    const data = await backend.read('export.mp4');
    onProgress('Complete', 1);
    return data;
  } finally {
    if (loaded) await backend.releaseSource(loaded).catch(() => {});
    await Promise.all([...files].map((name) => backend.remove(name).catch(() => {})));
  }
}
