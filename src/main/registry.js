// registry.js — registre déclaratif de services (services.json dans userData).
// Un service = une entrée JSON, jamais de code dédié. Le modèle de service
// et les règles de fusion sont partagés avec Android dans src/shared/service.js.

const fs = require('fs');
const path = require('path');
const { FIELDS, mkService, importable } = require('../shared/service');

let dataDir = null;
let services = [];

function filePath() {
  return path.join(dataDir, 'services.json');
}

function load() {
  try {
    services = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
  } catch {
    services = [];
  }
  if (!Array.isArray(services)) services = [];
  // Registre vide au premier lancement : l'onboarding (popup catalogue)
  // propose les services connus au lieu d'imposer des valeurs par défaut.
}

function save() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(services, null, 2));
}

function init(dir) {
  dataDir = dir;
  load();
}

function list() {
  return services;
}

function get(id) {
  return services.find((s) => s.id === id) || null;
}

function add(data) {
  const svc = mkService(data);
  services.push(svc);
  save();
  return svc;
}

function update(id, patch) {
  const svc = get(id);
  if (!svc) return null;
  for (const f of FIELDS) {
    if (patch[f] !== undefined) svc[f] = patch[f];
  }
  save();
  return svc;
}

function remove(id) {
  const svc = get(id);
  services = services.filter((s) => s.id !== id);
  save();
  return svc;
}

// Import d'un registre exporté : fusion par URL, jamais d'écrasement.
// Les entrées existantes (même URL) sont ignorées, les autres ajoutées.
function importAll(list) {
  const entries = importable(services, list);
  if (entries.length === 0) return 0;
  services.push(...entries);
  save();
  return entries.length;
}

module.exports = { init, list, get, add, update, remove, importAll };
