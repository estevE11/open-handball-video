import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FolderSelect } from './FolderSelect';
import { useTranslation, useTranslatedMessage } from '@/lib/i18n';
import { changeLibrary } from '@/store/libraryStore';
import { createId } from '@/lib/ids';
import type { LibraryFolder } from '@/types/project';

export function FolderDialog({ folder, parentId, onClose }: { folder?: LibraryFolder; parentId: string | null; onClose: () => void }) {
  const t = useTranslation(), message = useTranslatedMessage();
  const [name, setName] = useState(folder?.name ?? ''), [parent, setParent] = useState(folder ? folder.parentId : parentId);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>{folder ? t('Edit folder') : t('New folder')}</DialogTitle><DialogDescription>{t('Choose a folder name and its parent directory.')}</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={event => {
      event.preventDefault(); setBusy(true); setError('');
      void changeLibrary({ kind: 'folder', folder: { id: folder?.id ?? createId(), name, parentId: parent } }).then(onClose)
        .catch(error => setError(error instanceof Error ? error.message : 'Could not save folder.')).finally(() => setBusy(false));
    }}>
      <div className="space-y-2"><Label htmlFor="folder-name">{t('Folder name')}</Label><Input id="folder-name" required value={name} onChange={event => setName(event.target.value)} maxLength={200} disabled={busy} /></div>
      <div className="space-y-2"><Label>{t('Parent folder')}</Label><FolderSelect label={t('Parent folder')} value={parent} onChange={setParent} exclude={folder?.id} /></div>
      {error && <p role="alert" className="text-sm text-destructive">{message(error)}</p>}
      <div className="flex justify-end gap-2"><Button variant="ghost" type="button" onClick={onClose} disabled={busy}>{t('Cancel')}</Button><Button disabled={busy}>{t('Save folder')}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
