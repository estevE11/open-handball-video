export type ExportTitles = { primaryText: string; secondaryText?: string; secondaryLabelsText?: string; hideClipLabels?: boolean };
export type MeasureExportText = (text: string, size: number) => number;

function singleLine(text: string) { return text.replace(/[\r\n\t]/g, ' '); }

function escapeText(text: string) {
  return singleLine(text).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "'\\\\''");
}

/** One layout for single/split sources and native/WASM rendering. */
export function exportTitleOverlay(titles: ExportTitles, fontName: string, measureText: MeasureExportText) {
  if (titles.hideClipLabels) return '';
  const draw = (text: string, x: number, y: string, size: number, border: number) =>
    `drawtext=fontfile='${fontName}':expansion=none:text='${escapeText(text)}':x=${x}:y=${y}:fontsize=${size}:fontcolor=white:borderw=${border}:bordercolor=black:shadowcolor=black@0.6:shadowx=2:shadowy=2`;
  const filters = [draw(titles.primaryText, 30, '64-ascent', 44, 3)];
  if (titles.secondaryLabelsText) {
    const x = 30 + Math.ceil(measureText(singleLine(titles.primaryText), 44)) + 24;
    filters.push(draw(titles.secondaryLabelsText, x, '64-ascent', 22, 2));
  }
  if (titles.secondaryText && titles.secondaryText !== titles.primaryText) filters.push(draw(titles.secondaryText, 30, '85', 22, 2));
  return filters.join(',');
}
