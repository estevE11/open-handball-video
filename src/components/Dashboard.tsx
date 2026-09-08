import { useEffect, useState } from 'react';
import { ClipOrderDialog } from '@/components/app/ClipOrderDialog';
import { createEmptyProject } from '@/lib/projectDefaults';
import { createId } from '@/lib/ids';
import { readVideoDuration, withProjectClips } from '@/lib/clipTimeline';
import { openElectronClipProject } from '@/lib/electronProjectSession';
import type { ProjectData, VideoClip } from '@/types/project';
import { useVideoStore } from '@/store/videoStore';
import { useProjectStore } from '@/store/projectStore';
import type { VideoFile } from '@/types/electron';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { FileVideo, RefreshCw } from 'lucide-react';

export function Dashboard() {
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<VideoFile[]>([]);
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [error, setError] = useState('');
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [loading, setLoading] = useState(false);
  const setElectronVideo = useProjectStore((s) => s.setElectronVideo);
  const replaceProject = useProjectStore((s) => s.replaceProject);

  const fetchVideos = async () => {
    if (!window.electron) return;
    setLoading(true);
    try {
      const [list, saved] = await Promise.all([window.electron.getVideos(), window.electron.getClipProjects()]);
      setProjects(saved);
      setSelected((previous) => previous.filter((key) => list.some((video) => video.path === key)));
      setError('');
      // Sort by modified date descending
      setVideos(list.sort((a, b) => b.modifiedAt - a.modifiedAt));
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not read projects.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVideos();
  }, []);

  const handleSelectVideo = async (video: VideoFile) => {
    if (!window.electron) return;

    // Load saved project state if it exists
    const savedData = await window.electron.loadProject(video.name);
    
    useProjectStore.getState().resetProject();
    useVideoStore.getState().reset();

    // Set video in store (this sets videoSourceUrl to file://...)
    setElectronVideo(video.url, {
      fileName: video.name,
      fileSize: video.size,
      fileType: 'video/mp4', // Generic fallback
      lastModified: video.modifiedAt,
      // Duration will be updated by the video player once loaded
    });

    if (savedData) {
      console.log('Restoring project state for', video.name);
      replaceProject(savedData);
    } else {
      console.log('Starting fresh project for', video.name);
      // Ensure we don't have leftover state from previous project
      // (The store reset might be needed, but replaceProject overwrites most things. 
      //  To be safe, we could reset first, but setElectronVideo sets session.)
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Open Handball Video</h1>
          <p className="text-muted-foreground mt-2">
            Open a video, or select several clips below to create a split match.
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={fetchVideos} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button disabled={selected.length < 2 || loading} onClick={() => { setError(''); setPending(selected.map((key) => videos.find((video) => video.path === key)!)); }}>Arrange selected clips ({selected.length})</Button>
      {projects.length > 0 && <div className="flex flex-wrap gap-2">{projects.map((project) => <Button key={project.projectId} variant="secondary" onClick={() => {
        try { openElectronClipProject(project, videos); } catch (err) { setError(err instanceof Error ? err.message : 'Could not open project.'); }
      }}>Open match: {project.videoMeta?.fileName} ({project.clips?.length} clips)</Button>)}</div>}
      <ScrollArea className="flex-1 border rounded-md p-4 bg-card/50">
        {videos.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <p>No videos found in "Documents/open-handball-video"</p>
            <p className="text-sm mt-2">Add .mp4, .mov, or .webm files there.</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map((video) => (
            <Card 
              key={video.path} 
              className="cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => void handleSelectVideo(video).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not open project.'))}
            >
              <CardHeader className="flex flex-row items-center gap-4 pb-2">
                <div className="bg-primary/10 p-2 rounded-full">
                  <FileVideo className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 overflow-hidden">
                  <CardTitle className="text-base truncate" title={video.name}>
                    {video.name}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {(video.size / (1024 * 1024)).toFixed(1)} MB
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <label className="mb-2 flex items-center gap-2 text-sm" onClick={(event) => event.stopPropagation()}>
                  <input type="checkbox" checked={selected.includes(video.path)} onChange={(event) => {
                    setSelected((prev) => event.target.checked ? [...prev, video.path] : prev.filter((item) => item !== video.path));
                  }} /> Include in split match
                </label>
                <div className="text-xs text-muted-foreground">
                  Last modified: {new Date(video.modifiedAt).toLocaleDateString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
      {pending.length > 0 && <ClipOrderDialog items={pending.map((video) => ({ id: video.path, name: video.name }))}
        onChange={(ids) => setPending(ids.map((id) => pending.find((video) => video.path === id)!))}
        busy={loading} error={error} onCancel={() => setPending([])} onStart={() => {
          void (async () => {
            setLoading(true); setError('');
            try {
              const clips: VideoClip[] = [];
              for (const video of pending) clips.push({ id: createId(), fileName: video.name, fileSize: video.size,
                fileType: 'video/mp4', lastModified: video.modifiedAt, durationSec: await readVideoDuration(video.url) });
              const data = withProjectClips(createEmptyProject(), clips);
              data.electronProjectKey = data.projectId;
              if (!(await window.electron!.saveProject(data.electronProjectKey, data))) throw new Error('Could not save the split match.');
              openElectronClipProject(data, videos);
            } catch (err) { setError(err instanceof Error ? err.message : 'Could not prepare clips.'); }
            finally { setLoading(false); }
          })();
        }} />}
    </div>
  );
}
