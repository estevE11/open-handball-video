import type { ProjectData } from "./project";

export interface ElectronAPI {
  getVideos: () => Promise<VideoFile[]>;
  loadProject: (videoFileName: string) => Promise<ProjectData | null>;
  saveProject: (videoFileName: string, projectData: ProjectData) => Promise<boolean>;
  readFile: (filePath: string) => Promise<Uint8Array>;
  runNativeExport: (opts: { 
    inputPath: string; 
    outputPath: string; 
    segments: any[]; 
    addGap: boolean; 
    mainLabels: any[] 
  }) => Promise<boolean>;
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
