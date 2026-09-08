# Open Handball Video

Video analysis for handball, available as an Electron desktop app and a browser app.

Web app: https://open-handball-video.vercel.app

## Run locally

```sh
npm install
npm run dev             # Browser app at http://localhost:5173
npm run electron:dev    # Electron app
npm run build           # Browser production build in dist/
npm run electron:build # Desktop packages in release/
npm test
npm run lint
```

## Browser projects

Use **Add video** to create a project. The app stores the original video and project JSON in IndexedDB on your current browser and device. Labels, settings, and segments autosave; reopening a saved project restores its video without another upload. The library supports multiple projects, JSON import/export, and deletion of both a project's video and metadata to reclaim space. **Remove video** frees a project's video storage while preserving its JSON, labels, segments, settings, and original video details. The library marks these projects as needing their video; open one and attach the original file to continue. **Delete project** removes both the video and project data.

Imported JSON creates a separate project; attach its original video once when opening it. Legacy single-project localStorage autosaves migrate into the library automatically.

The storage panel reports estimated available bytes and predicts additional projects as `floor(available bytes / average complete project bytes)`. Each complete project's size includes its video and UTF-8 JSON; JSON-only imports are excluded from the average. Before the first video is stored, or when the browser cannot report its quota, the prediction is unavailable. Browser estimates can change and are not a guarantee of available physical disk space.

Videos stay on your device and are not uploaded to Vercel. Browser storage belongs to the site's origin; another browser, device, or deployment hostname has a separate library. Keep original videos and exported JSON as backups. Clearing site data deletes the library. **Keep storage persistent** asks the browser to protect stored projects from automatic eviction; browsers may decline, and private browsing storage is temporary.

Electron continues reading videos and project JSON from `Documents/open-handball-video`.

## Playback and clip titles

Playback speeds are 0.5×, 1×, 2×, and 3×. Left/right arrows seek backward/forward five seconds. Comma steps one frame backward; period steps one frame forward. Frame stepping pauses playback and uses the current source clip's frame rate (or the configured fallback). These shortcuts leave text editing and dialog controls alone.

Use a clip's pencil button or double-click its title to rename that individual event. Clearing the title restores its tag type as the default. Renaming keeps the tag type and all sibling clips unchanged. Exported videos show the individual name at 44 px and its type underneath at 22 px; Export Studio previews both. Shared type names remain editable in Settings. Names already changed globally by older versions can be corrected there; the old data does not record which individual clip was intended.

The timeline fits its header and label rows, with no reserved empty space. Its height is capped at 320 px or 40% of the viewport, whichever is smaller, and additional rows scroll.

## Split matches

In the browser, select multiple files with **Add video**. Arrange them using drag and drop or the up/down arrows, then choose **Start tagging**. Preparation reads each clip's duration; no merged copy of the full match is created. Clip order is fixed once tagging starts to keep existing tag times meaningful.

Playback, scrubbing, the event log, and tagging use one continuous match timeline. The player switches originals at clip boundaries. Project JSON stores the ordered clip list and durations, and browser storage retains all original clips in one atomic save. Existing single-video projects continue to work.

**Remove video** removes all stored originals for that project and keeps its analysis and clip order. To revisit it, open the project and select all original files. The app matches filenames and sizes and restores their saved order even if the files are selected in a different order. Missing or mismatched clips leave the saved project untouched.

In Electron, put the originals in `Documents/open-handball-video`, select **Include in split match** for each one, and choose **Arrange selected clips**. Split matches have their own saved-project entries and JSON sidecars, so they do not replace the individual videos' projects.

Export Studio cuts the selected tag ranges from the relevant sources, including tags spanning clip boundaries, and merges only those tagged pieces. Split-match exports normalize video to 30 fps and the first used clip's dimensions, and audio to stereo 48 kHz (silence for clips without audio). Optional black gaps occur between tags, never in the middle of a tag spanning two sources. The browser exporter loads one original at a time into FFmpeg memory; large clips can still exceed browser memory limits. Export never modifies the originals.

Validation includes UI ordering/seek/playback/save/restore tests, IndexedDB rollback and removal tests, and real native and WebAssembly renders using clips with different dimensions, frame rates, and audio presence. Those render tests inspect the resulting media streams and decoded pixels to verify source order and gap placement.

## Vercel

`vercel.json` configures the Vite build and isolation headers used by the browser's FFmpeg WebAssembly export. Deploy with:

```sh
vercel link
vercel --prod
```

Use a stable production hostname to keep access to the same browser library across deployments.

## Implementation references

[OpenCut Classic storage](https://github.com/opencut-app/opencut-classic/tree/main/apps/web/src/services/storage) and [scene exporter](https://github.com/opencut-app/opencut-classic/blob/main/apps/web/src/services/renderer/scene-exporter.ts) informed the capacity preflight and export resource cleanup. This app stores video blobs and JSON in separate IndexedDB stores within one atomic transaction. Browser exports use the existing FFmpeg pipeline, with bundled worker dependencies, exit-code checks, and temporary-file cleanup on success and failure.

The bundled Roboto Bold font is sourced from [googlefonts/roboto](https://github.com/googlefonts/roboto/blob/main/src/hinted/Roboto-Bold.ttf); its Apache 2.0 license is included at `public/fonts/Roboto-LICENSE.txt`.
