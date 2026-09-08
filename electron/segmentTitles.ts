/** Clip titles identify individual events; the shared label remains their type. */
export function getSegmentTitles(segment: { name?: string }, label?: { name: string }) {
  const type = label?.name.trim() || 'Tag';
  return { primaryText: segment.name?.trim() || type, secondaryText: type };
}
