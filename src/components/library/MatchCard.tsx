import { useState, type ReactNode } from 'react';
import { MoreHorizontal, Trophy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { useLanguageStore, useTranslation } from '@/lib/i18n';
import { projectName, teamName } from '@/lib/library';
import { useLibraryStore } from '@/store/libraryStore';
import { formatBytes } from '@/lib/browserStorage';
import type { ProjectData } from '@/types/project';
export function MatchCard({ project, bytes, lastOpenedAtMs, busy, missingVideo, children, openLabel, onOpen, onEdit, onMove, onDuplicate, onExport, onRemoveVideo, onDelete }: {
  project: ProjectData; bytes?: number; lastOpenedAtMs?: number; busy: boolean; missingVideo?: boolean; children?: ReactNode;
  openLabel?: string;
  onOpen: () => void; onEdit: () => void; onMove: () => void; onDuplicate: () => void; onExport: () => void; onRemoveVideo?: () => void; onDelete?: () => void;
}) {
  const t = useTranslation(), language = useLanguageStore(state => state.language), teams = useLibraryStore(state => state.catalog.teams);
  const [actionsOpen, setActionsOpen] = useState(false);
  const name = projectName(project), match = project.match;
  const home = teamName(match?.homeTeamId, match?.homeTeamName, teams), away = teamName(match?.awayTeamId, match?.awayTeamName, teams);
  function action(run: () => void) { setActionsOpen(false); run(); }
  return <Card role="article" aria-label={name} className="flex min-w-0 flex-col">
    <CardHeader className="space-y-3 pb-3"><div className="flex items-start justify-between gap-2">
      <button className="min-w-0 text-left hover:underline" onClick={onOpen} disabled={busy}><CardTitle className="truncate text-base" title={name}>{name}</CardTitle></button>
      <Popover open={actionsOpen} onOpenChange={setActionsOpen}><PopoverTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={busy} aria-label={t('Actions for {0}', name)}><MoreHorizontal className="h-4 w-4" /></Button></PopoverTrigger>
        <PopoverContent align="end" className="w-48 p-1"><div className="flex flex-col">
          <Button variant="ghost" className="justify-start" onClick={() => action(onEdit)}>{t('Rename video')}</Button>
          <Button variant="ghost" className="justify-start" onClick={() => action(onMove)}>{t('Move video')}</Button>
          <Button variant="ghost" className="justify-start" onClick={() => action(onDuplicate)}>{t('Duplicate video')}</Button>
          <Button variant="ghost" className="justify-start" onClick={() => action(onExport)}>{t('Export JSON')}</Button>
          {onRemoveVideo && <Button variant="ghost" className="justify-start" onClick={() => action(onRemoveVideo)}>{t('Remove video')}</Button>}
          {onDelete && <Button variant="ghost" className="justify-start text-destructive" onClick={() => action(onDelete)}>{t('Delete project')}</Button>}
        </div></PopoverContent>
      </Popover>
    </div>
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-md bg-muted/30 p-3">
      <div className="min-w-0"><p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('Local team')}</p><p className="truncate text-sm font-semibold" title={home}>{home || t('Not set')}</p></div>
      <span className="text-xs text-muted-foreground">vs</span>
      <div className="min-w-0 text-right"><p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{t('Visitor team')}</p><p className="truncate text-sm font-semibold" title={away}>{away || t('Not set')}</p></div>
    </div></CardHeader>
    <CardContent className="flex flex-1 flex-col gap-3">
      {(match?.category || match?.season) && <div className="flex flex-wrap gap-1.5">{match.category && <Badge variant="secondary" className="max-w-full" title={match.category}><span className="truncate">{match.category}</span></Badge>}{match.season && <Badge variant="outline" className="max-w-full" title={match.season}><span className="truncate">{match.season}</span></Badge>}</div>}
      {(match?.competition || match?.fixture) && <p className="flex items-start gap-2 text-sm text-muted-foreground"><Trophy className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 break-words">{[match.competition, match.fixture].filter(Boolean).join(' · ')}</span></p>}
      <p className="text-xs text-muted-foreground">{bytes !== undefined ? `${formatBytes(bytes)} · ` : ''}{new Date(project.updatedAtMs).toLocaleDateString(language)} · {t('{0} tags', project.segments.length)}</p>
      {lastOpenedAtMs !== undefined && <p className="text-xs text-muted-foreground">{t('Last opened:')} {new Date(lastOpenedAtMs).toLocaleDateString(language)}</p>}
      {missingVideo && <p className="text-xs text-muted-foreground">{t('Video not stored. Project data kept. Choose the original video when opening this project.')}</p>}
      {children}
      <div className="mt-auto flex flex-wrap gap-2 pt-1"><Button disabled={busy} aria-label={openLabel} onClick={onOpen}>{t('Open project')}</Button><Button variant="outline" disabled={busy} onClick={onEdit}>{t('Match details')}</Button></div>
    </CardContent>
  </Card>;
}
