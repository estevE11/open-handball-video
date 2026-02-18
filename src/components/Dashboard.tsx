import { useEffect, useState } from 'react';
import { useProjectStore } from '@/store/projectStore';
import { VideoFile } from '@/types/electron';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { FileVideo, RefreshCw } from 'lucide-react';

export function Dashboard() {
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [loading, setLoading] = useState(false);
  const setElectronVideo = useProjectStore((s) => s.setElectronVideo);
  const replaceProject = useProjectStore((s) => s.replaceProject);

  const fetchVideos = async () => {
    if (!window.electron) return;
    setLoading(true);
    try {
      const list = await window.electron.getVideos();
      // Sort by modified date descending
      setVideos(list.sort((a, b) => b.modifiedAt - a.modifiedAt));
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
            Select a video from your documents folder to start analyzing.
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={fetchVideos} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

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
              onClick={() => handleSelectVideo(video)}
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
                <div className="text-xs text-muted-foreground">
                  Last modified: {new Date(video.modifiedAt).toLocaleDateString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
