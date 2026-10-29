// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExportStudioModal } from './ExportStudioModal';
import { useProjectStore } from '@/store/projectStore';
import { exportFilteredSegmentsToMp4 } from '@/lib/exportMp4';
import { exportClipSequence } from '@/lib/exportClipSequence';
import { clearDiagnostics, createDiagnosticReport, recordEngineLog } from '@/lib/diagnostics';

vi.mock('@/lib/exportMp4', () => ({ exportFilteredSegmentsToMp4: vi.fn() }));
vi.mock('@/lib/exportClipSequence', () => ({ exportClipSequence: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useProjectStore.getState().resetProject(); });

it('shows live progress, keeps failure below 100%, and resets correctly for a successful retry', async () => {
  clearDiagnostics();
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  useProjectStore.getState().resetProject();
  const state = useProjectStore.getState();
  state.setVideoFile(new File(['video'], 'match.mp4'), 'blob:test', 60);
  state.createSegmentFromTrigger(state.mainLabels[0].id, 10);
  let report!: (phase: string, ratio: number) => void;
  let resolve!: (blob: Blob) => void;
  let reject!: (error: Error) => void;
  vi.mocked(exportFilteredSegmentsToMp4).mockImplementation((_input, _segments, _output, opts) => {
    report = opts!.onProgress!;
    return new Promise<Blob>((yes, no) => { resolve = yes; reject = no; });
  });
  const onOpenChange = vi.fn();
  render(<ExportStudioModal open onOpenChange={onOpenChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Render MP4' }));
  const bar = screen.getByRole('progressbar', { name: 'Export progress' });
  expect(bar.getAttribute('aria-valuenow')).toBe('0');
  act(() => report('Rendering clip 1 of 2', 0.4));
  expect(bar.getAttribute('aria-valuenow')).toBe('40');
  act(() => report('Retrying render', 0.1));
  expect(bar.getAttribute('aria-valuenow')).toBe('40');
  act(() => report('Preparing download', 1));
  expect(bar.getAttribute('aria-valuenow')).toBe('99');
  recordEngineLog('Encoder output: unsupported pixel format');
  await act(async () => reject(new Error('Encoding failed')));
  expect(screen.getByText('Export failed')).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('Encoding failed');
  expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Share report' })).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toContain('Please share a report with us so we can investigate this error.');
  const diagnostics = await createDiagnosticReport();
  expect(diagnostics.events.at(-1)).toMatchObject({ code: 'export.failed', details: { phase: 'Preparing download', ratio: 1, selectedSegments: 1 }, error: { message: 'Encoding failed' } });
  expect(diagnostics.events.at(-1)?.context).toMatchObject({ export: { status: 'failed' },
    exportPlan: { totalCount: 1, selection: [{ exportIndex: 1, timelineIndex: 1, startTimeSec: expect.any(Number), endTimeSec: expect.any(Number) }] } });
  expect(diagnostics.engineLogs.at(-1)?.message).toContain('unsupported pixel format');
  fireEvent.click(screen.getByRole('button', { name: 'Share report' }));
  const reportDialog = await screen.findByRole('dialog', { name: 'Beta diagnostic report' });
  await waitFor(() => expect(reportDialog.querySelector('pre')).toBeTruthy());
  const shared = JSON.parse(reportDialog.querySelector('pre')!.textContent!);
  expect(shared.focusEventId).toBe(diagnostics.events.at(-1)?.id);
  expect(shared.events.at(-1).error.message).toBe('Encoding failed');
  fireEvent.click(within(reportDialog).getByRole('button', { name: 'Close' }));
  expect(bar.getAttribute('aria-valuenow')).toBe('99');
  fireEvent.click(screen.getByRole('button', { name: 'Render MP4' }));
  expect(bar.getAttribute('aria-valuenow')).toBe('0');
  act(() => report('Rendering tagged clips', 0.6));
  await act(async () => resolve(new Blob(['mp4'])));
  await waitFor(() => expect(bar.getAttribute('aria-valuenow')).toBe('100'));
  expect(screen.getByText('Export ready')).toBeTruthy();
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
});

it('cancels without downloading and permits an immediate retry', async () => {
  URL.createObjectURL = vi.fn(() => 'blob:test'); URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const state = useProjectStore.getState();
  state.setVideoFile(new File(['video'], 'match.mp4'), 'blob:test', 60);
  state.createSegmentFromTrigger(state.mainLabels[0].id, 10);
  let signal: AbortSignal | undefined;
  vi.mocked(exportFilteredSegmentsToMp4).mockImplementation((_input, _segments, _output, opts) => {
    signal = opts!.signal;
    opts!.onProgress!('Rendering', 0.4);
    return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('Export cancelled', 'AbortError'))));
  });
  render(<ExportStudioModal open onOpenChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Render MP4' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel export' }));
  await screen.findByText('Export cancelled');
  expect(signal?.aborted).toBe(true);
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
  vi.mocked(exportFilteredSegmentsToMp4).mockResolvedValue(new Blob(['ready']));
  fireEvent.click(screen.getByRole('button', { name: 'Render MP4' }));
  await screen.findByText('Export ready');
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
});

