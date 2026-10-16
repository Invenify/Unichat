// conv-store.js — historique local des chats visités ({serviceId, url, title, dates}).
// 100 % local, JSON dans userData. Dédoublonné par (serviceId, url).

const fs = require('fs');
const path = require('path');

let dataDir = null;
let entries = [];
let saveTimer = null;

function filePath() {
  return path.join(dataDir, 'history.json');
}

function load() {
  try {
    entries = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    if (!Array.isArray(entries)) entries = [];
  } catch {
    entries = [];
  }
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(entries, null, 2));
  }, 300);
}

function init(dir) {
  dataDir = dir;
  load();
}

function key(serviceId, url) {
  return serviceId + '|' + url;
}

// Insère ou met à jour (si le chat est renommé, le titre suit).
function upsert(serviceId, url, title) {
  if (!title) return null;
  const url_ = normalize(url);
  const existing = entries.find((e) => key(e.serviceId, e.url) === key(serviceId, url_));
  const now = Date.now();
  if (existing) {
    // Titre renommé manuellement (manual) : il ne suit plus la page.
    if (!existing.manual && existing.title !== title) {
      existing.title = title;
    }
    existing.updatedAt = now;
    saveSoon();
    return existing;
  }
  const entry = {
    serviceId,
    url: url_,
    title,
    createdAt: now,
    updatedAt: now,
  };
  entries.push(entry);
  saveSoon();
  return entry;
}

function normalize(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

function listAll() {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
}

function removeService(serviceId) {
  entries = entries.filter((e) => e.serviceId !== serviceId);
  saveSoon();
}

// Retire UNE entrée de l'historique (clic droit « Retirer de la liste »).
function remove(serviceId, url) {
  const target = key(serviceId, normalize(url));
  const before = entries.length;
  entries = entries.filter((e) => key(e.serviceId, e.url) !== target);
  if (entries.length !== before) saveSoon();
}

// Titre manuel : marque l'entrée « manual » pour que le titre de la page
// ne l'écrase plus lors des upserts suivants.
function rename(serviceId, url, title) {
  if (!title) return null;
  const target = key(serviceId, normalize(url));
  const existing = entries.find((e) => key(e.serviceId, e.url) === target);
  if (!existing) return null;
  existing.title = title;
  existing.manual = true;
  existing.updatedAt = Date.now();
  saveSoon();
  return existing;
}

module.exports = { init, upsert, listAll, removeService, remove, rename };
