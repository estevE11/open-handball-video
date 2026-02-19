export type Id = string;

export type MainLabel = {
  id: Id;
  name: string;
  /** The original name given when the label was created. */
  defaultName?: string;
  /** Tailwind-friendly hex is fine (e.g. "#ef4444"). */
  color: string;
  /** Seconds before the trigger time. */
  preRollSec: number;
  /** Seconds after the trigger time. */
  postRollSec: number;
  /** Single-character hotkey (e.g. "A"). */
  hotkey: string;
};

export type SecondaryLabel = {
  id: Id;
  name: string;
  hotkey?: string;
};

export type Segment = {
  id: Id;
  /** Optional name override for this specific segment. */
  name?: string;
  startTimeSec: number;
  endTimeSec: number;
  mainLabelId: Id;
  secondaryLabelIds: Id[];
  createdAtMs: number;
};

export type ProjectSettings = {
  /** Used for frame step buttons. Defaults to 30 fps. */
  fps: number;
};

export type VideoMeta = {
  /** The last uploaded file name (used to prompt re-upload on restore). */
  fileName: string;
  fileSize: number;
  fileType: string;
  lastModified: number;
  durationSec?: number;
  /** Detected from ffprobe (avg_frame_rate / r_frame_rate). */
  fps?: number;
};

export type ProjectData = {
  schemaVersion: 1;
  projectId: Id;
  createdAtMs: number;
  updatedAtMs: number;
  videoMeta: VideoMeta | null;
  mainLabels: MainLabel[];
  secondaryLabels: SecondaryLabel[];
  segments: Segment[];
  settings: ProjectSettings;
};


