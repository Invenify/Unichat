// settings.js — réglages applicatifs (settings.json dans userData).
// « theme » : 'system' (suit l'OS), 'light' ou 'dark' (forcé).
// « sidebarCollapsed » : sidebar réduite à un rail d'icônes (desktop).
// « language » : 'system' (suit l'OS) ou code i18n (fr, en, de, es, it).
// « blockTrackers » : coupe le pistage/la pub dans les vues (desktop).
// « historyRetentionDays » : purge des conversations plus anciennes (0/30/90/365).

const fs = require('fs');
const path = require('path');

const THEMES = ['system', 'light', 'dark'];
const LANG_CODES = ['system', 'fr', 'en', 'de', 'es', 'it'];
const RETENTION_DAYS = [0, 30, 90, 365];

let dataDir = null;
let data = { theme: 'system', sidebarCollapsed: false, language: 'system', blockTrackers: false, historyRetentionDays: 0 };

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
  data.sidebarCollapsed = data.sidebarCollapsed === true;
  if (!LANG_CODES.includes(data.language)) data.language = 'system';
  data.blockTrackers = data.blockTrackers === true;
  if (!RETENTION_DAYS.includes(data.historyRetentionDays)) data.historyRetentionDays = 0;
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
  setSidebarCollapsed(collapsed) {
    data.sidebarCollapsed = collapsed === true;
    save();
    return { ...data };
  },
  setLanguage(language) {
    if (!LANG_CODES.includes(language)) return null;
    data.language = language;
    save();
    return { ...data };
  },
  setBlockTrackers(on) {
    data.blockTrackers = on === true;
    save();
    return { ...data };
  },
  setHistoryRetention(days) {
    if (!RETENTION_DAYS.includes(days)) return null;
    data.historyRetentionDays = days;
    save();
    return { ...data };
  },
};
