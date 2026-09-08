import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useProjectStore } from '@/store/projectStore';
import { useReviewStore } from '@/store/reviewStore';

export function ReviewControls() {
  const labels = useProjectStore((s) => s.mainLabels);
  const segments = useProjectStore((s) => s.segments);
  const review = useReviewStore();
  const [type, setType] = useState('');
  const selectedCount = segments.filter((seg) => review.selectedIds.includes(seg.id)).length;
  return <div className="space-y-2 rounded-md border p-2">
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Review tag type" className="h-8 rounded border bg-background px-2 text-xs" value={type} onChange={(event) => setType(event.target.value)}>
        <option value="">All types</option>{labels.map((label) => <option key={label.id} value={label.id}>{label.name}</option>)}
      </select>
      <Button size="sm" variant="outline" onClick={() => review.select(segments.filter((seg) => !type || seg.mainLabelId === type).map((seg) => seg.id))}>Select tags</Button>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={review.loop} onChange={(event) => review.setLoop(event.target.checked)} />Loop review</label>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {review.active ? <Button size="sm" onClick={review.stop}>Stop review</Button> : <Button size="sm" disabled={!selectedCount} onClick={review.start}>Review {selectedCount} tags</Button>}
      <Button size="sm" variant="outline" disabled={!review.active} onClick={() => review.step(-1)} title="Previous tag ([)">Previous tag</Button>
      <Button size="sm" variant="outline" disabled={!review.active} onClick={() => review.step(1)} title="Next tag (])">Next tag</Button>
    </div>
    {review.active && <p className="text-xs text-muted-foreground" role="status">Reviewing {review.index + 1} of {review.queue.length}</p>}
  </div>;
}
