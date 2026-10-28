export function formatTimecode(sec: number): string {
  if (!Number.isFinite(sec)) return '--:--';
  const totalMs = Math.round(Math.max(0, sec) * 1000);
  const total = Math.floor(totalMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  const ms = totalMs % 1000;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const mmm = String(ms).padStart(3, '0');
  const secondsText = `${ss}.${mmm}`;
  if (hours > 0) return `${hh}:${mm}:${secondsText}`;
  if (minutes > 0) return `${mm}:${secondsText}`;
  return secondsText;
}


