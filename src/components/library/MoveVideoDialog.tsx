import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FolderSelect } from './FolderSelect';
import { useTranslation, useTranslatedMessage } from '@/lib/i18n';
export function MoveVideoDialog({ name, initial, onSave, onClose }: { name: string; initial?: string | null; onSave: (folder: string | null) => Promise<void>; onClose: () => void }) {
  const t = useTranslation(), message = useTranslatedMessage();
  const [folder, setFolder] = useState(initial ?? null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>{t('Move video')}</DialogTitle><DialogDescription>{t('Choose a destination for “{0}”.', name)}</DialogDescription></DialogHeader>
    <FolderSelect label={t('Destination folder')} value={folder} onChange={setFolder} />
    {error && <p role="alert" className="text-sm text-destructive">{message(error)}</p>}
    <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onClose}>{t('Cancel')}</Button><Button disabled={busy} onClick={() => {
      setBusy(true); void onSave(folder).then(onClose).catch(error => setError(error.message)).finally(() => setBusy(false));
    }}>{t('Move here')}</Button></div>
  </DialogContent></Dialog>;
}
