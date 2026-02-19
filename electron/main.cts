import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

// Constants
const APP_FOLDER_NAME = 'open-handball-video';
const SAVES_FOLDER_NAME = '.saves';

// Determine the App Folder Path
let appFolderPath: string | null = null;

function getAppFolderPath() {
  if (!appFolderPath) {
    appFolderPath = path.join(app.getPath('documents'), APP_FOLDER_NAME);
  }
  return appFolderPath;
}

function getSavesFolderPath() {
  return path.join(getAppFolderPath(), SAVES_FOLDER_NAME);
}

function ensureFoldersExist() {
  const appPath = getAppFolderPath();
  if (!fs.existsSync(appPath)) {
    fs.mkdirSync(appPath, { recursive: true });
  }
  const savesPath = getSavesFolderPath();
  if (!fs.existsSync(savesPath)) {
    fs.mkdirSync(savesPath, { recursive: true });
  }
}

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false // Needed for file:// access to videos without complex setups
    },
  });

  // Check if we are in dev mode (env var or argument)
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  ensureFoldersExist();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPC Handlers ---

ipcMain.handle('get-videos', async () => {
  try {
    ensureFoldersExist();
    const appPath = getAppFolderPath();
    const files = await fs.promises.readdir(appPath);
    
    // Filter for video files
    const videoExtensions = ['.mp4', '.mov', '.webm', '.mkv', '.avi'];
    const videos = await Promise.all(files
      .filter(file => videoExtensions.includes(path.extname(file).toLowerCase()))
      .map(async (file) => {
        const filePath = path.join(appPath, file);
        const stats = await fs.promises.stat(filePath);
        return {
          name: file,
          path: filePath,
          url: `file://${filePath}`,
          size: stats.size,
          createdAt: stats.birthtimeMs,
          modifiedAt: stats.mtimeMs
        };
      }));
      
    return videos;
  } catch (error) {
    console.error('Error listing videos:', error);
    return [];
  }
});

ipcMain.handle('load-project', async (_event, videoFileName) => {
  try {
    ensureFoldersExist();
    // videoFileName is expected to be "match.mp4"
    // We look for ".saves/match.mp4.json"
    const saveFileName = `${videoFileName}.json`;
    const savePath = path.join(getSavesFolderPath(), saveFileName);

    if (fs.existsSync(savePath)) {
      const data = await fs.promises.readFile(savePath, 'utf-8');
      return JSON.parse(data);
    }
    return null;
  } catch (error) {
    console.error(`Error loading project for ${videoFileName}:`, error);
    // Return null instead of throwing, so the UI can just start a fresh project
    return null;
  }
});

