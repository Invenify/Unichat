// main.js — fenêtre UniChat : sidebar (renderer) + un WebContentsView par
// service, sessions persistantes, empilées, une seule visible.

const { app, BrowserWindow, WebContentsView, session, ipcMain, shell, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const registry = require('./registry');
const metadata = require('./metadata');
const catalog = require('./catalog');
const convStore = require('../engine/conv-store');
const titleTracker = require('../engine/title-tracker');

const SIDEBAR_WIDTH = 310;
let mainWindow = null;
const views = new Map(); // serviceId -> WebContentsView
let activeServiceId = null;
let modalOpen = false; // modal renderer ouverte → vues masquées (elles couvrent la fenêtre)

function layoutViews() {
  if (!mainWindow) return;
  const [w, h] = mainWindow.getContentSize();
  const bounds = { x: SIDEBAR_WIDTH, y: 0, width: Math.max(0, w - SIDEBAR_WIDTH), height: h };
  for (const [id, view] of views) {
    view.setBounds(bounds);
    view.setVisible(!modalOpen && id === activeServiceId);
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

// URL courante de la vue active → barre d'adresse de la sidebar.
function pushActiveUrl() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const view = activeServiceId ? views.get(activeServiceId) : null;
  const url = view ? view.webContents.getURL() : '';
  mainWindow.webContents.send('active-url-changed', url);
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

  // Regex optionnelle : bloque les navigations vers des domaines indésirables.
  // Cas d'usage : un service (ex. Euria) qui redirige vers son shell parent
  // (ex. KSuite) alors qu'il fonctionne très bien en standalone.
  if (service.blockNavRegex) {
    let re = null;
    try {
      re = new RegExp(service.blockNavRegex);
    } catch {
      // regex invalide : pas de blocage
    }
    if (re) {
      const block = (event, url) => {
        if (re.test(url)) event.preventDefault();
      };
      // location.href / liens → will-navigate ; redirections serveur → will-redirect.
      // loadURL() (nos navigations) ne passe pas par will-navigate.
      view.webContents.on('will-navigate', block);
      view.webContents.on('will-redirect', block);
    }
  }

  view.webContents.on('did-navigate', () => {
    if (service.id === activeServiceId) pushActiveUrl();
  });
  view.webContents.on('did-navigate-in-page', () => {
    if (service.id === activeServiceId) pushActiveUrl();
  });
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
  pushActiveUrl();
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
    const next = registry.list().find((s) => s.enabled !== false);
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

  // Un WebContentsView par service ACTIVÉ du registre, superposées.
  const enabledServices = registry.list().filter((s) => s.enabled !== false);
  for (const service of enabledServices) {
    createServiceView(service);
  }
  const first = enabledServices[0];
  if (first) showService(first.id);
}

// --- IPC : pont avec le renderer ---

ipcMain.handle('get-services', () => registry.list());
ipcMain.handle('get-history', () => convStore.listAll());
ipcMain.handle('analyze-url', (_e, url) => metadata.analyzeUrl(url));

ipcMain.handle('get-catalog', () => catalog.list());

// Activer / désactiver un service du catalogue (ou déjà enregistré).
// Désactiver conserve la session ET l'historique : seule la vue disparaît.
// Correspondance par origine : un service avec paramètres d'URL (ex. Euria
// ?ksuite-mode=main) reste la même entrée que celle du catalogue.
ipcMain.handle('set-service-enabled', (_e, url, enabled) => {
  let svc = registry.list().find((s) => catalog.sameOrigin(s.url, url)) || null;
  if (svc) {
    registry.update(svc.id, { enabled });
  } else if (enabled) {
    const entry = catalog.find(url);
    if (!entry) return { ok: false, error: 'Service inconnu du catalogue.' };
    svc = registry.add({ ...entry, enabled: true });
  }
  if (!svc) return { ok: false };
  if (enabled) {
    if (!views.has(svc.id)) createServiceView(svc);
    showService(svc.id);
  } else {
    removeServiceView(svc.id, true); // session conservée
  }
  pushServices();
  return { ok: true, service: svc };
});

ipcMain.handle('add-service', (_e, data) => {
  const svc = registry.add(data);
  createServiceView(svc);
  showService(svc.id);
  pushServices();
  return svc;
});

ipcMain.handle('update-service', (_e, id, patch) => {
  const svc = registry.update(id, patch);
  // URL ou regex de blocage modifiée : la vue est recréée pour rebrancher le
  // title-tracker et le blocage. La session (partition) est conservée.
  if (svc && views.has(id) && (patch.url !== undefined || patch.blockNavRegex !== undefined)) {
    const wasActive = activeServiceId === id;
    removeServiceView(id, true);
    createServiceView(svc);
    if (wasActive) showService(id);
  }
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

// Les WebContentsView recouvrent la fenêtre : quand le renderer ouvre une
// modal (wizard, catalogue, suppression), on les masque pour la laisser voir.
ipcMain.handle('set-modal-open', (_e, open) => {
  modalOpen = !!open;
  layoutViews();
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

// Export du registre : dialogue natif « Enregistrer sous », JSON brut.
ipcMain.handle('export-registry', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, canceled: true };
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Exporter le registre UniChat',
    defaultPath: 'unichat-services.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(registry.list(), null, 2));
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
  return { ok: true, filePath };
});

// Import : fusion par URL (jamais d'écrasement), puis création des vues manquantes.
ipcMain.handle('import-registry', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, canceled: true };
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Importer un registre UniChat',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths || filePaths.length === 0) return { ok: false, canceled: true };
  let list;
  try {
    list = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
  } catch (e) {
    return { ok: false, error: 'Fichier illisible : ' + (e.message || e) };
  }
  const added = registry.importAll(list);
  for (const svc of registry.list()) {
    if (!views.has(svc.id)) createServiceView(svc);
  }
  pushServices();
  return { ok: true, added };
});

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  registry.init(userData);
  convStore.init(userData);

  // Services enregistrés avant l'existence du catalogue : on leur donne
  // le logo et les exclusions de leur entrée catalogue (par origine).
  for (const svc of registry.list()) {
    const entry = catalog.list().find((c) => catalog.sameOrigin(c.url, svc.url));
    if (!entry) continue;
    const patch = {};
    if (!svc.logo && entry.logo) patch.logo = entry.logo;
    if (!svc.excludeRegex && entry.excludeRegex) patch.excludeRegex = entry.excludeRegex;
    if (Object.keys(patch).length > 0) registry.update(svc.id, patch);
  }

  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
