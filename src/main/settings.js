// settings.js — réglages applicatifs (settings.json dans userData).
// « theme » : 'system' (suit l'OS), 'light' ou 'dark' (forcé).

const fs = require('fs');
const path = require('path');

const THEMES = ['system', 'light', 'dark'];

let dataDir = null;
let data = { theme: 'system' };

function filePath() {
  return path.join(dataDir, 'settings.json');
}

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    if (parsed && typeof parsed === 'object') data = { ...data, ...parsed };
  } catch {
    data = { theme: 'system' };
  }
  if (!THEMES.includes(data.theme)) data.theme = 'system';
}

function save() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(filePath(), JSON.stringify(data, null, 2));
}

module.exports = {
  THEMES,
  init(dir) {
    dataDir = dir;
    load();
    return data;
  },
  get() {
    return { ...data };
  },
  setTheme(theme) {
    if (!THEMES.includes(theme)) return null;
    data.theme = theme;
    save();
    return { ...data };
  },
};
