// title-tracker.js — moteur de titres universel.
// Écoute did-navigate / page-title-updated sur chaque WebContentsView et
// enregistre {serviceId, url, title, timestamp} dans le store local.
// document.title est la seule chose que tous les chats IA ont en commun :
// zéro sélecteur CSS à maintenir.

const convStore = require('./conv-store');

function isRoot(serviceUrl, url) {
  try {
    const a = new URL(serviceUrl);
    const b = new URL(url);
    return (
      a.hostname === b.hostname &&
      (b.pathname === '/' || b.pathname === a.pathname) &&
      b.search === ''
    );
  } catch {
    return false;
  }
}

function excluded(service, url) {
  if (service.excludeRegex) {
    try {
      if (new RegExp(service.excludeRegex).test(url)) return true;
    } catch {
      // regex invalide : on ignore le filtre
    }
  }
  return false;
}

// Pages de connexion/inscription : jamais des chats, quel que soit le service.
function isAuthUrl(url) {
  return /\/(login|signin|signup|register|auth|connexion)(\/|$|\?|#)/i.test(url);
}

function isChatUrl(service, url) {
  if (!/^https?:/i.test(url)) return false;
  if (isAuthUrl(url)) return false;
  if (excluded(service, url)) return false;
  return !isRoot(service.url, url);
}

// À chaque navigation et à chaque changement de titre de la page.
function attach(webContents, service, onChange) {
  const record = (url, title) => {
    if (!url || !title) return;
    if (!isChatUrl(service, url)) return;
    const entry = convStore.upsert(service.id, url, title);
    if (entry && onChange) onChange(entry);
  };

  webContents.on('did-navigate', (_e, url) => {
    record(url, webContents.getTitle() || null);
  });

  webContents.on('page-title-updated', (_e, title) => {
    record(webContents.getURL(), title);
  });

  // Premier enregistrement pour un service déjà ouvert sur un chat.
  record(webContents.getURL(), webContents.getTitle());
}

module.exports = { attach };
