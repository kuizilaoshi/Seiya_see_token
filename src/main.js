const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell } = require('electron');
const { createCodexRateLimitsClient } = require('./codexRateLimits');
const { getDefaultSessionsDir, readProjectSnapshot } = require('./projectUsageReader');
const {
  createLoadingSnapshot,
  createOfficialFailureSnapshot,
  createOfficialSnapshot,
  mergeProjectSnapshot,
  quotaWindowFromSnapshot
} = require('./quotaState');
const { createQuotaRetryScheduler } = require('./quotaRetry');
const { createUsageRefreshController } = require('./usageRefresh');
const { createWatchRefreshScheduler } = require('./watchRefresh');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('in-process-gpu');

const REFRESH_MS = 60 * 1000;
const WATCH_DEBOUNCE_MS = 900;
const WATCH_MAX_WAIT_MS = 5000;
const TRAY_ICON_DIR = path.join(app.getAppPath(), 'assets', 'tray-icons');

let mainWindow = null;
let tray = null;
let settings = {};
let refreshTimer = null;
let sessionWatcher = null;
let watchRefreshScheduler = null;
let displayRevision = 0;
let latestProjects = {
  sessionsDir: getDefaultSessionsDir(),
  scannedFiles: 0,
  projectStats: null,
  projects: []
};
let latestSnapshot = createLoadingSnapshot(latestProjects);

const codexRateLimits = createCodexRateLimitsClient();

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

const readSettings = () => {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
};

const saveSettings = (nextSettings = {}) => {
  settings = { ...settings, ...nextSettings };
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch {
    // Optional window preferences must never stop quota refreshes.
  }
};

const remainingPercent = (snapshot = latestSnapshot) => {
  const value = snapshot?.total?.remainingPercent;
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
};

const createFallbackTrayIcon = (label) => {
  const fontSize = label.length >= 3 ? 11 : 16;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="2" y="2" width="28" height="28" rx="7" fill="#f69ab7" stroke="#5c3630" stroke-width="2"/>
      <text x="16" y="21" text-anchor="middle" font-family="Noto Sans SC, Microsoft YaHei UI, sans-serif" font-size="${fontSize}" font-weight="400" fill="#181818">${label}</text>
    </svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
};

const createTrayIcon = (percent) => {
  if (!Number.isFinite(percent)) return createFallbackTrayIcon('--');
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  const label = value < 10 ? `0${value}` : String(value);
  const iconPath = path.join(TRAY_ICON_DIR, `tray-${label}.png`);
  const image = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : createFallbackTrayIcon(label);
  image.setTemplateImage(false);
  return image;
};

const sendWindowState = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window:state', { alwaysOnTop: mainWindow.isAlwaysOnTop() });
};

const sendSnapshot = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('usage:update', latestSnapshot);
};

const buildTrayMenu = () => {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示小组件', click: showWindow },
    { label: '收进托盘', click: destroyWindow },
    { label: '立即刷新', click: refreshAll },
    { type: 'separator' },
    { label: '打开项目文件夹', click: () => shell.openPath(app.getAppPath()) },
    { type: 'separator' },
    { label: '退出', click: quitApp }
  ]));
};

const updateTray = (snapshot) => {
  if (!tray) return;
  const remaining = remainingPercent(snapshot);
  tray.setImage(createTrayIcon(remaining));
  if (snapshot?.hasData) {
    const stale = snapshot.status === 'stale' ? ' · 暂未更新' : '';
    tray.setToolTip(`Codex 剩余 ${remaining}% · ${snapshot.total.reset.label}${stale}`);
  } else {
    tray.setToolTip(`Codex 剩余 -- · ${snapshot?.warning || '正在获取官方用量'}`);
  }
  buildTrayMenu();
};

const commitSnapshot = (snapshot) => {
  displayRevision += 1;
  latestSnapshot = { ...snapshot, displayRevision };
  updateTray(latestSnapshot);
  sendSnapshot();
  return latestSnapshot;
};

const persistBounds = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  saveSettings({ bounds: mainWindow.getBounds(), alwaysOnTop: mainWindow.isAlwaysOnTop() });
};

const createWindow = () => {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  const bounds = settings.bounds || {};
  mainWindow = new BrowserWindow({
    width: bounds.width || 410,
    height: bounds.height || 585,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: Boolean(settings.alwaysOnTop),
    skipTaskbar: true,
    show: false,
    icon: path.join(app.getAppPath(), 'assets', 'app-icon-borderless.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
    sendSnapshot();
    sendWindowState();
  });
  mainWindow.webContents.on('did-finish-load', () => {
    sendSnapshot();
    sendWindowState();
  });
  mainWindow.on('moved', persistBounds);
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
};

const destroyWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  persistBounds();
  mainWindow.destroy();
  mainWindow = null;
};

const showWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else {
    mainWindow.show();
    mainWindow.focus();
    sendSnapshot();
    sendWindowState();
  }
  refreshAll();
};

const toggleWindow = () => {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) destroyWindow();
  else showWindow();
};

const projectRefresh = createUsageRefreshController({
  readSnapshot: () => readProjectSnapshot({
    quotaWindow: quotaWindowFromSnapshot(latestSnapshot)
  }),
  onSnapshot: (projectSnapshot) => {
    latestProjects = projectSnapshot;
    commitSnapshot(mergeProjectSnapshot(latestSnapshot, latestProjects));
  }
});

const refreshProjects = () => projectRefresh.refresh();

let quotaRetry = null;
const quotaRefresh = createUsageRefreshController({
  readSnapshot: async ({ previous }) => {
    try {
      const official = await codexRateLimits.readStandardRateLimit();
      return createOfficialSnapshot(official, latestProjects);
    } catch (error) {
      return createOfficialFailureSnapshot(error, previous, latestProjects);
    }
  },
  onSnapshot: (snapshot) => {
    commitSnapshot(snapshot);
    if (snapshot.status === 'current') {
      quotaRetry?.markSuccess();
      refreshProjects();
    } else {
      quotaRetry?.scheduleAfterFailure();
    }
  }
});

const refreshQuota = (options = {}) => quotaRefresh.refresh(options);

quotaRetry = createQuotaRetryScheduler({
  retry: () => refreshQuota({ force: true }),
  delaysMs: [5000, 15000]
});

async function refreshAll() {
  quotaRetry.restartCycle();
  await refreshQuota({ force: true });
  await refreshProjects();
  return latestSnapshot;
}

const stopSessionWatcher = () => {
  watchRefreshScheduler?.stop();
  watchRefreshScheduler = null;
  const watcher = sessionWatcher;
  sessionWatcher = null;
  try { watcher?.close(); } catch { /* Cleanup remains idempotent. */ }
};

const startSessionWatcher = () => {
  if (sessionWatcher) return;
  const sessionsDir = getDefaultSessionsDir();
  if (!fs.existsSync(sessionsDir)) return;
  try {
    watchRefreshScheduler = createWatchRefreshScheduler({
      refresh: refreshProjects,
      debounceMs: WATCH_DEBOUNCE_MS,
      maxWaitMs: WATCH_MAX_WAIT_MS
    });
    sessionWatcher = fs.watch(sessionsDir, { recursive: true }, (_eventType, filename) => {
      if (filename && !String(filename).toLowerCase().endsWith('.jsonl')) return;
      watchRefreshScheduler?.schedule();
    });
    sessionWatcher.on('error', stopSessionWatcher);
  } catch {
    stopSessionWatcher();
  }
};

function quitApp() {
  app.isQuitting = true;
  if (refreshTimer) clearInterval(refreshTimer);
  quotaRetry.stop();
  stopSessionWatcher();
  codexRateLimits.close();
  destroyWindow();
  tray?.destroy();
  tray = null;
  app.quit();
}

ipcMain.handle('usage:get', () => latestSnapshot);
ipcMain.handle('usage:refresh', refreshAll);
ipcMain.handle('window:get-state', () => ({ alwaysOnTop: mainWindow?.isAlwaysOnTop() || false }));
ipcMain.on('window:hide', destroyWindow);
ipcMain.on('window:quit', quitApp);
ipcMain.on('window:toggle-top', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const next = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(next);
  saveSettings({ alwaysOnTop: next });
  sendWindowState();
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(() => {
    settings = readSettings();
    tray = new Tray(createTrayIcon(null));
    tray.on('click', toggleWindow);
    buildTrayMenu();
    createWindow();
    commitSnapshot(latestSnapshot);
    startSessionWatcher();
    refreshProjects();
    quotaRetry.restartCycle();
    refreshQuota({ force: true });

    refreshTimer = setInterval(() => {
      if (!sessionWatcher) startSessionWatcher();
      quotaRetry.restartCycle();
      refreshQuota();
    }, REFRESH_MS);
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    if (refreshTimer) clearInterval(refreshTimer);
    quotaRetry.stop();
    stopSessionWatcher();
    codexRateLimits.close();
  });

  app.on('window-all-closed', () => {
    // The tray process intentionally stays alive after the window is destroyed.
  });
}
