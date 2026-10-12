import { Button } from '@/components/ui/button';
import { loadLabelSets, saveLabelSet, useLabelSetStore } from '@/store/labelSetStore';
import { useTranslation, useTranslatedMessage } from '@/lib/i18n';

export function LabelSetSaveStatus() {
  const t = useTranslation();
  const message = useTranslatedMessage();
  const pending = useLabelSetStore((s) => s.pending);
  const error = useLabelSetStore((s) => s.error);
  return <div className="text-xs" role={error ? 'alert' : 'status'}>
    {error ? message(error) : t(pending ? 'Saving…' : 'Saved')}
    {error && <Button variant="ghost" size="sm" onClick={() => {
      for (const set of useLabelSetStore.getState().sets) void saveLabelSet(set).catch(() => {});
      if (!useLabelSetStore.getState().loaded) void loadLabelSets().catch(() => {});
    }}>{t('Retry save')}</Button>}
  </div>;
}

