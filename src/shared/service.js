// service.js — modèle d'un service du registre + règles d'import.
// Portable desktop (Electron) et mobile (Capacitor) : zéro API Node/Electron.
// Un service = une entrée JSON, jamais de code dédié.

// Champs modifiables via update().
const FIELDS = ['name', 'url', 'accent', 'accent2', 'logo', 'customLogo', 'excludeRegex', 'blockNavRegex', 'stripTitleRegex', 'enabled'];

// Id court, stable : crypto.randomUUID côté Node et navigateur, avec
// repli au cas où l'API ne serait pas disponible.
function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return 'svc-' + c.randomUUID().slice(0, 8);
  }
  return 'svc-' + Math.random().toString(16).slice(2, 10);
}

function mkService({ name, url, accent, accent2, logo, customLogo, excludeRegex, blockNavRegex, stripTitleRegex, enabled }) {
  return {
    id: newId(),
    name,
    url,
    accent: accent || '#6c5ce7',
    accent2: accent2 || '#a29bfe',
    logo: logo || null,
    // customLogo : le logo a été choisi dans la modal ✎ (URL ou fichier
    // importé) — il prime sur le logo du catalogue.
    customLogo: customLogo === true,
    excludeRegex: excludeRegex || null,
    blockNavRegex: blockNavRegex || null,
    // stripTitleRegex : suffixe retiré des titres de page (ex. Open WebUI
    // « <chat> / Open WebUI » → on garde le nom du chat).
    stripTitleRegex: stripTitleRegex || null,
    enabled: enabled !== false,
  };
}

// Fusion par URL, jamais d'écrasement : les entrées existantes (même URL)
// sont ignorées, les invalides écartées. Retourne les entrées à ajouter
// (déjà normalisées par mkService), le stockage reste à la charge de l'appelant.
function importable(existing, incoming) {
  if (!Array.isArray(incoming)) return [];
  const out = [];
  for (const s of incoming) {
    if (!s || typeof s.url !== 'string' || s.url === '') continue;
    if (existing.some((x) => x.url === s.url)) continue;
    out.push(
      mkService({
        name: s.name,
        url: s.url,
        accent: s.accent,
        accent2: s.accent2,
        logo: s.logo,
        customLogo: s.customLogo,
        excludeRegex: s.excludeRegex,
        stripTitleRegex: s.stripTitleRegex,
      })
    );
  }
  return out;
}

module.exports = { FIELDS, mkService, importable, newId };
