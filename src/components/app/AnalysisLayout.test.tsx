// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnalysisLayout } from '@/components/app/AnalysisLayout';
import { useLanguageStore } from '@/lib/i18n';

let measure: () => void;
let size: { width: number; height: number };
beforeEach(() => {
  localStorage.clear();
  useLanguageStore.setState({ language: 'en' });
  size = { width: 1024, height: 700 };
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ ...size, x: 0, y: 0, left: 0, top: 0, right: size.width, bottom: size.height, toJSON() {} }));
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { measure = callback; } observe() {} disconnect() {} });
  vi.stubGlobal('PointerEvent', MouseEvent);
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: vi.fn(() => false) },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function layout() { return <AnalysisLayout sidebar={<div>Events</div>} player={<div>Video</div>} timeline={<div>Labels</div>} />; }
function value(name: 'Resize sidebar' | 'Resize timeline') { return Number(screen.getByRole('separator', { name }).getAttribute('aria-valuenow')); }
function drag(name: 'Resize sidebar' | 'Resize timeline', x: number, y: number) {
  const separator = screen.getByRole('separator', { name });
  fireEvent.pointerDown(separator, { button: 0, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(separator, { clientX: x, clientY: y });
  fireEvent.pointerUp(separator);
}

it('resizes both panes and remembers their sizes when reopening the workspace', () => {
  const app = render(layout());
  expect(value('Resize sidebar')).toBe(420);
  expect(value('Resize timeline')).toBe(156);
  drag('Resize sidebar', 80, 0);
  drag('Resize timeline', 0, -144);
  expect(value('Resize sidebar')).toBe(500);
  expect(value('Resize timeline')).toBe(300);
  app.unmount();
  render(layout());
  expect(value('Resize sidebar')).toBe(500);
  expect(value('Resize timeline')).toBe(300);
});

it('enforces two visible label rows and usable minimum sidebar and player sizes', () => {
  render(layout());
  drag('Resize sidebar', -1000, 0);
  drag('Resize timeline', 0, 1000);
  expect(value('Resize sidebar')).toBe(320);
  expect(value('Resize timeline')).toBe(156);
  drag('Resize sidebar', 1000, 0);
  drag('Resize timeline', 0, -1000);
  expect(value('Resize sidebar')).toBe(536); // 1024 - 480px player - 8px divider.
  expect(value('Resize timeline')).toBe(452); // 700 - 240px player - 8px divider.
});

it('clamps to a smaller window without overwriting the preferred sizes', () => {
  render(layout());
  drag('Resize sidebar', 80, 0);
  drag('Resize timeline', 0, -144);
  size = { width: 808, height: 404 };
  act(() => measure());
  expect(value('Resize sidebar')).toBe(320);
  expect(value('Resize timeline')).toBe(156);
  size = { width: 1024, height: 700 };
  act(() => measure());
  expect(value('Resize sidebar')).toBe(500);
  expect(value('Resize timeline')).toBe(300);
});

it('supports keyboard resizing and resets without taking over playback arrows', () => {
  render(layout());
  const sidebar = screen.getByRole('separator', { name: 'Resize sidebar' });
  const timeline = screen.getByRole('separator', { name: 'Resize timeline' });
  fireEvent.keyDown(sidebar, { key: 'ArrowRight' });
  expect(value('Resize sidebar')).toBe(420);
  fireEvent.keyDown(sidebar, { key: 'ArrowRight', altKey: true });
  fireEvent.keyDown(timeline, { key: 'ArrowUp', altKey: true, shiftKey: true });
  expect(value('Resize sidebar')).toBe(430);
  expect(value('Resize timeline')).toBe(206);
  fireEvent.doubleClick(sidebar);
  fireEvent.doubleClick(timeline);
  expect(value('Resize sidebar')).toBe(420);
  expect(value('Resize timeline')).toBe(156);
});

it('recovers from invalid saved dimensions or unavailable storage', () => {
  localStorage.setItem('ohv-analysis-layout-v1', '{broken');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
  render(layout());
  drag('Resize timeline', 0, -100);
  expect(value('Resize timeline')).toBe(256);
});
