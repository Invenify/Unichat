// app.js — UI mobile UniChat : 3 écrans (Chats, Services, Réglages),
// navigation basse, bottom-sheets (catalogue, wizard, menus). La logique
// métier vit dans src/shared/, le stockage derrière mobile/api.js.

import { api, catalogList, sameOrigin } from './api.js';

const $ = (sel) => document.querySelector(sel);
const SVG = {
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>',
};

let services = [];
let history = [];

// --- Logo d'un service : entrée du catalogue par origine, sinon champ du
// service, sinon pastille de couleur d'accent (fallback).

function catalogLogoFor(url) {
  const entry = catalogList().find((c) => sameOrigin(c.url, url));
  return entry ? entry.logo : null;
}

function logoHtml(svc, cls) {
  const src = svc.customLogo && svc.logo ? svc.logo : catalogLogoFor(svc.url) || svc.logo;
  const fallback = `<span class="${cls}" style="background: ${svc.accent}"></span>`;
  return src ? `<img src="${src}" alt="" onerror="this.outerHTML='${fallback.replace(/"/g, "'")}'">` : fallback;
}

// --- Toast ---

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

// --- Bottom-sheets ---

function openSheet(id) {
  $('#sheet-overlay').classList.remove('hidden');
  $(id).classList.remove('hidden');
}

function closeSheets() {
  $('#sheet-overlay').classList.add('hidden');
  document.querySelectorAll('.sheet').forEach((s) => s.classList.add('hidden'));
}

$('#sheet-overlay').addEventListener('click', closeSheets);

// Menu générique (⋮ d'un service ou d'un chat)
function openMenu(title, items) {
  const body = $('#menu-body');
  body.innerHTML = '';
  if (title) {
    const h = document.createElement('h2');
    h.textContent = title;
    h.className = 'menu-title';
    body.appendChild(h);
  }
  for (const item of items) {
    const btn = document.createElement('button');
    btn.textContent = item.label;
    if (item.danger) btn.classList.add('danger');
    btn.addEventListener('click', async () => {
      closeSheets();
      await item.action();
    });
    body.appendChild(btn);
  }
  openSheet('#sheet-menu');
}

// --- Écrans ---

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.screen === name));
}

document.querySelectorAll('.nav-btn').forEach((btn) =>
  btn.addEventListener('click', () => showScreen(btn.dataset.screen))
);

// --- Écran Chats : historique groupé par service, épinglées en tête ---

function chatGroups(query) {
  const q = (query || '').trim().toLowerCase();
  const byService = new Map();
  for (const svc of services) {
    if (!svc.enabled) continue;
    const entries = history
      .filter((e) => e.serviceId === svc.id)
      .filter((e) => !q || e.title.toLowerCase().includes(q) || svc.name.toLowerCase().includes(q))
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.timestamp - a.timestamp);
    if (entries.length > 0) byService.set(svc.id, entries);
  }
  return byService;
}

function fmtDate(ts) {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function renderChats() {
  const list = $('#chat-list');
  const groups = chatGroups($('#search').value);
  list.innerHTML = '';
  if (groups.size === 0) {
    list.innerHTML = `<p class="empty-hint">${history.length === 0
      ? 'Aucune conversation pour le moment.<br>Ouvrez un service, les chats visités apparaissent ici.'
      : 'Aucun résultat pour cette recherche.'}</p>`;
    return;
  }
  for (const [serviceId, entries] of groups) {
    const svc = services.find((s) => s.id === serviceId);
    if (!svc) continue;
    const group = document.createElement('div');
    group.className = 'svc-group';
    group.innerHTML = `
      <button class="svc-header" data-svc="${svc.id}">
        ${logoHtml(svc, 'svc-fallback')}
        <span class="svc-name">${escapeHtml(svc.name)}</span>
      </button>`;
    for (const e of entries) {
      const row = document.createElement('div');
      row.className = 'chat-entry';
      row.dataset.svc = svc.id;
      row.dataset.url = e.url;
      row.innerHTML = `
        <span class="dot" style="background: ${svc.accent}"></span>
        <span class="chat-title">${escapeHtml(e.title)}</span>
        <span class="chat-date">${fmtDate(e.timestamp)}</span>
        <button class="chat-menu">${SVG.more}</button>`;
      if (e.pinned) {
        const pin = document.createElement('span');
        pin.className = 'pin-icon';
        pin.style.color = svc.accent;
        pin.innerHTML = SVG.pin;
        row.querySelector('.dot').replaceWith(pin);
      }
      row.addEventListener('click', (ev) => {
        if (ev.target.closest('.chat-menu')) return;
        openWebView(svc, e.url);
      });
      row.querySelector('.chat-menu').addEventListener('click', () => chatMenu(svc, e));
      group.appendChild(row);
    }
    list.appendChild(group);
    group.querySelector('.svc-header').addEventListener('click', () => openWebView(svc, svc.url));
  }
}

// Menu d'une conversation
function chatMenu(svc, entry) {
  openMenu(entry.title, [
    { label: 'Ouvrir', action: () => openWebView(svc, entry.url) },
    { label: entry.pinned ? 'Détacher' : 'Épingler', action: async () => {
      await api.setPinned(svc.id, entry.url, !entry.pinned);
      await reload();
    } },
    { label: 'Renommer', action: () => startRename(svc, entry) },
    { label: 'Retirer de l\u2019historique', danger: true, action: async () => {
      await api.removeEntry(svc.id, entry.url);
      await reload();
    } },
  ]);
}

// Renommage inline : l'entrée devient un champ, Enter valide, blur valide,
// navigation ailleurs (Échap) annule.
function startRename(svc, entry) {
  showScreen('chats');
  $('#search').value = '';
  renderChats();
  const row = document.querySelector(`.chat-entry[data-svc="${svc.id}"][data-url="${CSS.escape(entry.url)}"]`);
  if (!row) return;
  const titleEl = row.querySelector('.chat-title');
  const input = document.createElement('input');
  input.className = 'chat-rename';
  input.value = entry.title;
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  let closed = false;
  const done = async (save) => {
    if (closed) return;
    closed = true;
    if (save && input.value.trim()) await api.renameEntry(svc.id, entry.url, input.value.trim());
    await reload();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') done(true);
    if (e.key === 'Escape') done(false);
  });
  input.addEventListener('blur', () => done(true));
}

