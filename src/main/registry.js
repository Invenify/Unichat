// registry.js — registre déclaratif de services (services.json dans userData).
// Un service = une entrée JSON, jamais de code dédié.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
  if (!Array.isArray(services) || services.length === 0) {
    services = defaultServices();
    save();
  }
}

function save() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(services, null, 2));
}

// Trois entrées initiales, comme n'importe quel autre chat ajouté ensuite.
function defaultServices() {
  return [
    mkService({ name: 'Euria', url: 'https://euria.infomaniak.com', accent: '#0098f7' }),
    mkService({ name: 'Lumo', url: 'https://lumo.proton.me', accent: '#6d4aff' }),
    mkService({ name: 'Le Chat', url: 'https://chat.mistral.ai', accent: '#fa520f' }),
  ];
}

function mkService({ name, url, accent, accent2, logo, excludeRegex }) {
  return {
    id: 'svc-' + crypto.randomUUID().slice(0, 8),
    name,
    url,
    accent: accent || '#6c5ce7',
    accent2: accent2 || '#a29bfe',
    logo: logo || null,
    excludeRegex: excludeRegex || null,
  };
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

function add({ name, url, accent, accent2, logo, excludeRegex }) {
  const svc = mkService({ name, url, accent, accent2, logo, excludeRegex });
  services.push(svc);
  save();
  return svc;
}

function update(id, patch) {
  const svc = get(id);
  if (!svc) return null;
  const fields = ['name', 'url', 'accent', 'accent2', 'logo', 'excludeRegex'];
  for (const f of fields) {
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

module.exports = { init, list, get, add, update, remove };
