import { useLocalizedLabels } from '@/hooks/useLocalizedLabels';
import { useTranslation } from '@/lib/i18n';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/store/projectStore';
import { useReviewStore } from '@/store/reviewStore';

export function ReviewControls() {
  const t = useTranslation();
  const { mainLabels: labels } = useLocalizedLabels();
  const segments = useProjectStore((s) => s.segments);
  const review = useReviewStore();
  const [type, setType] = useState('');
  const selectedCount = segments.filter((seg) => review.selectedIds.includes(seg.id)).length;
  return <div className="space-y-2 rounded-md border p-2">
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label={t("Review tag type")} className="h-8 rounded border bg-background px-2 text-xs" value={type} onChange={(event) => setType(event.target.value)}>
        <option value="">{t("All types")}</option>{labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
      </select>
      <Button size="sm" variant="outline" onClick={() => review.select(segments.filter((seg) => !type || seg.mainLabelId === type).map((seg) => seg.id))}>{t("Select tags")}</Button>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={review.loop} onChange={(event) => review.setLoop(event.target.checked)} />{t("Loop review")}</label>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {review.active ? <Button size="sm" onClick={review.stop}>{t("Stop review")}</Button> : <Button size="sm" disabled={!selectedCount} onClick={review.start}>{t("Review {0} tags", selectedCount)}</Button>}
      <Button size="sm" variant="outline" disabled={!review.active} onClick={() => review.step(-1)} title={t("Previous tag ([)")}>{t("Previous tag")}</Button>
      <Button size="sm" variant="outline" disabled={!review.active} onClick={() => review.step(1)} title={t("Next tag (])")}>{t("Next tag")}</Button>
    </div>
    {review.active && <p className="text-xs text-muted-foreground" role="status">{t("Reviewing {0} of {1}", review.index + 1, review.queue.length)}</p>}
  </div>;
}
