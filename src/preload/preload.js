// preload.js — pont IPC minimal entre le renderer et le process principal.

const { contextBridge, ipcRenderer } = require('electron');
const i18n = require('../shared/i18n');

// Langue résolue DÈS le chargement du preload : api.t() traduit dans la
// bonne langue au premier rendu du renderer (qui n'est pas bundlé et ne
// peut pas require() le dictionnaire lui-même).
i18n.setLang(i18n.resolveLang(ipcRenderer.sendSync('get-language-sync'), navigator.language));

contextBridge.exposeInMainWorld('unichat', {
  // i18n : le dictionnaire vit dans src/shared (même code que le mobile),
  // la traduction est appelée ici, dans le contexte du preload.
  t: (key, vars) => i18n.t(key, vars),
  i18nLangs: i18n.LANGS,
  i18nLocale: () => i18n.locale(),
  getLanguage: () => ipcRenderer.invoke('get-language'),
  setLanguage: (language) => ipcRenderer.invoke('set-language', language),
  getBlockTrackers: () => ipcRenderer.invoke('get-block-trackers'),
  setBlockTrackers: (on) => ipcRenderer.invoke('set-block-trackers', on),
  getHistoryRetention: () => ipcRenderer.invoke('get-history-retention'),
  setHistoryRetention: (days) => ipcRenderer.invoke('set-history-retention', days),
  getHibernateMinutes: () => ipcRenderer.invoke('get-hibernate-minutes'),
  setHibernateMinutes: (minutes) => ipcRenderer.invoke('set-hibernate-minutes', minutes),
  getWorkspaces: () => ipcRenderer.invoke('get-workspaces'),
  workspacesActivate: (id) => ipcRenderer.invoke('workspaces-activate', id),
  workspacesCreate: (name) => ipcRenderer.invoke('workspaces-create', name),
  workspacesDelete: (id) => ipcRenderer.invoke('workspaces-delete', id),
  workspacesToggleService: (wsId, serviceId, member) =>
    ipcRenderer.invoke('workspaces-toggle-service', wsId, serviceId, member),
  exportProfile: () => ipcRenderer.invoke('export-profile'),
  importProfile: () => ipcRenderer.invoke('import-profile'),
  getServices: () => ipcRenderer.invoke('get-services'),
  getHistory: () => ipcRenderer.invoke('get-history'),
  removeHistoryEntry: (serviceId, url) => ipcRenderer.invoke('history-remove', serviceId, url),
  renameHistoryEntry: (serviceId, url, title) => ipcRenderer.invoke('history-rename', serviceId, url, title),
  setPinnedHistoryEntry: (serviceId, url, pinned) => ipcRenderer.invoke('history-set-pinned', serviceId, url, pinned),
  analyzeUrl: (url) => ipcRenderer.invoke('analyze-url', url),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  getSidebarCollapsed: () => ipcRenderer.invoke('get-sidebar-collapsed'),
  setSidebarCollapsed: (collapsed) => ipcRenderer.invoke('set-sidebar-collapsed', collapsed),
  getCatalog: () => ipcRenderer.invoke('get-catalog'),
  setServiceEnabled: (url, enabled) => ipcRenderer.invoke('set-service-enabled', url, enabled),
  addService: (data) => ipcRenderer.invoke('add-service', data),
  updateService: (id, patch) => ipcRenderer.invoke('update-service', id, patch),
  importLogo: () => ipcRenderer.invoke('import-logo'),
  relayCopy: (text) => ipcRenderer.invoke('relay-copy', text),
  relayPaste: (serviceId) => ipcRenderer.invoke('relay-paste', serviceId),
  relaySend: (serviceId) => ipcRenderer.invoke('relay-send', serviceId),
  armBattleAdvance: (serviceId) => ipcRenderer.invoke('arm-battle-advance', serviceId),
  setSplit: (serviceId) => ipcRenderer.invoke('set-split', serviceId),
  removeService: (id, keepSession) => ipcRenderer.invoke('remove-service', id, keepSession),
  showService: (id) => ipcRenderer.invoke('show-service', id),
  reorderServices: (ids) => ipcRenderer.invoke('reorder-services', ids),
  setModalOpen: (open) => ipcRenderer.invoke('set-modal-open', open),
  navigate: (serviceId, url) => ipcRenderer.invoke('navigate', serviceId, url),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  exportRegistry: () => ipcRenderer.invoke('export-registry'),
  importRegistry: () => ipcRenderer.invoke('import-registry'),

  onServicesUpdated: (cb) => {
    const listener = (_e, services) => cb(services);
    ipcRenderer.on('services-updated', listener);
    return () => ipcRenderer.removeListener('services-updated', listener);
  },
  onHistoryUpdated: (cb) => {
    const listener = (_e, entries) => cb(entries);
    ipcRenderer.on('history-updated', listener);
    return () => ipcRenderer.removeListener('history-updated', listener);
  },
  onActiveServiceChanged: (cb) => {
    const listener = (_e, id) => cb(id);
    ipcRenderer.on('active-service-changed', listener);
    return () => ipcRenderer.removeListener('active-service-changed', listener);
  },
  onActiveUrlChanged: (cb) => {
    const listener = (_e, url) => cb(url);
    ipcRenderer.on('active-url-changed', listener);
    return () => ipcRenderer.removeListener('active-url-changed', listener);
  },
  onBattleAdvance: (cb) => {
    const listener = (_e, serviceId) => cb(serviceId);
    ipcRenderer.on('battle-advance', listener);
    return () => ipcRenderer.removeListener('battle-advance', listener);
  },
});
