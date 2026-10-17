// api.js — façade entre l'UI mobile et le stockage.
// Toutes les méthodes sont async : l'implémentation (localStorage ici, puis
// Filesystem/WebView natives) peut changer sans toucher à l'UI.
// Les règles métier (isChatUrl, cleanTitle, fusion d'import) viennent de
// src/shared/ — exactement les mêmes que le desktop.

import { isChatUrl, cleanTitle } from '../src/shared/title-rules.js';
import { mkService, importable } from '../src/shared/service.js';
import { list as catalogList, find as catalogFind, sameOrigin } from '../src/shared/catalog.js';

const K = { services: 'unichat.services', history: 'unichat.history', theme: 'unichat.theme' };

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// Normalisation identique au desktop (conv-store) : le fragment (#…) est
// ignoré, deux URLs ne différant que par lui sont la même conversation.
function normUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname + u.search;
  } catch {
    return url;
  }
}

export const api = {
  // --- Registre de services ---

  async getServices() {
    return read(K.services, []);
  },

  async addService(data) {
    const services = read(K.services, []);
    const svc = mkService(data);
    services.push(svc);
    write(K.services, services);
    return svc;
  },

  async updateService(id, patch) {
    const services = read(K.services, []);
    const svc = services.find((s) => s.id === id);
    if (!svc) return null;
    for (const f of ['name', 'url', 'accent', 'accent2', 'logo', 'customLogo', 'excludeRegex', 'blockNavRegex', 'stripTitleRegex', 'enabled']) {
      if (patch[f] !== undefined) svc[f] = patch[f];
    }
    write(K.services, services);
    return svc;
  },

  async removeService(id) {
    const services = read(K.services, []);
    const svc = services.find((s) => s.id === id) || null;
    write(K.services, services.filter((s) => s.id !== id));
    return svc;
  },

  async importRegistry(list) {
    const services = read(K.services, []);
    const entries = importable(services, list);
    if (entries.length > 0) write(K.services, [...services, ...entries]);
    return entries.length;
  },

  // Réordonne le registre (drag & drop du dock) : les ids listés passent en
  // tête dans cet ordre ; les absents restent en fin, ordre conservé.
  async reorderServices(orderedIds) {
    const services = read(K.services, []);
    const ids = (Array.isArray(orderedIds) ? orderedIds : [])
      .filter((id) => services.some((s) => s.id === id));
    const next = ids.map((id) => services.find((s) => s.id === id));
    for (const s of services) if (!ids.includes(s.id)) next.push(s);
    write(K.services, next);
    return next;
  },

  // --- Historique des conversations (moteur de titres) ---

  async getHistory() {
    return read(K.history, []);
  },

  // Enregistre une navigation : les mêmes règles que le desktop
  // (https, même hôte, pas de login, pas la racine, pas d'exclusion,
  // stripTitleRegex appliqué).
  async recordNavigation(service, url, title) {
    if (!url || !title) return null;
    if (!isChatUrl(service, url)) return null;
    const history = read(K.history, []);
    const key = normUrl(url);
    let entry = history.find((e) => e.serviceId === service.id && e.url === key);
    const clean = cleanTitle(service, title);
    if (entry) {
      if (!entry.manual) entry.title = clean;
      entry.timestamp = Date.now();
    } else {
      entry = { serviceId: service.id, url: key, title: clean, timestamp: Date.now(), pinned: false, manual: false };
      history.push(entry);
    }
    write(K.history, history);
    return entry;
  },

  async setPinned(serviceId, url, pinned) {
    const history = read(K.history, []);
    const entry = history.find((e) => e.serviceId === serviceId && e.url === normUrl(url));
    if (!entry) return null;
    entry.pinned = pinned === true;
    write(K.history, history);
    return entry;
  },

  async renameEntry(serviceId, url, title) {
    if (!title) return null;
    const history = read(K.history, []);
    const entry = history.find((e) => e.serviceId === serviceId && e.url === normUrl(url));
    if (!entry) return null;
    entry.title = title;
    entry.manual = true;
    write(K.history, history);
    return entry;
  },

  async removeEntry(serviceId, url) {
    const key = normUrl(url);
    write(K.history, read(K.history, []).filter((e) => !(e.serviceId === serviceId && e.url === key)));
  },

  async removeServiceHistory(serviceId) {
    write(K.history, read(K.history, []).filter((e) => e.serviceId !== serviceId));
  },

  // --- Thème (system | light | dark) ---

  async getTheme() {
    const t = localStorage.getItem(K.theme);
    return t === 'light' || t === 'dark' ? t : 'system';
  },

  async setTheme(theme) {
    if (theme === 'system' || theme === 'light' || theme === 'dark') {
      localStorage.setItem(K.theme, theme);
      return theme;
    }
    return null;
  },

  // --- Métadonnées d'une URL (phase 6 : fetch natif, pas de CORS) ---
  // En attendant le plugin HTTP : on complète via le catalogue (même
  // origine) puis par défaut depuis le hostname.

  async analyzeUrl(input) {
    let url = String(input || '').trim();
    if (!/^https?:/i.test(url)) url = 'https://' + url;
    const u = new URL(url); // lève si invalide
    const entry = catalogFind(u.origin) || catalogList().find((c) => sameOrigin(c.url, url));
    return {
      url,
      name: entry ? entry.name : u.hostname.replace(/^www\./, ''),
      accent: entry ? entry.accent : '#6c5ce7',
      accent2: entry ? entry.accent2 : '#a29bfe',
      logo: entry ? entry.logo : null,
    };
  },
};

export { catalogList, catalogFind, sameOrigin };
