import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  getSavedProjects: () => ipcRenderer.invoke('get-saved-projects'),
  getLabelSets: () => ipcRenderer.invoke('get-label-sets'),
  saveLabelSet: (labelSet: unknown) => ipcRenderer.invoke('save-label-set', labelSet),
  cancelExport: (exportId: string) => ipcRenderer.invoke('cancel-export', exportId),
  onExportProgress: (callback: (progress: { exportId: string; phase: string; ratio: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { exportId: string; phase: string; ratio: number }) => callback(progress);
    ipcRenderer.on('export-progress', listener);
    return () => ipcRenderer.removeListener('export-progress', listener);
  },
  getClipProjects: () => ipcRenderer.invoke('get-clip-projects'),
  runNativeClipExport: (opts: unknown) => ipcRenderer.invoke('run-native-clip-export', opts),
  probeVideoMetadata: (source: string) => ipcRenderer.invoke('probe-video-metadata', source),
  getVideos: () => ipcRenderer.invoke('get-videos'),
  loadProject: (videoFileName: string) => ipcRenderer.invoke('load-project', videoFileName),
  saveProject: (videoFileName: string, projectData: unknown) => ipcRenderer.invoke('save-project', videoFileName, projectData),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  runNativeExport: (opts: { inputPath: string; segments: any[]; addGap: boolean; mainLabels: any[] }) => ipcRenderer.invoke('run-native-export', opts),
});
