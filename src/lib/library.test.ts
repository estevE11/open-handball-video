import { expect, it } from 'vitest';
import { applyLibraryChange, coerceCatalog, coerceMatchMetadata, emptyCatalog } from '../../electron/libraryCatalog';
import { createEmptyProject } from '@/lib/projectDefaults';
import { coerceProjectData } from '@/lib/projectIo';
import { emptyMatch, folderPath, matchesLibraryFilter } from '@/lib/library';

it('creates nested folders, renames and moves a subtree, and rejects cycles and duplicate siblings', () => {
  let catalog = applyLibraryChange(emptyCatalog(), { kind: 'folder', folder: { id: 'season', name: '2026', parentId: null } });
  catalog = applyLibraryChange(catalog, { kind: 'folder', folder: { id: 'round', name: 'Round 12', parentId: 'season' } });
  catalog = applyLibraryChange(catalog, { kind: 'folder', folder: { id: 'archive', name: 'Archive', parentId: null } });
  expect(() => applyLibraryChange(catalog, { kind: 'folder', folder: { id: 'season', name: '2026', parentId: 'round' } })).toThrow('inside itself');
  expect(() => applyLibraryChange(catalog, { kind: 'folder', folder: { id: 'duplicate', name: 'round 12', parentId: 'season' } })).toThrow('already exists');
  expect(() => applyLibraryChange(catalog, { kind: 'folder', folder: { id: 'new', name: 'New', parentId: 'missing' } })).toThrow('no longer exists');
  catalog = applyLibraryChange(catalog, { kind: 'folder', folder: { id: 'season', name: '2026–27', parentId: 'archive' } });
  expect(folderPath('round', catalog.folders)).toBe('Archive / 2026–27 / Round 12');
  expect(catalog.folders.find(folder => folder.id === 'round')?.parentId).toBe('season');
});

it('uses stable teams for both local and visitor filtering, even after a rename', () => {
  const project = { ...createEmptyProject(), name: 'League game', folderId: 'round', match: { ...emptyMatch(), homeTeamId: 'a', awayTeamId: 'b', homeTeamName: 'Old name', awayTeamName: 'Visitors', competition: 'Liga', season: '2026–27', fixture: 'Round 12' } };
  const teams = [{ id: 'a', name: 'Renamed club' }, { id: 'b', name: 'Visitors' }];
  expect(matchesLibraryFilter(project, 'round', 'a', 'renamed', teams)).toBe(true);
  expect(matchesLibraryFilter(project, 'all', 'b', 'round 12', teams)).toBe(true);
  expect(matchesLibraryFilter(project, null, '', '', teams)).toBe(false);
  expect(matchesLibraryFilter(project, 'all', 'unknown', '', teams)).toBe(false);
  expect(() => coerceCatalog({ folders: [], teams: [{ id: 'a', name: 'Club' }, { id: 'b', name: ' club ' }] })).toThrow('already exists');
});

it('round-trips match metadata and preserves original video identity and legacy projects', () => {
  const old = createEmptyProject();
  expect(coerceProjectData(old)).toEqual(old);
  const data = { ...old, name: 'Final', folderId: 'folder', match: { ...emptyMatch(), category: 'U18', competition: 'League', season: '2026–27', fixture: 'Round 12', homeTeamId: 'a', homeTeamName: 'Local', awayTeamId: 'b', awayTeamName: 'Visitors' } };
  expect(coerceProjectData(JSON.parse(JSON.stringify(data)))).toEqual(data);
  expect(() => coerceMatchMetadata({ ...emptyMatch(), homeTeamId: 'a', awayTeamId: 'a' })).toThrow('different teams');
  expect(() => coerceProjectData({ ...old, match: { ...emptyMatch(), season: 2026 } })).toThrow('Invalid match');
  expect(() => coerceProjectData({ ...old, name: '' })).toThrow('video name');
});
