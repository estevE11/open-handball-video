export function formatTimecode(sec: number): string {
  if (!Number.isFinite(sec)) return '--:--';
  const s = Math.max(0, sec);
  const total = Math.floor(s);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const ms = Math.floor((s - total) * 1000);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');
  return `${mm}:${ss}.${mmm}`;
}


