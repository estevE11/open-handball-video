import { create } from 'zustand';
import es from './i18n/es.json';
import ca from './i18n/ca.json';
import type { MainLabel, SecondaryLabel } from '@/types/project';

export type Language = 'en' | 'es' | 'ca';
export type TranslationKey = keyof typeof es;
export const LANGUAGE_STORAGE_KEY = 'ohv-language';
export const languages = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'ca', name: 'Català', flag: null },
] as const;

export function readLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'es' || saved === 'ca') return saved;
  } catch { /* Language selection also works when storage is unavailable. */ }
  return 'en';
}

export const useLanguageStore = create<{ language: Language; setLanguage: (language: Language) => void }>((set) => ({
  language: readLanguage(),
  setLanguage: (language) => {
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, language); } catch { /* Keep the in-memory preference. */ }
    if (typeof document !== 'undefined') document.documentElement.lang = language;
    set({ language });
  },
}));

export const catalogs = { es, ca: ca satisfies Record<TranslationKey, string> };
function interpolate(text: string, values: (string | number)[]) {
  return text.replace(/\{(\d+)\}/g, (placeholder, index: string) => String(values[Number(index)] ?? placeholder));
}
export function translate(language: Language, key: TranslationKey, ...values: (string | number)[]) {
  return interpolate(language === 'en' ? key : catalogs[language][key], values);
}
// Stable functions keep existing memoized summaries in sync with the language.
const translators = {
  en: (key: TranslationKey, ...values: (string | number)[]) => translate('en', key, ...values),
  es: (key: TranslationKey, ...values: (string | number)[]) => translate('es', key, ...values),
  ca: (key: TranslationKey, ...values: (string | number)[]) => translate('ca', key, ...values),
};
export function useTranslation() {
  return translators[useLanguageStore((s) => s.language)];
}

const messagePatterns = (Object.keys(es) as TranslationKey[]).filter((key) => key.includes('{')).map((key) => ({
  key,
  pattern: new RegExp('^' + key.split(/\{\d+\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('([\\s\\S]+?)') + '$'),
}));
/** Translate app messages arriving from storage, Electron, and export workers at display time. */
export function translateMessage(message: string, language: Language): string {
  if (language === 'en' || !message) return message;
  if (Object.prototype.hasOwnProperty.call(es, message)) return translate(language, message as TranslationKey);
  for (const { key, pattern } of messagePatterns) {
    const match = message.match(pattern);
    if (match) {
      const values = match.slice(1);
      if (key === 'Could not migrate the previous autosave: {0}') values[0] = translateMessage(values[0], language);
      return translate(language, key, ...values);
    }
  }
  return message;
}
export function useTranslatedMessage() {
  const language = useLanguageStore((s) => s.language);
  return (message: string) => translateMessage(message, language);
}

/** Translate untouched presets for display without changing saved or custom names. */
export function mainLabelName(label: MainLabel, t: ReturnType<typeof useTranslation>) {
  return label.name === label.defaultName && (label.name === 'Attack' || label.name === 'Defense') ? t(label.name) : label.name;
}
export function secondaryLabelName(label: SecondaryLabel, t: ReturnType<typeof useTranslation>) {
  return label.name === 'Player #10' || label.name === 'Player #9' ? t(label.name) : label.name;
}
