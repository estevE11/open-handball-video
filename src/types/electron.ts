import type { MainLabel, ProjectData, Segment } from "./project";

export interface ElectronAPI {
  cancelExport: (exportId: string) => Promise<void>;
  probeVideoMetadata: (source: string) => Promise<{ fps?: number; durationSec?: number }>;
  onExportProgress: (callback: (progress: { exportId: string; phase: string; ratio: number }) => void) => () => void;
  runNativeClipExport: (opts: {
    exportId?: string;
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
    exportId?: string;
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
