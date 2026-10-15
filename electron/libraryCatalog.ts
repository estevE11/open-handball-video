export type LibraryFolder = { id: string; name: string; parentId: string | null };
export type Team = { id: string; name: string };
export type LibraryCatalog = { folders: LibraryFolder[]; teams: Team[] };
export type LibraryChange = { kind: 'folder'; folder: LibraryFolder } | { kind: 'team'; team: Team };
export type MatchMetadata = { category: string; competition: string; fixture: string; season: string;
  homeTeamId?: string; awayTeamId?: string; homeTeamName?: string; awayTeamName?: string };
export const emptyCatalog = (): LibraryCatalog => ({ folders: [], teams: [] });
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 200;
export function coerceMatchMetadata(raw: unknown): MatchMetadata {
  if (!object(raw) || !['category', 'competition', 'fixture', 'season'].every(key => typeof raw[key] === 'string' && String(raw[key]).length <= 200)
    || !['homeTeamId', 'awayTeamId', 'homeTeamName', 'awayTeamName'].every(key => raw[key] === undefined || text(raw[key]))) throw new Error('Invalid match details.');
  if (raw.homeTeamId && raw.homeTeamId === raw.awayTeamId) throw new Error('Choose two different teams.');
  return Object.fromEntries(['category', 'competition', 'fixture', 'season', 'homeTeamId', 'awayTeamId', 'homeTeamName', 'awayTeamName']
    .filter(key => raw[key] !== undefined).map(key => [key, String(raw[key]).trim()])) as MatchMetadata;
}
export function coerceCatalog(raw: unknown): LibraryCatalog {
  if (!object(raw) || !Array.isArray(raw.folders) || !Array.isArray(raw.teams)) throw new Error('Invalid library catalog.');
  const catalog = emptyCatalog();
  for (const folder of raw.folders) {
    if (!object(folder) || !text(folder.id) || !text(folder.name) || (folder.parentId !== null && !text(folder.parentId))) throw new Error('Invalid folder.');
    catalog.folders.push({ id: folder.id, name: folder.name.trim(), parentId: folder.parentId });
  }
  for (const team of raw.teams) {
    if (!object(team) || !text(team.id) || !text(team.name)) throw new Error('Invalid team.');
    catalog.teams.push({ id: team.id, name: team.name.trim() });
  }
  if (new Set(catalog.folders.map(folder => folder.id)).size !== catalog.folders.length || new Set(catalog.teams.map(team => team.id)).size !== catalog.teams.length) throw new Error('Duplicate library IDs.');
  for (const folder of catalog.folders) {
    const visited = new Set([folder.id]);
    let parent = folder.parentId;
    while (parent !== null) {
      if (visited.has(parent)) throw new Error('A folder cannot be moved inside itself.');
      visited.add(parent);
      const ancestor = catalog.folders.find(item => item.id === parent);
      if (!ancestor) throw new Error('The destination folder no longer exists.');
      parent = ancestor.parentId;
    }
    if (catalog.folders.some(other => other.id !== folder.id && other.parentId === folder.parentId && other.name.toLocaleLowerCase() === folder.name.toLocaleLowerCase())) throw new Error('A folder with this name already exists here.');
  }
  if (new Set(catalog.teams.map(team => team.name.toLocaleLowerCase())).size !== catalog.teams.length) throw new Error('A team with this name already exists.');
  return catalog;
}
export function applyLibraryChange(catalog: LibraryCatalog, raw: unknown): LibraryCatalog {
  if (!object(raw)) throw new Error('Invalid library change.');
  if (raw.kind === 'folder' && object(raw.folder)) return coerceCatalog({ ...catalog, folders: [...catalog.folders.filter(folder => folder.id !== (raw.folder as Record<string, unknown>).id), raw.folder] });
  if (raw.kind === 'team' && object(raw.team)) return coerceCatalog({ ...catalog, teams: [...catalog.teams.filter(team => team.id !== (raw.team as Record<string, unknown>).id), raw.team] });
  throw new Error('Invalid library change.');
}
