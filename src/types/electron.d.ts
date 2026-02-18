export interface ElectronAPI {
  getVideos: () => Promise<VideoFile[]>;
  loadProject: (videoFileName: string) => Promise<any>;
  saveProject: (videoFileName: string, projectData: any) => Promise<boolean>;
}

export interface VideoFile {
  name: string;
  path: string;
  url: string;
  size: number;
  createdAt: number;
  modifiedAt: number;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
  }
}
