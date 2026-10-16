// logos.js — import d'un logo personnalisé : copie du fichier choisi vers
// userData/logos/ sous un nom unique. Le renderer l'affiche via le schéma
// interne « unichat-logo:// » (voir main.js) : ni le dossier du site ni
// userData ne sont exposés en clair au renderer.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp'];

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

function mimeFor(name) {
  return MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
}

// Copie src dans logosDir sous un nom unique. Retourne le nom du fichier
// copié, ou null si l'extension n'est pas une image reconnue.
function importFile(src, logosDir) {
  const ext = path.extname(src).toLowerCase();
  if (!EXTENSIONS.includes(ext)) return null;
  const name = crypto.randomBytes(6).toString('hex') + ext;
  fs.mkdirSync(logosDir, { recursive: true });
  fs.copyFileSync(src, path.join(logosDir, name));
  return name;
}

module.exports = { importFile, mimeFor, EXTENSIONS };
