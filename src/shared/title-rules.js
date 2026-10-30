// title-rules.js — règles du moteur de titres universel.
// Portable desktop (Electron) et mobile (Capacitor) : zéro API Node/Electron.
// document.title est la seule chose que tous les chats IA ont en commun :
// zéro sélecteur CSS à maintenir.

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
  if (isRoot(service.url, url)) {
    // Certains services (Copilot, Lumo) vivent entièrement sur leur page
    // racine : l'URL ne change jamais, seule l'entrée « conversation
    // courante » est enregistrée (clé = racine, titre = titre de la page).
    return service.rootChat === true;
  }
  return true;
}

// Titre « générique » (nom de marque seul, ex. « Copilot », « Proton Lumo »)
// : ce n'est jamais le nom d'une conversation, on ne l'enregistre pas, même
// hors racine — c'est le cas Copilot/Lumo : URL figée + titre de marque.
function isRecordableTitle(service, title) {
  const t = (title || '').trim();
  if (t.length < 3) return false;
  if (service.genericTitleRegex) {
    try {
      if (new RegExp(service.genericTitleRegex, 'i').test(t)) return false;
    } catch {
      // regex invalide : on ignore le filtre
    }
  }
  const name = (service.name || '').trim().toLowerCase();
  if (name && t.toLowerCase() === name) return false;
  return true;
}

// Décision partagée desktop (title-tracker) / mobile (api.recordNavigation) :
// le titre final à enregistrer, ou null si ce n'est pas une conversation.
// 1. nettoyage du suffixe de marque (stripTitleRegex) ;
// 2. filtre des titres génériques (isRecordableTitle) ;
// 3. repli « Conversation en cours » pour un service racine (rootChat,
//    ex. Duck.ai) dont le titre de page reste celui de la marque : sans
//    repli, le service paraît simplement ne pas fonctionner.
function resolveTitle(service, url, title) {
  const clean = cleanTitle(service, title);
  if (isRecordableTitle(service, clean)) return clean;
  if (service.rootChat === true && isRoot(service.url, url)) return 'Conversation en cours';
  return null;
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

module.exports = { isRoot, isAuthUrl, isChatUrl, cleanTitle, isRecordableTitle, resolveTitle };
