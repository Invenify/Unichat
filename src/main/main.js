// main.js — fenêtre UniChat : sidebar (renderer) + un WebContentsView par
// service, sessions persistantes, empilées, une seule visible.

const { app, BrowserWindow, WebContentsView, session, ipcMain, shell, dialog, clipboard, protocol, Tray, Menu, nativeImage, Notification, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');

const registry = require('./registry');
const metadata = require('./metadata');
const catalog = require('../shared/catalog');
const logos = require('./logos');
const settings = require('./settings');
const convStore = require('../engine/conv-store');
const titleTracker = require('../engine/title-tracker');

// Sidebar : largeur normale, ou rail d'icônes quand elle est réduite
// (bouton « ⟨ ⟩ » ou Ctrl/Cmd+B, état persisté dans settings.json).
const SIDEBAR_WIDE = 310;
const SIDEBAR_RAIL = 64;
function sidebarWidth() {
  return settings.get().sidebarCollapsed === true ? SIDEBAR_RAIL : SIDEBAR_WIDE;
}
let mainWindow = null;
const views = new Map(); // serviceId -> WebContentsView
let activeServiceId = null;
let splitServiceId = null; // 2e moitié de l'écran partagé (serviceId)
let modalOpen = false; // modal renderer ouverte → vues masquées (elles couvrent la fenêtre)

// Systray : fermer la fenêtre la cache (l'app tourne en arrière-plan),
// le tray la restaure. isQuitting distingue « vraie » fermeture et cachage.
let tray = null;
let isQuitting = false;
let trayHintShown = false;

// Instance unique : un second lancement restaure la fenêtre (cachée dans
// le tray) au lieu de repartir de zéro.
const gotInstanceLock = app.requestSingleInstanceLock();

// Schéma interne qui sert les logos importés (userData/logos) au renderer.
protocol.registerSchemesAsPrivileged([
  { scheme: 'unichat-logo', privileges: { secure: true } },
]);

function layoutViews() {
  if (!mainWindow) return;
  const [w, h] = mainWindow.getContentSize();
  const x0 = sidebarWidth();
  const avail = Math.max(0, w - x0);
  // Écran partagé : le service secondaire occupe la moitié droite, le
  // service actif la moitié gauche. Sans secondaire : pleine largeur.
  const splitOn =
    splitServiceId !== null && views.has(splitServiceId) && splitServiceId !== activeServiceId;
  const half = Math.floor(avail / 2);
  for (const [id, view] of views) {
    if (splitOn && id === splitServiceId) {
      view.setBounds({ x: x0 + half, y: 0, width: avail - half, height: h });
      view.setVisible(!modalOpen);
    } else {
      view.setBounds({ x: x0, y: 0, width: splitOn ? half : avail, height: h });
      view.setVisible(!modalOpen && id === activeServiceId);
    }
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

  view.webContents.on('did-navigate', (_e, url) => {
    notifyBattleAdvance(service.id);
    if (service.id === activeServiceId) pushActiveUrl();
  });
  view.webContents.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame !== false) notifyBattleAdvance(service.id);
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
  // Le service secondaire devient principal (clic sur son en-tête) :
  // il repasse en pleine largeur, l'écran partagé se referme.
  if (splitServiceId === serviceId) splitServiceId = null;
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
  if (splitServiceId === serviceId) splitServiceId = null;
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
  mainWindow.on('close', (e) => {
    // Tray disponible : la fermeture cache la fenêtre, l'app continue en
    // arrière-plan (sessions et historique vivants). Le tray restaure.
    if (!isQuitting && tray) {
      e.preventDefault();
      mainWindow.hide();
      showTrayHint();
    }
  });
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
ipcMain.handle('history-remove', (_e, serviceId, url) => {
  convStore.remove(serviceId, url);
  pushHistory();
  return true;
});
ipcMain.handle('history-rename', (_e, serviceId, url, title) => {
  const entry = convStore.rename(serviceId, url, title);
  pushHistory();
  return entry || null;
});
ipcMain.handle('history-set-pinned', (_e, serviceId, url, pinned) => {
  const entry = convStore.setPinned(serviceId, url, pinned);
  pushHistory();
  return entry || null;
});
ipcMain.handle('analyze-url', (_e, url) => metadata.analyzeUrl(url));

// Thème : 'system' suit l'OS, 'light'/'dark' force via nativeTheme.themeSource.
ipcMain.handle('get-theme', () => settings.get().theme);
ipcMain.handle('set-theme', (_e, theme) => {
  const result = settings.setTheme(theme);
  if (result) nativeTheme.themeSource = result.theme;
  return result ? result.theme : null;
});

// Langue de l'interface : le réglage ('system' ou code) vit dans settings.
// Le PRELOAD la lit de façon synchrone à son chargement (sendSync) pour
// initialiser api.t() — le renderer se recharge après un changement, le
// preload repart alors dans la nouvelle langue.
ipcMain.on('get-language-sync', (e) => {
  e.returnValue = settings.get().language;
});
ipcMain.handle('get-language', () => settings.get().language);
ipcMain.handle('set-language', (_e, language) => {
  const result = settings.setLanguage(language);
  return result ? result.language : null;
});

// Sidebar réduite (rail d'icônes) : l'état vit ici, layoutViews() en a
// besoin pour placer les WebContentsView.
ipcMain.handle('get-sidebar-collapsed', () => settings.get().sidebarCollapsed === true);
ipcMain.handle('set-sidebar-collapsed', (_e, collapsed) => {
  settings.setSidebarCollapsed(collapsed);
  layoutViews();
  return true;
});

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

// Ordre des services (glisser-déposer de la sidebar) : le nouvel ordre des
// services actifs passe en tête, les absents restent en fin. L'ordre pilote
// aussi les raccourcis Ctrl/Cmd+1…9.
ipcMain.handle('reorder-services', (_e, orderedIds) => {
  const list = registry.reorder(orderedIds);
  pushServices();
  return list;
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

// Logo personnalisé : copie du fichier choisi vers userData/logos/ et
// référence « unichat-logo://f/<nom> » servie par le protocole interne.
ipcMain.handle('import-logo', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, canceled: true };
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Importer un logo',
    filters: [{ name: 'Images', extensions: logos.EXTENSIONS.map((e) => e.slice(1)) }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths || filePaths.length === 0) return { ok: false, canceled: true };
  try {
    const dir = path.join(app.getPath('userData'), 'logos');
    const name = logos.importFile(filePaths[0], dir);
    if (!name) return { ok: false, error: 'Format non pris en charge (png, jpg, gif, svg, ico, webp).' };
    return { ok: true, logo: 'unichat-logo://f/' + name };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

// Relais universel : le prompt saisi dans la barre UniChat part dans le
// presse-papiers ; la vue du service choisi est affichée, l'utilisateur
// colle (Ctrl+V) et envoie. Aucune lecture du contenu des conversations.
ipcMain.handle('relay-copy', (_e, text) => {
  clipboard.writeText(String(text || ''));
  return true;
});

// Auto-collage du relais/battle : colle le presse-papiers dans le champ de
// saisie du site affiché. Sans champ focalisé, c'est un no-op silencieux —
// le collage manuel reste possible. Aucune lecture du contenu des pages.
ipcMain.handle('relay-paste', (_e, serviceId) => {
  const view = views.get(serviceId);
  if (!view || serviceId !== activeServiceId) return false;
  try {
    view.webContents.focus();
    view.webContents.paste();
    return true;
  } catch {
    return false;
  }
});

// Auto-envoi du relais/battle : simule Entrée dans la vue du service —
// dans la quasi-totalité des chats IA, Entrée envoie le message. Heuristique
// sans sélecteur : certains sites exigent un clic sur un bouton (rare).
ipcMain.handle('relay-send', (_e, serviceId) => {
  const view = views.get(serviceId);
  if (!view || serviceId !== activeServiceId) return false;
  try {
    view.webContents.focus();
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    return true;
  } catch {
    return false;
  }
});

// Détection d'envoi (battle automatique) : armé sur un service, le premier
// changement d'URL de sa vue (l'IA crée la conversation = prompt envoyé)
// notifie le renderer pour passer à l'IA suivante. Désarmé après usage ou
// en cas de changement d'arme.
let armedServiceId = null;
ipcMain.handle('arm-battle-advance', (_e, serviceId) => {
  armedServiceId = serviceId || null;
  return armedServiceId !== null;
});

function notifyBattleAdvance(serviceId) {
  if (armedServiceId !== serviceId) return;
  armedServiceId = null;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('battle-advance', serviceId);
  }
}

// Écran partagé : serviceId = moitié droite, null = pleine largeur.
ipcMain.handle('set-split', (_e, serviceId) => {
  splitServiceId =
    serviceId && views.has(serviceId) && serviceId !== activeServiceId ? serviceId : null;
  layoutViews();
  return splitServiceId;
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

// --- Systray : fermeture en arrière-plan ---

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

// Petite notification (une fois par session) pour expliquer le cachage.
function showTrayHint() {
  if (trayHintShown || !Notification.isSupported()) return;
  trayHintShown = true;
  try {
    new Notification({
      title: 'UniChat continue en arrière-plan',
      body: "L'icône UniChat reste dans la zone de notifications : cliquez pour rouvrir, clic droit pour quitter.",
    }).show();
  } catch {
    // environnement sans service de notifications : silencieux
  }
}

// Créé après la fenêtre. Si l'environnement n'a pas de zone de notifications,
// l'échec est silencieux et la fermeture de la fenêtre quitte l'app normalement.
function createTray() {
  try {
    const icon = nativeImage.createFromPath(
      path.join(__dirname, '..', 'renderer', 'assets', 'logo.png')
    );
    if (icon.isEmpty()) return;
    tray = new Tray(icon.resize({ width: 22, height: 22 }));
    tray.setToolTip('UniChat');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Afficher UniChat', click: showMainWindow },
        { type: 'separator' },
        { label: 'Quitter', click: () => app.quit() },
      ])
    );
    tray.on('click', showMainWindow);
  } catch {
    tray = null;
  }
}

if (!gotInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());

  app.whenReady().then(() => {
  const userData = app.getPath('userData');
  registry.init(userData);
  convStore.init(userData);

  // Thème : nativeTheme.themeSource pilote prefers-color-scheme pour toute
  // l'app (sidebar ET vues des services) : 'system' suit l'OS, 'light'/'dark'
  // force. Appliqué avant createWindow pour éviter tout flash au démarrage.
  settings.init(userData);
  nativeTheme.themeSource = settings.get().theme;
  // i18n : le PRELOAD résout la langue à son chargement (get-language-sync,
  // ci-dessous) — le main n'a jamais de texte à traduire.

  // Les logos importés vivent dans userData/logos ; le renderer ne peut pas
  // y accéder en file:// direct, on les sert via le schéma interne.
  protocol.handle('unichat-logo', (request) => {
    try {
      const name = path.basename(decodeURIComponent(new URL(request.url).pathname));
      const data = fs.readFileSync(path.join(userData, 'logos', name));
      return new Response(data, { headers: { 'content-type': logos.mimeFor(name) } });
    } catch {
      return new Response('', { status: 404 });
    }
  });

  // Services enregistrés avant l'existence du catalogue : on leur donne
  // le logo et les exclusions de leur entrée catalogue (par origine).
  for (const svc of registry.list()) {
    const entry = catalog.list().find((c) => catalog.sameOrigin(c.url, svc.url));
    if (!entry) continue;
    const patch = {};
    if (!svc.logo && entry.logo) patch.logo = entry.logo;
    if (!svc.excludeRegex && entry.excludeRegex) patch.excludeRegex = entry.excludeRegex;
    if (!svc.stripTitleRegex && entry.stripTitleRegex) patch.stripTitleRegex = entry.stripTitleRegex;
    if (svc.rootChat !== true && entry.rootChat) patch.rootChat = true;
    if (!svc.genericTitleRegex && entry.genericTitleRegex) patch.genericTitleRegex = entry.genericTitleRegex;
    // Contre-patch : des champs (rootChat, regex) posés par une version
    // précédente alors que le catalogue ne les porte plus doivent disparaître.
    if (svc.rootChat === true && !entry.rootChat) patch.rootChat = false;
    if (svc.genericTitleRegex && !entry.genericTitleRegex) patch.genericTitleRegex = null;
    if (svc.stripTitleRegex && !entry.stripTitleRegex) patch.stripTitleRegex = null;
    if (Object.keys(patch).length > 0) registry.update(svc.id, patch);
  }

  // Nettoyage au boot des historiques pré-fixes — idempotent :
  // - stripTitleRegex : retire le suffixe de marque des titres (ex. « /
  //   Open WebUI »), sans toucher aux titres renommés manuellement ;
  // - excludeRegex : purge les entrées qui matchent (ex. page liste
  //   Gemini /app enregistrée avant l'exclusion).
  for (const svc of registry.list()) {
    if (svc.stripTitleRegex) convStore.stripTitle(svc.id, svc.stripTitleRegex);
    if (svc.excludeRegex) convStore.purgeMatching(svc.id, svc.excludeRegex);
    // Titres de marque enregistrés avant le filtre (ex. « Copilot » à la
    // racine) : ils n'ont jamais été des conversations.
    if (svc.genericTitleRegex) convStore.purgeMatchingTitle(svc.id, svc.genericTitleRegex);
    // Entrées racine d'un service sans rootChat (ancienne version) : mortes.
    if (svc.rootChat !== true) convStore.purgeRoot(svc.id, svc.url);
  }

  createWindow();
  createTray();
  });
}

app.on('before-quit', () => {
  isQuitting = true; // la fermeture de la fenêtre ne doit plus la cacher
});

app.on('activate', () => {
  // macOS (dock) : retour de l'arrière-plan → réafficher.
  if (mainWindow) showMainWindow();
});

app.on('window-all-closed', () => {
  // N'arrive que si la fenêtre est réellement détruite (quitter via le tray
  // ou environnement sans tray) — jamais lors du simple cachage.
  app.quit();
});
