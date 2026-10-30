// workspaces.js — espaces de travail : sous-ensembles nommés de services
// (perso / pro / études…). workspaces.json dans userData :
// { active: id, list: [{ id, name, services: [serviceIds] }] }.
// L'espace implicite 'all' (tous les services actifs) n'est jamais stocké.

const fs = require('fs');
const path = require('path');

let dataDir = null;
let data = { active: 'all', list: [] };

function filePath() {
  return path.join(dataDir, 'workspaces.json');
}

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    data.active = typeof parsed.active === 'string' ? parsed.active : 'all';
    data.list = Array.isArray(parsed.list)
      ? parsed.list.filter(
          (w) => w && typeof w.id === 'string' && typeof w.name === 'string' && Array.isArray(w.services)
        )
      : [];
  } catch {
    data = { active: 'all', list: [] };
  }
  if (data.active !== 'all' && !data.list.some((w) => w.id === data.active)) {
    data.active = 'all';
  }
}

function save() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(data, null, 2));
}

function init(dir) {
  dataDir = dir;
  load();
  return get();
}

function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return 'ws-' + c.randomUUID().slice(0, 8);
  }
  return 'ws-' + Math.random().toString(16).slice(2, 10);
}

function get() {
  return { active: data.active, list: data.list.map((w) => ({ ...w, services: [...w.services] })) };
}

function activate(id) {
  data.active = id === 'all' || data.list.some((w) => w.id === id) ? id : 'all';
  save();
  return get();
}

// Nouvel espace : il démarre avec les services passés (l'appelant fournit
// les services actuellement visibles — créer un espace depuis ce qu'on voit).
function create(name, serviceIds) {
  const w = {
    id: newId(),
    name: String(name || 'Espace').slice(0, 40),
    services: (Array.isArray(serviceIds) ? serviceIds : []).filter((id) => typeof id === 'string'),
  };
  data.list.push(w);
  save();
  return { ...w, services: [...w.services] };
}

function remove(id) {
  data.list = data.list.filter((w) => w.id !== id);
  if (data.active === id) data.active = 'all';
  save();
  return get();
}

// Ajoute/retire un service d'un espace (✎ du service, Réglages des espaces).
function toggleService(wsId, serviceId, member) {
  const w = data.list.find((x) => x.id === wsId);
  if (!w) return null;
  if (member === true) {
    if (!w.services.includes(serviceId)) w.services.push(serviceId);
  } else {
    w.services = w.services.filter((s) => s !== serviceId);
  }
  save();
  return { ...w, services: [...w.services] };
}

// Services visibles selon l'espace actif : actifs ET membres de l'espace
// ('all' = tous les actifs).
function visibleServices(services) {
  const enabled = (services || []).filter((s) => s && s.enabled !== false);
  if (data.active === 'all') return enabled;
  const ws = data.list.find((w) => w.id === data.active);
  if (!ws) return enabled;
  const ids = new Set(ws.services);
  return enabled.filter((s) => ids.has(s.id));
}

module.exports = { init, get, activate, create, remove, toggleService, visibleServices };
