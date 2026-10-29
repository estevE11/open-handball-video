export type TelemetryCore = {
  HEAPU8?: Uint8Array;
  ret?: number;
  FS?: unknown;
  onAbort?: (reason: unknown) => void;
  exec: (...args: string[]) => unknown;
  ffprobe: (...args: string[]) => unknown;
  setLogger: (logger: (entry: { type: string; message: string }) => void) => void;
  setProgress: (callback: (event: { time: number; progress: number }) => void) => void;
};
export function instrumentFFmpegCore<T extends TelemetryCore>(core: T, heapLimitBytes?: number | null): T;
export default function createDiagnosticCore(options: unknown): Promise<TelemetryCore>;
