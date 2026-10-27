// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DiagnosticsButton, ErrorReportAction } from './DiagnosticsButton';
import { clearDiagnostics, recordDiagnostic } from '@/lib/diagnostics';
import { useLanguageStore } from '@/lib/i18n';

beforeEach(() => {
  clearDiagnostics(); useLanguageStore.setState({ language: 'en' });
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('copies a report correlated with an incident without including private project contents', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const errorId = recordDiagnostic('error', 'export', 'export.failed', { phase: 'Rendering gaps', ratio: 0.1 }, new Error('Encoder failed'));
  render(<ErrorReportAction errorId={errorId} />);
  expect(screen.getByText('Please share a report with us so we can investigate this error.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Share report' }));
  await screen.findByRole('button', { name: 'Copy report' });
  fireEvent.click(screen.getByRole('button', { name: 'Copy report' }));
  await screen.findByText('Report copied.');
  const report = JSON.parse(writeText.mock.calls[0][0]);
  expect(report.focusEventId).toBe(errorId);
  expect(report.events.at(-1)).toMatchObject({ id: errorId, details: { phase: 'Rendering gaps', ratio: 0.1 } });
  expect(report.project).not.toHaveProperty('segments');
});

it('offers a JSON download when clipboard access is denied', async () => {
  vi.stubGlobal('Blob', NodeBlob);
  const writeText = vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  let downloaded: Blob | undefined;
  URL.createObjectURL = vi.fn((blob: Blob) => { downloaded = blob; return 'blob:report'; });
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<DiagnosticsButton />);
  fireEvent.click(screen.getByRole('button', { name: 'Share diagnostics' }));
  await screen.findByRole('button', { name: 'Copy report' });
  fireEvent.click(screen.getByRole('button', { name: 'Copy report' }));
  await screen.findByText('Could not copy the report. Download it instead.');
  fireEvent.click(screen.getByRole('button', { name: 'Download report' }));
  expect(click).toHaveBeenCalledOnce();
  await waitFor(() => expect(downloaded).toBeTruthy());
  expect(JSON.parse(await downloaded!.text())).toMatchObject({ reportVersion: 1, storage: { persistent: 'unsupported' } });
});
