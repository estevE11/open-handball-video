/// <reference types="node" />
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { File as NodeFile, Blob as NodeBlob } from 'node:buffer';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { within } from '@testing-library/react';
import { applyLibraryChange, type LibraryCatalog } from '../electron/libraryCatalog';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '@/App';
import { readLanguage, translate, useLanguageStore } from '@/lib/i18n';
import { useProjectStore } from '@/store/projectStore';
import { loadLabelSets, flushLabelSets, useLabelSetStore } from '@/store/labelSetStore';
import { useLibraryStore } from '@/store/libraryStore';
import { deleteBrowserProject, listBrowserProjects, loadBrowserProject } from '@/lib/browserStorage';

vi.mock('@/lib/videoProbe', () => ({ probeVideoFps: async () => 30 }));
vi.mock('@/lib/exportMp4', () => ({ exportFilteredSegmentsToMp4: vi.fn() }));

beforeEach(async () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  URL.createObjectURL = vi.fn(() => 'blob:test-video');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  Object.defineProperty(navigator, 'storage', { configurable: true, value: {
    estimate: async () => ({ usage: 1000, quota: 1000000 }),
    persisted: async () => true,
    persist: async () => true,
  } });
  await loadLabelSets().catch(() => {});
  await flushLabelSets().catch(() => {});
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('ohv.library.v1', 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, options] of [['projects', { keyPath: 'id' }], ['videos', undefined], ['labelSets', { keyPath: 'id' }], ['catalog', undefined]] as const) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, options);
      }
    };
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction(['labelSets', 'catalog'], 'readwrite');
      tx.objectStore('labelSets').clear();
      tx.objectStore('catalog').clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  });
  useLabelSetStore.setState({ sets: [], loaded: false, pending: 0, error: '' });
  useLibraryStore.setState({ catalog: { folders: [], teams: [] }, loaded: false, backend: null, error: '' });
  localStorage.clear();
  useLanguageStore.setState({ language: 'en' });
  useProjectStore.getState().resetProject();
  for (const project of await listBrowserProjects()) await deleteBrowserProject(project.id);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); useLanguageStore.setState({ language: 'en' }); });

async function chooseDefaultSet() {
  const language = useLanguageStore.getState().language;
  await screen.findByRole('dialog', { name: translate(language, 'Choose a label set') });
  fireEvent.click(await screen.findByRole('button', { name: translate(language, 'Use label set {0}', translate(language, 'Default handball labels')) }));
}
async function enterVideo() {
  const language = useLanguageStore.getState().language;
  await waitFor(() => {
    expect(screen.queryByRole('dialog', { name: translate(language, 'Choose a label set') })
      || screen.queryByRole('button', { name: translate(language, 'Back to projects') })).toBeTruthy();
  });
  if (screen.queryByRole('dialog', { name: translate(language, 'Choose a label set') })) await chooseDefaultSet();
  await waitFor(() => expect(screen.queryByRole('button', { name: translate(language, 'Create video') }) || screen.queryByRole('button', { name: translate(language, 'Back to projects') })).toBeTruthy());
  if (screen.queryByRole('button', { name: translate(language, 'Create video') })) await finishCreation();
  await screen.findByRole('button', { name: translate(language, 'Back to projects') });
}
async function finishCreation() {
  fireEvent.click(await screen.findByRole('button', { name: translate(useLanguageStore.getState().language, 'Create video') }));
}
async function clickVideoTitle(name: string) {
  const title = await screen.findByText(name);
  await waitFor(() => expect(title.closest('button')!.hasAttribute('disabled')).toBe(false));
  fireEvent.click(title);
}

