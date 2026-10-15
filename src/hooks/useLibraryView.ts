import { useEffect, useState } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import type { LibraryScope } from '@/lib/library';
type View = { scope: LibraryScope; search: string; teamId: string };
export function useLibraryView() {
  const key = `ohv-library-view-${window.electron ? 'desktop' : 'browser'}`;
  const { catalog, loaded } = useLibraryStore();
  const [view, setView] = useState<View>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
      return { scope: saved?.scope === null || typeof saved?.scope === 'string' ? saved.scope : 'all',
        search: typeof saved?.search === 'string' ? saved.search : '', teamId: typeof saved?.teamId === 'string' ? saved.teamId : '' };
    } catch { return { scope: 'all', search: '', teamId: '' }; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(view)); } catch { /* Keep the in-memory view. */ } }, [key, view]);
  const scope = loaded && view.scope !== 'all' && view.scope !== null && !catalog.folders.some(folder => folder.id === view.scope) ? 'all' : view.scope;
  const teamId = loaded && view.teamId && !catalog.teams.some(team => team.id === view.teamId) ? '' : view.teamId;
  return { scope, search: view.search, teamId,
    setScope: (scope: LibraryScope) => setView(previous => ({ ...previous, scope })),
    setSearch: (search: string) => setView(previous => ({ ...previous, search })),
    setTeamId: (teamId: string) => setView(previous => ({ ...previous, teamId })),
  };
}
