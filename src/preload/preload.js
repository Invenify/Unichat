// preload.js — pont IPC minimal entre le renderer et le process principal.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('unichat', {
  getServices: () => ipcRenderer.invoke('get-services'),
  getHistory: () => ipcRenderer.invoke('get-history'),
  removeHistoryEntry: (serviceId, url) => ipcRenderer.invoke('history-remove', serviceId, url),
  renameHistoryEntry: (serviceId, url, title) => ipcRenderer.invoke('history-rename', serviceId, url, title),
  setPinnedHistoryEntry: (serviceId, url, pinned) => ipcRenderer.invoke('history-set-pinned', serviceId, url, pinned),
  analyzeUrl: (url) => ipcRenderer.invoke('analyze-url', url),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (theme) => ipcRenderer.invoke('set-theme', theme),
  getCatalog: () => ipcRenderer.invoke('get-catalog'),
  setServiceEnabled: (url, enabled) => ipcRenderer.invoke('set-service-enabled', url, enabled),
  addService: (data) => ipcRenderer.invoke('add-service', data),
  updateService: (id, patch) => ipcRenderer.invoke('update-service', id, patch),
  importLogo: () => ipcRenderer.invoke('import-logo'),
  relayCopy: (text) => ipcRenderer.invoke('relay-copy', text),
  removeService: (id, keepSession) => ipcRenderer.invoke('remove-service', id, keepSession),
  showService: (id) => ipcRenderer.invoke('show-service', id),
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
});
