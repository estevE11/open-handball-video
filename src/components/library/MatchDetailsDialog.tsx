import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TeamPicker } from './TeamPicker';
import { emptyMatch, type MatchDetails } from '@/lib/library';
import { useTranslation, useTranslatedMessage } from '@/lib/i18n';
import { matchWithTeamNames } from '@/store/libraryStore';
import { coerceMatchMetadata } from '../../../electron/libraryCatalog';
import type { MatchMetadata } from '@/types/project';

export function MatchDetailsDialog({ initial, creating = false, onSave, onCancel }: { initial: { name: string; match?: MatchMetadata };
  creating?: boolean; onSave: (details: MatchDetails) => Promise<void> | void; onCancel: () => void }) {
  const t = useTranslation(), message = useTranslatedMessage();
  const [name, setName] = useState(initial.name), [match, setMatch] = useState(initial.match ?? emptyMatch());
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try {
      if (!name.trim() || name.trim().length > 200) throw new Error('Enter a video name.');
      await onSave({ name: name.trim(), match: coerceMatchMetadata(matchWithTeamNames(match)) });
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save match details.'); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onCancel(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[620px]">
    <DialogHeader><DialogTitle>{creating ? t('Create video') : t('Match details')}</DialogTitle>
      <DialogDescription>{t('Name this match and select its teams. Match details are optional and can be edited later.')}</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className="space-y-2"><Label htmlFor="match-name">{t('Video name')}</Label><Input id="match-name" value={name} onChange={event => setName(event.target.value)} maxLength={200} required disabled={busy} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label>{t('Local team')}</Label><TeamPicker label={t('Local team')} value={match.homeTeamId ?? ''} exclude={match.awayTeamId} onChange={id => setMatch(previous => ({ ...previous, homeTeamId: id || undefined, homeTeamName: undefined }))} /></div>
        <div className="space-y-2"><Label>{t('Visitor team')}</Label><TeamPicker label={t('Visitor team')} value={match.awayTeamId ?? ''} exclude={match.homeTeamId} onChange={id => setMatch(previous => ({ ...previous, awayTeamId: id || undefined, awayTeamName: undefined }))} /></div>
        {(['category', 'competition', 'season', 'fixture'] as const).map(field => <div key={field} className="space-y-2">
          <Label htmlFor={`match-${field}`}>{t(({ category: 'Category', competition: 'Competition', season: 'Season', fixture: 'Fixture / matchday' } as const)[field])}</Label>
          <Input id={`match-${field}`} value={match[field]} disabled={busy} maxLength={200} placeholder={field === 'fixture' ? t('e.g. Round 12') : undefined}
            onChange={event => setMatch(previous => ({ ...previous, [field]: event.target.value }))} />
        </div>)}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{message(error)}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>{t('Cancel')}</Button>
        <Button disabled={busy} type="submit">{creating ? t('Create video') : t('Save changes')}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
