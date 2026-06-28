'use strict';

const { app, BrowserWindow, shell, dialog, globalShortcut } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

/* ── Single instance ── */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

/* ── Config ── */
const SERVE_PORT  = 10673;
const BACKEND_PORT = 4000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.eot':  'application/vnd.ms-fontobject',
  '.map':  'application/json',
};

function getMime(p) {
  return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

/* ── Static file server + API proxy (SPA fallback to index.html) ── */
let fileServer = null;

function proxyToBackend(req, res) {
  const options = {
    hostname: '127.0.0.1',
    port: BACKEND_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${BACKEND_PORT}` },
  };
  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });
  proxyReq.on('error', () => { res.writeHead(502); res.end('Backend unavailable'); });
  req.pipe(proxyReq, { end: true });
}

function startStaticServer(distPath) {
  return new Promise((resolve, reject) => {
    fileServer = http.createServer((req, res) => {
      try {
        // Proxy /api/* → backend
        if (req.url.startsWith('/api/')) {
          proxyToBackend(req, res);
          return;
        }

        const rawPath = req.url.split('?')[0];
        let decoded;
        try { decoded = decodeURIComponent(rawPath); }
        catch { decoded = rawPath; }

        let fp = path.join(distPath, decoded === '/' ? 'index.html' : decoded);

        // SPA fallback (only for paths without file extension)
        if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
          fp = path.join(distPath, 'index.html');
        }

        fs.readFile(fp, (err, data) => {
          if (err) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(200, {
            'Content-Type': getMime(fp),
            'Cache-Control': fp.endsWith('index.html') ? 'no-cache' : 'max-age=86400',
          });
          res.end(data);
        });
      } catch (e) {
        res.writeHead(500); res.end('Server error');
      }
    });

    fileServer.listen(SERVE_PORT, '127.0.0.1', () => resolve());
    fileServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve();
      else reject(err);
    });
  });
}

/* ── Backend process ── */
let backendProcess = null;

function getOrCreateJwtSecret(userDataPath) {
  const secretFile = path.join(userDataPath, 'jwt_secret.txt');
  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, 'utf8').trim();
  }
  const secret = crypto.randomBytes(64).toString('hex');
  fs.writeFileSync(secretFile, secret, 'utf8');
  return secret;
}

function ensureDbCopied(userDataPath, backendDir) {
  const dbDest = path.join(userDataPath, 'bms_finance.db');
  const dbSrc  = path.join(backendDir, 'data', 'bms_finance.db');

  // ถ้า DB ที่ผู้ใช้มีอยู่มีขนาด < 64KB ถือว่าเป็น empty schema → ทับด้วย template
  const isEmptyDb = fs.existsSync(dbDest) && fs.statSync(dbDest).size < 65536;
  if (!fs.existsSync(dbDest) || isEmptyDb) {
    if (fs.existsSync(dbSrc)) {
      fs.copyFileSync(dbSrc, dbDest);
    }
  }
  return dbDest;
}

function waitForBackend(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      const req = http.request(
        { host: '127.0.0.1', port: BACKEND_PORT, path: '/api/health', method: 'GET' },
        (res) => {
          if (res.statusCode === 200) resolve();
          else tryAgain();
        }
      );
      req.on('error', tryAgain);
      req.setTimeout(1000, () => { req.destroy(); tryAgain(); });
      req.end();
    }
    function tryAgain() {
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Backend did not start in time'));
      } else {
        setTimeout(check, 500);
      }
    }
    check();
  });
}

function startBackend(backendDir, userDataPath) {
  const jwtSecret = getOrCreateJwtSecret(userDataPath);
  const dbPath    = ensureDbCopied(userDataPath, backendDir);
  const entryFile = path.join(backendDir, 'dist', 'server.js');

  if (!fs.existsSync(entryFile)) {
    throw new Error(`Backend entry not found: ${entryFile}`);
  }

  // Log file สำหรับ debug
  const logPath = path.join(userDataPath, 'backend.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  logStream.write(`\n--- backend start ${new Date().toISOString()} ---\n`);
  logStream.write(`entryFile: ${entryFile}\n`);
  logStream.write(`dbPath: ${dbPath}\n`);

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV:             'production',
    PORT:                 String(BACKEND_PORT),
    HOST:                 '0.0.0.0',
    DATABASE_URL:         `file:${dbPath}`,
    JWT_SECRET:           jwtSecret,
    CORS_ORIGINS:         `http://127.0.0.1:${SERVE_PORT},http://localhost:${SERVE_PORT}`,
  };

  // Use the Electron executable itself with ELECTRON_RUN_AS_NODE=1
  backendProcess = spawn(process.execPath, [entryFile], {
    env,
    cwd: backendDir,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess.stdout.on('data', (d) => { process.stdout.write('[backend] ' + d); logStream.write('[out] ' + d); });
  backendProcess.stderr.on('data', (d) => { process.stderr.write('[backend] ' + d); logStream.write('[err] ' + d); });

  backendProcess.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`[backend] exited with code ${code}\n`);
    }
    backendProcess = null;
  });
}

