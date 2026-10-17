// app.js — UI mobile UniChat : 3 écrans (Chats, Services, Réglages),
// navigation basse, bottom-sheets (catalogue, wizard, menus). La logique
// métier vit dans src/shared/, le stockage derrière mobile/api.js.

import { api, catalogList, sameOrigin } from './api.js';
import { webviews } from './webviews.js';

const $ = (sel) => document.querySelector(sel);
const SVG = {
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
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
  if (wvOpen) webviews.hide(); // une WebView native couvrirait le sheet
  $('#sheet-overlay').classList.remove('hidden');
  $(id).classList.remove('hidden');
}

function closeSheets() {
  $('#sheet-overlay').classList.add('hidden');
  document.querySelectorAll('.sheet').forEach((s) => s.classList.add('hidden'));
  if (wvOpen) webviews.show();
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

// --- Écran Chats : historique groupé par service. Épinglées toujours
// visibles (hors quota) puis, sans recherche, les 5 dernières normales
// par service + « voir les autres » (modale). En recherche : toutes les
// conversations correspondantes, tous services.

const CHATS_PER_SERVICE = 5;

function serviceEntries(svc, q) {
  return history
    .filter((e) => e.serviceId === svc.id)
    .filter((e) => !q || e.title.toLowerCase().includes(q) || svc.name.toLowerCase().includes(q))
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.timestamp - a.timestamp);
}

function chatGroups(query) {
  const q = (query || '').trim().toLowerCase();
  const byService = new Map();
  for (const svc of services) {
    if (!svc.enabled) continue;
    const entries = serviceEntries(svc, q);
    if (entries.length > 0) byService.set(svc.id, entries);
  }
  return byService;
}

function fmtDate(ts) {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

// Ligne de conversation (écran Chats et modale « toutes les conversations »)
function chatRow(svc, e, onMenu, onOpen) {
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
    if (onOpen) onOpen();
    openWebView(svc, e.url);
  });
  row.querySelector('.chat-menu').addEventListener('click', () => onMenu(svc, e));
  return row;
}

function renderChats() {
  const list = $('#chat-list');
  const query = $('#search').value;
  const groups = chatGroups(query);
  const searching = query.trim().length > 0;
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
    // Recherche → tout l'historique filtré ; sinon épinglées (hors quota)
    // + 5 dernières conversations normales + « voir plus ».
    const pinned = entries.filter((e) => e.pinned);
    const rest = entries.filter((e) => !e.pinned);
    const shown = searching ? entries : [...pinned, ...rest.slice(0, CHATS_PER_SERVICE)];
    for (const e of shown) group.appendChild(chatRow(svc, e, chatMenu));
    if (!searching && rest.length > CHATS_PER_SERVICE) {
      const more = document.createElement('button');
      more.className = 'chat-more';
      more.innerHTML = `<span>Voir les ${rest.length - CHATS_PER_SERVICE} autres</span>${SVG.chevron}`;
      more.addEventListener('click', () => openServiceChats(svc));
      group.appendChild(more);
    }
    list.appendChild(group);
    group.querySelector('.svc-header').addEventListener('click', () => openWebView(svc, svc.url));
  }
}

// Modale « toutes les conversations d'un service »
function openServiceChats(svc) {
  const entries = serviceEntries(svc, '');
  $('#sheet-chats-title').textContent = svc.name;
  $('#sheet-chats-count').textContent =
    entries.length + (entries.length > 1 ? ' conversations' : ' conversation');
  const body = $('#sheet-chats-body');
  body.innerHTML = '';
  for (const e of entries) {
    const row = chatRow(
      svc,
      e,
      (s, entry) => chatMenu(s, entry, { fromSheet: true, refresh: () => openServiceChats(svc) }),
      closeSheets // fermer la modale avant d'ouvrir la vue
    );
    body.appendChild(row);
  }
  openSheet('#sheet-chats');
}

