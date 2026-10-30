// title-tracker.js — moteur de titres universel (couche Electron).
// Écoute did-navigate / page-title-updated sur chaque WebContentsView et
// enregistre {serviceId, url, title, timestamp} dans le store local.
// Les règles de filtrage (isChatUrl, cleanTitle) sont partagées avec
// Android dans src/shared/title-rules.js.

const convStore = require('./conv-store');
const { isChatUrl, cleanTitle, isRecordableTitle, resolveTitle } = require('../shared/title-rules');

// À chaque navigation et à chaque changement de titre de la page.
// Les SPA changent d'URL via l'API History sans rechargement :
// did-navigate-in-page couvre ces cas que did-navigate ne voit jamais.
function attach(webContents, service, onChange) {
  const record = (url, title) => {
    if (!url || !title) return;
    if (!isChatUrl(service, url)) return;
    const final = resolveTitle(service, url, title);
    if (!final) return;
    const entry = convStore.upsert(service.id, url, final);
    if (entry && onChange) onChange(entry);
  };

  webContents.on('did-navigate', (_e, url) => {
    record(url, webContents.getTitle() || null);
  });

  webContents.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (isMainFrame === false) return;
    record(url, webContents.getTitle() || null);
  });

  webContents.on('page-title-updated', (_e, title) => {
    record(webContents.getURL(), title);
  });

  // Premier enregistrement pour un service déjà ouvert sur un chat.
  record(webContents.getURL(), webContents.getTitle());
}

module.exports = { attach, isChatUrl, cleanTitle, isRecordableTitle };
