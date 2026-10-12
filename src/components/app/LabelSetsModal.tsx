import { useLabelSetName } from '@/hooks/useLabelSetName';
import { LabelSetSaveStatus } from '@/components/app/LabelSetSaveStatus';
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SettingsModal } from '@/components/app/SettingsModal';
import { createLabelSet, loadLabelSets, useLabelSetStore } from '@/store/labelSetStore';
import { useTranslation } from '@/lib/i18n';
import type { LabelSet } from '@/types/project';

export function LabelSetsModal({ open, onOpenChange, onSelect }: {
  open: boolean; onOpenChange: (open: boolean) => void; onSelect?: (set: LabelSet) => void;
}) {
  const t = useTranslation();
  const name = useLabelSetName();
  const sets = useLabelSetStore((s) => s.sets);
  const loaded = useLabelSetStore((s) => s.loaded);
  const pending = useLabelSetStore((s) => s.pending);
  const error = useLabelSetStore((s) => s.error);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (open) void loadLabelSets().catch(() => {}); }, [open]);
  return <>
    <Dialog open={open && !editingId} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{t(onSelect ? 'Choose a label set' : 'Manage label sets')}</DialogTitle>
          <DialogDescription>{t(onSelect
            ? 'Choose the labels for this video. The selected set cannot be changed later. Edits to the set are shared across its videos.'
            : 'Create reusable sets of main and secondary labels. Editing a set updates every video that uses it.')}</DialogDescription>
        </DialogHeader>
        <Button disabled={!loaded || creating || pending > 0} onClick={() => {
          setCreating(true);
          void createLabelSet(t('New label set')).then((set) => setEditingId(set.id)).catch(() => {}).finally(() => setCreating(false));
        }}><Plus className="h-4 w-4" />{t('Create label set')}</Button>
        {!loaded && <p role="status">{t('Loading…')}</p>}
        <div className="max-h-[50vh] space-y-2 overflow-auto">
          {[...sets].sort((a, b) => name(a).localeCompare(name(b))).map((set) => <div key={set.id} className="flex items-center gap-2 rounded-md border p-2">
            <Button variant="ghost" className="h-auto min-w-0 flex-1 justify-start whitespace-normal text-left" disabled={!loaded} onClick={() => setEditingId(set.id)}>
              <span><span className="block font-medium">{name(set)}</span><span className="block text-xs text-muted-foreground">{t('{0} main labels · {1} secondary labels', set.mainLabels.length, set.secondaryLabels.length)}</span></span>
            </Button>
            {onSelect && <Button size="sm" disabled={!loaded || pending > 0 || !!error} aria-label={t('Use label set {0}', name(set))} onClick={() => onSelect(set)}>{t('Use this set')}</Button>}
          </div>)}
        </div>
        <LabelSetSaveStatus />
        {onSelect && <div className="flex justify-end"><Button variant="outline" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button></div>}
      </DialogContent>
    </Dialog>
    {editingId && <SettingsModal open onOpenChange={(next) => { if (!next) setEditingId(null); }} labelSetId={editingId} />}
  </>;
}
