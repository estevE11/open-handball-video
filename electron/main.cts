import { app, BrowserWindow, ipcMain, protocol } from 'electron';
import path from 'path';
import fs from 'fs';

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
