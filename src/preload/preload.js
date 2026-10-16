// preload.js — pont IPC minimal entre le renderer et le process principal.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('unichat', {
  getServices: () => ipcRenderer.invoke('get-services'),
  getHistory: () => ipcRenderer.invoke('get-history'),
  analyzeUrl: (url) => ipcRenderer.invoke('analyze-url', url),
  addService: (data) => ipcRenderer.invoke('add-service', data),
  updateService: (id, patch) => ipcRenderer.invoke('update-service', id, patch),
  removeService: (id, keepSession) => ipcRenderer.invoke('remove-service', id, keepSession),
  showService: (id) => ipcRenderer.invoke('show-service', id),
  navigate: (serviceId, url) => ipcRenderer.invoke('navigate', serviceId, url),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

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
});