// Menu d'une conversation. Depuis la modale (fromSheet), le renommage inline
// n'est pas proposé (le champ vit dans la liste) mais épingler/retirer
// rafraîchissent la modale via opts.refresh.
function chatMenu(svc, entry, opts = {}) {
  const done = async (fn) => {
    await fn();
    await reload();
    if (opts.refresh) opts.refresh();
  };
  const items = [
    { label: 'Ouvrir', action: () => openWebView(svc, entry.url) },
    { label: entry.pinned ? 'Détacher' : 'Épingler', action: () =>
      done(() => api.setPinned(svc.id, entry.url, !entry.pinned)) },
  ];
  if (!opts.fromSheet) {
    items.push({ label: 'Renommer', action: () => startRename(svc, entry) });
  }
  items.push({ label: 'Retirer de l\u2019historique', danger: true, action: () =>
    done(() => api.removeEntry(svc.id, entry.url)) });
  openMenu(entry.title, items);
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

// --- Dock (écran Chats) : logos des services actifs, accès direct au chat
// sans passer par l'écran Services. Caché si aucun service actif.

function renderDock() {
  const dock = $('#quick-dock');
  const active = services.filter((s) => s.enabled);
  dock.classList.toggle('hidden', active.length === 0);
  dock.innerHTML = '';
  for (const svc of active) {
    const btn = document.createElement('button');
    btn.className = 'dock-btn';
    btn.dataset.svcId = svc.id;
    btn.title = svc.name;
    btn.setAttribute('aria-label', 'Ouvrir ' + svc.name);
    btn.innerHTML = logoHtml(svc, 'dock-fallback');
    btn.addEventListener('click', () => openWebView(svc, svc.url));
    dock.appendChild(btn);
  }
}

// --- Réordonnancement du dock : appui long (350 ms) puis glisser.
// L'ordre persiste dans le registre (api.reorderServices) et s'applique
// aussi aux groupes de l'écran Chats et à la liste Services. ---

(() => {
  const dock = $('#quick-dock');
  const LONG_PRESS = 350;
  let press = null;
  let suppressClick = false;

  function beginDrag() {
    if (!press) return;
    press.dragging = true;
    suppressClick = true;
    const { btn, pid } = press;
    press.children = [...dock.children];
    press.idx = press.children.indexOf(btn);
    press.slots = press.children.map((c) => c.offsetLeft);
    press.width = btn.offsetWidth || 52;
    press.step = press.children.length > 1 ? press.slots[1] - press.slots[0] : press.width + 12;
    press.target = press.idx;
    btn.classList.add('dragging');
    dock.classList.add('dragging');
    try { btn.setPointerCapture(pid); } catch { /* environnement sans capture */ }
    if (navigator.vibrate) navigator.vibrate(10);
  }

  function shiftOthers() {
    const { children, idx, target, step } = press;
    children.forEach((c, i) => {
      if (i === idx) return;
      let shift = 0;
      if (target < idx && i >= target && i < idx) shift = step;
      else if (target > idx && i > idx && i <= target) shift = -step;
      c.style.transform = shift ? `translateX(${shift}px)` : '';
    });
  }

  dock.addEventListener('pointerdown', (ev) => {
    const btn = ev.target.closest('.dock-btn');
    if (!btn) return;
    suppressClick = false;
    press = { btn, pid: ev.pointerId, startX: ev.clientX, dragging: false };
    press.timer = setTimeout(beginDrag, LONG_PRESS);
  });

  // Android : sans ceci, la WebView prend le geste en charge (scroll du dock)
  // dès le premier mouvement et envoie pointercancel — le drag est impossible.
  // touchmove est évalué au début du geste : preventDefault ne bloque que
  // pendant le drag ; le scroll normal du dock reste utilisable.
  dock.addEventListener('touchmove', (ev) => {
    if (press && press.dragging) ev.preventDefault();
  }, { passive: false });

  dock.addEventListener('pointermove', (ev) => {
    if (!press) return;
    if (!press.dragging) {
      // Déplacement avant le long press : on laisse le dock défiler.
      if (Math.abs(ev.clientX - press.startX) > 8) clearTimeout(press.timer);
      return;
    }
    const dx = ev.clientX - press.startX;
    const { btn, slots, idx, children, width } = press;
    btn.style.transform = `translateX(${dx}px) scale(1.08)`;
    // Beaucoup de services : suivre le doigt près des bords du dock.
    const r = dock.getBoundingClientRect();
    if (ev.clientX > r.right - 44) dock.scrollLeft += 8;
    else if (ev.clientX < r.left + 44) dock.scrollLeft -= 8;
    const center = slots[idx] + dx + width / 2;
    let target = 0;
    for (let i = 0; i < children.length; i++) {
      if (i !== idx && center > slots[i] + width / 2) target++;
    }
    if (target !== press.target) {
      press.target = target;
      shiftOthers();
    }
  });

  async function endDrag(cancelled) {
    if (!press) return;
    clearTimeout(press.timer);
    const { btn, dragging, target, idx, children } = press;
    press = null;
    if (!dragging) return;
    btn.classList.remove('dragging');
    dock.classList.remove('dragging');
    if (!cancelled && target !== idx) {
      const others = children.filter((_, i) => i !== idx);
      const ids = [...others.slice(0, target), btn, ...others.slice(target)]
        .map((c) => c.dataset.svcId);
      services = await api.reorderServices(ids);
      renderDock();
      renderChats();
      renderServices();
      toast('Ordre des services mis à jour.');
    } else {
      renderDock(); // transform remis à zéro
    }
  }

  dock.addEventListener('pointerup', () => endDrag(false));
  dock.addEventListener('pointercancel', () => endDrag(true));
  // Après un glisser, le clic résiduel ne doit pas ouvrir le service.
  dock.addEventListener('click', (ev) => {
    if (suppressClick) {
      suppressClick = false;
      ev.stopPropagation();
      ev.preventDefault();
    }
  }, true);
})();

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
  if (dropSession) await webviews.clearSession(svc.url); // cookies + stockage du domaine
  await webviews.destroy(svc.id); // la WebView éventuelle du service
  await api.removeService(svc.id);
  await api.removeServiceHistory(svc.id);
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

// --- Vue service : la WebView native (plugin UniChatWebViews) vit dans le
// slot #webview-slot, positionnée par géométrie CSS transmise au natif.
// Sans plugin (navigateur, tests) : placeholder. ---

let wvOpen = false;
let wvToken = 0; // évite la course ouvrir/fermer (retour immédiat)

function slotRect() {
  const r = $('#webview-slot').getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
}

function syncGeometry() {
  if (wvOpen) webviews.position(slotRect());
}

function openWebView(svc, url) {
  const token = ++wvToken;
  $('#webview-title').textContent = svc.name;
  const img = $('#webview-logo');
  const src = svc.customLogo && svc.logo ? svc.logo : catalogLogoFor(svc.url) || svc.logo;
  if (src) { img.src = src; img.classList.remove('hidden'); } else img.classList.add('hidden');
  $('#webview-slot').innerHTML = webviews.available()
    ? ''
    : `<span>Vue « ${escapeHtml(svc.name)} » — ${escapeHtml(url)}<br><br>La WebView native est disponible sur l'app Android uniquement.</span>`;
  $('#webview-holder').classList.remove('hidden');
  wvOpen = true;
  // Le holder vient d'être affiché : mesurer le slot puis ouvrir la vue.
  requestAnimationFrame(async () => {
    if (token !== wvToken) return; // fermé entre-temps
    await webviews.open(svc, url, slotRect());
  });
}

async function closeWebView() {
  wvToken++;
  $('#webview-holder').classList.add('hidden');
  wvOpen = false;
  await webviews.close();
}

$('#webview-back').addEventListener('click', closeWebView);

// La vue native est recadrée quand le viewport change (clavier, rotation,
// insets) — la géométrie du slot est repoussée au plugin.
window.addEventListener('resize', syncGeometry);
if (window.visualViewport) window.visualViewport.addEventListener('resize', syncGeometry);

// Events du plugin : titre/URL de page → moteur d'historique ; fermeture par
// le retour système → recacher le holder.
webviews.onPage(async (ev) => {
  const svc = services.find((s) => s.id === ev.id);
  if (!svc) return;
  const saved = await api.recordNavigation(svc, ev.url, ev.title);
  if (saved) {
    history = await api.getHistory();
    renderChats();
  }
});

webviews.onClosed(() => {
  if (wvOpen) closeWebView();
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
  renderDock();
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
