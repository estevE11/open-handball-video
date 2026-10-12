import { useLabelSetName } from '@/hooks/useLabelSetName';
import { LabelSetSaveStatus } from '@/components/app/LabelSetSaveStatus';
import { editLabelSet, useLabelSetStore } from '@/store/labelSetStore';
import { LanguageSelector } from '@/components/app/LanguageSelector';
import { useTranslation, mainLabelName, secondaryLabelName } from '@/lib/i18n';
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { moveLabelInOrder } from '@/lib/labelSets';
import { createId } from '@/lib/ids';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/store/projectStore';
import type { MainLabel, SecondaryLabel } from '@/types/project';

type SettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Supplied when editing a set from the library rather than the active video. */
  labelSetId?: string;
};

export function SettingsModal({ open, onOpenChange, labelSetId }: SettingsModalProps) {
  const t = useTranslation();
  const projectMainLabels = useProjectStore((s) => s.mainLabels);
  const projectSecondaryLabels = useProjectStore((s) => s.secondaryLabels);
  const projectLabelSetId = useProjectStore((s) => s.labelSetId);
  const sharedSet = useLabelSetStore((s) => s.sets.find((set) => set.id === (labelSetId ?? projectLabelSetId)));
  const setName = useLabelSetName();
  const mainLabels = labelSetId && sharedSet ? sharedSet.mainLabels : projectMainLabels;
  const secondaryLabels = labelSetId && sharedSet ? sharedSet.secondaryLabels : projectSecondaryLabels;
  const detectedFps = useProjectStore((s) => s.videoMeta?.fps);

  function editSet(change: Partial<NonNullable<typeof sharedSet>>) {
    if (sharedSet) void editLabelSet(sharedSet.id, change).catch(() => {});
  }
  function upsertMainLabel(label: MainLabel) {
    if (!labelSetId) { useProjectStore.getState().upsertMainLabel(label); return; }
    editSet({ mainLabels: mainLabels.some((item) => item.id === label.id) ? mainLabels.map((item) => item.id === label.id ? label : item) : [...mainLabels, label] });
  }
  function deleteMainLabel(id: string) {
    if (!labelSetId) { useProjectStore.getState().deleteMainLabel(id); return; }
    editSet({ mainLabels: mainLabels.filter((label) => label.id !== id) });
  }
  function upsertSecondaryLabel(label: SecondaryLabel) {
    if (!labelSetId) { useProjectStore.getState().upsertSecondaryLabel(label); return; }
    editSet({ secondaryLabels: secondaryLabels.some((item) => item.id === label.id) ? secondaryLabels.map((item) => item.id === label.id ? label : item) : [...secondaryLabels, label] });
  }
  function deleteSecondaryLabel(id: string) {
    if (!labelSetId) { useProjectStore.getState().deleteSecondaryLabel(id); return; }
    editSet({ secondaryLabels: secondaryLabels.filter((label) => label.id !== id) });
  }

  const [tab, setTab] = useState<'main' | 'secondary' | 'settings'>('main');

  const visibleMainLabels = useMemo(() => mainLabels.filter((label) => !label.archived), [mainLabels]);
  const visibleSecondaryLabels = useMemo(() => secondaryLabels.filter((label) => !label.archived), [secondaryLabels]);
  const [draggedLabel, setDraggedLabel] = useState<{ kind: 'main' | 'secondary'; id: string } | null>(null);
  function moveMainLabel(id: string, targetId: string) {
    if (!labelSetId) { useProjectStore.getState().moveMainLabel(id, targetId); return; }
    const next = moveLabelInOrder(mainLabels, id, targetId);
    if (next !== mainLabels) editSet({ mainLabels: next });
  }
  function moveSecondaryLabel(id: string, targetId: string) {
    if (!labelSetId) { useProjectStore.getState().moveSecondaryLabel(id, targetId); return; }
    const next = moveLabelInOrder(secondaryLabels, id, targetId);
    if (next !== secondaryLabels) editSet({ secondaryLabels: next });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[1000px]">
        <DialogHeader>
          <DialogTitle>{t("Labels & Settings")}</DialogTitle>
          <DialogDescription>{t("Configure labeling categories, secondary tags, and project settings.")}</DialogDescription>
        </DialogHeader>

        {sharedSet && <div className="space-y-2 rounded-md border p-3">
          <Label htmlFor="label-set-name">{t('Label set name')}</Label>
          <Input id="label-set-name" value={sharedSet.name ? setName(sharedSet) : ''} placeholder={t('Untitled label set')} onChange={(event) => editSet({ name: event.target.value })} />
          <p className="text-xs text-muted-foreground">{t('Edits are saved to this shared label set and apply to every video using it.')}</p>
          <LabelSetSaveStatus />
        </div>}

        <p className="text-xs text-muted-foreground">{t('Drag labels or use the arrows to change their order.')}</p>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="h-auto max-w-full flex-wrap justify-start">
            <TabsTrigger value="main">{t("Main Labels")}</TabsTrigger>
            <TabsTrigger value="secondary">{t("Secondary Labels")}</TabsTrigger>
            {!labelSetId && <TabsTrigger value="settings">{t("Settings")}</TabsTrigger>}
          </TabsList>

          <TabsContent value="main" className="mt-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{t("Main labels (timeline tracks)")}</div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const l: MainLabel = {
                    id: createId(),
                    name: t("New Label"),
                    defaultName: t("New Label"),
                    color: '#22c55e',
                    preRollSec: 2,
                    postRollSec: 3,
                    hotkey: 'N',
                  };
                  upsertMainLabel(l);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />{t("Add")}</Button>
            </div>

            <div className="mt-2 rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]"> </TableHead>
                    <TableHead className="w-[90px]">{t('Order')}</TableHead>
                    <TableHead>{t("Type name")}</TableHead>
                    <TableHead className="w-[100px]">{t("Original preset")}</TableHead>
                    <TableHead className="w-[110px]">{t("Color")}</TableHead>
                    <TableHead className="w-[120px]">{t("Pre-roll (s)")}</TableHead>
                    <TableHead className="w-[120px]">{t("Post-roll (s)")}</TableHead>
                    <TableHead className="w-[120px]">{t("Hotkey")}</TableHead>
                    <TableHead className="w-[60px]"> </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleMainLabels.map((l, index) => (
                    <TableRow key={l.id} className={cn(draggedLabel?.id === l.id && 'opacity-50')}
                      onDragOver={(event) => { if (draggedLabel?.kind === 'main') event.preventDefault(); }}
                      onDrop={(event) => {
                        if (draggedLabel?.kind !== 'main') return;
                        event.preventDefault();
                        moveMainLabel(draggedLabel.id, l.id);
                        setDraggedLabel(null);
                      }}>
                      <TableCell>
                        <div className="h-4 w-4 rounded-sm" style={{ backgroundColor: l.color }} aria-hidden />
                      </TableCell>
                      <TableCell>
                        <LabelOrderControls name={mainLabelName(l, t)} index={index} count={visibleMainLabels.length}
                          onMove={(direction) => moveMainLabel(l.id, visibleMainLabels[index + direction].id)}
                          onDragStart={() => setDraggedLabel({ kind: 'main', id: l.id })} onDragEnd={() => setDraggedLabel(null)} />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={mainLabelName(l, t)}
                          onChange={(e) => upsertMainLabel({ ...l, name: e.target.value })}
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground italic">
                        {l.defaultName === 'Attack' || l.defaultName === 'Defense' ? t(l.defaultName) : l.defaultName || t("Custom")}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="color"
                          value={l.color}
                          onChange={(e) => upsertMainLabel({ ...l, color: e.target.value })}
                          className={cn('h-8 px-1')}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={l.preRollSec}
                          onChange={(e) => upsertMainLabel({ ...l, preRollSec: Math.max(0, Number(e.target.value)) })}
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={l.postRollSec}
                          onChange={(e) => upsertMainLabel({ ...l, postRollSec: Math.max(0, Number(e.target.value)) })}
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={l.hotkey}
                          onChange={(e) => upsertMainLabel({ ...l, hotkey: e.target.value })}
                          className="h-8 font-mono"
                        />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('Delete label')} onClick={() => deleteMainLabel(l.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="secondary" className="mt-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">{t("Secondary labels (tags)")}</div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const l: SecondaryLabel = { id: createId(), name: t("New Tag"), hotkey: 'T' };
                  upsertSecondaryLabel(l);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />{t("Add")}</Button>
            </div>

            <div className="mt-2 rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[90px]">{t('Order')}</TableHead>
                    <TableHead>{t("Name")}</TableHead>
                    <TableHead className="w-[140px]">{t("Hotkey")}</TableHead>
                    <TableHead className="w-[60px]"> </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleSecondaryLabels.map((l, index) => (
                    <TableRow key={l.id} className={cn(draggedLabel?.id === l.id && 'opacity-50')}
                      onDragOver={(event) => { if (draggedLabel?.kind === 'secondary') event.preventDefault(); }}
                      onDrop={(event) => {
                        if (draggedLabel?.kind !== 'secondary') return;
                        event.preventDefault();
                        moveSecondaryLabel(draggedLabel.id, l.id);
                        setDraggedLabel(null);
                      }}>
                      <TableCell>
                        <LabelOrderControls name={secondaryLabelName(l, t)} index={index} count={visibleSecondaryLabels.length}
                          onMove={(direction) => moveSecondaryLabel(l.id, visibleSecondaryLabels[index + direction].id)}
                          onDragStart={() => setDraggedLabel({ kind: 'secondary', id: l.id })} onDragEnd={() => setDraggedLabel(null)} />
                      </TableCell>
                      <TableCell>
                        <Input value={secondaryLabelName(l, t)} onChange={(e) => upsertSecondaryLabel({ ...l, name: e.target.value })} className="h-8" />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={l.hotkey ?? ''}
                          onChange={(e) => upsertSecondaryLabel({ ...l, hotkey: e.target.value })}
                          className="h-8 font-mono"
                        />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('Delete label')} onClick={() => deleteSecondaryLabel(l.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-2 text-xs text-muted-foreground">{t("Tip: after creating a segment (main label), press a secondary hotkey to append the tag to the most recent segment.")}</div>
          </TabsContent>

          <TabsContent value="settings" className="mt-3">
            <div className="grid gap-3">
              <div className="rounded-md border p-3">
                <LanguageSelector />
                <p className="mt-2 text-xs text-muted-foreground">{t('Choose your interface language.')}</p>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-sm font-medium">{t("Playback")}</div>
                <div className="mt-2 grid grid-cols-[140px_1fr] items-center gap-2">
                  <Label htmlFor="fps" className="text-sm">{t("FPS (frame step)")}</Label>
                  <Input
                    id="fps"
                    type="number"
                    value={detectedFps ?? 30}
                    disabled
                    className="h-8"
                  />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">{t("Detected from the loaded video via ffprobe. (If unknown, falls back to 30 fps.)")}</div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function LabelOrderControls({ name, index, count, onMove, onDragStart, onDragEnd }: {
  name: string; index: number; count: number; onMove: (direction: -1 | 1) => void;
  onDragStart: () => void; onDragEnd: () => void;
}) {
  const t = useTranslation();
  return <div className="flex items-center">
    <Button variant="ghost" size="icon" className="h-7 w-6 cursor-grab active:cursor-grabbing" draggable
      aria-label={t('Drag label {0} to reorder', name)} onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', name); event.dataTransfer.effectAllowed = 'move'; onDragStart();
      }} onDragEnd={onDragEnd}><GripVertical className="h-4 w-4" aria-hidden /></Button>
    <Button variant="ghost" size="icon" className="h-7 w-6" disabled={index === 0}
      aria-label={t('Move label {0} up', name)} onClick={() => onMove(-1)}><ArrowUp className="h-3 w-3" aria-hidden /></Button>
    <Button variant="ghost" size="icon" className="h-7 w-6" disabled={index === count - 1}
      aria-label={t('Move label {0} down', name)} onClick={() => onMove(1)}><ArrowDown className="h-3 w-3" aria-hidden /></Button>
  </div>;
}
