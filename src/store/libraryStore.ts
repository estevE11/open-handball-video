import { create } from 'zustand';
import { recordDiagnostic } from '@/lib/diagnostics';
import { coerceCatalog, coerceMatchMetadata, emptyCatalog, type LibraryChange } from '../../electron/libraryCatalog';
import { changeBrowserCatalog, getBrowserCatalog, storageError } from '@/lib/browserStorage';
import { createId } from '@/lib/ids';
import type { LibraryCatalog, MatchMetadata } from '@/types/project';

export const useLibraryStore = create<{ catalog: LibraryCatalog; loaded: boolean; backend: 'browser' | 'electron' | null; error: string }>(() => ({ catalog: emptyCatalog(), loaded: false, backend: null, error: '' }));
let loading: Promise<void> | undefined;
let writes = Promise.resolve();
export async function loadLibraryCatalog(force = false) {
  const backend = window.electron ? 'electron' : 'browser';
  const state = useLibraryStore.getState();
  if (!force && state.loaded && state.backend === backend) return;
  if (loading) { await loading; return loadLibraryCatalog(force); }
  loading = (async () => {
    try {
      const catalog = window.electron ? await window.electron.getLibraryCatalog?.() ?? emptyCatalog() : await getBrowserCatalog();
      useLibraryStore.setState({ catalog: coerceCatalog(catalog), loaded: true, backend, error: '' });
    } catch (error) { recordDiagnostic('error', 'storage', 'catalog.load_failed', undefined, error); useLibraryStore.setState({ error: storageError(error) }); throw error; }
    finally { loading = undefined; }
  })();
  await loading;
}
export function changeLibrary(change: LibraryChange): Promise<void> {
  const electron = window.electron;
  writes = writes.catch(() => {}).then(async () => {
    try {
      if (electron && !electron.changeLibraryCatalog) throw new Error('Restart the desktop app to manage folders and teams.');
      const catalog = electron ? await electron.changeLibraryCatalog!(change) : await changeBrowserCatalog(change);
      useLibraryStore.setState({ catalog: coerceCatalog(catalog), error: '', loaded: true, backend: electron ? 'electron' : 'browser' });
    } catch (error) { recordDiagnostic('error', 'save', 'catalog.save_failed', { kind: change.kind }, error); useLibraryStore.setState({ error: storageError(error) }); throw error; }
  });
  return writes;
}
export async function createTeam(name: string) {
  await loadLibraryCatalog();
  const team = { id: createId(), name: name.trim() };
  await changeLibrary({ kind: 'team', team });
  return team;
}
export function matchWithTeamNames(match: MatchMetadata): MatchMetadata {
  const teams = useLibraryStore.getState().catalog.teams;
  return { ...match, homeTeamName: teams.find(team => team.id === match.homeTeamId)?.name ?? match.homeTeamName,
    awayTeamName: teams.find(team => team.id === match.awayTeamId)?.name ?? match.awayTeamName };
}
/** Imported IDs remain stable when available; name snapshots keep JSON portable. */
export async function importMatchTeams(match: MatchMetadata | undefined) {
  if (!match) return undefined;
  await loadLibraryCatalog();
  const next = { ...match };
  for (const side of ['home', 'away'] as const) {
    const idKey = side === 'home' ? 'homeTeamId' : 'awayTeamId';
    const nameKey = side === 'home' ? 'homeTeamName' : 'awayTeamName';
    const id = next[idKey], name = next[nameKey];
    const teams = useLibraryStore.getState().catalog.teams;
    let team = teams.find(team => team.id === id) ?? teams.find(team => name && team.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (!team && name) {
      team = { id: id ?? createId(), name };
      await changeLibrary({ kind: 'team', team });
    }
    if (team) { next[idKey] = team.id; next[nameKey] = team.name; }
    else { delete next[idKey]; delete next[nameKey]; }
  }
  return coerceMatchMetadata(next);
}
