// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { emptyMatch } from '@/lib/library';
import { changeLibrary, importMatchTeams, matchWithTeamNames, useLibraryStore } from '@/store/libraryStore';

it('imports portable team snapshots idempotently and resolves names without changing stable IDs', async () => {
  const metadata = { ...emptyMatch(), homeTeamId: 'import-a', awayTeamId: 'import-b', homeTeamName: 'Imported A', awayTeamName: 'Imported B' };
  const first = await importMatchTeams(metadata);
  expect(first).toEqual(metadata);
  expect(useLibraryStore.getState().catalog.teams).toHaveLength(2);
  expect(await importMatchTeams(metadata)).toEqual(metadata);
  expect(useLibraryStore.getState().catalog.teams).toHaveLength(2);
  await changeLibrary({ kind: 'team', team: { id: 'import-a', name: 'Academy A' } });
  expect(matchWithTeamNames(metadata).homeTeamName).toBe('Academy A');
  const elsewhere = await importMatchTeams({ ...emptyMatch(), homeTeamId: 'different-id', homeTeamName: 'Academy A' });
  expect(elsewhere?.homeTeamId).toBe('import-a');
  expect(useLibraryStore.getState().catalog.teams).toHaveLength(2);
});