it('adds video, autosaves edits before immediate navigation, and restores project after remount', async () => {
  const app = render(<App />);
  await screen.findByText('No saved projects yet.');
  const file = new File(['test-video-bytes'], 'match.mp4', { type: 'video/mp4' });
  fireEvent.change(screen.getByLabelText('Add video file'), { target: { files: [file] } });
  await enterVideo();
  const id = useProjectStore.getState().projectId;
  act(() => {
    const state = useProjectStore.getState();
    state.createSegmentFromTrigger(state.mainLabels[0].id, 10);
    state.updateSettings({ fps: 60 });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
  await screen.findByRole('button', { name: 'Open project' });
  await waitFor(() => expect(screen.getByText(/About .* more projects/)).toBeTruthy());
  expect((await loadBrowserProject(id)).data.segments).toHaveLength(1);
  expect((await loadBrowserProject(id)).data.settings.fps).toBe(60);
  app.unmount();
  useProjectStore.getState().resetProject();
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open project' }));
  await enterVideo();
  expect(screen.queryByText('Attach project video')).toBeNull();
  expect(useProjectStore.getState().session.videoFile?.name).toBe('match.mp4');
  expect(useProjectStore.getState().segments).toHaveLength(1);
  expect(await useProjectStore.getState().session.videoFile?.text()).toBe('test-video-bytes');
  expect(screen.queryByLabelText('Browser storage')).toBeNull();
});

it('updates the timeline when MOV duration changes after initial metadata', async () => {
  const { useVideoStore } = await import('@/store/videoStore');
  const app = render(<App />);
  await screen.findByText('No saved projects yet.');
  const file = new File(['test-video'], 'match.mov', { type: 'video/quicktime' });
  fireEvent.change(screen.getByLabelText('Add video file'), { target: { files: [file] } });
  await enterVideo();
  const player = app.container.querySelector('video')!;
  Object.defineProperty(player, 'duration', { configurable: true, value: NaN });
  Object.defineProperty(player, 'readyState', { configurable: true, value: 1 });
  fireEvent.loadedMetadata(player);
  expect(useVideoStore.getState().durationSec).toBe(0);
  Object.defineProperty(player, 'duration', { configurable: true, value: 120 });
  fireEvent.durationChange(player);
  expect(useVideoStore.getState().durationSec).toBe(120);
  expect(useProjectStore.getState().videoMeta?.durationSec).toBe(120);
  Object.defineProperty(player, 'duration', { configurable: true, value: NaN });
  fireEvent.durationChange(player);
  expect(useVideoStore.getState().durationSec).toBe(120);
  const id = useProjectStore.getState().projectId;
  await waitFor(async () => expect((await loadBrowserProject(id)).data.videoMeta?.durationSec).toBe(120));
});

it('shows complete hour timestamps in the player and timeline ruler', async () => {
  const { useVideoStore } = await import('@/store/videoStore');
  const app = render(<App />);
  await screen.findByText('No saved projects yet.');
  const file = new File(['test-video'], 'long-match.mp4', { type: 'video/mp4' });
  fireEvent.change(screen.getByLabelText('Add video file'), { target: { files: [file] } });
  await enterVideo();
  const player = app.container.querySelector('video')!;
  Object.defineProperty(player, 'duration', { configurable: true, value: 4260 });
  fireEvent.loadedMetadata(player);
  act(() => useVideoStore.getState().setCurrentTimeSec(4205.123));
  expect(screen.getByText('01:10:05.123 / 01:11:00.000')).toBeTruthy();
  const ruler = screen.getByLabelText('Timeline tracks');
  expect(within(ruler).getByText('01:10:00.000')).toBeTruthy();
  expect(within(ruler).getByText('00.000')).toBeTruthy();
  expect(within(ruler).getByText('02.000')).toBeTruthy();
  expect(within(ruler).getByText('01:00.000')).toBeTruthy();
});

it('imports JSON as a separate project and stores its attached video', async () => {
  render(<App />);
  await screen.findByText('No saved projects yet.');
  const data = JSON.parse(useProjectStore.getState().exportProjectJson());
  data.videoMeta = { fileName: 'import.mp4', fileType: 'video/mp4', fileSize: 5, lastModified: 1 };
  const json = new File([JSON.stringify(data)], 'project.json', { type: 'application/json' });
  fireEvent.change(screen.getByLabelText('Import project JSON file'), { target: { files: [json] } });
  fireEvent.click(await screen.findByRole('button', { name: 'Open project' }));
  await screen.findByText('Attach project video');
  expect(useProjectStore.getState().projectId).not.toBe(data.projectId);
  const dialog = screen.getByRole('dialog');
  const video = new File(['video'], 'import.mp4', { type: 'video/mp4' });
  fireEvent.change(dialog.querySelector('input')!, { target: { files: [video] } });
  await waitFor(() => expect(screen.queryByText('Attach project video')).toBeNull());
  const restored = await loadBrowserProject(useProjectStore.getState().projectId);
  expect(await restored.file?.text()).toBe('video');
});

it('confirms video removal and reattaches the original file without losing analysis', async () => {
  const app = render(<App />);
  await screen.findByText('No saved projects yet.');
  const file = new File(['original-video'], 'archive.mp4', { type: 'video/mp4', lastModified: 1000 });
  fireEvent.change(screen.getByLabelText('Add video file'), { target: { files: [file] } });
  await enterVideo();
  act(() => {
    const state = useProjectStore.getState();
    state.createSegmentFromTrigger(state.mainLabels[0].id, 10);
    state.updateSettings({ fps: 60 });
    state.setVideoDurationSec(120);
    state.setVideoFps(30);
  });
  const id = useProjectStore.getState().projectId;
  fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Actions for archive.mp4' }));
  await screen.findByRole('button', { name: 'Remove video' });
  const before = (await loadBrowserProject(id)).data;
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Remove video' }));
  expect((await loadBrowserProject(id)).file?.size).toBe(file.size);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Actions for archive.mp4' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove video' }));
  await screen.findByText(/Video not stored. Project data kept/);
  expect(screen.queryByRole('button', { name: 'Remove video' })).toBeNull();
  expect((await loadBrowserProject(id)).data).toEqual(before);
  expect((await loadBrowserProject(id)).file).toBeUndefined();
  app.unmount();
  useProjectStore.getState().resetProject();
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open project' }));
  await screen.findByText('Attach project video');
  fireEvent.change(screen.getByRole('dialog').querySelector('input')!, { target: { files: [file] } });
  await waitFor(() => expect(screen.queryByText('Attach project video')).toBeNull());
  const restored = await loadBrowserProject(id);
  expect(restored.data).toEqual({ ...before, updatedAtMs: restored.data.updatedAtMs });
  expect(await restored.file?.text()).toBe('original-video');
  expect(useProjectStore.getState().videoMeta?.durationSec).toBe(120);
  expect(useProjectStore.getState().settings.fps).toBe(60);
  expect(useProjectStore.getState().segments).toHaveLength(1);
});

it('orders a split match, seeks and plays across boundaries, and tags on match time', async () => {
  const clipTimeline = await import('@/lib/clipTimeline');
  vi.spyOn(clipTimeline, 'readVideoDuration').mockImplementation(async (file) => typeof file !== 'string' && file.name === 'first.mp4' ? 10 : 20);
  let urlIndex = 0;
  URL.createObjectURL = vi.fn(() => `blob:clip-${urlIndex++}`);
  const { useVideoStore } = await import('@/store/videoStore');
  const app = render(<App />);
  await screen.findByText('No saved projects yet.');
  const first = new File(['first'], 'first.mp4'); const second = new File(['second'], 'second.mp4');
  fireEvent.change(screen.getByLabelText('Add video file'), { target: { files: [second, first] } });
  await screen.findByText('Arrange match clips');
  const rows = screen.getByRole('list', { name: 'Clip order' }).querySelectorAll('li');
  const dataTransfer = { setData: vi.fn() };
  fireEvent.dragStart(rows[1], { dataTransfer });
  fireEvent.dragOver(rows[0], { dataTransfer });
  fireEvent.drop(rows[0], { dataTransfer });
  expect(screen.getByRole('list', { name: 'Clip order' }).querySelector('li')?.textContent).toContain('first.mp4');
  fireEvent.click(screen.getByRole('button', { name: 'Start tagging' }));
  await enterVideo();
  const id = useProjectStore.getState().projectId;
  expect(useProjectStore.getState().clips?.map((clip) => clip.fileName)).toEqual(['first.mp4', 'second.mp4']);
  expect(useVideoStore.getState().durationSec).toBe(30);
  let player = app.container.querySelector('video')!;
  Object.defineProperty(player, 'duration', { configurable: true, value: 10 });
  Object.defineProperty(player, 'readyState', { configurable: true, value: 1 });
  fireEvent.loadedMetadata(player);
  act(() => useVideoStore.getState().setCurrentTimeSec(12));
  player = app.container.querySelector('video')!;
  Object.defineProperty(player, 'duration', { configurable: true, value: 20 });
  Object.defineProperty(player, 'readyState', { configurable: true, value: 1 });
  fireEvent.loadedMetadata(player);
  expect(player.currentTime).toBe(2);
  expect(screen.getByText('Clip 2/2: second.mp4')).toBeTruthy();
  act(() => useVideoStore.getState().setCurrentTimeSec(9));
  player = app.container.querySelector('video')!;
  Object.defineProperty(player, 'duration', { configurable: true, value: 10 });
  Object.defineProperty(player, 'readyState', { configurable: true, value: 1 });
  fireEvent.loadedMetadata(player);
  expect(player.currentTime).toBe(9);
  fireEvent.keyDown(window, { key: 'a' });
  expect(useProjectStore.getState().segments[0]).toMatchObject({ startTimeSec: 7, endTimeSec: 12 });
  fireEvent.click(screen.getByRole('button', { name: 'Play' }));
  Object.defineProperty(player, 'ended', { configurable: true, value: true });
  fireEvent.ended(player);
  expect(useVideoStore.getState().currentTimeSec).toBe(10);
  expect(useVideoStore.getState().isPlaying).toBe(true);
  expect(screen.getByText('Clip 2/2: second.mp4')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
  await screen.findByRole('button', { name: 'Open project' });
  const saved = await loadBrowserProject(id);
  expect(saved.files.map((file) => file.name)).toEqual(['first.mp4', 'second.mp4']);
  expect(saved.data.segments[0]).toMatchObject({ startTimeSec: 7, endTimeSec: 12 });
  app.unmount();
  useProjectStore.getState().resetProject();
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open project' }));
  await enterVideo();
  expect(useProjectStore.getState().clips?.map((clip) => clip.fileName)).toEqual(['first.mp4', 'second.mp4']);
  expect(useProjectStore.getState().segments).toHaveLength(1);
});

it('keeps the library unchanged when clip preparation fails or is cancelled', async () => {
  const clipTimeline = await import('@/lib/clipTimeline');
  vi.spyOn(clipTimeline, 'readVideoDuration').mockRejectedValue(new Error('Unreadable clip'));
  render(<App />);
  await screen.findByText('No saved projects yet.');
  fireEvent.change(screen.getByLabelText('Add video file'), { target: { files: [new File(['a'], 'a.mp4'), new File(['b'], 'b.mp4')] } });
  fireEvent.click(await screen.findByRole('button', { name: 'Start tagging' }));
  await chooseDefaultSet();
  await waitFor(() => expect(screen.getAllByText(/Unreadable clip/).length).toBeGreaterThan(0));
  expect(await listBrowserProjects()).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByText('Arrange match clips')).toBeNull();
});

