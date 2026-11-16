import type { MeasureExportText } from './exportTitleOverlay.js';

/** Advance widths from the bundled TrueType font, shared by browser and Node.
 * This measures our export font only; it is not a general text-shaping engine.
 */
export function createExportTextMeasurer(bytes: Uint8Array): MeasureExportText {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (offset: number) => data.getUint16(offset);
  const u32 = (offset: number) => data.getUint32(offset);
  const tables = new Map<string, number>();
  for (let i = 0; i < u16(4); i++) {
    const record = 12 + i * 16;
    const name = String.fromCharCode(...bytes.subarray(record, record + 4));
    tables.set(name, u32(record + 8));
  }
  const table = (name: string) => {
    const offset = tables.get(name);
    if (offset === undefined) throw new Error(`Missing export font table: ${name}`);
    return offset;
  };
  const units = u16(table('head') + 18);
  const metricsCount = u16(table('hhea') + 34);
  const metrics = table('hmtx');
  const cmap = table('cmap');
  let format4 = 0, format12 = 0;
  for (let i = 0; i < u16(cmap + 2); i++) {
    const record = cmap + 4 + i * 8;
    const platform = u16(record), encoding = u16(record + 2);
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
    const offset = cmap + u32(record + 4);
    if (u16(offset) === 4) format4 = offset;
    if (u16(offset) === 12) format12 = offset;
  }
  if (!format4 && !format12) throw new Error('Missing export font character map');
  const glyph = (code: number) => {
    if (format12) {
      let low = 0, high = u32(format12 + 12) - 1;
      while (low <= high) {
        const middle = (low + high) >>> 1;
        const group = format12 + 16 + middle * 12;
        if (code < u32(group)) high = middle - 1;
        else if (code > u32(group + 4)) low = middle + 1;
        else return u32(group + 8) + code - u32(group);
      }
      return 0;
    }
    const count = u16(format4 + 6) / 2;
    for (let i = 0; i < count; i++) {
      if (code > u16(format4 + 14 + i * 2)) continue;
      const start = u16(format4 + 16 + count * 2 + i * 2);
      if (code < start) return 0;
      const delta = u16(format4 + 16 + count * 4 + i * 2);
      const rangeAddress = format4 + 16 + count * 6 + i * 2;
      const range = u16(rangeAddress);
      if (!range) return (code + delta) & 0xffff;
      const id = u16(rangeAddress + range + (code - start) * 2);
      return id ? (id + delta) & 0xffff : 0;
    }
    return 0;
  };
  return (text, size) => [...text].reduce((width, character) => {
    const id = glyph(character.codePointAt(0)!);
    // FreeType's hinted advances are rounded to pixels for each glyph.
    return width + Math.round(u16(metrics + Math.min(id, metricsCount - 1) * 4) * size / units);
  }, 0);
}
