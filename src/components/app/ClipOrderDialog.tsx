import { useTranslation, useTranslatedMessage } from '@/lib/i18n';
import { useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ErrorReportAction } from './DiagnosticsButton';

type Item = { id: string; name: string };
export function ClipOrderDialog({ items, onChange, onStart, onCancel, busy, error }: {
  items: Item[]; onChange: (ids: string[]) => void; onStart: () => void; onCancel: () => void; busy: boolean; error: string;
}) {
  const t = useTranslation();
  const message = useTranslatedMessage();
  const [dragged, setDragged] = useState<string | null>(null);
  function move(id: string, target: number) {
    const ids = items.map((item) => item.id);
    const index = ids.indexOf(id);
    if (index < 0 || target < 0 || target >= ids.length || busy) return;
    ids.splice(index, 1); ids.splice(target, 0, id); onChange(ids);
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
    <DialogContent className="sm:max-w-[620px]">
      <DialogHeader><DialogTitle>{t("Arrange match clips")}</DialogTitle>
        <DialogDescription>{t("Drag clips into match order, or use the arrows. Tagging uses one continuous timeline. Order is fixed after you start tagging.")}</DialogDescription>
      </DialogHeader>
      <ol className="max-h-[50vh] space-y-2 overflow-auto" aria-label={t("Clip order")}>
        {items.map((item, index) => <li key={item.id} draggable={!busy}
          onDragStart={(event) => { setDragged(item.id); event.dataTransfer.setData('text/plain', item.id); }}
          onDragEnd={() => setDragged(null)} onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); if (dragged) move(dragged, index); setDragged(null); }}
          className="flex items-center gap-2 rounded border p-2">
          <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">{index + 1}.</span><span className="min-w-0 flex-1 truncate" title={item.name}>{item.name}</span>
          <Button size="icon" variant="ghost" disabled={busy || index === 0} aria-label={t("Move {0} up", item.name)} onClick={() => move(item.id, index - 1)}><ArrowUp className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" disabled={busy || index === items.length - 1} aria-label={t("Move {0} down", item.name)} onClick={() => move(item.id, index + 1)}><ArrowDown className="h-4 w-4" /></Button>
        </li>)}
      </ol>
      {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{message(error)}</p><ErrorReportAction /></div>}
      <div className="flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onCancel}>{t("Cancel")}</Button>
        <Button disabled={busy || !items.length} onClick={onStart}>{busy ? t("Preparing clips…") : t("Start tagging")}</Button></div>
    </DialogContent>
  </Dialog>;
}
