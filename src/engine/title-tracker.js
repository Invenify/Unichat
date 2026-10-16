// title-tracker.js — moteur de titres universel.
// Écoute did-navigate / page-title-updated sur chaque WebContentsView et
// enregistre {serviceId, url, title, timestamp} dans le store local.
// document.title est la seule chose que tous les chats IA ont en commun :
// zéro sélecteur CSS à maintenir.

const convStore = require('./conv-store');

// Racine du service : même origine et même chemin, paramètres ignorés
// (l'URL de démarrage peut porter un paramètre, ex. Euria ?ksuite-mode=main).
function isRoot(serviceUrl, url) {
  try {
    const a = new URL(serviceUrl);
    const b = new URL(url);
    return a.origin === b.origin && a.pathname === b.pathname;
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
  try {
    // Un chat vit sur le même hôte que son service : les redirections SSO
    // (login.infomaniak.com, v2.auth.mistral.ai, account.proton.me…) ne
    // polluent jamais l'historique.
    if (new URL(url).hostname !== new URL(service.url).hostname) return false;
  } catch {
    return false;
  }
  if (isAuthUrl(url)) return false;
  if (excluded(service, url)) return false;
  return !isRoot(service.url, url);
}

// Suffixe de marque dans le titre de page (ex. Open WebUI « Hello /
// Open WebUI ») : le champ stripTitleRegex du service le retire, le nom
// de la conversation prime. Si la regex vide le titre, on le garde tel quel.
function cleanTitle(service, title) {
  if (!service.stripTitleRegex) return title;
  try {
    const t = title.replace(new RegExp(service.stripTitleRegex), '').trim();
    return t || title;
  } catch {
    // regex invalide : titre intact
    return title;
  }
}

// À chaque navigation et à chaque changement de titre de la page.
function attach(webContents, service, onChange) {
  const record = (url, title) => {
    if (!url || !title) return;
    if (!isChatUrl(service, url)) return;
    const entry = convStore.upsert(service.id, url, cleanTitle(service, title));
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

module.exports = { attach, isChatUrl, cleanTitle };
