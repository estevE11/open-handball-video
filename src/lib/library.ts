import type { LibraryFolder, MatchMetadata, ProjectData, Team } from '@/types/project';
export type MatchDetails = { name: string; match: MatchMetadata };
export type ConfigureMatch = (initial: { name: string; match?: MatchMetadata }) => Promise<MatchDetails | null>;
export type LibraryScope = 'all' | string | null;
export const emptyMatch = (): MatchMetadata => ({ category: '', competition: '', fixture: '', season: '' });
export function projectName(project: ProjectData) {
  return project.name ?? (project.clips && project.clips.length > 1 ? `${project.clips[0].fileName} (+${project.clips.length - 1} clips)` : project.videoMeta?.fileName ?? 'Untitled project');
}
export function folderPath(id: string | null | undefined, folders: LibraryFolder[]): string {
  if (!id) return '';
  const folder = folders.find(folder => folder.id === id);
  return folder ? [folderPath(folder.parentId, folders), folder.name].filter(Boolean).join(' / ') : '';
}
export function isFolderDescendant(id: string, ancestor: string, folders: LibraryFolder[]): boolean {
  let current = folders.find(folder => folder.id === id);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    if (current.id === ancestor) return true;
    visited.add(current.id);
    current = folders.find(folder => folder.id === current!.parentId);
  }
  return false;
}
export function teamName(id: string | undefined, fallback: string | undefined, teams: Team[]) { return teams.find(team => team.id === id)?.name ?? fallback ?? ''; }
export function matchesLibraryFilter(project: ProjectData, scope: LibraryScope, teamId: string, search: string, teams: Team[]) {
  if (scope !== 'all' && (project.folderId ?? null) !== scope) return false;
  if (teamId && project.match?.homeTeamId !== teamId && project.match?.awayTeamId !== teamId) return false;
  const match = project.match;
  const text = [projectName(project), match?.category, match?.competition, match?.fixture, match?.season,
    teamName(match?.homeTeamId, match?.homeTeamName, teams), teamName(match?.awayTeamId, match?.awayTeamName, teams)].join(' ').toLocaleLowerCase();
  return text.includes(search.trim().toLocaleLowerCase());
}
