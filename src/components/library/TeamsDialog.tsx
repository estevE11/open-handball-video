import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { changeLibrary, createTeam, useLibraryStore } from '@/store/libraryStore';
import { useTranslation, useTranslatedMessage } from '@/lib/i18n';
import type { Team } from '@/types/project';
export function TeamsDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslation(), message = useTranslatedMessage(), teams = useLibraryStore(state => state.catalog.teams);
  const [name, setName] = useState(''), [search, setSearch] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="sm:max-w-[560px]">
    <DialogHeader><DialogTitle>{t('Manage teams')}</DialogTitle><DialogDescription>{t('Teams are shared across matches. Renaming a team keeps its match history and filters.')}</DialogDescription></DialogHeader>
    <form className="flex gap-2" onSubmit={event => {
      event.preventDefault(); setBusy(true); setError('');
      void createTeam(name).then(() => setName('')).catch(error => setError(error.message)).finally(() => setBusy(false));
    }}><Input aria-label={t('New team name')} value={name} onChange={event => setName(event.target.value)} maxLength={200} required placeholder={t('New team name')} disabled={busy} /><Button disabled={busy}>{t('Add team')}</Button></form>
    <Input aria-label={t('Search teams')} placeholder={t('Search teams')} value={search} onChange={event => setSearch(event.target.value)} />
    <div className="max-h-[45vh] space-y-2 overflow-auto">
      {teams.filter(team => team.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => a.name.localeCompare(b.name)).map(team => <TeamRow key={team.id} team={team} />)}
      {!teams.length && <p className="py-6 text-center text-sm text-muted-foreground">{t('No teams yet. Create your first team above.')}</p>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{message(error)}</p>}
    <div className="flex justify-end"><Button variant="outline" onClick={onClose}>{t('Close')}</Button></div>
  </DialogContent></Dialog>;
}
function TeamRow({ team }: { team: Team }) {
  const t = useTranslation(), message = useTranslatedMessage();
  const [name, setName] = useState(team.name), [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <form className="rounded-md border p-2" onSubmit={event => {
    event.preventDefault(); setBusy(true); setError('');
    void changeLibrary({ kind: 'team', team: { ...team, name } }).catch(error => setError(error.message)).finally(() => setBusy(false));
  }}><div className="flex gap-2"><Input aria-label={t('Team name: {0}', team.name)} value={name} onChange={event => setName(event.target.value)} maxLength={200} required disabled={busy} /><Button variant="outline" disabled={busy || name.trim() === team.name} aria-label={t('Save team {0}', team.name)}>{t('Save')}</Button></div>
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{message(error)}</p>}
  </form>;
}