it.each(['single video', 'multiple videos'])('exports only checked matching clips for %s', async (mode) => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  URL.createObjectURL = vi.fn(() => 'blob:test'); URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const state = useProjectStore.getState();
  state.setVideoFile(new File(['video'], 'match.mp4'), 'blob:test', 60);
  const later = state.createSegmentFromTrigger(state.mainLabels[0].id, 30)!;
  const earlier = state.createSegmentFromTrigger(state.mainLabels[0].id, 10)!;
  const otherType = state.createSegmentFromTrigger(state.mainLabels[1].id, 20)!;
  if (mode === 'multiple videos') useProjectStore.setState({
    clips: ['first', 'second'].map((id) => ({ id, fileName: `${id}.mp4`, fileSize: 5, fileType: 'video/mp4', lastModified: 0, durationSec: 30 })),
    session: { ...useProjectStore.getState().session, clipSources: [{ url: 'blob:first', file: null }, { url: 'blob:second', file: null }] },
  });
  const savedProject = useProjectStore.getState().exportProjectJson();
  vi.mocked(exportFilteredSegmentsToMp4).mockResolvedValue(new Blob(['mp4']));
  vi.mocked(exportClipSequence).mockResolvedValue(new Blob(['mp4']));
  render(<ExportStudioModal open onOpenChange={() => {}} />);
  const clipCheckboxes = () => screen.getAllByRole('checkbox', { name: /^Include .* in export$/ });
  expect(clipCheckboxes().every((box) => box.getAttribute('aria-checked') === 'true')).toBe(true);
  fireEvent.click(clipCheckboxes()[0]);
  expect(screen.getByText('2 of 3 matching clips selected for export')).toBeTruthy();

  // Filter away the excluded clip and back: its exclusion must survive.
  fireEvent.click(screen.getAllByRole('combobox')[0]);
  fireEvent.click(screen.getByRole('option', { name: state.mainLabels[1].name }));
  expect(clipCheckboxes()).toHaveLength(1);
  fireEvent.click(screen.getByRole('option', { name: 'Any' }));
  fireEvent.keyDown(screen.getByPlaceholderText('Search main labels...'), { key: 'Escape' });
  expect(clipCheckboxes()[0].getAttribute('aria-checked')).toBe('false');
  fireEvent.click(clipCheckboxes()[1]);
  fireEvent.click(clipCheckboxes()[2]);
  expect((screen.getByRole('button', { name: 'Render MP4' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(clipCheckboxes()[1]);
  fireEvent.click(clipCheckboxes()[2]);
  fireEvent.click(screen.getByRole('button', { name: 'Render MP4' }));
  await screen.findByText('Export ready');
  const exported = mode === 'multiple videos'
    ? vi.mocked(exportClipSequence).mock.lastCall![2]
    : vi.mocked(exportFilteredSegmentsToMp4).mock.lastCall![1];
  expect(exported.map((seg) => seg.id)).toEqual([otherType.id, later.id]);
  expect(exported.map((seg) => seg.id)).not.toContain(earlier.id);
  expect(useProjectStore.getState().exportProjectJson()).toBe(savedProject);
});

it('allows excluding matching clips beyond the first 200 rows', () => {
  const state = useProjectStore.getState();
  state.setVideoFile(new File(['video'], 'match.mp4'), 'blob:test', 1000);
  const segment = state.createSegmentFromTrigger(state.mainLabels[0].id, 10)!;
  useProjectStore.setState({ segments: Array.from({ length: 201 }, (_, i) => ({ ...segment, id: `segment-${i}`, startTimeSec: i * 2, endTimeSec: i * 2 + 1 })) });
  render(<ExportStudioModal open onOpenChange={() => {}} />);
  const boxes = screen.getAllByRole('checkbox', { name: /^Include .* in export$/ });
  expect(boxes).toHaveLength(201);
  fireEvent.click(boxes[200]);
  expect(screen.getByText('200 of 201 matching clips selected for export')).toBeTruthy();
});

it.each(['single video', 'multiple videos'])('keeps timeline numbers while reordering the %s export', async (mode) => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  URL.createObjectURL = vi.fn(() => 'blob:test'); URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const state = useProjectStore.getState();
  state.setVideoFile(new File(['video'], 'match.mp4'), 'blob:test', 60);
  const third = state.createSegmentFromTrigger(state.mainLabels[0].id, 30)!;
  const first = state.createSegmentFromTrigger(state.mainLabels[0].id, 10)!;
  state.createSegmentFromTrigger(state.mainLabels[1].id, 20);
  if (mode === 'multiple videos') useProjectStore.setState({
    clips: ['first', 'second'].map((id) => ({ id, fileName: `${id}.mp4`, fileSize: 5, fileType: 'video/mp4', lastModified: 0, durationSec: 30 })),
    session: { ...useProjectStore.getState().session, clipSources: [{ url: 'blob:first', file: null }, { url: 'blob:second', file: null }] },
  });
  const savedProject = useProjectStore.getState().exportProjectJson();
  vi.mocked(exportFilteredSegmentsToMp4).mockResolvedValue(new Blob(['mp4']));
  vi.mocked(exportClipSequence).mockResolvedValue(new Blob(['mp4']));
  render(<ExportStudioModal open onOpenChange={() => {}} />);
  const numbers = () => screen.getAllByRole('cell', { name: /^Timeline position / }).map((cell) => cell.textContent);
  const row = (number: number) => screen.getByRole('cell', { name: `Timeline position ${number}` }).closest('tr')!;
  expect(numbers()).toEqual(['1', '2', '3']);
  fireEvent.click(screen.getByRole('button', { name: 'Move clip 3 up' }));
  fireEvent.click(screen.getByRole('button', { name: 'Move clip 3 up' }));
  expect(numbers()).toEqual(['3', '1', '2']);
  const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
  fireEvent.dragStart(screen.getByRole('button', { name: 'Drag clip 1 to reorder' }), { dataTransfer });
  fireEvent.dragOver(row(2), { dataTransfer });
  fireEvent.drop(row(2), { dataTransfer });
  expect(numbers()).toEqual(['3', '2', '1']);
  fireEvent.click(within(row(2)).getByRole('checkbox'));
  fireEvent.click(screen.getAllByRole('combobox')[0]);
  fireEvent.click(screen.getByRole('option', { name: state.mainLabels[1].name }));
  expect(numbers()).toEqual(['2']);
  fireEvent.click(screen.getByRole('option', { name: 'Any' }));
  fireEvent.keyDown(screen.getByPlaceholderText('Search main labels...'), { key: 'Escape' });
  expect(numbers()).toEqual(['3', '2', '1']);
  expect(within(row(2)).getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Reset order' }));
  expect(numbers()).toEqual(['1', '2', '3']);
  fireEvent.click(screen.getByRole('button', { name: 'Move clip 1 down' }));
  fireEvent.click(screen.getByRole('button', { name: 'Move clip 3 up' }));
  expect(numbers()).toEqual(['2', '3', '1']);
  fireEvent.click(screen.getByRole('button', { name: 'Render MP4' }));
  expect((screen.getByRole('button', { name: 'Move clip 1 up' }) as HTMLButtonElement).disabled).toBe(true);
  await screen.findByText('Export ready');
  const exported = mode === 'multiple videos'
    ? vi.mocked(exportClipSequence).mock.lastCall![2]
    : vi.mocked(exportFilteredSegmentsToMp4).mock.lastCall![1];
  expect(exported.map((seg) => seg.id)).toEqual([third.id, first.id]);
  expect(useProjectStore.getState().exportProjectJson()).toBe(savedProject);
});
