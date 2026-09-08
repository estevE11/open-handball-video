export type ExportProgress = (phase: string, ratio: number) => void;

/** Keep retries and late engine events from moving the overall bar backward. */
export function monotonicProgress(callback: ExportProgress = () => {}): ExportProgress {
  let previous = 0;
  return (phase, ratio) => {
    if (!Number.isFinite(ratio)) return;
    previous = Math.max(previous, Math.min(1, Math.max(0, ratio)));
    callback(phase, previous);
  };
}

/** FFmpeg's machine-readable progress may arrive across arbitrary stdout chunks. */
export function nativeProgressParser(onTime: (seconds: number) => void) {
  let pending = '';
  return (chunk: string) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('out_time_us=')) continue;
      const value = Number(line.slice('out_time_us='.length).trim());
      if (Number.isSafeInteger(value) && value >= 0) onTime(value / 1_000_000);
    }
  };
}
