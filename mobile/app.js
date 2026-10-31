// app.js — UI mobile UniChat : 3 écrans (Chats, Services, Réglages),
// navigation basse, bottom-sheets (catalogue, wizard, menus). La logique
// métier vit dans src/shared/, le stockage derrière mobile/api.js.

import { api, catalogList, sameOrigin } from './api.js';
import { webviews } from './webviews.js';
import { t, setLang as setI18nLang, resolveLang, locale as i18nLocale, LANGS } from '../src/shared/i18n.js';
import { isProfile } from '../src/shared/profile.js';

// Applique la langue courante aux textes statiques du DOM (data-i18n,
// data-i18n-placeholder, data-i18n-title) et à <html lang>.
function applyI18n() {
  document.documentElement.lang = i18nLocale().slice(0, 2);
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
}

const $ = (sel) => document.querySelector(sel);
const SVG = {
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
};

let services = [];
let history = [];
let workspaces = { active: 'all', list: [] }; // espace de travail actif

// --- Espaces de travail (perso / pro) : filtrage du dock et de l'écran
// Chats selon l'espace actif. L'écran Services montre tout (gestion). ---

// Services visibles : actifs ET membres de l'espace actif ('all' = tous).
function visibleServices() {
  return services.filter((s) => {
    if (!s.enabled) return false;
    if (workspaces.active === 'all') return true;
    const ws = workspaces.list.find((w) => w.id === workspaces.active);
    return ws ? ws.services.includes(s.id) : false;
  });
}

function updateWsChip() {
  const chip = $('#ws-chip');
  chip.classList.toggle('hidden', workspaces.list.length === 0);
  const name =
    workspaces.active === 'all'
      ? t('allServices')
      : (workspaces.list.find((w) => w.id === workspaces.active) || {}).name || t('allServices');
  $('#ws-chip-name').textContent = name;
  chip.title = `${t('workspacesSection')} : ${name}`;
}

// Applique un nouvel état des espaces partout : chip, dock, conversations.
async function applyWorkspaceState(state, opts = {}) {
  workspaces = state;
  await reload();
  updateWsChip();
  renderWsSettingsList();
  renderBattleServices();
  if (opts.sheet) renderWsSheet();
}

// Sheet de bascule rapide (ouvert par la chip de l'écran Chats).
function renderWsSheet() {
  const body = $('#ws-sheet-body');
  body.innerHTML = '';
  const add = (label, active, action, danger) => {
    const btn = document.createElement('button');
    btn.className = 'ws-sheet-btn' + (active ? ' on' : '') + (danger ? ' danger' : '');
    btn.textContent = label;
    btn.addEventListener('click', async () => {
      closeSheets();
      await action();
    });
    body.appendChild(btn);
  };
  add(t('allServices'), workspaces.active === 'all', () => applyWorkspaceState(api.workspacesActivate('all')));
  for (const ws of workspaces.list) {
    add(ws.name, workspaces.active === ws.id, () => applyWorkspaceState(api.workspacesActivate(ws.id)));
  }
  add(t('manageWorkspaces'), false, () => showScreen('settings'));
}

$('#ws-chip').addEventListener('click', () => {
  renderWsSheet();
  openSheet('#sheet-workspaces');
});

// Réglages : liste des espaces (activer / supprimer) + création.
function renderWsSettingsList() {
  const listEl = $('#ws-settings-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  for (const ws of workspaces.list) {
    const row = document.createElement('div');
    row.className = 'ws-settings-row';
    const name = document.createElement('button');
    name.className = 'ws-name' + (workspaces.active === ws.id ? ' on' : '');
    name.textContent = ws.name;
    name.addEventListener('click', async () => {
      await applyWorkspaceState(await api.workspacesActivate(ws.id));
      toast(t('workspacesSection') + ' : ' + ws.name);
    });
    row.appendChild(name);
    const del = document.createElement('button');
    del.className = 'ws-del';
    del.textContent = '×';
    del.title = t('deleteWorkspace');
    del.addEventListener('click', async () => {
      await applyWorkspaceState(await api.workspacesDelete(ws.id));
    });
    row.appendChild(del);
    listEl.appendChild(row);
  }
}

$('#ws-create').addEventListener('click', async () => {
  const name = $('#ws-new-name').value.trim();
  if (!name) {
    $('#ws-new-name').focus();
    return;
  }
  // Le nouvel espace démarre avec les services actifs (visibles) actuels.
  await applyWorkspaceState(await api.workspacesCreate(name, visibleServices().map((s) => s.id)));
  $('#ws-new-name').value = '';
  toast(t('workspaceCreated'));
});

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
  const visible = new Set(visibleServices().map((s) => s.id));
  for (const svc of services) {
    if (!svc.enabled || !visible.has(svc.id)) continue;
    const entries = serviceEntries(svc, q);
    if (entries.length > 0) byService.set(svc.id, entries);
  }
  return byService;
}

