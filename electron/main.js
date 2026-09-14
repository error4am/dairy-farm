const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_DATA_DIR = path.join(app.getPath('appData'), 'DairyFarmManager');
app.setPath('userData', APP_DATA_DIR);

const LOG_FILE = path.join(APP_DATA_DIR, 'startup.log');

function log(message) {
  try {
    fs.mkdirSync(APP_DATA_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // logging must never break startup
  }
}

let mainWindow = null;
let httpServer = null;
let sqlite = null;
let shuttingDown = false;

function startLocalServer() {
  process.env.DB_PATH = path.join(APP_DATA_DIR, 'data', 'dairy.db');
  process.env.BACKUP_DIR = path.join(APP_DATA_DIR, 'backups');

  const expressApp = require(path.join(__dirname, '..', 'server', 'index.js'));
  sqlite = require(path.join(__dirname, '..', 'server', 'db', 'connection.js'));

  return new Promise((resolve, reject) => {
    httpServer = expressApp.listen(0, '127.0.0.1', () => {
      const address = httpServer.address();
      log(`Server listening on http://127.0.0.1:${address.port}`);
      resolve(address.port);
    });
    httpServer.on('error', (err) => {
      reject(err);
    });
  });
}

function runAutomaticBackup() {
  try {
    const backup = require(path.join(__dirname, '..', 'server', 'db', 'backup.js'));
    const result = backup.runAutomaticBackup();
    log(
      result.skipped
        ? `Automatic backup: already created today (${result.path})`
        : `Automatic backup created: ${result.path}`
    );
  } catch (err) {
    log(`Automatic backup failed: ${err.message}`);
  }
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Dairy Farm Manager',
    backgroundColor: '#f5f6f5',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedOrigin = `http://127.0.0.1:${port}`;
    if (!url.startsWith(allowedOrigin)) {
      event.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;

  if (httpServer) {
    try {
      httpServer.close();
    } catch {
      // ignore
    }
    httpServer = null;
  }

  if (sqlite) {
    try {
      if (sqlite.open) sqlite.close();
    } catch {
      // ignore
    }
    sqlite = null;
  }

  log('Application shutdown complete.');
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      log(`Application starting (electron ${process.versions.electron}, node ${process.versions.node})`);
      const port = await startLocalServer();
      runAutomaticBackup();
      createWindow(port);
    } catch (err) {
      log(`STARTUP FAILED: ${err && err.stack ? err.stack : err}`);
      dialog.showErrorBox(
        'Dairy Farm Manager',
        'The application could not start.\n\nPlease close the application and try again.\n\nTechnical details are available in:\n' +
          APP_DATA_DIR
      );
      shutdown();
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    shutdown();
    app.quit();
  });

  app.on('before-quit', shutdown);
}
