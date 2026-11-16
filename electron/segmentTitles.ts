/** Clip titles identify individual events; the shared label remains their type. */
export function getSegmentTitles(segment: { name?: string; secondaryLabelIds?: string[] }, label?: { name: string },
  secondaryLabels: { id: string; name: string }[] = []) {
  const type = label?.name.trim() || 'Tag';
  const primaryText = segment.name?.trim() || type;
  const secondaryLabelsText = [...new Set(segment.secondaryLabelIds ?? [])]
    .map(id => secondaryLabels.find(item => item.id === id)?.name.trim())
    .filter(Boolean).join(', ');
  return { primaryText, secondaryText: primaryText === type ? '' : type, secondaryLabelsText };
}
