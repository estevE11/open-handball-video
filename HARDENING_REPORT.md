# Technical Debt & Hardening Report: Open Handball Video

## Overview

This report outlines architectural weaknesses and planned improvements. **Browser robustness is the top priority**, focused on three areas:

1. **Video persistence** — survive reload without re-uploading
2. **Export consistency & speed** — predictable output, best-effort performance on the user's machine
3. **Export progress UI** — a real progress bar, not a text percentage

Electron-specific items are listed separately at the end.

### Comparison baseline (vs OpenCut)

| Dimension | OpenCut | This project (browser, today) | Target (browser) |
|-----------|---------|-------------------------------|------------------|
| Storage backend | IndexedDB | localStorage | IndexedDB |
| Video binary | IndexedDB Blob | Not persisted (blob URL only) | IndexedDB Blob |
| Persistence guarantee | `navigator.storage.persist()` | None | `navigator.storage.persist()` |
| Storage limit | Browser quota (~50 GB–1 TB) | ~5–10 MB (localStorage) | Browser quota |
| Reload behavior | Video + project restored | Re-upload required | Video + project restored |

---

## Phase 1: Browser Video Persistence (Highest Priority)

### 1. Persist video bytes in IndexedDB

*   **Problem:** On reload, `session.videoSourceUrl` and `session.videoFile` are lost. Only `videoMeta` (filename, size, mtime) survives in localStorage. Users must re-pick the file via `RequireVideoModal`.
*   **Status:** 🔴 Pending
*   **Files:** `src/store/projectStore.ts`, new `src/lib/videoStorage.ts`
*   **Action:**
    *   Create a dedicated IndexedDB store for video blobs (separate from project JSON — blobs should not go through Zustand's sync persist path).
    *   On `setVideoFile(file, url)`: write the `File` blob to IndexedDB keyed by `projectId` (or a stable `videoAssetId`).
    *   On rehydrate: if a blob exists for the active project, recreate `URL.createObjectURL(blob)` and set `session.videoFile` / `session.videoSourceUrl` automatically — **no re-upload modal**.
    *   On project reset or video replace: delete the old blob entry.
    *   Show upload progress for large files (copy to IndexedDB can take seconds on a 2 GB match recording).

### 2. Migrate project state from localStorage → IndexedDB

*   **Problem:** Annotations (segments, labels) live in `localStorage` (`ohv.project.v1`), capped at ~5–10 MB. A long match with hundreds of segments can hit the limit and fail silently.
*   **Status:** 🔴 Pending
*   **Files:** `src/store/projectStore.ts`
*   **Action:**
    *   Install `idb-keyval` (or a thin IndexedDB wrapper).
    *   Replace Zustand `createJSONStorage(() => localStorage)` with an async IndexedDB adapter.
    *   On first launch after upgrade: read `localStorage` key, migrate to IndexedDB, remove old key.
    *   Keep `partialize` as-is (still no video bytes in project JSON).

### 3. Request durable storage (`navigator.storage.persist()`)

*   **Problem:** Without an explicit persist request, the browser may evict IndexedDB data under storage pressure (especially on mobile or low-disk scenarios).
*   **Status:** 🔴 Pending
*   **Files:** new `src/lib/storagePersist.ts`, call site in video upload flow
*   **Action:**
    *   Call `navigator.storage.persist()` on first video import (after user gesture).
    *   Surface result in Settings ("Storage: persistent" vs "may be cleared by browser").
    *   Optionally show `navigator.storage.estimate()` usage (used / quota) when a large video is stored.

### 4. Stable video identity (content hash)

*   **Problem:** `videoMeta` links by `fileName` + `fileSize` + `lastModified`. Renaming the file or copying it breaks the association. No way to detect that a re-uploaded file is the same video.
*   **Status:** 🔴 Pending
*   **Files:** `src/types/project.ts`, `src/lib/videoStorage.ts`
*   **Action:**
    *   Compute a SHA-256 hash of the file on import (streaming read, chunked — do not load entire file into memory at once).
    *   Store `videoHash` in `VideoMeta` and use it as the IndexedDB blob key (allows one blob shared across projects if the same file is ever reused).
    *   On manual re-upload: if hash matches stored blob, skip re-write.

### 5. Remove / simplify `RequireVideoModal` for browser

*   **Problem:** Modal exists solely because video is not persisted. Once IndexedDB restore works, the modal should only appear when the blob is genuinely missing (cleared storage, different browser, quota eviction).
*   **Status:** 🔴 Pending
*   **Files:** `src/components/app/RequireVideoModal.tsx`, `src/store/projectStore.ts`
*   **Action:**
    *   Auto-restore video from IndexedDB after Zustand rehydrate.
    *   Show `RequireVideoModal` only as a fallback with a clear message ("Video not found in browser storage — please re-select the file").
    *   Optionally offer "link existing file" without wiping segments.

---

## Phase 2: Export Progress Bar (Highest Priority)

### 6. Real progress bar in Export Studio

*   **Problem:** Export progress is a monospace text label (`ffmpeg:load 42%`) in `ExportStudioModal`. It is easy to miss, not visual, and does not convey overall job progress across phases. Native Electron export reports `0%` then `100%` with nothing in between.
*   **Status:** 🔴 Pending
*   **Files:** `src/components/app/ExportStudioModal.tsx`, `src/lib/exportMp4.ts`, `src/lib/ffmpegSingleton.ts`
*   **Action:**
    *   Replace the text-only indicator with a `<Progress>` bar (0–100%) and a human-readable phase label ("Loading encoder…", "Cutting clip 3/12…", "Merging…").
    *   Define a **weighted progress model** so the bar moves smoothly across the full job:

        | Phase | Weight | Source |
        |-------|--------|--------|
        | Load ffmpeg.wasm | 5% | existing `getFFmpeg` callback |
        | Write input to FS | 10% | byte-write progress (if available) or indeterminate |
        | Cut clips (per segment) | 70% | `(clipIndex + clipProgress) / totalClips` |
        | Concat | 10% | ffmpeg `progress` event during concat |
        | Read output | 5% | readFile completion |

    *   Wire `ffmpeg.on('progress', …)` in `ffmpegSingleton` (or per-export) to get frame-level progress during each `exec` call — map `progress` (0–1) into the current clip's slice of the 70% band.
    *   Disable the Render button and show cancel affordance (stretch: `ffmpeg.terminate()` + reload) while exporting.
    *   Keep the modal open until download completes; do not allow accidental dismiss mid-export.

### 7. Native (Electron) export progress

*   **Problem:** `run-native-export` in `electron/main.cts` spawns ffmpeg but never parses stderr for progress or emits IPC events. Renderer jumps from 0% to 100%.
*   **Status:** 🔴 Pending
*   **Files:** `electron/main.cts`, `electron/preload.cts`, `src/types/electron.ts`, `src/lib/exportMp4.ts`
*   **Action:**
    *   Parse ffmpeg stderr for `time=` / `out_time_ms` / `progress=continue` lines.
    *   Emit `export-progress` IPC events with `{ phase, ratio }`.
    *   Reuse the same progress bar component and weighted model from item 6.

---

## Phase 3: Export Consistency & Speed (Browser)

### 8. Unify browser export pipeline (single-pass `filter_complex`)

*   **Problem:** Browser export cuts each segment into a separate clip file, then concat-demuxes. This is slow (N encode passes + 1 concat), memory-heavy (all clips in ffmpeg virtual FS), and the `-c copy` fallback on overlay failure produces **inconsistent output** (no label burn-in, different codec params).
*   **Status:** 🔴 Pending
*   **Files:** `src/lib/exportMp4.ts`
*   **Action:**
    *   Port the Electron native approach to ffmpeg.wasm: one `filter_complex` with `trim`/`atrim` per segment, optional gap clips, single `concat`, one encode pass.
    *   Remove per-clip intermediate files from virtual FS (reduces peak memory and failure points).
    *   **Remove silent `-c copy` fallback** when drawtext fails — surface an error instead so output is always predictable.
    *   Lock encoder settings across all exports: `libx264`, `preset veryfast`, `crf 23`, `aac 128k`, `format=yuv420p`.

### 9. Consistent input handling for export

*   **Problem:** Export accepts `File | string` (blob URL or `file://`). Browser path re-fetches the entire video into ffmpeg FS even when the `File` is already in memory. Behavior differs between browser and Electron.
*   **Status:** 🔴 Pending
*   **Files:** `src/lib/exportMp4.ts`, `src/store/projectStore.ts`
*   **Action:**
    *   Browser: always export from `session.videoFile` or rehydrated blob from IndexedDB — never from blob URL fetch (avoids redundant decode/copy).
    *   Validate before export: video loaded, segments non-empty, duration known, segment times within `[0, duration]`.
    *   Return structured errors (`NO_VIDEO`, `NO_SEGMENTS`, `SEGMENT_OUT_OF_RANGE`) for consistent UI messaging.

### 10. Export speed improvements (best-effort)

*   **Problem:** ffmpeg.wasm is CPU-only and loads the full video into memory. Export time is dominated by the user's machine, but the current multi-pass pipeline makes it worse than necessary.
*   **Status:** 🔴 Pending
*   **Files:** `src/lib/exportMp4.ts`, `src/lib/ffmpegSingleton.ts`
*   **Action:**
    *   **Primary win:** item 8 (single-pass) — largest expected speedup.
    *   Keep ffmpeg.wasm loaded across exports (already a singleton — verify it is not re-loaded unnecessarily).
    *   Use `-ss` before `-i` for segment seeks where accuracy allows (faster keyframe seek; document trade-off vs sample-accurate `-ss` after `-i`).
    *   Consider `preset faster` / `crf 26` as a "Fast export" toggle in Export Studio (user chooses speed vs quality).
    *   Do **not** promise hardware acceleration in browser — WASM ffmpeg cannot use GPU encoders. Document expected times in UI ("Export may take several minutes for long matches").

### 11. Export output cleanup

*   **Problem:** Electron native export writes `<video>_export_<timestamp>.mp4` next to the source file and never deletes it. Browser WASM cleans virtual FS but leaves no trace — inconsistent.
*   **Status:** 🔴 Pending
*   **Files:** `electron/main.cts`, `src/lib/exportMp4.ts`
*   **Action:**
    *   Electron: delete temp export file after reading into blob (or write to OS temp dir via `app.getPath('temp')`).
    *   Browser: no file-system artifact (already correct).

---

## Phase 4: Electron-Only (Lower Priority for Browser Goals)

### 12. Custom protocol (security hardening)

*   **Problem:** `webSecurity: false` in `main.cts` allows `file://` playback but is a high-risk configuration.
*   **Status:** 🔴 Pending
*   **Files:** `electron/main.cts`
*   **Action:** Set `webSecurity: true`, implement `protocol.handle('media', …)`, use `media://` URLs in renderer.

### 13. Production font resolution (ASAR fix)

*   **Problem:** FFmpeg `drawtext` font paths break in packaged builds (ASAR).
*   **Status:** 🔴 Pending
*   **Files:** `electron/main.cts`, `package.json`
*   **Action:** Add fonts to `asarUnpack`, resolve path via `app.asar.unpacked`.

### 14. Hardware acceleration (Electron export only)

*   **Problem:** Export is CPU-only (`libx264`).
*   **Status:** 🔴 Pending
*   **Action:** Detect `h264_videotoolbox` / `h264_nvenc` / `h264_amf`, add optional toggle in Settings.

### 15. Waveform visualization

*   **Problem:** Hard to find match events (whistles) without audio visualization.
*   **Status:** 🔴 Pending
*   **Files:** `src/components/app/TimelinePanel.tsx`
*   **Action:** Generate peaks via Web Audio API or ffmpeg, render behind segments.

---

## Suggested Implementation Order

| Order | Item | Rationale |
|-------|------|-----------|
| 1 | **6** — Export progress bar | Highest user-visible impact; low risk |
| 2 | **7** — Native export progress | Same UI, completes progress story for Electron |
| 3 | **1** — Video blobs in IndexedDB | Core browser persistence gap |
| 4 | **2** — Project state → IndexedDB | Prevents annotation data loss |
| 5 | **3** — `storage.persist()` | Protects stored video from eviction |
| 6 | **8** — Single-pass export | Consistency + major speed win |
| 7 | **9** — Consistent export input | Reliability |
| 8 | **4** — Content hash | Robust re-linking |
| 9 | **5** — Simplify RequireVideoModal | UX polish after persistence works |
| 10 | **10–11** — Speed toggles, cleanup | Incremental improvements |

---

## Progress Tracking

### Browser (priority)
- [ ] 1. Video blobs in IndexedDB
- [ ] 2. Project state → IndexedDB
- [ ] 3. `navigator.storage.persist()`
- [ ] 4. Content hash for video identity
- [ ] 5. Simplify RequireVideoModal
- [ ] 6. Export progress bar (WASM)
- [ ] 7. Export progress bar (Electron native)
- [ ] 8. Single-pass filter_complex export
- [ ] 9. Consistent export input validation
- [ ] 10. Export speed improvements
- [ ] 11. Export temp file cleanup

### Electron / polish
- [ ] 12. Custom protocol security
- [ ] 13. ASAR font fix
- [ ] 14. Hardware acceleration
- [ ] 15. Waveform visualization
