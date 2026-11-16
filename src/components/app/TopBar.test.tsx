// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TopBar } from './TopBar';
import { useProjectStore } from '@/store/projectStore';

let fullscreenElement: Element | null;
beforeEach(() => {
  fullscreenElement = null;
  Object.defineProperties(document, {
    fullscreenElement: { configurable: true, get: () => fullscreenElement },
    fullscreenEnabled: { configurable: true, value: true },
    exitFullscreen: { configurable: true, value: vi.fn(async () => {
      fullscreenElement = null; document.dispatchEvent(new Event('fullscreenchange'));
    }) },
  });
  Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: vi.fn(async () => {
    fullscreenElement = document.documentElement; document.dispatchEvent(new Event('fullscreenchange'));
  }) });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  for (const name of ['fullscreenElement', 'fullscreenEnabled', 'exitFullscreen']) Reflect.deleteProperty(document, name);
  Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
});

it('replaces New with a toggle that enters and exits fullscreen for the entire app', async () => {
  const savedProject = useProjectStore.getState().exportProjectJson();
  render(<TopBar onOpenSettings={vi.fn()} onOpenExport={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'New' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
  await screen.findByRole('button', { name: 'Exit fullscreen' });
  expect(document.documentElement.requestFullscreen).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Exit fullscreen' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }));
  await screen.findByRole('button', { name: 'Enter fullscreen' });
  expect(document.exitFullscreen).toHaveBeenCalledOnce();
  expect(useProjectStore.getState().exportProjectJson()).toBe(savedProject);
});

it('updates when fullscreen is dismissed using Escape or browser controls', async () => {
  render(<TopBar onOpenSettings={vi.fn()} onOpenExport={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
  await screen.findByRole('button', { name: 'Exit fullscreen' });
  act(() => { fullscreenElement = null; document.dispatchEvent(new Event('fullscreenchange')); });
  expect(screen.getByRole('button', { name: 'Enter fullscreen' }).getAttribute('aria-pressed')).toBe('false');
});

it('disables fullscreen when the browser does not support it', () => {
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
  render(<TopBar onOpenSettings={vi.fn()} onOpenExport={vi.fn()} />);
  const button = screen.getByRole('button', { name: 'Enter fullscreen' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.title).toBe('Fullscreen is not supported by this browser.');
});

it('handles denied requests and allows a retry', async () => {
  vi.mocked(document.documentElement.requestFullscreen).mockRejectedValueOnce(new Error('Request denied'));
  render(<TopBar onOpenSettings={vi.fn()} onOpenExport={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Could not change fullscreen mode. Try again.');
  expect((screen.getByRole('button', { name: 'Enter fullscreen' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
  await screen.findByRole('button', { name: 'Exit fullscreen' });
  expect(screen.queryByRole('alert')).toBeNull();
});
