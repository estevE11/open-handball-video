// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExportStudioModal } from './ExportStudioModal';
import { useProjectStore } from '@/store/projectStore';
import { exportFilteredSegmentsToMp4 } from '@/lib/exportMp4';

vi.mock('@/lib/exportMp4', () => ({ exportFilteredSegmentsToMp4: vi.fn() }));
vi.mock('@/lib/exportClipSequence', () => ({ exportClipSequence: vi.fn() }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); useProjectStore.getState().resetProject(); });

it('shows live progress, keeps failure below 100%, and resets correctly for a successful retry', async () => {
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
  await act(async () => reject(new Error('Encoding failed')));
  expect(screen.getByText('Export failed')).toBeTruthy();
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
