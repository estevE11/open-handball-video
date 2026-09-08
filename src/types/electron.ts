import type { MainLabel, ProjectData, Segment } from "./project";

export interface ElectronAPI {
  runNativeClipExport: (opts: {
    inputPaths: string[];
    pieces: { sourceIndex: number; startTimeSec: number; endTimeSec: number; segmentIndex: number; primaryText: string; secondaryText?: string }[];
    addGap: boolean;
  }) => Promise<Uint8Array>;
  getClipProjects: () => Promise<ProjectData[]>;
  getVideos: () => Promise<VideoFile[]>;
  loadProject: (videoFileName: string) => Promise<unknown>;
  saveProject: (videoFileName: string, projectData: ProjectData) => Promise<boolean>;
  readFile: (filePath: string) => Promise<Uint8Array>;
  runNativeExport: (opts: {
    inputPath: string;
    segments: Segment[];
    addGap: boolean;
    mainLabels: MainLabel[]
  }) => Promise<Uint8Array>;
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