function killBackend() {
  if (backendProcess) {
    try { backendProcess.kill('SIGTERM'); } catch {}
    backendProcess = null;
  }
}

/* ── Auto update ── */
function setupAutoUpdater(userDataPath) {
  const logPath = path.join(userDataPath, 'update.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const log = (msg) => logStream.write(`[${new Date().toISOString()}] ${msg}\n`);

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => log('checking for update'));
  autoUpdater.on('update-available', (info) => log(`update available: ${info.version}`));
  autoUpdater.on('update-not-available', () => log('no update available'));
  autoUpdater.on('error', (err) => log(`error: ${err && err.stack ? err.stack : err}`));
  autoUpdater.on('download-progress', (p) => log(`download progress: ${p.percent.toFixed(1)}%`));
  autoUpdater.on('update-downloaded', (info) => {
    log(`update downloaded: ${info.version}`);
    dialog.showMessageBox({
      type: 'info',
      title: 'มีอัปเดตใหม่',
      message: `ดาวน์โหลดเวอร์ชัน ${info.version} เรียบร้อยแล้ว ต้องการรีสตาร์ทเพื่อติดตั้งตอนนี้หรือไม่?`,
      buttons: ['รีสตาร์ทตอนนี้', 'ติดตั้งครั้งถัดไป'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.checkForUpdates().catch((err) => log(`checkForUpdates failed: ${err.message}`));
}

/* ── BrowserWindow ── */
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Medical Record System',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`http://127.0.0.1:${SERVE_PORT}/`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  // F12 เปิด DevTools
  globalShortcut.register('F12', () => {
    if (mainWindow) mainWindow.webContents.toggleDevTools();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

/* ── App events ── */
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  const isPkg = app.isPackaged;

  const distPath   = isPkg
    ? path.join(process.resourcesPath, 'app-dist')
    : path.join(__dirname, '..', 'dist');

  const backendDir = isPkg
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, '..', 'backend-installer');

  const userDataPath = app.getPath('userData');

  // ตรวจ frontend
  if (!fs.existsSync(path.join(distPath, 'index.html'))) {
    dialog.showErrorBox(
      'ไม่พบไฟล์แอปพลิเคชัน',
      `ไม่พบ index.html ใน:\n${distPath}\n\nกรุณา build โปรเจกต์ก่อนรัน`
    );
    app.quit();
    return;
  }

  // เริ่ม backend
  try {
    startBackend(backendDir, userDataPath);
  } catch (err) {
    dialog.showErrorBox('ไม่สามารถเริ่ม Backend ได้', String(err.message));
    app.quit();
    return;
  }

  // รอ backend พร้อม (สูงสุด 30 วินาที)
  try {
    await waitForBackend(30000);
  } catch (err) {
    dialog.showErrorBox(
      'Backend ไม่ตอบสนอง',
      'ระบบฐานข้อมูลหลังบ้านใช้เวลานานเกินไป กรุณาลองเปิดโปรแกรมใหม่อีกครั้ง'
    );
    killBackend();
    app.quit();
    return;
  }

  await startStaticServer(distPath);
  createWindow();

  if (isPkg) {
    setupAutoUpdater(userDataPath);
  }
});

app.on('window-all-closed', () => {
  killBackend();
  if (fileServer) fileServer.close();
  app.quit();
});

app.on('before-quit', () => {
  killBackend();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
