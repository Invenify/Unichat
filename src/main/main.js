// main.js — fenêtre UniChat : sidebar (renderer) + un WebContentsView par
// service, sessions persistantes, empilées, une seule visible.

const { app, BrowserWindow, WebContentsView, session, ipcMain, shell } = require('electron');
const path = require('path');

const registry = require('./registry');
const metadata = require('./metadata');
const convStore = require('../engine/conv-store');
const titleTracker = require('../engine/title-tracker');

const SIDEBAR_WIDTH = 310;
let mainWindow = null;
const views = new Map(); // serviceId -> WebContentsView
let activeServiceId = null;

function layoutViews() {
  if (!mainWindow) return;
  const [w, h] = mainWindow.getContentSize();
  const bounds = { x: SIDEBAR_WIDTH, y: 0, width: Math.max(0, w - SIDEBAR_WIDTH), height: h };
  for (const [id, view] of views) {
    view.setBounds(bounds);
    view.setVisible(id === activeServiceId);
  }
}

function pushServices() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('services-updated', registry.list());
  }
}

function pushHistory() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('history-updated', convStore.listAll());
  }
}

function createServiceView(service) {
  if (views.has(service.id)) return views.get(service.id);
  const ses = session.fromPartition(`persist:${service.id}`);
  const view = new WebContentsView({
    webPreferences: {
      session: ses,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  views.set(service.id, view);
  mainWindow.contentView.addChildView(view);

  titleTracker.attach(view.webContents, service, () => pushHistory());
  view.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (view.webContents.getURL() === '') {
    view.webContents.loadURL(service.url).catch(() => {});
  }
  layoutViews();
  return view;
}

function showService(serviceId) {
  if (!views.has(serviceId)) return;
  activeServiceId = serviceId;
  layoutViews();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('active-service-changed', serviceId);
  }
}

function removeServiceView(serviceId, keepSession) {
  const view = views.get(serviceId);
  if (view) {
    mainWindow.contentView.removeChildView(view);
    view.webContents.close();
    views.delete(serviceId);
  }
  if (!keepSession) {
    session
      .fromPartition(`persist:${serviceId}`)
      .clearStorageData()
      .catch(() => {});
  }
  if (activeServiceId === serviceId) {
    const next = registry.list()[0];
    if (next) showService(next.id);
    else {
      activeServiceId = null;
      layoutViews();
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: 'UniChat',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // nécessaire pour require('electron') dans le preload
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('resize', layoutViews);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Un WebContentsView par service du registre, superposées.
  for (const service of registry.list()) {
    createServiceView(service);
  }
  const first = registry.list()[0];
  if (first) showService(first.id);
}

// --- IPC : pont avec le renderer ---

ipcMain.handle('get-services', () => registry.list());
ipcMain.handle('get-history', () => convStore.listAll());
ipcMain.handle('analyze-url', (_e, url) => metadata.analyzeUrl(url));

ipcMain.handle('add-service', (_e, data) => {
  const svc = registry.add(data);
  createServiceView(svc);
  showService(svc.id);
  pushServices();
  return svc;
});

ipcMain.handle('update-service', (_e, id, patch) => {
  const svc = registry.update(id, patch);
  pushServices();
  return svc;
});

ipcMain.handle('remove-service', (_e, id, keepSession) => {
  const svc = registry.remove(id);
  if (svc) {
    removeServiceView(id, keepSession);
    convStore.removeService(id);
    pushServices();
    pushHistory();
  }
  return !!svc;
});

ipcMain.handle('show-service', (_e, serviceId) => {
  showService(serviceId);
});

ipcMain.handle('navigate', (_e, serviceId, url) => {
  const view = views.get(serviceId);
  if (!view) return false;
  showService(serviceId);
  view.webContents.loadURL(url).catch(() => {});
  return true;
});

ipcMain.handle('open-external', (_e, url) => {
  if (/^https?:/i.test(url)) shell.openExternal(url);
});

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  registry.init(userData);
  convStore.init(userData);
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
