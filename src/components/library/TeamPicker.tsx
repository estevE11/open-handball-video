import { useState } from 'react';
import { Check, ChevronsUpDown, Plus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { createTeam, useLibraryStore } from '@/store/libraryStore';
import { useTranslation, useTranslatedMessage } from '@/lib/i18n';

export function TeamPicker({ label, value, onChange, exclude, allowCreate = true }: {
  label: string; value: string; onChange: (id: string) => void; exclude?: string; allowCreate?: boolean;
}) {
  const t = useTranslation(), message = useTranslatedMessage();
  const teams = useLibraryStore(state => state.catalog.teams);
  const [open, setOpen] = useState(false), [search, setSearch] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const selected = teams.find(team => team.id === value);
  const available = teams.filter(team => team.id !== exclude).sort((a, b) => a.name.localeCompare(b.name));
  async function add() {
    setBusy(true); setError('');
    try { const team = await createTeam(search); onChange(team.id); setOpen(false); setSearch(''); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not save team.'); }
    finally { setBusy(false); }
  }
  return <Popover open={open} onOpenChange={next => { setOpen(next); setError(''); }}>
    <PopoverTrigger asChild><Button variant="outline" role="combobox" aria-label={label} aria-expanded={open} className="w-full justify-between gap-2 font-normal">
      <Users className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-left">{selected?.name ?? (allowCreate ? t('Select team') : t('All teams'))}</span><ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
    </Button></PopoverTrigger>
    <PopoverContent aria-label={label} align="start" className="w-[min(320px,calc(100vw-32px))] p-0">
      <Command label={t('Search teams')}><CommandInput aria-label={t('Search teams')} placeholder={t('Search teams')} value={search} onValueChange={setSearch} />
        <CommandList><CommandEmpty>{t('No matching teams.')}</CommandEmpty>
          <CommandItem value={t('No team')} onSelect={() => { onChange(''); setOpen(false); }}>{t('No team')}</CommandItem>
          {available.map(team => <CommandItem key={team.id} value={team.name} onSelect={() => { onChange(team.id); setOpen(false); setSearch(''); }}>
            <Check className={`mr-2 h-4 w-4 ${value === team.id ? '' : 'opacity-0'}`} /><span className="truncate">{team.name}</span>
          </CommandItem>)}
        </CommandList>
      </Command>
      {allowCreate && search.trim() && !teams.some(team => team.name.toLocaleLowerCase() === search.trim().toLocaleLowerCase()) && <div className="border-t p-2">
        <Button type="button" variant="ghost" className="w-full justify-start" disabled={busy} onClick={() => void add()}><Plus className="mr-2 h-4 w-4" /><span className="truncate">{t('Create team “{0}”', search.trim())}</span></Button>
      </div>}
      {error && <p role="alert" className="p-3 text-xs text-destructive">{message(error)}</p>}
    </PopoverContent>
  </Popover>;
}