function fmtDate(ts) {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString(i18nLocale(), { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(i18nLocale(), { day: 'numeric', month: 'short' });
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
      ? t('mobileEmptyHistory')
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
      more.innerHTML = `<span>${t('mobileSeeMore', { n: rest.length - CHATS_PER_SERVICE })}</span>${SVG.chevron}`;
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
    entries.length + ' ' + t(entries.length > 1 ? 'mobileConversations' : 'mobileConversation');
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
    { label: t('mobileOpen'), action: () => openWebView(svc, entry.url) },
    { label: entry.pinned ? t('entryUnpin') : t('entryPin'), action: () =>
      done(() => api.setPinned(svc.id, entry.url, !entry.pinned)) },
  ];
  if (!opts.fromSheet) {
    items.push({ label: t('entryRename'), action: () => startRename(svc, entry) });
  }
  items.push({ label: t('mobileRemoveHistory'), danger: true, action: () =>
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
  const active = visibleServices();
  dock.classList.toggle('hidden', active.length === 0);
  dock.innerHTML = '';
  for (const svc of active) {
    const btn = document.createElement('button');
    btn.className = 'dock-btn';
    btn.dataset.svcId = svc.id;
    btn.title = svc.name;
    btn.setAttribute('aria-label', t('mobileOpen') + ' ' + svc.name);
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
      toast(t('mobileOrderToast'));
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
    list.innerHTML = `<p class="empty-hint">${t('mobileEmptyServices')}</p>`;
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
  const items = [
    { label: t('mobileOpen'), action: () => openWebView(svc, svc.url) },
    { label: svc.enabled ? t('mobileDisable') : t('mobileEnable'), action: async () => {
      await api.updateService(svc.id, { enabled: !svc.enabled });
      await reload();
    } },
  ];
  // Appartenance aux espaces (✓ = membre) : un item par espace.
  for (const ws of workspaces.list) {
    const member = ws.services.includes(svc.id);
    items.push({
      label: (member ? '✓ ' : '') + ws.name,
      action: async () => {
        await applyWorkspaceState(await api.workspacesToggleService(ws.id, svc.id, !member));
      },
    });
  }
  items.push({ label: t('mobileDelete'), danger: true, action: () =>
    openMenu(svc.name, [
      { label: t('removeDeleteSession'), danger: true, action: () => removeService(svc, true) },
      { label: t('mobileDeleteKeepSession'), action: () => removeService(svc, false) },
      { label: t('cancel'), action: () => {} },
    ]) });
  openMenu(svc.name, items);
}

async function removeService(svc, dropSession) {
  if (dropSession) await webviews.clearSession(svc.url); // cookies + stockage du domaine
  await webviews.destroy(svc.id); // la WebView éventuelle du service
  await api.removeService(svc.id);
  await api.removeServiceHistory(svc.id);
  toast(t(dropSession ? 'mobileDeletedDC' : 'mobileDeletedKeep', { name: svc.name }));
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
    toast(t('mobileAddedToast', { name: entry.name }));
  } else {
    await api.updateService(svc.id, { enabled: !svc.enabled });
  }
  await reload();
  renderCatalog();
}

// --- Wizard « Ajouter par URL » ---

let wizardDraft = null;

function openWizard() {
  $('#wizard-title').textContent = t('wizardTitleAdd');
  $('#wizard-step-url').classList.remove('hidden');
  $('#wizard-step-confirm').classList.add('hidden');
  $('#wizard-error').classList.add('hidden');
  $('#svc-url').value = '';
  $('#wizard-next').textContent = t('wizardAnalyze');
  openSheet('#sheet-wizard');
}

$('#wizard-next').addEventListener('click', async () => {
  const err = $('#wizard-error');
  err.classList.add('hidden');
  if ($('#wizard-step-confirm').classList.contains('hidden')) {
    try {
      wizardDraft = await api.analyzeUrl($('#svc-url').value);
    } catch {
      err.textContent = t('wizardUrlInvalid');
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
    $('#wizard-next').textContent = t('wizardSaveAdd');
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
  toast(t('mobileAddedToast', { name: svc.name }));
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
    : `<span>${escapeHtml(svc.name)} — ${escapeHtml(url)}<br><br>${t('mobileWebViewNote')}</span>`;
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

// --- Battle d'IA : prompt saisi dans UniChat, copié vers le presse-papiers
// de chaque IA choisie, une par une. « Suivante » dans la barre de la vue
// copie et bascule ; un service sélectionné = relais simple. Zéro sélecteur
// de site : le prompt n'est jamais lu depuis les pages.

const RELAY_KEY = 'unichat.relay.prompt';
const PROMPTS_KEY = 'unichat.relay.prompts';
let battleSel = new Set(); // ids des IA participantes
let battle = null; // { services: [svc…], idx, prompt }

function savedPrompts() {
  try {
    const v = JSON.parse(localStorage.getItem(PROMPTS_KEY));
    return Array.isArray(v) ? v.filter((p) => typeof p === 'string' && p) : [];
  } catch {
    return [];
  }
}

function renderBattleChips() {
  const wrap = $('#battle-prompt-chips');
  wrap.innerHTML = '';
  for (const text of savedPrompts()) {
    const chip = document.createElement('button');
    chip.className = 'prompt-chip';
    chip.type = 'button';
    chip.innerHTML = `<span class="chip-label">${escapeHtml(text.length > 36 ? text.slice(0, 36) + '…' : text)}</span><span class="chip-x">×</span>`;
    chip.querySelector('.chip-x').addEventListener('click', (ev) => {
      ev.stopPropagation();
      localStorage.setItem(PROMPTS_KEY, JSON.stringify(savedPrompts().filter((p) => p !== text)));
      renderBattleChips();
    });
    chip.addEventListener('click', () => {
      $('#battle-text').value = text;
      localStorage.setItem(RELAY_KEY, text);
    });
    wrap.appendChild(chip);
  }
}

function renderBattleServices() {
  const listEl = $('#battle-svc-list');
  listEl.innerHTML = '';
  for (const svc of visibleServices()) {
    const on = battleSel.has(svc.id);
    const btn = document.createElement('button');
    btn.className = 'cat-entry battle-svc' + (on ? ' selected' : '');
    btn.innerHTML = `
      ${logoHtml(svc, 'cat-fallback')}
      <span class="cat-name">${escapeHtml(svc.name)}</span>
      <span class="cat-check">${on ? SVG.check : ''}</span>`;
    btn.addEventListener('click', () => {
      if (battleSel.has(svc.id)) battleSel.delete(svc.id);
      else battleSel.add(svc.id);
      renderBattleServices();
    });
    listEl.appendChild(btn);
  }
  const n = battleSel.size;
  const btn = $('#battle-start');
  btn.textContent = n <= 1 ? t('relayRelay') : t('relayBattle', { n });
  btn.disabled = n === 0;
}

function openBattleSheet() {
  $('#battle-text').value = localStorage.getItem(RELAY_KEY) || '';
  battleSel = new Set(visibleServices().map((s) => s.id));
  renderBattleChips();
  renderBattleServices();
  openSheet('#sheet-battle');
}

function saveBattlePrompt() {
  const text = $('#battle-text').value.trim();
  if (!text) return;
  localStorage.setItem(PROMPTS_KEY, JSON.stringify([text, ...savedPrompts().filter((p) => p !== text)].slice(0, 12)));
  renderBattleChips();
  toast(t('promptSaved'));
}

async function battleStep() {
  const svc = battle.services[battle.idx];
  const copied = await webviews.copyText(battle.prompt);
  const next = $('#battle-next');
  const last = battle.idx === battle.services.length - 1;
  next.textContent = last ? t('mobileBattleFinish') : t('mobileBattleNext', { i: battle.idx + 1, n: battle.services.length });
  next.classList.remove('hidden');
  openWebView(svc, svc.url);
  toast(copied
    ? t('mobileBattleCopied', { name: svc.name })
    : t('mobileBattleCopyFail', { name: svc.name }));
}

async function battleStart() {
  const text = $('#battle-text').value.trim();
  if (!text) {
    $('#battle-text').focus();
    return;
  }
  const list = services.filter((s) => s.enabled && battleSel.has(s.id));
  if (list.length === 0) return;
  localStorage.setItem(RELAY_KEY, text);
  battle = { services: list, idx: 0, prompt: text };
  closeSheets();
  await battleStep();
}

async function battleNext() {
  if (!battle) return;
  if (battle.idx >= battle.services.length - 1) {
    battle = null;
    $('#battle-next').classList.add('hidden');
    toast(t('battleDoneToast'));
    return;
  }
  battle.idx += 1;
  await battleStep();
}

$('#battle-open').addEventListener('click', () => { closeSheets(); openBattleSheet(); });
$('#battle-prompt-save').addEventListener('click', saveBattlePrompt);

// Joindre un fichier au prompt : lecture locale (128 Ko max, tronqué
// au-delà), ajouté sous le texte saisi.
$('#battle-attach').addEventListener('click', () => $('#attach-file').click());
$('#attach-file').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const raw = await file.text();
    if (!raw.trim()) {
      toast(t('attachEmpty'));
      return;
    }
    const MAX = 128 * 1024;
    const truncated = raw.length > MAX;
    const ta = $('#battle-text');
    ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n' : '') + (truncated ? raw.slice(0, MAX) : raw);
    localStorage.setItem(RELAY_KEY, ta.value);
    toast(truncated ? t('attachTruncated') : t('promptSaved'));
  } catch {
    toast(t('attachEmpty'));
  }
});
$('#battle-start').addEventListener('click', battleStart);
$('#battle-next').addEventListener('click', battleNext);

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

// Langue de l'interface : le rechargement retraduit tout d'un coup
// (statique et dynamique) — un changement de langue est rare.
document.querySelectorAll('#lang-row .lang-opt').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const applied = await api.setLang(btn.dataset.lang);
    if (applied) window.location.reload();
  })
);

// Rétention de l'historique : purge au prochain chargement.
document.querySelectorAll('#retention-row .retention-opt').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const applied = await api.setRetention(parseInt(btn.dataset.days, 10));
    if (applied !== null) {
      document.querySelectorAll('#retention-row .retention-opt').forEach((b) => {
        b.classList.toggle('on', parseInt(b.dataset.days, 10) === applied);
      });
      await reload();
    }
  })
);

