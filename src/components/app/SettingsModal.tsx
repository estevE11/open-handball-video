import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { createId } from '@/lib/ids';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/store/projectStore';
import type { MainLabel, SecondaryLabel } from '@/types/project';

type SettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const mainLabels = useProjectStore((s) => s.mainLabels);
  const secondaryLabels = useProjectStore((s) => s.secondaryLabels);
  const detectedFps = useProjectStore((s) => s.videoMeta?.fps);

  const upsertMainLabel = useProjectStore((s) => s.upsertMainLabel);
  const deleteMainLabel = useProjectStore((s) => s.deleteMainLabel);
  const upsertSecondaryLabel = useProjectStore((s) => s.upsertSecondaryLabel);
  const deleteSecondaryLabel = useProjectStore((s) => s.deleteSecondaryLabel);

  const [tab, setTab] = useState<'main' | 'secondary' | 'settings'>('main');

  const mainSorted = useMemo(() => [...mainLabels].sort((a, b) => a.name.localeCompare(b.name)), [mainLabels]);
  const secondarySorted = useMemo(() => [...secondaryLabels].sort((a, b) => a.name.localeCompare(b.name)), [secondaryLabels]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle>Labels & Settings</DialogTitle>
          <DialogDescription>Configure labeling categories, secondary tags, and project settings.</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="main">Main Labels</TabsTrigger>
            <TabsTrigger value="secondary">Secondary Labels</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="main" className="mt-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Main labels (timeline tracks)</div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const l: MainLabel = {
                    id: createId(),
                    name: 'New Label',
                    defaultName: 'New Label',
                    color: '#22c55e',
                    preRollSec: 2,
                    postRollSec: 3,
                    hotkey: 'N',
                  };
                  upsertMainLabel(l);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add
              </Button>
            </div>

            <div className="mt-2 rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]"> </TableHead>
                    <TableHead>Display Name</TableHead>
                    <TableHead className="w-[100px]">Type</TableHead>
                    <TableHead className="w-[110px]">Color</TableHead>
                    <TableHead className="w-[120px]">Pre-roll (s)</TableHead>
                    <TableHead className="w-[120px]">Post-roll (s)</TableHead>
                    <TableHead className="w-[120px]">Hotkey</TableHead>
                    <TableHead className="w-[60px]"> </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mainSorted.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <div className="h-4 w-4 rounded-sm" style={{ backgroundColor: l.color }} aria-hidden />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={l.name}
                          onChange={(e) => upsertMainLabel({ ...l, name: e.target.value })}
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground italic">
                        {l.defaultName || 'Custom'}
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
                          onChange={(e) => upsertMainLabel({ ...l, preRollSec: Number(e.target.value) })}
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={l.postRollSec}
                          onChange={(e) => upsertMainLabel({ ...l, postRollSec: Number(e.target.value) })}
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
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteMainLabel(l.id)}>
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
              <div className="text-sm font-medium">Secondary labels (tags)</div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const l: SecondaryLabel = { id: createId(), name: 'New Tag', hotkey: 'T' };
                  upsertSecondaryLabel(l);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add
              </Button>
            </div>

            <div className="mt-2 rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-[140px]">Hotkey</TableHead>
                    <TableHead className="w-[60px]"> </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {secondarySorted.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <Input value={l.name} onChange={(e) => upsertSecondaryLabel({ ...l, name: e.target.value })} className="h-8" />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={l.hotkey ?? ''}
                          onChange={(e) => upsertSecondaryLabel({ ...l, hotkey: e.target.value })}
                          className="h-8 font-mono"
                        />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteSecondaryLabel(l.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-2 text-xs text-muted-foreground">
              Tip: after creating a segment (main label), press a secondary hotkey to append the tag to the most recent segment.
            </div>
          </TabsContent>

          <TabsContent value="settings" className="mt-3">
            <div className="grid gap-3">
              <div className="rounded-md border p-3">
                <div className="text-sm font-medium">Playback</div>
                <div className="mt-2 grid grid-cols-[140px_1fr] items-center gap-2">
                  <Label htmlFor="fps" className="text-sm">
                    FPS (frame step)
                  </Label>
                  <Input
                    id="fps"
                    type="number"
                    value={detectedFps ?? 30}
                    disabled
                    className="h-8"
                  />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Detected from the loaded video via ffprobe. (If unknown, falls back to 30 fps.)
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}


