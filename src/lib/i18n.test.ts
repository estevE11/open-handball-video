// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { catalogs, LANGUAGE_STORAGE_KEY, mainLabelName, readLanguage, translate, translateMessage, useLanguageStore, type TranslationKey } from '@/lib/i18n';
import { getDefaultMainLabels } from '@/lib/projectDefaults';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); useLanguageStore.setState({ language: 'en' }); });

it('has matching catalogs and preserves every interpolation placeholder', () => {
  const keys = Object.keys(catalogs.es) as TranslationKey[];
  expect(Object.keys(catalogs.ca).sort()).toEqual([...keys].sort());
  for (const key of keys) {
    const placeholders = key.match(/\{\d+\}/g)?.sort() ?? [];
    for (const catalog of Object.values(catalogs)) {
      expect(catalog[key].trim(), key).not.toBe('');
      expect(catalog[key].match(/\{\d+\}/g)?.sort() ?? [], key).toEqual(placeholders);
    }
  }
});

it('translates dynamic progress and errors without changing names or numbers', () => {
  expect(translate('es', 'Reviewing {0} of {1}', 2, 10)).toBe('Revisando 2 de 10');
  expect(translateMessage('Rendering clip 2 of 10', 'ca')).toBe('Processant el clip 2 de 10');
  expect(translateMessage('Select the original video for this saved project: match.mp4', 'es')).toBe('Selecciona el vídeo original de este proyecto guardado: match.mp4');
  expect(translateMessage('Video export failed (FFmpeg exit code 1).', 'ca')).toBe('L’exportació de vídeo ha fallat (codi de sortida de FFmpeg 1).');
  expect(translateMessage('Unexpected external error', 'es')).toBe('Unexpected external error');
  expect(translateMessage('Select the original video for this saved project: Attack', 'es')).toBe('Selecciona el vídeo original de este proyecto guardado: Attack');
  expect(translateMessage('Could not migrate the previous autosave: Invalid desktop project key.', 'ca')).toBe('No s’ha pogut migrar el desament automàtic anterior: Clau de projecte d’escriptori no vàlida.');
});

it('persists the preference, falls back for invalid values, and handles unavailable storage', () => {
  useLanguageStore.getState().setLanguage('ca');
  expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ca');
  expect(readLanguage()).toBe('ca');
  expect(document.documentElement.lang).toBe('ca');
  localStorage.setItem(LANGUAGE_STORAGE_KEY, 'xx');
  expect(readLanguage()).toBe('en');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(() => useLanguageStore.getState().setLanguage('es')).not.toThrow();
  expect(useLanguageStore.getState().language).toBe('es');
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  expect(readLanguage()).toBe('en');
});

it('localizes untouched presets while preserving customized names and saved labels', () => {
  const label = getDefaultMainLabels()[0];
  const t = (key: TranslationKey) => translate('ca', key);
  expect(mainLabelName(label, t)).toBe('Atac');
  expect(label.name).toBe('Attack');
  expect(mainLabelName({ ...label, name: 'Fast break' }, t)).toBe('Fast break');
  expect(mainLabelName({ ...label, defaultName: 'Custom', name: 'Attack' }, t)).toBe('Attack');
});