ipcMain.handle('save-project', async (_event, videoFileName, projectData) => {
  try {
    ensureFoldersExist();
    const saveFileName = `${videoFileName}.json`;
    const savePath = path.join(getSavesFolderPath(), saveFileName);
    
    // Write nicely formatted JSON
    await fs.promises.writeFile(savePath, JSON.stringify(projectData, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error(`Error saving project for ${videoFileName}:`, error);
    throw error;
  }
});

ipcMain.handle('read-file', async (_event, filePath: string) => {
  try {
    const buffer = await fs.promises.readFile(filePath);
    return buffer;
  } catch (error) {
    console.error(`Error reading file at ${filePath}:`, error);
    throw error;
  }
});

ipcMain.handle('run-native-export', async (event, { inputPath, outputPath, segments, addGap, mainLabels }) => {
  return new Promise(async (resolve, reject) => {
    try {
      const env = { ...process.env };
      if (process.platform === 'darwin' && !env.PATH?.includes('/opt/homebrew/bin')) {
        env.PATH = `/opt/homebrew/bin:${env.PATH || ''}`;
      }

      // Get video resolution and audio info
      let width = 1280;
      let height = 720;
      let sampleRate = 48000;
      try {
        const probeProc = spawn('ffprobe', [
          '-v', 'error',
          '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height',
          '-of', 'csv=s=x:p=0',
          inputPath
        ], { env });
        let probeOutput = '';
        probeProc.stdout.on('data', (data) => { probeOutput += data.toString(); });
        await new Promise((res) => probeProc.on('close', res));
        const dimensions = probeOutput.trim().split('x');
        if (dimensions.length === 2) {
          width = parseInt(dimensions[0], 10);
          height = parseInt(dimensions[1], 10);
        }

        const audioProbeProc = spawn('ffprobe', [
          '-v', 'error',
          '-select_streams', 'a:0',
          '-show_entries', 'stream=sample_rate',
          '-of', 'csv=p=0',
          inputPath
        ], { env });
        let audioOutput = '';
        audioProbeProc.stdout.on('data', (data) => { audioOutput += data.toString(); });
        await new Promise((res) => audioProbeProc.on('close', res));
        if (audioOutput.trim()) {
          sampleRate = parseInt(audioOutput.trim(), 10);
        }
      } catch (e) {
        console.warn('Failed to probe video info, using fallbacks:', e);
      }

      // Check for drawtext support
      let hasDrawtext = false;
      try {
        const checkProc = spawn('ffmpeg', ['-filters'], { env });
        let filtersOutput = '';
        checkProc.stdout.on('data', (data) => { filtersOutput += data.toString(); });
        await new Promise((res) => checkProc.on('close', res));
        hasDrawtext = filtersOutput.includes('drawtext');
      } catch (e) {
        console.warn('Failed to check ffmpeg filters:', e);
      }

      // Find font path
      let fontPath = path.join(app.getAppPath(), 'public', 'fonts', 'Roboto-Bold.ttf');
      if (!fs.existsSync(fontPath)) {
        fontPath = path.join(app.getAppPath(), 'dist', 'fonts', 'Roboto-Bold.ttf');
      }

      const args = ['-hide_banner', '-y', '-i', inputPath];
      
      let filterComplex = '';
      const concatInputs: string[] = [];

      segments.forEach((seg: any, i: number) => {
        const label = mainLabels.find((l: any) => l.id === seg.mainLabelId);
        const primaryText = label?.defaultName || label?.name || 'Tag';
        const secondaryText = (label?.defaultName && label?.name !== label?.defaultName) ? label?.name : null;

        let overlayFilter = '';
        if (hasDrawtext) {
          const pText = primaryText.replace(/'/g, "'\\\\''").replace(/:/g, '\\:');
          const sText = secondaryText ? secondaryText.replace(/'/g, "'\\\\''").replace(/:/g, '\\:') : '';

          overlayFilter = `,drawtext=fontfile='${fontPath}':text='${pText}':x=30:y=30:fontsize=44:fontcolor=white:shadowcolor=black@0.6:shadowx=2:shadowy=2`;
          if (secondaryText) {
            overlayFilter += `,drawtext=fontfile='${fontPath}':text='${sText}':x=30:y=85:fontsize=22:fontcolor=white:shadowcolor=black@0.6:shadowx=2:shadowy=2`;
          }
        }

        filterComplex += `[0:v]trim=start=${seg.startTimeSec}:end=${seg.endTimeSec},setpts=PTS-STARTPTS${overlayFilter}[v${i}]; `;
        filterComplex += `[0:a]atrim=start=${seg.startTimeSec}:end=${seg.endTimeSec},asetpts=PTS-STARTPTS[a${i}]; `;
        
        concatInputs.push(`[v${i}][a${i}]`);

        if (addGap && i < segments.length - 1) {
          filterComplex += `color=c=black:s=${width}x${height}:d=0.5,setpts=PTS-STARTPTS[vg${i}]; `;
          filterComplex += `anullsrc=r=${sampleRate}:cl=stereo:d=0.5,asetpts=PTS-STARTPTS[ag${i}]; `;
          concatInputs.push(`[vg${i}][ag${i}]`);
        }
      });

      filterComplex += `${concatInputs.join('')}concat=n=${concatInputs.length}:v=1:a=1[outv][outa]`;

      args.push('-filter_complex', filterComplex, '-map', '[outv]', '-map', '[outa]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', outputPath);

      console.log('Running native ffmpeg:', args.join(' '));
      
      const proc = spawn('ffmpeg', args, { env });

      proc.stderr.on('data', (data) => {
        const msg = data.toString();
        // Progress parsing could go here if needed
        console.debug('ffmpeg:', msg);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });

    } catch (error) {
      reject(error);
    }
  });
});
