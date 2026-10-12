import { useMemo } from 'react';
import { mainLabelName, secondaryLabelName, useTranslation } from '@/lib/i18n';
import { useProjectStore } from '@/store/projectStore';

export function useLocalizedLabels() {
  const t = useTranslation();
  const storedMainLabels = useProjectStore((s) => s.mainLabels);
  const storedSecondaryLabels = useProjectStore((s) => s.secondaryLabels);
  const mainLabels = useMemo(() => storedMainLabels.map((label) => ({ ...label, name: mainLabelName(label, t) })), [storedMainLabels, t]);
  const secondaryLabels = useMemo(() => storedSecondaryLabels.map((label) => ({ ...label, name: secondaryLabelName(label, t) })), [storedSecondaryLabels, t]);
  return { mainLabels, secondaryLabels };
}
