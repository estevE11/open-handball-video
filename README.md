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

The library has a directory tree with **All videos** and **Library root** views. Create nested folders with the folder button; **Edit folder** renames a directory or moves it under another parent. A video's action menu supports renaming, moving, duplication, JSON export, and removal. Folder and video display names never change source filenames or saved clip identities. The selected folder and filters are remembered when returning from a video.

New videos and split matches have a match-details step after label-set selection. Record the category, competition, fixture/matchday (for example, Round 12), season, local team, and visitor team. These fields are optional and remain editable through **Match details** on each card. **Manage teams** maintains a shared, name-only team list; team pickers include search and inline creation. Filter by either local or visitor team, or search video names, teams, competition, season, and matchday. Team renames retain their stable IDs and update cards and filters.

Duplicating creates a new project with independent annotations and segment IDs, while preserving its label-set binding and match details. Browser copies share an immutable media reference, so duplicating a large video does not copy its bytes. Replacing or removing one copy's video leaves other copies intact; media is reclaimed only when the last reference is removed. Capacity totals count shared media once. JSON exports include team names alongside IDs; imports reconcile the team list and enter the currently selected folder. Existing projects remain usable without match details.

Desktop folders use the same logical library model, persisted in `.saves/library-catalog.json`. Native copies have independent project sidecars and refer to the same original files in `Documents/open-handball-video`. Folder changes do not move files on disk. This remains local storage; account permissions, cloud uploads, and multi-user sync are future work.

Use **Manage label sets** in the main menu to create and edit reusable main and secondary labels with the same editor used inside a video. Every new video or split match requires a label set before tagging begins. The selected label set is permanent for the project; editing its labels or set name updates the shared set for all videos using it. Drag the handles or use the arrows in either label tab to set a custom order; that order is used by the video buttons, timeline tracks, and label filters. Existing projects retain their labels as reusable sets named after their videos. Removing a label from a set preserves existing tagged segments and their label names, while preventing new tags with that label.

Use **Add video** to create a project. The app stores the original video and project JSON in IndexedDB on your current browser and device. Labels, settings, and segments autosave; reopening a saved project restores its video without another upload. The library supports multiple projects, JSON import/export, and deletion of both a project's video and metadata to reclaim space. **Remove video** frees a project's video storage while preserving its JSON, labels, segments, settings, and original video details. The library marks these projects as needing their video; open one and attach the original file to continue. **Delete project** removes both the video and project data.

Imported JSON creates a separate project; attach its original video once when opening it. Legacy single-project localStorage autosaves migrate into the library automatically.

The storage panel reports estimated available bytes and predicts additional projects as `floor(available bytes / average complete project bytes)`. Each complete project's size includes its video and UTF-8 JSON; JSON-only imports are excluded from the average. Before the first video is stored, or when the browser cannot report its quota, the prediction is unavailable. Browser estimates can change and are not a guarantee of available physical disk space.

Videos stay on your device and are not uploaded to Vercel. Browser storage belongs to the site's origin; another browser, device, or deployment hostname has a separate library. Keep original videos and exported JSON as backups. Clearing site data deletes the library. **Keep storage persistent** asks the browser to protect stored projects from automatic eviction; browsers may decline, and private browsing storage is temporary.

Electron continues reading videos and project JSON from `Documents/open-handball-video`. Native exports use isolated temporary directories, return the completed video for download, and remove intermediates after success or failure.

## Beta diagnostics

Use **Share diagnostics** in the library header, the editor's bug button, or an error message to preview, copy, or download a JSON diagnostic report. Send the report to the development team with the steps that led to the problem. Reports include the app version and build commit, browser/OS user agent, storage API support and persistence status, safe media statistics, recent save/export activity, error stacks, and the export engine's recent output. Export errors also retain the last phase and progress, selected clip count, and gap setting. The export error message is shown in full rather than truncated.

Diagnostics are local and are never sent automatically. Videos and full project JSON are excluded; common file paths, source URLs, credentials, and text overlays are redacted. The history keeps up to 120 events and 80 engine log lines, with a 200,000-character persisted budget. It survives reloads when localStorage is available, and stays usable in memory if browser storage is full or blocked. A report is a troubleshooting aid, not a project backup; clearing site data may remove diagnostic history too. Production builds generate hidden source maps; retained script filenames and line/column positions can be mapped back to source for the reported build. Historical error entries retain their build identity.

## Playback and clip titles

Playback speeds are 0.5×, 1×, 2×, 2.5×, and 3×. Tap Space to play or pause. Hold Space for temporary 1× playback; release it to restore the selected speed and previous playing or paused state. Hold J also temporarily switches to 1×. Left/right arrows seek backward/forward five seconds. Comma steps one frame backward; period steps one frame forward. Frame stepping pauses playback and uses the current source clip's frame rate (or the configured fallback). Playback shortcuts work even when player buttons, the speed selector, or the timeline slider have focus; use Enter or a click to open the speed menu. These shortcuts leave text editing and dialog controls alone.

