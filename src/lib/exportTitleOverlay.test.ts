/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { getSegmentTitles } from '../../electron/segmentTitles';
import { exportTitleOverlay } from '../../electron/exportTitleOverlay';
import { createExportTextMeasurer } from '../../electron/exportFontMetrics';

const measure = createExportTextMeasurer(readFileSync('public/fonts/Roboto-Bold.ttf'));

it('omits identical or default type captions but retains distinct custom titles', () => {
  for (const name of [undefined, '', 'Atac', ' Atac ']) {
    const titles = getSegmentTitles({ name }, { name: 'Atac' });
    expect(titles).toEqual({ primaryText: 'Atac', secondaryText: '', secondaryLabelsText: '' });
    expect(exportTitleOverlay(titles, 'font.ttf', measure).match(/drawtext=/g)).toHaveLength(1);
  }
  expect(getSegmentTitles({ name: 'atac' }, { name: 'Atac' }).secondaryText).toBe('Atac');
  expect(getSegmentTitles({ name: 'Fast break' }, { name: 'Atac' })).toMatchObject({ primaryText: 'Fast break', secondaryText: 'Atac' });
});

it('resolves assigned secondary labels in order and joins their names with commas', () => {
  const titles = getSegmentTitles({ name: 'Atac', secondaryLabelIds: ['two', 'missing', 'one', 'two'] }, { name: 'Atac' }, [
    { id: 'one', name: 'player #1' }, { id: 'two', name: 'player #2' }, { id: 'unused', name: 'not selected' },
  ]);
  expect(titles.secondaryLabelsText).toBe('player #2, player #1');
  const filter = exportTitleOverlay(titles, 'font.ttf', measure);
  expect(filter).toContain(`text='Atac':x=30:y=64-ascent:fontsize=44`);
  expect(filter).toContain(`text='player #2, player #1':x=${54 + measure('Atac', 44)}:y=64-ascent:fontsize=22`);
  expect(filter).not.toContain(':y=85:');
  expect(filter.match(/bordercolor=black/g)).toHaveLength(2);
  expect(filter).toContain('borderw=3');
  expect(filter).toContain('borderw=2');
});

it('measures the actual font advances rather than using character counts', () => {
  expect(measure('WWW', 44)).toBeGreaterThan(measure('iii', 44) * 2);
  expect(measure('Atac', 44)).toBeGreaterThan(measure('Atac', 22));
  expect(measure('Defensa ràpida · acción', 44)).toBeGreaterThan(200);
});

it('escapes punctuation literally and keeps all three overlays outlined', () => {
  const filter = exportTitleOverlay({ primaryText: '3:2:1', secondaryText: 'Attack', secondaryLabelsText: "Player #1, d'atac 100%\nleft" }, 'font.ttf', measure);
  expect(filter).toContain("text='3\\:2\\:1'");
  expect(filter).toContain('100% left');
  expect(filter.match(/expansion=none/g)).toHaveLength(3);
  expect(filter.match(/bordercolor=black/g)).toHaveLength(3);
});
