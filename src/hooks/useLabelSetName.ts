import { DEFAULT_LABEL_SET_ID } from '@/store/labelSetStore';
import { useTranslation } from '@/lib/i18n';
import type { LabelSet } from '@/types/project';

export function useLabelSetName() {
  const t = useTranslation();
  return (set: LabelSet) => set.id === DEFAULT_LABEL_SET_ID && set.name === 'Default handball labels'
    ? t('Default handball labels') : set.name || t('Untitled label set');
}