it('restores removed split-match clips by identity even when selected in reverse order', async () => {
  const { fileMeta, withProjectClips } = await import('@/lib/clipTimeline');
  const { saveBrowserProject, removeBrowserProjectVideo } = await import('@/lib/browserStorage');
  const { createEmptyProject } = await import('@/lib/projectDefaults');
  const files = [new File(['one'], 'one.mp4'), new File(['two2'], 'two.mp4')];
  const data = withProjectClips(createEmptyProject(), files.map((file, index) => ({ ...fileMeta(file), id: String(index), durationSec: 10 })));
  data.segments.push({ id: 'tag', mainLabelId: data.mainLabels[0].id, startTimeSec: 8, endTimeSec: 12, secondaryLabelIds: [], createdAtMs: 1 });
  await saveBrowserProject(data, files);
  await removeBrowserProjectVideo(data.projectId);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open project' }));
  await screen.findByRole('dialog');
  fireEvent.change(screen.getByRole('dialog').querySelector('input')!, { target: { files: [files[0]] } });
  await screen.findByText('Choose all 2 original clips to restore this project.');
  expect((await loadBrowserProject(data.projectId)).files).toHaveLength(0);
  fireEvent.change(screen.getByRole('dialog').querySelector('input')!, { target: { files: [...files].reverse() } });
  await waitFor(() => expect(screen.queryByText('Attach project video')).toBeNull());
  expect(useProjectStore.getState().session.clipSources.map((source) => source.file?.name)).toEqual(['one.mp4', 'two.mp4']);
  expect(useProjectStore.getState().segments).toEqual(data.segments);
  expect((await loadBrowserProject(data.projectId)).files.map((file) => file.name)).toEqual(['one.mp4', 'two.mp4']);
});