Use a clip's pencil button or double-click its title to rename that individual event. Clearing the title restores its tag type as the default. Renaming keeps the tag type and all sibling clips unchanged. Exported videos show the individual name at 44 px and its type underneath at 22 px; Export Studio previews both. Shared type names remain editable in Settings. Names already changed globally by older versions can be corrected there; the old data does not record which individual clip was intended.

Drag the divider above the timeline to resize its height, or the divider beside the event log to resize the sidebar width. The timeline starts at two label rows tall and scrolls vertically when more labels are present, so adding labels does not shrink the video. Its minimum height is 156 px, including the headers and scrollbar; the sidebar has a 320 px minimum width. Resizing preserves room for the player. Pane sizes are remembered on this browser or device. Double-click a divider to reset it, or focus it and use Alt + arrow keys to resize (Alt + Shift + arrows for larger steps). Small windows scroll the workspace rather than hiding controls.

## Split matches

In the browser, select multiple files with **Add video**. Arrange them using drag and drop or the up/down arrows, then choose **Start tagging**. Preparation reads each clip's duration; no merged copy of the full match is created. Clip order is fixed once tagging starts to keep existing tag times meaningful.

Playback, scrubbing, the event log, and tagging use one continuous match timeline. The player switches originals at clip boundaries. Project JSON stores the ordered clip list and durations, and browser storage retains all original clips in one atomic save. Existing single-video projects continue to work.

**Remove video** removes all stored originals for that project and keeps its analysis and clip order. To revisit it, open the project and select all original files. The app matches filenames and sizes and restores their saved order even if the files are selected in a different order. Missing or mismatched clips leave the saved project untouched.

In Electron, put the originals in `Documents/open-handball-video`, select **Include in split match** for each one, and choose **Arrange selected clips**. Split matches have their own saved-project entries and JSON sidecars, so they do not replace the individual videos' projects.

Export Studio cuts the selected tag ranges from the relevant sources, including tags spanning clip boundaries, and merges only those tagged pieces. Split-match exports normalize video to 30 fps and the first used clip's dimensions, and audio to stereo 48 kHz (silence for clips without audio). Optional black gaps occur between tags, never in the middle of a tag spanning two sources. The browser exporter loads one original at a time into FFmpeg memory; large clips can still exceed browser memory limits. Export never modifies the originals.

Export Studio shows a live progress bar for browser and Electron exports. Rendering progress uses encoded video time and is weighted by tagged duration; it never moves backward between stages or retries. Loading and download preparation have status labels and an activity indicator. The bar reaches 100% only when the exported file is ready, and failures retain the last percentage so a retry can start cleanly.

Validation includes UI ordering/seek/playback/save/restore tests, IndexedDB rollback and removal tests, and real native and WebAssembly renders using clips with different dimensions, frame rates, and audio presence. Those render tests inspect the resulting media streams and decoded pixels to verify source order and gap placement.

## Vercel

`vercel.json` configures the Vite build and isolation headers used by the browser's FFmpeg WebAssembly export. From the `dev` branch, deploy a preview and update its stable URL:

```sh
vercel link
vercel deploy --target=preview --yes -m githubDeployment=1 -m githubCommitRef=dev
vercel alias set <preview-url> open-handball-video-dev.vercel.app
```

After merging approved changes to `main`, deploy from `main` with `vercel deploy --prod --yes -m githubDeployment=1 -m githubCommitRef=main`.

Builds from `dev` show `[DEV]` in the tab title and an amber corner fade, including production builds. Main builds keep the normal appearance. Vite uses `VERCEL_GIT_COMMIT_REF` on Vercel and the checked-out Git branch locally; pass the Git metadata above for CLI deployments so Vercel identifies the branch correctly.

Use the stable beta (`open-handball-video.vercel.app`) and dev hostnames to retain each site's browser library across deployments. Their storage is separate.

## Implementation references

[OpenCut Classic storage](https://github.com/opencut-app/opencut-classic/tree/main/apps/web/src/services/storage) and [scene exporter](https://github.com/opencut-app/opencut-classic/blob/main/apps/web/src/services/renderer/scene-exporter.ts) informed the capacity preflight and export resource cleanup. This app stores video blobs and JSON in separate IndexedDB stores within one atomic transaction. Browser exports use the existing FFmpeg pipeline, with bundled worker dependencies, exit-code checks, and temporary-file cleanup on success and failure.

The bundled Roboto Bold font is sourced from [googlefonts/roboto](https://github.com/googlefonts/roboto/blob/main/src/hinted/Roboto-Bold.ttf); its Apache 2.0 license is included at `public/fonts/Roboto-LICENSE.txt`.
