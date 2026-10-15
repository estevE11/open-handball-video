export type Id = string;

export type { MainLabel, SecondaryLabel, LabelSet } from '../../electron/labelSets';
import type { MainLabel, SecondaryLabel } from '../../electron/labelSets';
export type { LibraryFolder, LibraryCatalog, Team, MatchMetadata } from '../../electron/libraryCatalog';
import type { MatchMetadata } from '../../electron/libraryCatalog';

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

export type VideoClip = VideoMeta & {
  id: Id;
  durationSec: number;
};

export type ProjectData = {
  /** Display name and logical folder; source filenames stay unchanged. */
  name?: string;
  folderId?: string | null;
  match?: MatchMetadata;
  /** Ordered sources for a split match. Absent on legacy single-video projects. */
  clips?: VideoClip[];
  /** Separate sidecar for an Electron split-match project. */
  electronProjectKey?: string;
  /** Chosen once; labels are shared with other projects using this set. */
  labelSetId?: Id;
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