it('creates and reopens an Electron split match using its own save key', async () => {
  const timeline = await import('@/lib/clipTimeline');
  vi.spyOn(timeline, 'readVideoDuration').mockResolvedValue(10);
  const videos = ['first.mp4', 'second.mp4'].map((name) => ({ name, path: `/videos/${name}`, url: `file:///videos/${name}`, size: 10, modifiedAt: 1, createdAt: 1 }));
  const saved: import('@/types/project').ProjectData[] = [];
  await loadLabelSets();
  window.electron = {
    getLabelSets: async () => useLabelSetStore.getState().sets,
    getSavedProjects: async () => [],
    saveLabelSet: vi.fn(async () => {}),
    cancelExport: vi.fn(async () => {}),
    probeVideoMetadata: vi.fn(async () => ({ fps: 25, durationSec: 10 })),
    onExportProgress: vi.fn(() => () => {}),
    getVideos: async () => videos, getClipProjects: async () => saved,
    loadProject: vi.fn(async () => null),
    saveProject: vi.fn(async (key, data) => { expect(key).toBe(data.projectId); saved.splice(0, saved.length, data); return true; }),
    readFile: vi.fn(), runNativeExport: vi.fn(), runNativeClipExport: vi.fn(),
  };
  try {
    render(<App />);
    const checkboxes = await screen.findAllByRole('checkbox', { name: 'Include in split match' });
    fireEvent.click(checkboxes[0]); fireEvent.click(checkboxes[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Arrange selected clips (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move second.mp4 up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start tagging' }));
    await enterVideo();
    expect(useProjectStore.getState().session.clipSources.map((source) => source.url)).toEqual(['file:///videos/second.mp4', 'file:///videos/first.mp4']);
    expect(window.electron.loadProject).not.toHaveBeenCalled();
    expect(useProjectStore.getState().clips?.map((clip) => clip.fps)).toEqual([25, 25]);
    act(() => { const state = useProjectStore.getState(); state.createSegmentFromTrigger(state.mainLabels[0].id, 9); });
    fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open match: second.mp4 (+1 clips) (2 clips)' }));
    await enterVideo();
    expect(useProjectStore.getState().segments).toHaveLength(1);
    expect(useProjectStore.getState().clips?.map((clip) => clip.fileName)).toEqual(['second.mp4', 'first.mp4']);
  } finally { cleanup(); delete window.electron; }
});

it('renames only the chosen event and retains its type and title after saving and reopening', async () => {
  render(<App />);
  await screen.findByText('No saved projects yet.');
  fireEvent.change(screen.getByLabelText('Add video file'), { target: { files: [new File(['video'], 'names.mp4', { type: 'video/mp4' })] } });
  await enterVideo();
  act(() => {
    const state = useProjectStore.getState();
    state.createSegmentFromTrigger(state.mainLabels[0].id, 10);
    state.createSegmentFromTrigger(state.mainLabels[0].id, 30);
  });
  const before = useProjectStore.getState();
  const type = before.mainLabels[0];
  fireEvent.click(screen.getAllByRole('button', { name: `Rename clip ${type.name}` })[0]);
  fireEvent.change(screen.getByRole('textbox', { name: 'Clip title' }), { target: { value: '3:2:1' } });
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Clip title' }), { key: 'Enter' });
  expect(screen.getByRole('button', { name: 'Rename clip 3:2:1' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: `Rename clip ${type.name}` })).toHaveLength(1);
  expect(useProjectStore.getState().mainLabels).toEqual(before.mainLabels);
  expect(useProjectStore.getState().segments.every((seg) => seg.mainLabelId === type.id)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open project' }));
  await screen.findByRole('button', { name: 'Rename clip 3:2:1' });
  expect(useProjectStore.getState().segments.filter((seg) => seg.name === '3:2:1')).toHaveLength(1);
  expect(useProjectStore.getState().mainLabels).toEqual(before.mainLabels);
  fireEvent.click(screen.getByRole('button', { name: 'Rename clip 3:2:1' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Clip title' }), { target: { value: '   ' } });
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Clip title' }), { key: 'Enter' });
  expect(screen.getAllByRole('button', { name: `Rename clip ${type.name}` })).toHaveLength(2);
});

it('seeks five seconds, steps individual frames in both directions, and selects 3× playback', async () => {
  const { useVideoStore } = await import('@/store/videoStore');
  render(<App />);
  await screen.findByText('No saved projects yet.');
  fireEvent.change(screen.getByLabelText('Add video file'), { target: { files: [new File(['video'], 'controls.mp4', { type: 'video/mp4' })] } });
  await enterVideo();
  const video = document.querySelector('video')!;
  Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
  Object.defineProperty(video, 'duration', { configurable: true, value: 60 });
  fireEvent.loadedMetadata(video);
  act(() => { useProjectStore.getState().setVideoFps(25); useVideoStore.getState().setCurrentTimeSec(10); });
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(video.currentTime).toBe(15);
  act(() => { fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true }); fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true }); });
  expect(video.currentTime).toBe(25);
  fireEvent.keyDown(window, { key: 'ArrowLeft' });
  expect(video.currentTime).toBe(20);
  fireEvent.timeUpdate(video);
  act(() => useVideoStore.getState().setIsPlaying(true));
  fireEvent.keyDown(window, { key: '.' });
  expect(video.currentTime).toBeCloseTo(20.04, 5);
  expect(useVideoStore.getState().isPlaying).toBe(false);
  fireEvent.keyDown(window, { key: ',' });
  expect(video.currentTime).toBeCloseTo(20, 5);
  fireEvent.click(screen.getByRole('button', { name: 'Frame backward' }));
  expect(video.currentTime).toBeCloseTo(19.96, 5);
  act(() => useVideoStore.getState().setCurrentTimeSec(1));
  fireEvent.keyDown(window, { key: 'ArrowLeft' });
  fireEvent.keyDown(window, { key: ',' });
  expect(video.currentTime).toBe(0);
  act(() => useVideoStore.getState().setCurrentTimeSec(59));
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  fireEvent.keyDown(window, { key: '.' });
  expect(video.currentTime).toBe(60);
  act(() => useProjectStore.getState().createSegmentFromTrigger(useProjectStore.getState().mainLabels[0].id, 10));
  fireEvent.click(screen.getByRole('button', { name: /^Rename clip/ }));
  const input = screen.getByRole('textbox', { name: 'Clip title' });
  fireEvent.keyDown(input, { key: 'ArrowLeft' });
  fireEvent.keyDown(input, { key: ',' });
  expect(video.currentTime).toBe(60);
  fireEvent.keyDown(input, { key: 'Escape' });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Playback speed' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('option', { name: '3×' }));
  expect(video.playbackRate).toBe(3);
  const speed = screen.getByRole('combobox', { name: 'Playback speed' });
  fireEvent.keyDown(speed, { key: ' ' });
  fireEvent.keyUp(speed, { key: ' ' });
  expect(useVideoStore.getState().isPlaying).toBe(true);
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.keyDown(speed, { key: 'ArrowLeft' });
  expect(video.currentTime).toBe(55);
  expect(video.playbackRate).toBe(3);
  fireEvent.keyDown(speed, { key: ' ' });
  fireEvent.keyUp(speed, { key: ' ' });
  expect(useVideoStore.getState().isPlaying).toBe(false);
  fireEvent.keyDown(window, { key: 'j' });
  expect(video.playbackRate).toBe(1);
  fireEvent.keyDown(window, { key: 'j', repeat: true });
  fireEvent.keyUp(window, { key: 'j' });
  expect(video.playbackRate).toBe(3);
});

it.each([{ mainLabels: null }, { segments: [null] }, { settings: { fps: 0 } }, null])('rejects invalid project replacement without mutating state: %j', (invalid) => {
  const state = useProjectStore.getState();
  const raw = invalid === null ? null : { ...JSON.parse(state.exportProjectJson()), ...invalid };
  expect(() => state.replaceProject(raw)).toThrow();
  expect(useProjectStore.getState()).toBe(state);
});

it.each(['malformed', 'unreadable'])('keeps the Electron library recoverable after a %s saved project', async (failure) => {
  const video = { name: 'bad.mp4', path: '/videos/bad.mp4', url: 'file:///videos/bad.mp4', size: 10, modifiedAt: 1, createdAt: 1 };
  const state = useProjectStore.getState();
  const invalid = { ...JSON.parse(state.exportProjectJson()), mainLabels: null };
  await loadLabelSets();
  window.electron = {
    getLabelSets: async () => useLabelSetStore.getState().sets,
    getSavedProjects: async () => [],
    saveLabelSet: vi.fn(async () => {}),
    cancelExport: vi.fn(async () => {}),
    probeVideoMetadata: vi.fn(async () => ({ fps: 25, durationSec: 10 })),
    onExportProgress: vi.fn(() => () => {}),
    getVideos: async () => [video], getClipProjects: async () => [],
    loadProject: vi.fn(async () => { if (failure === 'unreadable') throw new Error('Could not read saved project'); return invalid; }),
    saveProject: vi.fn(async () => true), readFile: vi.fn(), runNativeExport: vi.fn(), runNativeClipExport: vi.fn(),
  };
  try {
    render(<App />);
    await clickVideoTitle('bad.mp4');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Invalid project|Could not read saved project/);
    expect(useProjectStore.getState()).toBe(state);
    expect(window.electron.saveProject).not.toHaveBeenCalled();
    // A subsequent valid load works without restarting the app.
    vi.mocked(window.electron.loadProject).mockResolvedValue(JSON.parse(state.exportProjectJson()));
    fireEvent.click(screen.getByText('bad.mp4'));
    await enterVideo();
  } finally { cleanup(); delete window.electron; }
});

it('selects tagged ranges for review and skips to the next selected tag during playback', async () => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  render(<App />);
  await screen.findByText('No saved projects yet.');
  fireEvent.change(screen.getByLabelText('Add video file'), { target: { files: [new File(['video'], 'review.mp4', { type: 'video/mp4' })] } });
  await enterVideo();
  act(() => {
    const state = useProjectStore.getState();
    state.createSegmentFromTrigger(state.mainLabels[0].id, 10);
    state.createSegmentFromTrigger(state.mainLabels[0].id, 30);
  });
  const video = document.querySelector('video')!;
  Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
  Object.defineProperty(video, 'duration', { configurable: true, value: 60 });
  fireEvent.loadedMetadata(video);
  fireEvent.click(screen.getByRole('button', { name: 'Select tags' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review 2 tags' }));
  expect(video.currentTime).toBe(8);
  video.currentTime = 13; fireEvent.timeUpdate(video);
  expect(video.currentTime).toBe(28);
  fireEvent.keyDown(window, { key: '[' }); expect(video.currentTime).toBe(8);
  fireEvent.keyDown(window, { key: ']' }); expect(video.currentTime).toBe(28);
  fireEvent.click(screen.getByRole('button', { name: 'Stop review' }));
  expect(screen.getByRole('button', { name: 'Review 2 tags' })).toBeTruthy();
});


it.each(['es', 'ca'] as const)('switches the whole UI to %s from the library and back from video settings', async (language) => {
  const app = render(<App />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add video' }).hasAttribute('disabled')).toBe(false));
  const buttonName = language === 'es' ? 'Español' : 'Català';
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Language' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: buttonName }));
  expect(document.documentElement.lang).toBe(language);
  expect(readLanguage()).toBe(language);
  expect(screen.getByRole('button', { name: translate(language, 'Add video') })).toBeTruthy();
  expect(screen.getByText(translate(language, 'Add one video or several clips for a split match. Videos and projects stay in this browser.'))).toBeTruthy();
  app.unmount();
  const reopened = render(<App />);
  await waitFor(() => expect(screen.getByRole('button', { name: translate(language, 'Add video') }).hasAttribute('disabled')).toBe(false));
  const file = new File(['test-video-bytes'], 'match.mp4', { type: 'video/mp4' });
  fireEvent.change(screen.getByLabelText(translate(language, 'Add video file')), { target: { files: [file] } });
  await enterVideo();
  expect(screen.getByRole('button', { name: translate(language, 'Play') })).toBeTruthy();
  expect(screen.getByText(translate(language, 'Event Log'))).toBeTruthy();
  expect(screen.getAllByText(translate(language, 'Attack')).length).toBeGreaterThan(0);
  act(() => {
    const state = useProjectStore.getState();
    state.upsertMainLabel({ ...state.mainLabels[0], name: 'My custom attack' });
    state.createSegmentFromTrigger(state.mainLabels[0].id, 10);
    state.renameSegment(useProjectStore.getState().segments[0].id, 'Custom clip title');
  });
  fireEvent.click(screen.getByRole('button', { name: translate(language, 'Labels & Settings') }));
  fireEvent.mouseDown(screen.getByRole('tab', { name: translate(language, 'Settings') }), { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  expect(document.documentElement.lang).toBe('en');
  expect(readLanguage()).toBe('en');
  expect(screen.getByRole('tab', { name: 'Settings' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  expect(useProjectStore.getState().mainLabels[0].name).toBe('My custom attack');
  expect(useProjectStore.getState().segments[0].name).toBe('Custom clip title');
  const projectId = useProjectStore.getState().projectId;
  await waitFor(async () => expect((await loadBrowserProject(projectId)).data.segments[0].name).toBe('Custom clip title'));
  reopened.unmount();
});


it('creates a reusable set, requires it for new videos, and shares edits from the video and library', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Manage label sets' }));
  const createSetButton = await screen.findByRole('button', { name: 'Create label set' });
  await waitFor(() => expect(createSetButton.hasAttribute('disabled')).toBe(false));
  fireEvent.click(createSetButton);
  fireEvent.change(await screen.findByLabelText('Label set name'), { target: { value: 'Squad A' } });
  fireEvent.change(screen.getByDisplayValue('Attack'), { target: { value: 'Counterattack' } });
  const row = screen.getByDisplayValue('Counterattack').closest('tr')!;
  fireEvent.change(row.querySelector('input[type="color"]')!, { target: { value: '#123456' } });
  fireEvent.change(row.querySelectorAll('input[type="number"]')[0], { target: { value: '5' } });
  fireEvent.change(screen.getByDisplayValue('A'), { target: { value: 'C' } });
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Secondary Labels' }), { button: 0, ctrlKey: false });
  fireEvent.change(screen.getByDisplayValue('Player #10'), { target: { value: 'Goalkeeper' } });
  await flushLabelSets();
  const shared = useLabelSetStore.getState().sets.find((set) => set.name === 'Squad A')!;
  expect(shared.mainLabels[0]).toMatchObject({ name: 'Counterattack', color: '#123456', preRollSec: 5, hotkey: 'C' });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(await screen.findByRole('button', { name: /Squad A/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.change(screen.getByLabelText('Add video file'), { target: { files: [new File(['one'], 'one.mp4')] } });
  await screen.findByRole('dialog', { name: 'Choose a label set' });
  expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  expect(await listBrowserProjects()).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Use label set Squad A' }));
  await finishCreation();
  await screen.findByRole('button', { name: 'Back to projects' });
  const firstId = useProjectStore.getState().projectId;
  expect(useProjectStore.getState().labelSetId).toBe(shared.id);
  fireEvent.keyDown(window, { key: 'c' });
  expect(useProjectStore.getState().segments[0].mainLabelId).toBe(shared.mainLabels[0].id);
  fireEvent.click(screen.getByRole('button', { name: 'Labels & Settings' }));
  expect(screen.queryByRole('button', { name: 'Use this set' })).toBeNull();
  fireEvent.change(screen.getByDisplayValue('Counterattack'), { target: { value: 'Fast break' } });
  await waitFor(() => expect(useLabelSetStore.getState().sets.find((set) => set.id === shared.id)?.mainLabels[0].name).toBe('Fast break'));
  // A local edit remains undoable while the shared set follows undo/redo.
  act(() => useProjectStore.getState().undo());
  expect(useProjectStore.getState().mainLabels[0].name).toBe('Counterattack');
  act(() => useProjectStore.getState().redo());
  expect(useLabelSetStore.getState().sets.find((set) => set.id === shared.id)?.mainLabels[0].name).toBe('Fast break');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
  await screen.findByRole('button', { name: 'Open project' });
  fireEvent.change(screen.getByLabelText('Add video file'), { target: { files: [new File(['two'], 'two.mp4')] } });
  await screen.findByRole('dialog', { name: 'Choose a label set' });
  fireEvent.click(screen.getByRole('button', { name: 'Use label set Squad A' }));
  await finishCreation();
  await screen.findByRole('button', { name: 'Back to projects' });
  expect(useProjectStore.getState().labelSetId).toBe(shared.id);
  expect(useProjectStore.getState().mainLabels[0]).toMatchObject({ id: shared.mainLabels[0].id, name: 'Fast break' });
  expect(useProjectStore.getState().secondaryLabels[0].name).toBe('Goalkeeper');
  fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
  await screen.findByRole('button', { name: 'Manage label sets' });
  fireEvent.click(screen.getByRole('button', { name: 'Manage label sets' }));
  fireEvent.click(await screen.findByRole('button', { name: /Squad A/ }));
  fireEvent.change(screen.getByDisplayValue('Fast break'), { target: { value: 'Transitions' } });
  await flushLabelSets();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  const firstCard = screen.getByText('one.mp4').closest('[class*="rounded-xl"]')!;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Actions for one.mp4' }));
  fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
  await waitFor(() => expect(vi.mocked(URL.createObjectURL).mock.calls.some(([blob]) => blob instanceof Blob && blob.type === 'application/json')).toBe(true));
  const exported = vi.mocked(URL.createObjectURL).mock.calls.find(([blob]) => blob instanceof Blob && blob.type === 'application/json')![0] as Blob;
  expect(JSON.parse(await exported.text()).mainLabels[0].name).toBe('Transitions');
  await waitFor(() => expect(firstCard.querySelector('button')!.hasAttribute('disabled')).toBe(false));
  fireEvent.click(firstCard.querySelector('button')!);
  await screen.findByRole('button', { name: 'Back to projects' });
  expect(screen.queryByRole('dialog', { name: 'Choose a label set' })).toBeNull();
  expect(useProjectStore.getState().labelSetId).toBe(shared.id);
  expect(useProjectStore.getState().mainLabels[0].name).toBe('Transitions');
  expect(useProjectStore.getState().segments).toHaveLength(1);
  expect((await loadBrowserProject(firstId)).data.labelSetId).toBe(shared.id);
}, 10000);

it('cancels label selection without creating a video project', async () => {
  render(<App />);
  await screen.findByText('No saved projects yet.');
  fireEvent.change(screen.getByLabelText('Add video file'), { target: { files: [new File(['video'], 'cancelled.mp4')] } });
  await screen.findByRole('dialog', { name: 'Choose a label set' });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add video' }).hasAttribute('disabled')).toBe(false));
  expect(await listBrowserProjects()).toEqual([]);
  expect(useProjectStore.getState().session.videoSourceUrl).toBeNull();
});


it('requires a set before first opening a desktop video and persists shared edits through the desktop API', async () => {
  const sets: import('@/types/project').LabelSet[] = [];
  const projects = new Map<string, import('@/types/project').ProjectData>();
  const video = { name: 'desktop.mp4', path: '/videos/desktop.mp4', url: 'file:///videos/desktop.mp4', size: 10, modifiedAt: 1, createdAt: 1 };
  window.electron = {
    getLabelSets: async () => sets,
    getSavedProjects: async () => [...projects.values()],
    saveLabelSet: vi.fn(async (set) => { sets.splice(0, sets.length, ...sets.filter((item) => item.id !== set.id), structuredClone(set)); }),
    getVideos: async () => [video], getClipProjects: async () => [],
    loadProject: vi.fn(async (name) => projects.get(name) ?? null),
    saveProject: vi.fn(async (name, data) => { projects.set(name, structuredClone(data)); return true; }),
    probeVideoMetadata: vi.fn(async () => ({ fps: 25, durationSec: 60 })),
    cancelExport: vi.fn(async () => {}), onExportProgress: vi.fn(() => () => {}),
    readFile: vi.fn(), runNativeExport: vi.fn(), runNativeClipExport: vi.fn(),
  };
  try {
    render(<App />);
    await clickVideoTitle('desktop.mp4');
    await screen.findByRole('dialog', { name: 'Choose a label set' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(window.electron.saveProject).not.toHaveBeenCalled();
    await clickVideoTitle('desktop.mp4');
    await chooseDefaultSet();
    await finishCreation();
    await screen.findByRole('button', { name: 'Back to projects' });
    const setId = useProjectStore.getState().labelSetId;
    expect(projects.get('desktop.mp4')?.labelSetId).toBe(setId);
    fireEvent.click(screen.getByRole('button', { name: 'Labels & Settings' }));
    fireEvent.change(screen.getByDisplayValue('Attack'), { target: { value: 'Throw-off' } });
    await waitFor(() => expect(sets.find((set) => set.id === setId)?.mainLabels[0].name).toBe('Throw-off'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
    await screen.findByRole('button', { name: 'Manage label sets' });
    await clickVideoTitle('desktop.mp4');
    await screen.findByRole('button', { name: 'Back to projects' });
    expect(screen.queryByRole('dialog', { name: 'Choose a label set' })).toBeNull();
    expect(useProjectStore.getState().labelSetId).toBe(setId);
    expect(useProjectStore.getState().mainLabels[0].name).toBe('Throw-off');
    await flushLabelSets();
  } finally { cleanup(); delete window.electron; }
});

it('shares custom main and secondary label order, preserves tags, and restores order after reload', async () => {
  const app = render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Manage label sets' }));
  const defaultSetButton = await screen.findByRole('button', { name: /^Default handball labels/ });
  await waitFor(() => expect(defaultSetButton.hasAttribute('disabled')).toBe(false));
  fireEvent.click(defaultSetButton);
  fireEvent.click(screen.getByRole('button', { name: 'Move label Defense up' }));
  fireEvent.change(screen.getByDisplayValue('Defense'), { target: { value: 'Zebra defense' } });
  const mainRows = [...screen.getByRole('table').querySelectorAll('tbody tr')];
  expect(mainRows.map((row) => row.querySelector('input')!.value)).toEqual(['Zebra defense', 'Attack']);
  expect(screen.getByRole('button', { name: 'Move label Zebra defense up' }).hasAttribute('disabled')).toBe(true);
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Secondary Labels' }), { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole('button', { name: 'Move label Player #9 up' }));
  await flushLabelSets();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.change(screen.getByLabelText('Add video file'), { target: { files: [new File(['video'], 'ordered.mp4')] } });
  await enterVideo();
  expect(useProjectStore.getState().mainLabels.map((label) => label.name)).toEqual(['Zebra defense', 'Attack']);
  expect(useProjectStore.getState().secondaryLabels.map((label) => label.name)).toEqual(['Player #9', 'Player #10']);
  const state = useProjectStore.getState();
  act(() => {
    const segment = state.createSegmentFromTrigger(state.mainLabels[1].id, 10)!;
    state.renameSegment(segment.id, 'Fast break');
    state.toggleSecondaryOnSelectedSegment(state.secondaryLabels[0].id);
  });
  const tags = useProjectStore.getState().segments;
  fireEvent.click(screen.getByRole('button', { name: 'Labels & Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Move label Attack up' }));
  expect(useProjectStore.getState().mainLabels.map((label) => label.name)).toEqual(['Attack', 'Zebra defense']);
  act(() => useProjectStore.getState().undo());
  expect(useProjectStore.getState().mainLabels.map((label) => label.name)).toEqual(['Zebra defense', 'Attack']);
  act(() => useProjectStore.getState().redo());
  expect(useProjectStore.getState().mainLabels.map((label) => label.name)).toEqual(['Attack', 'Zebra defense']);
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Secondary Labels' }), { button: 0, ctrlKey: false });
  const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
  fireEvent.dragStart(screen.getByRole('button', { name: 'Drag label Player #10 to reorder' }), { dataTransfer });
  fireEvent.dragOver(screen.getByDisplayValue('Player #9').closest('tr')!, { dataTransfer });
  fireEvent.drop(screen.getByDisplayValue('Player #9').closest('tr')!, { dataTransfer });
  expect(useProjectStore.getState().secondaryLabels.map((label) => label.name)).toEqual(['Player #10', 'Player #9']);
  expect(useProjectStore.getState().segments).toEqual(tags);
  await flushLabelSets();
  const setId = useProjectStore.getState().labelSetId;
  const set = useLabelSetStore.getState().sets.find((item) => item.id === setId)!;
  expect(set.mainLabels.map((label) => label.name)).toEqual(['Attack', 'Zebra defense']);
  expect(set.secondaryLabels.map((label) => label.name)).toEqual(['Player #10', 'Player #9']);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
  await screen.findByRole('button', { name: 'Open project' });
  app.unmount();
  useLabelSetStore.setState({ loaded: false, sets: [] });
  useProjectStore.getState().resetProject();
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open project' }));
  await enterVideo();
  expect(useProjectStore.getState().mainLabels.map((label) => label.name)).toEqual(['Attack', 'Zebra defense']);
  expect(useProjectStore.getState().secondaryLabels.map((label) => label.name)).toEqual(['Player #10', 'Player #9']);
  expect(useProjectStore.getState().segments).toEqual(tags);
});

it('organizes matches in nested folders, selects and creates teams, duplicates independently, and filters renamed teams', async () => {
  const app = render(<App />);
  await screen.findByText('No saved projects yet.');
  fireEvent.click(screen.getByRole('button', { name: 'Manage teams' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'New team name' }), { target: { value: 'Club A' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add team' }));
  await screen.findByRole('textbox', { name: 'Team name: Club A' });
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Manage teams' })).getAllByRole('button', { name: 'Close' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
  fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: '2026–27' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save folder' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New folder' })).toBeNull());
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Video folders' })).getByRole('button', { name: '2026–27' }));
  fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
  fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Round 12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save folder' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New folder' })).toBeNull());
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Video folders' })).getByRole('button', { name: 'Round 12' }));
  const file = new File(['original media'], 'teams.mp4', { type: 'video/mp4' });
  fireEvent.change(screen.getByLabelText('Add video file'), { target: { files: [file] } });
  await chooseDefaultSet();
  await screen.findByRole('dialog', { name: 'Create video' });
  fireEvent.change(screen.getByLabelText('Video name'), { target: { value: 'League match' } });
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'U18' } });
  fireEvent.change(screen.getByLabelText('Competition'), { target: { value: 'Liga' } });
  fireEvent.change(screen.getByLabelText('Season'), { target: { value: '2026–27' } });
  fireEvent.change(screen.getByLabelText('Fixture / matchday'), { target: { value: 'Round 12' } });
  fireEvent.click(screen.getByRole('combobox', { name: 'Local team' }));
  const homePicker = within(await screen.findByRole('dialog', { name: 'Local team' }));
  fireEvent.change(homePicker.getByRole('combobox', { name: 'Search teams' }), { target: { value: 'Club A' } });
  fireEvent.click(await screen.findByRole('option', { name: 'Club A' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Local team' })).toBeNull());
  fireEvent.click(screen.getByRole('combobox', { name: 'Visitor team' }));
  const awayPicker = within(await screen.findByRole('dialog', { name: 'Visitor team' }));
  fireEvent.change(awayPicker.getByRole('combobox', { name: 'Search teams' }), { target: { value: 'Club B' } });
  const createVisitor = await awayPicker.findByRole('button', { name: 'Create team “Club B”' });
  expect(createVisitor.isConnected).toBe(true);
  fireEvent.click(createVisitor);
  await waitFor(() => expect(useLibraryStore.getState().catalog.teams.map(team => team.name)).toContain('Club B'));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Visitor team' }).textContent).toContain('Club B'));
  await finishCreation();
  await screen.findByRole('button', { name: 'Back to projects' });
  act(() => { const state = useProjectStore.getState(); state.createSegmentFromTrigger(state.mainLabels[0].id, 10); });
  const id = useProjectStore.getState().projectId;
  fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
  await screen.findByRole('article', { name: 'League match' });
  const original = (await loadBrowserProject(id)).data;
  expect(original.videoMeta?.fileName).toBe('teams.mp4');
  expect(original.match).toMatchObject({ category: 'U18', competition: 'Liga', season: '2026–27', fixture: 'Round 12', homeTeamName: 'Club A', awayTeamName: 'Club B' });
  expect(useLibraryStore.getState().catalog.folders.find(folder => folder.id === original.folderId)?.name).toBe('Round 12');
  fireEvent.click(screen.getByRole('button', { name: 'Actions for League match' }));
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate video' }));
  const copyCard = await screen.findByRole('article', { name: 'League match (copy)' });
  const copy = (await listBrowserProjects()).find(project => project.id !== id)!;
  expect(await (await loadBrowserProject(copy.id)).file?.text()).toBe('original media');
  fireEvent.click(within(copyCard).getByRole('button', { name: 'Match details' }));
  fireEvent.change(await screen.findByLabelText('Video name'), { target: { value: 'Training copy' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await screen.findByRole('article', { name: 'Training copy' });
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Training copy' }));
  fireEvent.click(screen.getByRole('button', { name: 'Move video' }));
  fireEvent.change(await screen.findByRole('combobox', { name: 'Destination folder' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move here' }));
  await waitFor(() => expect(screen.queryByRole('article', { name: 'Training copy' })).toBeNull());
  expect((await loadBrowserProject(copy.id)).data.folderId).toBeNull();
  expect((await loadBrowserProject(id)).data.folderId).toBe(original.folderId);
  fireEvent.click(screen.getByRole('button', { name: 'All videos' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search videos' }), { target: { value: 'Training' } });
  expect(screen.queryByRole('article', { name: 'League match' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  fireEvent.click(screen.getByRole('combobox', { name: 'Filter by team' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Club B' }));
  expect(screen.getAllByRole('article')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Manage teams' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Team name: Club A' }), { target: { value: 'Club A Academy' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save team Club A' }));
  await screen.findByRole('textbox', { name: 'Team name: Club A Academy' });
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Manage teams' })).getAllByRole('button', { name: 'Close' })[0]);
  expect(screen.getAllByText('Club A Academy')).toHaveLength(2);
  app.unmount();
  useLibraryStore.setState({ loaded: false, backend: null });
  render(<App />);
  await screen.findByRole('article', { name: 'Training copy' });
  await waitFor(() => expect(screen.getAllByText('Club A Academy')).toHaveLength(2));
  expect((await loadBrowserProject(id)).data.segments).toHaveLength(1);
});

it('keeps native copies in independent sidecars while sharing the original source and persisting folder moves', async () => {
  const data = JSON.parse(useProjectStore.getState().exportProjectJson()) as import('@/types/project').ProjectData;
  data.name = 'Native match';
  data.videoMeta = { fileName: 'native.mp4', fileSize: 10, fileType: 'video/mp4', lastModified: 1, fps: 25 };
  data.labelSetId = 'native-labels';
  const sets = [{ id: 'native-labels', name: 'Native labels', mainLabels: data.mainLabels, secondaryLabels: data.secondaryLabels, updatedAtMs: 1 }];
  const projects = new Map([['native.mp4', data]]);
  let catalog: LibraryCatalog = { folders: [{ id: 'season', name: 'Native season', parentId: null }], teams: [] };
  const video = { name: 'native.mp4', path: '/videos/native.mp4', url: 'file:///videos/native.mp4', size: 10, modifiedAt: 1, createdAt: 1 };
  window.electron = {
    getLibraryCatalog: async () => catalog,
    changeLibraryCatalog: async change => { catalog = applyLibraryChange(catalog, change); return catalog; },
    getLabelSets: async () => sets, saveLabelSet: vi.fn(async () => {}),
    getSavedProjects: async () => [...projects.values()], getClipProjects: async () => [], getVideos: async () => [video],
    loadProject: async name => projects.get(name) ?? null,
    saveProject: vi.fn(async (name, project) => { projects.set(name, structuredClone(project)); return true; }),
    probeVideoMetadata: vi.fn(async () => ({ fps: 25, durationSec: 60 })),
    cancelExport: vi.fn(async () => {}), onExportProgress: vi.fn(() => () => {}),
    readFile: vi.fn(), runNativeExport: vi.fn(), runNativeClipExport: vi.fn(),
  };
  try {
    render(<App />);
    const actions = await screen.findByRole('button', { name: 'Actions for Native match' });
    await waitFor(() => expect(actions.hasAttribute('disabled')).toBe(false));
    fireEvent.click(actions); fireEvent.click(screen.getByRole('button', { name: 'Duplicate video' }));
    const card = await screen.findByRole('article', { name: 'Native match (copy)' });
    const copy = [...projects.values()].find(project => project.projectId !== data.projectId)!;
    expect(copy.electronProjectKey).toBe(copy.projectId);
    expect(copy.videoMeta).toEqual(data.videoMeta);
    await waitFor(() => expect(within(card).getByRole('button', { name: 'Open project' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(within(card).getByRole('button', { name: 'Actions for Native match (copy)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move video' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Destination folder' }), { target: { value: 'season' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move here' }));
    await waitFor(() => expect(projects.get(copy.projectId)?.folderId).toBe('season'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Move video' })).toBeNull());
    fireEvent.click(within(screen.getByRole('article', { name: 'Native match (copy)' })).getByRole('button', { name: 'Open project' }));
    await enterVideo();
    expect(useProjectStore.getState().session.videoSourceUrl).toBe(video.url);
    act(() => { const state = useProjectStore.getState(); state.createSegmentFromTrigger(state.mainLabels[0].id, 10); });
    fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
    await screen.findByRole('article', { name: 'Native match (copy)' });
    expect(projects.get(copy.projectId)?.segments).toHaveLength(1);
    expect(projects.get('native.mp4')?.segments).toHaveLength(0);
    expect(projects.get('native.mp4')?.folderId).toBeUndefined();
  } finally { cleanup(); delete window.electron; }
});

it('keeps an unreadable browser save visible and never replaces it with empty analysis', async () => {
  const { saveBrowserProject } = await import('@/lib/browserStorage');
  const data = JSON.parse(useProjectStore.getState().exportProjectJson()) as import('@/types/project').ProjectData;
  data.name = 'Damaged match'; await saveBrowserProject(data);
  const json = JSON.stringify({ ...data, mainLabels: null });
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('ohv.library.v1', 3);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('projects', 'readwrite'), store = tx.objectStore('projects');
      const record = store.get(data.projectId);
      record.onsuccess = () => store.put({ ...record.result, json });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
  });
  render(<App />);
  const card = await screen.findByRole('article', { name: 'Damaged match' });
  await waitFor(() => expect(within(card).getByRole('button', { name: 'Open project' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(within(card).getByRole('button', { name: 'Open project' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Invalid project file');
  expect((await listBrowserProjects()).find(project => project.id === data.projectId)?.json).toBe(json);
  expect(useProjectStore.getState().session.videoSourceUrl).toBeNull();
});
