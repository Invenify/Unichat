// profile.js — profil UniChat exporté/importé multi-appareil (schéma v1).
// Un profil : { version: 1, exportedAt, services, workspaces, settings, history }.
// Les sessions/connexions ne se synchronisent JAMAIS (risque sécurité, et
// les sites re-demandent une vérification sur un nouvel appareil).
//
// Fusion, sans jamais écraser :
//  - services : par URL (les entrées locales priment, cf. service.js importable) ;
//  - espaces : par nom, union des services membres ;
//  - réglages : l'import gagne pour les clés connues (choix documenté) ;
//  - historique : par (service, url), l'entrée la plus récente gagne, les
//    titres renommés à la main résistent.
// PIÈGE : les ids de services DIFFÈRENT entre appareils — tous les serviceId
// du profil entrant sont remappés via l'URL vers l'id local.

const { importable } = require('./service');

const PROFILE_VERSION = 1;
const SETTINGS_KEYS = ['theme', 'language', 'blockTrackers', 'historyRetentionDays', 'hibernateMinutes'];

function makeProfile({ services, workspaces, settings, history }) {
  return {
    version: PROFILE_VERSION,
    exportedAt: new Date().toISOString(),
    services: Array.isArray(services) ? services : [],
    workspaces: Array.isArray(workspaces) ? workspaces : [],
    settings: settings && typeof settings === 'object' ? settings : {},
    history: Array.isArray(history) ? history : [],
  };
}

function isProfile(obj) {
  return !!obj && typeof obj === 'object' && obj.version === PROFILE_VERSION && Array.isArray(obj.services);
}

function normHistoryKey(serviceId, url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return serviceId + '|' + u.toString();
  } catch {
    return serviceId + '|' + url;
  }
}

// Fusionne un profil entrant dans les données locales. Tout est pur : les
// deux plateformes appliquent ensuite le résultat avec leur stockage.
function mergeProfile(local, incoming) {
  if (!isProfile(incoming)) return null;

  // 1. Services : fusion par URL — les locaux priment, les nouveaux sont
  //    ajoutés (ids locaux conservés, ids entrants ignorés).
  const services = [...(local.services || [])];
  const addedBefore = services.length;
  for (const svc of importable(services, incoming.services)) services.push(svc);
  const servicesAdded = services.length - addedBefore;

  // 2. Remappage des ids : id entrant → URL (profil) → id local.
  const incomingIdToUrl = new Map();
  for (const svc of incoming.services || []) {
    if (svc && typeof svc.id === 'string' && typeof svc.url === 'string') incomingIdToUrl.set(svc.id, svc.url);
  }
  const localIdByUrl = new Map();
  for (const svc of services) {
    if (svc && typeof svc.id === 'string' && typeof svc.url === 'string') localIdByUrl.set(svc.url, svc.id);
  }
  const remap = (incomingId) => {
    const url = incomingIdToUrl.get(incomingId);
    if (!url) return null;
    return localIdByUrl.get(url) || null;
  };

  // 3. Espaces : par nom, union des membres remappés.
  const workspaces = [...(local.workspaces || [])];
  let workspacesAdded = 0;
  for (const inc of incoming.workspaces || []) {
    if (!inc || typeof inc.name !== 'string' || !inc.name) continue;
    const members = (Array.isArray(inc.services) ? inc.services : [])
      .map(remap)
      .filter((id) => id !== null);
    const existing = workspaces.find((w) => w.name === inc.name);
    if (existing) {
      for (const id of members) {
        if (!existing.services.includes(id)) existing.services.push(id);
      }
    } else {
      workspaces.push({ id: inc.id || null, name: inc.name.slice(0, 40), services: [...new Set(members)] });
      workspacesAdded += 1;
    }
  }

  // 4. Réglages : l'import gagne pour les clés connues présentes.
  const settings = { ...(local.settings || {}) };
  for (const key of SETTINGS_KEYS) {
    if (incoming.settings && incoming.settings[key] !== undefined) {
      settings[key] = incoming.settings[key];
    }
  }

  // 5. Historique : par (service, url), le plus récent gagne ; à égalité,
  //    le titre manuel résiste.
  const history = [...(local.history || [])];
  const byKey = new Map(history.map((e) => [normHistoryKey(e.serviceId, e.url), e]));
  let historyMerged = 0;
  for (const inc of incoming.history || []) {
    if (!inc || typeof inc.url !== 'string') continue;
    const localId = remap(inc.serviceId);
    if (!localId) continue; // service inconnu des deux côtés
    const key = normHistoryKey(localId, inc.url);
    const existing = byKey.get(key);
    if (!existing) {
      const entry = { ...inc, serviceId: localId };
      history.push(entry);
      byKey.set(key, entry);
      historyMerged += 1;
      continue;
    }
    const incNewer = (inc.updatedAt || inc.timestamp || 0) > (existing.updatedAt || existing.timestamp || 0);
    if (incNewer && !(existing.manual === true && inc.manual !== true)) {
      Object.assign(existing, { ...inc, serviceId: localId });
      historyMerged += 1;
    }
  }

  return {
    services,
    workspaces,
    settings,
    history,
    stats: { servicesAdded, workspacesAdded, historyMerged },
  };
}

module.exports = { PROFILE_VERSION, SETTINGS_KEYS, makeProfile, isProfile, mergeProfile };
