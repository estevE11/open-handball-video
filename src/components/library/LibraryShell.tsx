import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderPlus, Library, Search, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FolderDialog } from './FolderDialog';
import { TeamsDialog } from './TeamsDialog';
import { TeamPicker } from './TeamPicker';
import { folderPath, type LibraryScope } from '@/lib/library';
import { loadLibraryCatalog, useLibraryStore } from '@/store/libraryStore';
import { useTranslation, useTranslatedMessage } from '@/lib/i18n';
import type { LibraryFolder } from '@/types/project';
export function LibraryShell({ scope, onScopeChange, search, onSearchChange, teamId, onTeamChange, children }: {
  scope: LibraryScope; onScopeChange: (scope: LibraryScope) => void; search: string; onSearchChange: (value: string) => void;
  teamId: string; onTeamChange: (value: string) => void; children: ReactNode;
}) {
  const t = useTranslation(), message = useTranslatedMessage();
  const { catalog, error } = useLibraryStore();
  const [folderDialog, setFolderDialog] = useState<{ folder?: LibraryFolder } | null>(null), [teamsOpen, setTeamsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => { void loadLibraryCatalog().catch(() => {}); }, []);
  const selected = catalog.folders.find(folder => folder.id === scope);
  const childrenFolders = scope === 'all' ? [] : catalog.folders.filter(folder => folder.parentId === scope).sort((a, b) => a.name.localeCompare(b.name));
  function branch(parent: string | null): ReactNode {
    return <ul className="space-y-1">{catalog.folders.filter(folder => folder.parentId === parent).sort((a, b) => a.name.localeCompare(b.name)).map(folder => {
      const hasChildren = catalog.folders.some(item => item.parentId === folder.id), closed = collapsed.has(folder.id);
      return <li key={folder.id}><div className="flex items-center gap-1">
        {hasChildren ? <button className="rounded p-1 hover:bg-accent" aria-label={closed ? t('Expand {0}', folder.name) : t('Collapse {0}', folder.name)} onClick={() => setCollapsed(previous => {
          const next = new Set(previous); if (closed) next.delete(folder.id); else next.add(folder.id); return next;
        })}>{closed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</button> : <span className="w-5 shrink-0" />}
        <Button className="min-w-0 flex-1 justify-start gap-2 px-2 font-normal" variant={scope === folder.id ? 'secondary' : 'ghost'} title={folder.name} aria-current={scope === folder.id ? 'page' : undefined} onClick={() => onScopeChange(folder.id)}><Folder className="h-4 w-4 shrink-0" /><span className="truncate">{folder.name}</span></Button>
      </div>{hasChildren && !closed && <div className="ml-3 border-l pl-1">{branch(folder.id)}</div>}</li>;
    })}</ul>;
  }
  return <div className="grid min-h-0 gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
    <aside className="self-start rounded-lg border bg-card p-3">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">{t('Folders')}</h2><Button variant="ghost" size="icon" className="h-7 w-7" aria-label={t('New folder')} onClick={() => setFolderDialog({})}><FolderPlus className="h-4 w-4" /></Button></div>
      <nav aria-label={t('Video folders')} className="max-h-[50vh] space-y-1 overflow-auto">
        <Button className="w-full justify-start gap-2 font-normal" variant={scope === 'all' ? 'secondary' : 'ghost'} onClick={() => onScopeChange('all')}><Library className="h-4 w-4" />{t('All videos')}</Button>
        <Button className="w-full justify-start gap-2 font-normal" variant={scope === null ? 'secondary' : 'ghost'} onClick={() => onScopeChange(null)}><Folder className="h-4 w-4" />{t('Library root')}</Button>
        {branch(null)}
      </nav>
      <div className="mt-4 border-t pt-3"><Button variant="ghost" className="w-full justify-start gap-2" onClick={() => setTeamsOpen(true)}><Users className="h-4 w-4" />{t('Manage teams')}</Button></div>
    </aside>
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="min-w-0 break-words text-lg font-semibold">{scope === 'all' ? t('All videos') : selected ? folderPath(selected.id, catalog.folders) : t('Library root')}</h2>
        {selected && <Button variant="outline" size="sm" onClick={() => setFolderDialog({ folder: selected })}>{t('Edit folder')}</Button>}
      </div>
      <div className="flex flex-wrap gap-3"><div className="relative min-w-[180px] flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pl-9" aria-label={t('Search videos')} placeholder={t('Search videos, teams, or competition')} value={search} onChange={event => onSearchChange(event.target.value)} /></div>
        <div className="w-full sm:w-[220px]"><TeamPicker label={t('Filter by team')} value={teamId} onChange={onTeamChange} allowCreate={false} /></div>
        {(search || teamId) && <Button variant="ghost" onClick={() => { onSearchChange(''); onTeamChange(''); }}>{t('Clear filters')}</Button>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{message(error)}</p>}
      {childrenFolders.length > 0 && <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{childrenFolders.map(folder => <Button key={folder.id} className="justify-start gap-2" variant="outline" onClick={() => onScopeChange(folder.id)}><Folder className="h-4 w-4 shrink-0" /><span className="truncate">{folder.name}</span></Button>)}</div>}
      {children}
    </div>
    {folderDialog && <FolderDialog folder={folderDialog.folder} parentId={scope === 'all' ? null : scope} onClose={() => setFolderDialog(null)} />}
    {teamsOpen && <TeamsDialog onClose={() => setTeamsOpen(false)} />}
  </div>;
}
