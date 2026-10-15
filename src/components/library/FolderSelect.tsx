import { folderPath, isFolderDescendant } from '@/lib/library';
import { useLibraryStore } from '@/store/libraryStore';
import { useTranslation } from '@/lib/i18n';
export function FolderSelect({ value, onChange, exclude, label }: { value: string | null; onChange: (id: string | null) => void; exclude?: string; label: string }) {
  const t = useTranslation(), folders = useLibraryStore(state => state.catalog.folders);
  return <select aria-label={label} className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={value ?? ''} onChange={event => onChange(event.target.value || null)}>
    <option value="">{t('Library root')}</option>
    {folders.filter(folder => !exclude || !isFolderDescendant(folder.id, exclude, folders)).sort((a, b) => folderPath(a.id, folders).localeCompare(folderPath(b.id, folders)))
      .map(folder => <option key={folder.id} value={folder.id}>{folderPath(folder.id, folders)}</option>)}
  </select>;
}