// --- Écran Services ---

function renderServices() {
  const list = $('#service-list');
  list.innerHTML = '';
  if (services.length === 0) {
    list.innerHTML = '<p class="empty-hint">Aucun service.<br>Ajoutez-en un par URL ou via le catalogue.</p>';
    return;
  }
  for (const svc of services) {
    const row = document.createElement('button');
    row.className = 'svc-row' + (svc.enabled ? '' : ' disabled');
    row.innerHTML = `
      ${logoHtml(svc, 'svc-fallback')}
      <span class="svc-name">${escapeHtml(svc.name)}<br><span class="svc-domain">${escapeHtml(domainOf(svc.url))}</span></span>
      <span class="switch${svc.enabled ? ' on' : ''}" role="switch" aria-checked="${svc.enabled}"></span>
      <span class="svc-more">${SVG.more}</span>`;
    row.addEventListener('click', async (ev) => {
      if (ev.target.closest('.switch')) {
        await api.updateService(svc.id, { enabled: !svc.enabled });
        await reload();
      } else if (ev.target.closest('.svc-more')) {
        serviceMenu(svc);
      } else {
        openWebView(svc, svc.url);
      }
    });
    list.appendChild(row);
  }
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function serviceMenu(svc) {
  openMenu(svc.name, [
    { label: 'Ouvrir', action: () => openWebView(svc, svc.url) },
    { label: svc.enabled ? 'Désactiver (session conservée)' : 'Activer', action: async () => {
      await api.updateService(svc.id, { enabled: !svc.enabled });
      await reload();
    } },
    { label: 'Supprimer…', danger: true, action: () =>
      openMenu(svc.name, [
        { label: 'Supprimer et déconnecter', danger: true, action: () => removeService(svc, true) },
        { label: 'Supprimer en gardant la session', action: () => removeService(svc, false) },
        { label: 'Annuler', action: () => {} },
      ]) },
  ]);
}

async function removeService(svc, dropSession) {
  await api.removeService(svc.id);
  await api.removeServiceHistory(svc.id);
  // dropSession (purge des cookies du domaine) : phase 4, plugin natif.
  toast(`« ${svc.name} » supprimé${dropSession ? ' et déconnecté' : ' (session conservée)'}.`);
  await reload();
}

// --- Catalogue (bottom-sheet) : activer / désactiver, onboarding inclus ---

function renderCatalog() {
  const list = $('#catalog-list');
  list.innerHTML = '';
  for (const entry of catalogList()) {
    const svc = services.find((s) => sameOrigin(s.url, entry.url));
    const on = !!svc && svc.enabled;
    const btn = document.createElement('button');
    btn.className = 'cat-entry' + (on ? ' enabled' : '');
    btn.innerHTML = `
      ${logoHtml(entry, 'cat-fallback')}
      <span class="cat-name">${escapeHtml(entry.name)}</span>
      <span class="cat-check">${on ? SVG.check : ''}</span>`;
    btn.addEventListener('click', () => toggleCatalogEntry(entry, svc));
    list.appendChild(btn);
  }
}

async function toggleCatalogEntry(entry, svc) {
  if (!svc) {
    await api.addService({ ...entry, enabled: true });
    toast(`« ${entry.name} » ajouté.`);
  } else {
    await api.updateService(svc.id, { enabled: !svc.enabled });
  }
  await reload();
  renderCatalog();
}

// --- Wizard « Ajouter par URL » ---

let wizardDraft = null;

function openWizard() {
  $('#wizard-title').textContent = 'Ajouter un service';
  $('#wizard-step-url').classList.remove('hidden');
  $('#wizard-step-confirm').classList.add('hidden');
  $('#wizard-error').classList.add('hidden');
  $('#svc-url').value = '';
  $('#wizard-next').textContent = 'Analyser';
  openSheet('#sheet-wizard');
}

$('#wizard-next').addEventListener('click', async () => {
  const err = $('#wizard-error');
  err.classList.add('hidden');
  if ($('#wizard-step-confirm').classList.contains('hidden')) {
    try {
      wizardDraft = await api.analyzeUrl($('#svc-url').value);
    } catch {
      err.textContent = 'URL invalide — exemple : chat.example.com';
      err.classList.remove('hidden');
      return;
    }
    $('#svc-name').value = wizardDraft.name;
    $('#svc-accent').value = wizardDraft.accent;
    $('#svc-accent2').value = wizardDraft.accent2;
    $('#svc-logo').src = wizardDraft.logo || 'assets/logo.png';
    $('#svc-name-preview').textContent = wizardDraft.name;
    $('#wizard-step-url').classList.add('hidden');
    $('#wizard-step-confirm').classList.remove('hidden');
    $('#wizard-next').textContent = 'Ajouter le service';
    return;
  }
  const svc = await api.addService({
    name: $('#svc-name').value.trim() || wizardDraft.name,
    url: wizardDraft.url,
    accent: $('#svc-accent').value,
    accent2: $('#svc-accent2').value,
    logo: wizardDraft.logo,
  });
  closeSheets();
  toast(`« ${svc.name} » ajouté.`);
  await reload();
});

$('#wizard-cancel').addEventListener('click', closeSheets);

// --- Vue service : la WebView native (phase 4) s'affichera dans le slot ---

function openWebView(svc, url) {
  $('#webview-title').textContent = svc.name;
  const img = $('#webview-logo');
  const src = svc.customLogo && svc.logo ? svc.logo : catalogLogoFor(svc.url) || svc.logo;
  if (src) { img.src = src; img.classList.remove('hidden'); } else img.classList.add('hidden');
  $('#webview-slot').innerHTML = `<span>Vue « ${escapeHtml(svc.name)} » — ${escapeHtml(url)}<br><br>La WebView native s'affichera ici (phase 4).</span>`;
  $('#webview-holder').classList.remove('hidden');
  // Phase 4 : plugin natif — createWebView(svc.id, url), events titre →
  // api.recordNavigation(svc, url, title) puis renderChats().
}

$('#webview-back').addEventListener('click', () => {
  $('#webview-holder').classList.add('hidden');
});

// --- Réglages : thème, export, import ---

async function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  document.querySelectorAll('.theme-opt').forEach((b) => b.classList.toggle('on', b.dataset.theme === theme));
}