$('#export-registry').addEventListener('click', async () => {
  const json = JSON.stringify(services, null, 2);
  // Phase 4 : share sheet Android. En attendant : presse-papiers.
  try {
    await navigator.clipboard.writeText(json);
    toast(t('mobileRegistryCopied', { n: services.length }));
  } catch {
    toast(t('mobileRegistryShareHint', { n: services.length }));
  }
});

$('#import-registry').addEventListener('click', () => $('#import-file').click());

// --- Profil multi-appareil : export par le partage Android, import via
// le sélecteur de fichier (détecte profil OU simple registre). ---

$('#profile-export').addEventListener('click', async () => {
  const data = await api.exportProfile();
  const json = JSON.stringify(data);
  // Partage Android (texte — le JSON fait quelques Ko) ; replis :
  // presse-papiers, puis message d'aide.
  if (navigator.share) {
    try {
      await navigator.share({ title: 'UniChat — profile.json', text: json });
      toast(t('profileExported'));
      return;
    } catch {
      // partage annulé : on tente le presse-papiers
    }
  }
  try {
    await navigator.clipboard.writeText(json);
    toast(t('profileExported'));
  } catch {
    toast(t('mobileRegistryCopied', { n: data.services.length }));
  }
});

$('#profile-import').addEventListener('click', () => $('#import-file').click());

