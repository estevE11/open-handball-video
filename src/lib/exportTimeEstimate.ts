/** Estimate from observed forward progress after setup. Waiting/retries increase
 * the estimate rather than letting an unsupported countdown reach zero.
 */
export function createExportTimeEstimator(startedAt: number) {
  let baseline: { time: number; ratio: number } | undefined;
  let progress = 0;
  let finishing = false;
  return {
    update(phase: string, ratio: number, now: number) {
      if (!Number.isFinite(ratio)) return;
      progress = Math.max(progress, Math.max(0, Math.min(0.99, ratio)));
      if (!baseline && /^Rendering (clip|tagged clips)/.test(phase)) baseline = { time: now, ratio: progress };
      finishing = phase === 'Preparing download' || phase === 'Export ready';
    },
    snapshot(now: number) {
      const elapsedMs = Math.max(0, now - startedAt);
      const observedMs = baseline ? Math.max(0, now - baseline.time) : 0;
      const advanced = baseline ? progress - baseline.ratio : 0;
      const remainingMs = !finishing && observedMs >= 3000 && advanced >= 0.005
        ? observedMs * (1 - progress) / advanced : null;
      return { elapsedMs, remainingMs };
    },
  };
}

/** Clock notation avoids locale-specific abbreviations and rounding to zero. */
export function formatExportDuration(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const pad = (value: number) => String(value).padStart(2, '0');
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${pad(minutes % 60)}:${pad(seconds % 60)}`
    : `${minutes}:${pad(seconds % 60)}`;
}
