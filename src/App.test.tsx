/// <reference types="node" />
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { File as NodeFile, Blob as NodeBlob } from 'node:buffer';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '@/App';
import { useProjectStore } from '@/store/projectStore';
import { deleteBrowserProject, listBrowserProjects, loadBrowserProject } from '@/lib/browserStorage';

vi.mock('@/lib/videoProbe', () => ({ probeVideoFps: async () => 30 }));
vi.mock('@/lib/exportMp4', () => ({ exportFilteredSegmentsToMp4: vi.fn() }));

beforeEach(async () => {
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
  localStorage.clear();
  useProjectStore.getState().resetProject();
  for (const project of await listBrowserProjects()) await deleteBrowserProject(project.id);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('adds video, autosaves edits before immediate navigation, and restores project after remount', async () => {
  const app = render(<App />);
  await screen.findByText('No saved projects yet.');
  const file = new File(['test-video-bytes'], 'match.mp4', { type: 'video/mp4' });
  fireEvent.change(screen.getByLabelText('Add video file'), { target: { files: [file] } });
  await screen.findByRole('button', { name: 'Back to projects' });
  const id = useProjectStore.getState().projectId;
  act(() => {
    const state = useProjectStore.getState();
    state.createSegmentFromTrigger(state.mainLabels[0].id, 10);
    state.updateSettings({ fps: 60 });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
  await screen.findByRole('button', { name: 'Open project' });
  expect((await loadBrowserProject(id)).data.segments).toHaveLength(1);
  expect((await loadBrowserProject(id)).data.settings.fps).toBe(60);
  app.unmount();
  useProjectStore.getState().resetProject();
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open project' }));
  await screen.findByRole('button', { name: 'Back to projects' });
  expect(screen.queryByText('Attach project video')).toBeNull();
  expect(useProjectStore.getState().session.videoFile?.name).toBe('match.mp4');
  expect(useProjectStore.getState().segments).toHaveLength(1);
  expect(await useProjectStore.getState().session.videoFile?.text()).toBe('test-video-bytes');
  await waitFor(() => expect(screen.getByText(/About .* more projects/)).toBeTruthy());
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
  await screen.findByRole('button', { name: 'Back to projects' });
  act(() => {
    const state = useProjectStore.getState();
    state.createSegmentFromTrigger(state.mainLabels[0].id, 10);
    state.updateSettings({ fps: 60 });
    state.setVideoDurationSec(120);
    state.setVideoFps(30);
  });
  const id = useProjectStore.getState().projectId;
  fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
  await screen.findByRole('button', { name: 'Remove video' });
  const before = (await loadBrowserProject(id)).data;
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Remove video' }));
  expect((await loadBrowserProject(id)).file?.size).toBe(file.size);
  confirm.mockReturnValue(true);
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
  await screen.findByRole('button', { name: 'Back to projects' });
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
  await screen.findByRole('button', { name: 'Back to projects' });
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
  window.electron = {
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
    await screen.findByRole('button', { name: 'Back to projects' });
    expect(useProjectStore.getState().session.clipSources.map((source) => source.url)).toEqual(['file:///videos/second.mp4', 'file:///videos/first.mp4']);
    expect(window.electron.loadProject).not.toHaveBeenCalled();
    act(() => { const state = useProjectStore.getState(); state.createSegmentFromTrigger(state.mainLabels[0].id, 9); });
    fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open match: second.mp4 (2 clips)' }));
    await screen.findByRole('button', { name: 'Back to projects' });
    expect(useProjectStore.getState().segments).toHaveLength(1);
    expect(useProjectStore.getState().clips?.map((clip) => clip.fileName)).toEqual(['second.mp4', 'first.mp4']);
  } finally { cleanup(); delete window.electron; }
});

it('renames only the chosen event and retains its type and title after saving and reopening', async () => {
  render(<App />);
  await screen.findByText('No saved projects yet.');
  fireEvent.change(screen.getByLabelText('Add video file'), { target: { files: [new File(['video'], 'names.mp4', { type: 'video/mp4' })] } });
  await screen.findByRole('button', { name: 'Back to projects' });
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
  await screen.findByRole('button', { name: 'Back to projects' });
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
  fireEvent.keyDown(screen.getByRole('combobox', { name: 'Playback speed' }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: '3×' }));
  expect(video.playbackRate).toBe(3);
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
  window.electron = {
    onExportProgress: vi.fn(() => () => {}),
    getVideos: async () => [video], getClipProjects: async () => [],
    loadProject: vi.fn(async () => { if (failure === 'unreadable') throw new Error('Could not read saved project'); return invalid; }),
    saveProject: vi.fn(async () => true), readFile: vi.fn(), runNativeExport: vi.fn(), runNativeClipExport: vi.fn(),
  };
  try {
    render(<App />);
    fireEvent.click(await screen.findByText('bad.mp4'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Invalid project|Could not read saved project/);
    expect(useProjectStore.getState()).toBe(state);
    expect(window.electron.saveProject).not.toHaveBeenCalled();
    // A subsequent valid load works without restarting the app.
    vi.mocked(window.electron.loadProject).mockResolvedValue(JSON.parse(state.exportProjectJson()));
    fireEvent.click(screen.getByText('bad.mp4'));
    await screen.findByRole('button', { name: 'Back to projects' });
  } finally { cleanup(); delete window.electron; }
});