$('#import-file').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    // Profil complet (multi-appareil) ou simple registre : les deux passent.
    if (isProfile(parsed)) {
      const stats = await api.importProfile(parsed);
      if (!stats) {
        toast(t('profileInvalid'));
        return;
      }
      await reload();
      toast(t('profileImported', { services: stats.servicesAdded, history: stats.historyMerged }));
      return;
    }
    const added = await api.importRegistry(parsed);
    toast(added > 0 ? t('registryImportAdded', { n: added }) : t('mobileImportNone'));
    await reload();
  } catch {
    toast(t('mobileImportInvalid'));
  }
});

// --- Boucle centrale ---

async function reload() {
  await api.purgeOldHistory(); // rétention « Historique » (0 = illimité)
  services = await api.getServices();
  history = await api.getHistory();
  workspaces = await api.getWorkspaces();
  renderChats();
  renderServices();
  renderDock();
  updateWsChip();
  renderWsSettingsList();
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
  // i18n : langue résolue AVANT tout rendu (catalogue, onboarding inclus).
  const langSetting = await api.getLang();
  setI18nLang(resolveLang(langSetting, navigator.language));
  applyI18n();
  document.querySelectorAll('#lang-row .lang-opt').forEach((b) => {
    b.classList.toggle('on', b.dataset.lang === langSetting);
  });
  workspaces = await api.getWorkspaces();
  updateWsChip();
  const retention = await api.getRetention();
  document.querySelectorAll('#retention-row .retention-opt').forEach((b) => {
    b.classList.toggle('on', parseInt(b.dataset.days, 10) === retention);
  });
  await applyTheme(await api.getTheme());
  await reload();
  showScreen('chats');
  // Onboarding : registre vide au premier lancement → catalogue.
  if (services.length === 0) {
    renderCatalog();
    openSheet('#sheet-catalog');
  }
})();
