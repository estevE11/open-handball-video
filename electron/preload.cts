import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  getVideos: () => ipcRenderer.invoke('get-videos'),
  loadProject: (videoFileName: string) => ipcRenderer.invoke('load-project', videoFileName),
  saveProject: (videoFileName: string, projectData: unknown) => ipcRenderer.invoke('save-project', videoFileName, projectData),
});