document.querySelectorAll('.theme-opt').forEach((btn) =>
  btn.addEventListener('click', async () => {
    await api.setTheme(btn.dataset.theme);
    await applyTheme(btn.dataset.theme);
  })
);

$('#export-registry').addEventListener('click', async () => {
  const json = JSON.stringify(services, null, 2);
  // Phase 4 : share sheet Android. En attendant : presse-papiers.
  try {
    await navigator.clipboard.writeText(json);
    toast('Registre copié dans le presse-papiers (' + services.length + ' services).');
  } catch {
    toast(services.length + ' services à exporter — partage Android en phase 4.');
  }
});

$('#import-registry').addEventListener('click', () => $('#import-file').click());

$('#import-file').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const list = JSON.parse(await file.text());
    const added = await api.importRegistry(list);
    toast(added > 0 ? `${added} service(s) importé(s).` : 'Rien de nouveau à importer.');
    await reload();
  } catch {
    toast('Fichier JSON invalide.');
  }
});

// --- Boucle centrale ---

async function reload() {
  services = await api.getServices();
  history = await api.getHistory();
  renderChats();
  renderServices();
}

$('#search').addEventListener('input', renderChats);
$('#add-service').addEventListener('click', () => { closeSheets(); openWizard(); });
$('#catalog-add-url').addEventListener('click', openWizard);
$('#catalog-done').addEventListener('click', closeSheets);
$('#open-catalog').addEventListener('click', () => { renderCatalog(); openSheet('#sheet-catalog'); });

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Démarrage ---

(async () => {
  await applyTheme(await api.getTheme());
  await reload();
  showScreen('chats');
  // Onboarding : registre vide au premier lancement → catalogue.
  if (services.length === 0) {
    renderCatalog();
    openSheet('#sheet-catalog');
  }
})();
