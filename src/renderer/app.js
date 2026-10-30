// app.js — UI UniChat : sidebar agrégée (services + historique de titres),
// wizard « Ajouter un service », thème par service, recherche, raccourcis.

const api = window.unichat;
// i18n : le dictionnaire vit dans src/shared (partagé avec le mobile),
// exposé par le preload. t('clé', {var}) interpole {var}.
const t = (key, vars) => api.t(key, vars);

// Applique la langue courante aux textes statiques du DOM (data-i18n,
// data-i18n-placeholder, data-i18n-title) et à <html lang>.
function applyI18n() {
  document.documentElement.lang = api.i18nLocale ? api.i18nLocale().slice(0, 2) : 'fr';
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

let services = [];
let history = [];
let activeServiceId = null;
let searchTerm = '';
let analysis = null; // résultat du wizard en cours
let wizardMode = 'add'; // 'add' | 'edit'
let editServiceId = null;
let editService = null; // service en cours d'édition (pour la duplication)
let wizardLogoOriginal = ''; // logo affiché à l'ouverture (base de customLogo)
let wizardCustomOriginal = false; // drapeau customLogo à l'ouverture (édition)
let currentUrl = ''; // URL courante de la vue active
let pendingRemoveId = null;
let catalogEntries = [];

const $ = (sel) => document.querySelector(sel);

// Icônes SVG inline (style « stroke », aucun glyph texte : la police du
// système ne les rend pas tous).
const ICONS = {
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pin: '<line x1="12" y1="17" x2="12" y2="22"/><path d="M8 3h8v4l2 4H6l2-4V3z"/>',
  'theme-system':
    '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  'theme-light':
    '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  'theme-dark': '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
};

function svg(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    ICONS[name] +
    '</svg>';
  return span;
}

// Même origine (protocole + hôte) : un service avec paramètres d'URL reste
// la même entrée que celle du catalogue.
function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

// --- Données ---

async function refreshServices() {
  services = await api.getServices();
  render();
}

function refreshHistory(entries) {
  history = entries;
  render();
}

// --- Rendu ---

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return t('timeNow');
  if (s < 3600) return t('timeMin', { n: Math.floor(s / 60) });
  if (s < 86400) return t('timeHour', { n: Math.floor(s / 3600) });
  if (s < 604800) return t('timeDay', { n: Math.floor(s / 86400) });
  return new Date(ts).toLocaleDateString(api.i18nLocale(), { day: 'numeric', month: 'short' });
}

// Logo local du catalogue par origine : les services enregistrés avant le
// passage aux assets locaux peuvent avoir une URL distante en échec.
function catalogLogoFor(url) {
  const entry = catalogEntries.find((c) => sameOrigin(c.url, url));
  return entry ? entry.logo : null;
}

function serviceLogo(svc) {
  // Le logo choisi dans la modal ✎ (URL ou fichier importé) prime sur le
  // logo du catalogue ; sinon l'asset local du catalogue est préféré à une
  // favicon distante éventuellement morte.
  const src =
    svc.customLogo && svc.logo ? svc.logo : catalogLogoFor(svc.url) || svc.logo;
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.onerror = () => img.replaceWith(fallbackDot(svc));
    return img;
  }
  return fallbackDot(svc);
}

function fallbackDot(svc) {
  const span = document.createElement('span');
  span.className = 'svc-fallback';
  return span;
}

function matchesSearch(title) {
  return !searchTerm || title.toLowerCase().includes(searchTerm);
}

function render() {
  const list = $('#service-list');
  list.innerHTML = '';

  const visible = services.filter((s) => s.enabled !== false);
  for (const svc of visible) {
    const group = document.createElement('div');
    group.className = 'svc-group';

    const header = document.createElement('button');
    header.className = 'svc-header' + (svc.id === activeServiceId ? ' active' : '');
    header.title = svc.name + ' — ' + svc.url;

    header.appendChild(serviceLogo(svc));
    const name = document.createElement('span');
    name.className = 'svc-name';
    name.textContent = svc.name;
    header.appendChild(name);

    const edit = document.createElement('button');
    edit.className = 'svc-edit';
    edit.title = t('editService');
    edit.appendChild(svg('edit'));
    edit.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openEdit(svc);
    });
    header.appendChild(edit);

    const remove = document.createElement('button');
    remove.className = 'svc-remove';
    remove.appendChild(svg('x'));
    remove.title = t('removeServiceTitle');
    remove.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openRemove(svc);
    });
    header.appendChild(remove);

    header.addEventListener('click', (ev) => {
      // Ctrl/Cmd+clic : service affiché en moitié droite (écran partagé).
      // Un second Ctrl+clic sur le même service referme l'écran partagé.
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        setSplit(splitServiceId === svc.id ? null : svc.id);
        return;
      }
      activeServiceId = svc.id;
      // Le service secondaire devient principal : écran partagé refermé
      // (le main fait de même dans showService).
      if (splitServiceId === svc.id) splitServiceId = null;
      updateSplitButton();
      api.showService(svc.id);
      render();
    });
    group.appendChild(header);

    // Entrées épinglées en tête du groupe (tri stable : l'ordre updatedAt
    // descendant de listAll est conservé au sein de chaque sous-ensemble).
    const entries = history
      .filter((e) => e.serviceId === svc.id && matchesSearch(e.title))
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    for (const entry of entries.slice(0, 30)) {
      const btn = document.createElement('button');
      btn.className = 'chat-entry' + (entry.pinned ? ' pinned' : '');
      btn.title = entry.title;
      btn.dataset.historyUrl = entry.url;

      const dot = document.createElement('span');
      dot.className = 'dot';
      btn.appendChild(dot);

      const title = document.createElement('span');
      title.className = 'chat-title';
      title.textContent = entry.title;
      btn.appendChild(title);

      if (entry.pinned) {
        const pinIcon = svg('pin');
        pinIcon.classList.add('pin-icon');
        pinIcon.title = t('pinned');
        btn.appendChild(pinIcon);
      }

      const date = document.createElement('span');
      date.className = 'chat-date';
      date.textContent = timeAgo(entry.updatedAt);
      btn.appendChild(date);

      btn.addEventListener('click', () => {
        activeServiceId = svc.id;
        api.navigate(svc.id, entry.url);
        render();
      });

      // Clic droit : renommer (titre manuel) ou retirer de la liste.
      // Le menu reste dans la sidebar : jamais caché sous les WebContentsView.
      btn.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        closeEntryMenu();
        openEntryMenu(entry, ev.clientX, ev.clientY);
      });

      group.appendChild(btn);
    }

    list.appendChild(group);
  }
}

// Barre d'adresse : URL courante de la vue active, sinon la racine du service.
function updateAddressBar() {
  const svc = services.find((s) => s.id === activeServiceId);
  const shown = currentUrl || (svc ? svc.url : '');
  const el = $('#active-url');
  el.textContent = shown;
  el.title = shown;
}

function applyTheme(svc) {
  const root = document.documentElement;
  root.style.setProperty('--accent', svc ? svc.accent : '#6c5ce7');
  root.style.setProperty('--accent2', svc ? svc.accent2 : '#a29bfe');
  updateAddressBar();
}

// --- Catalogue : onboarding au premier lancement, gestion ensuite ---

function isEnabled(url) {
  const svc = services.find((s) => sameOrigin(s.url, url));
  return !!svc && svc.enabled !== false;
}

function renderCatalog() {
  const listEl = $('#catalog-list');
  listEl.innerHTML = '';

  // Services personnalisés (ajoutés via le wizard) d'abord, puis le catalogue.
  // Correspondance par origine : pas de doublon si les URL diffèrent par
  // un paramètre (ex. Euria ?ksuite-mode=main).
  const custom = services
    .filter((s) => !catalogEntries.some((c) => sameOrigin(c.url, s.url)))
    .map((s) => ({ name: s.name, url: s.url, accent: s.accent, logo: s.logo, custom: true }));
  const entries = [...custom, ...catalogEntries];

  for (const entry of entries) {
    const btn = document.createElement('button');
    btn.className = 'cat-entry' + (isEnabled(entry.url) ? ' enabled' : '');
    btn.title = entry.url;

    if (entry.logo) {
      const img = document.createElement('img');
      img.src = entry.logo;
      img.alt = '';
      img.onerror = () => {
        const fb = document.createElement('span');
        fb.className = 'cat-fallback';
        fb.style.background = entry.accent || '#6c5ce7';
        img.replaceWith(fb);
      };
      btn.appendChild(img);
    } else {
      const fb = document.createElement('span');
      fb.className = 'cat-fallback';
      fb.style.background = entry.accent || '#6c5ce7';
      btn.appendChild(fb);
    }

    const name = document.createElement('span');
    name.className = 'cat-name';
    name.textContent = entry.name;
    btn.appendChild(name);

    if (entry.custom) {
      const tag = document.createElement('span');
      tag.className = 'cat-custom';
      tag.textContent = 'perso';
      btn.appendChild(tag);
    }

    const check = document.createElement('span');
    check.className = 'cat-check';
    check.appendChild(svg(isEnabled(entry.url) ? 'check' : 'plus'));
    btn.appendChild(check);

    btn.addEventListener('click', async () => {
      const res = await api.setServiceEnabled(entry.url, !isEnabled(entry.url));
      if (res.ok) {
        services = await api.getServices();
        render();
        renderCatalog();
      }
    });
    listEl.appendChild(btn);
  }
}

function openCatalog(onboarding) {
  $('#catalog-title').textContent = onboarding ? t('catalogTitleOnboard') : t('catalogTitleManage');
  $('#catalog-sub').textContent = onboarding ? t('catalogSubOnboard') : t('catalogSubManage');
  renderCatalog();
  $('#catalog-overlay').classList.remove('hidden');
  api.setModalOpen(true);
}

function closeCatalog() {
  $('#catalog-overlay').classList.add('hidden');
  api.setModalOpen(false);
}

// --- Wizard ---

function setEditFieldsVisible(visible) {
  document.querySelectorAll('.edit-only').forEach((el) => {
    el.classList.toggle('hidden', !visible);
  });
}

function openWizard() {
  wizardMode = 'add';
  editServiceId = null;
  analysis = null;
  setEditFieldsVisible(false);
  api.setModalOpen(true);
  $('#wizard-title').textContent = t('wizardTitleAdd');
  $('#wizard-save').textContent = t('wizardSaveAdd');
  $('#svc-url').value = '';
  $('#svc-logo-url').value = '';
  wizardLogoOriginal = '';
  wizardCustomOriginal = false;
  $('#wizard-error').classList.add('hidden');
  $('#wizard-step-url').classList.remove('hidden');
  $('#wizard-step-confirm').classList.add('hidden');
  $('#wizard-overlay').classList.remove('hidden');
  $('#svc-url').focus();
}

// Édition : mêmes champs que le wizard, sans ré-analyser. L'URL reste modifiable :
// la session vit dans la partition persist:<id>, pas dans l'URL.
function openEdit(svc) {
  wizardMode = 'edit';
  editServiceId = svc.id;
  editService = svc;
  analysis = { url: svc.url };
  setEditFieldsVisible(true);
  $('#wizard-title').textContent = t('wizardTitleEdit');
  $('#wizard-save').textContent = t('wizardSaveEdit');
  $('#svc-name').value = svc.name;
  $('#svc-logo').src = svc.logo || '';
  $('#svc-logo-url').value = svc.logo || '';
  wizardLogoOriginal = svc.logo || '';
  wizardCustomOriginal = !!svc.customLogo;
  $('#svc-name-preview').textContent = svc.name;
  $('#svc-accent').value = normalizeColor(svc.accent);
  $('#svc-accent2').value = normalizeColor(svc.accent2);
  $('#svc-url-edit').value = svc.url;
  $('#svc-exclude').value = svc.excludeRegex || '';
  $('#svc-blocknav').value = svc.blockNavRegex || '';
  $('#wizard-error').classList.add('hidden');
  $('#wizard-step-url').classList.add('hidden');
  $('#wizard-step-confirm').classList.remove('hidden');
  $('#wizard-overlay').classList.remove('hidden');
  api.setModalOpen(true);
  $('#svc-name').focus();
}

function closeWizard() {
  $('#wizard-overlay').classList.add('hidden');
  api.setModalOpen(false);
}

async function analyze() {
  const url = $('#svc-url').value.trim();
  const btn = $('#wizard-analyze');
  const err = $('#wizard-error');
  if (!url) return;
  btn.disabled = true;
  err.classList.add('hidden');
  try {
    analysis = await api.analyzeUrl(url);
    $('#svc-name').value = analysis.name;
    $('#svc-logo').src = analysis.faviconUrl || '';
    $('#svc-logo-url').value = analysis.faviconUrl || '';
    wizardLogoOriginal = analysis.faviconUrl || '';
    $('#svc-accent').value = normalizeColor(analysis.accent);
    $('#svc-accent2').value = normalizeColor(analysis.accent2);
    $('#svc-name-preview').textContent = analysis.name;
    $('#wizard-step-url').classList.add('hidden');
    $('#wizard-step-confirm').classList.remove('hidden');
  } catch (e) {
    err.textContent = t('wizardAnalyzeError', { error: e.message || e });
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

function normalizeColor(c) {
  if (!c) return '#6c5ce7';
  const s = String(c).trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return ('#' + s.slice(1).split('').map((h) => h + h).join('')).toLowerCase();
  }
  const m = s.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (m) {
    const hex = (n) => parseInt(n, 10).toString(16).padStart(2, '0');
    return ('#' + hex(m[1]) + hex(m[2]) + hex(m[3])).toLowerCase();
  }
  return '#6c5ce7';
}

async function saveService() {
  if (!analysis) return;
  const logo = $('#svc-logo-url').value.trim() || null;
  const data = {
    name: $('#svc-name').value.trim() || analysis.name,
    logo,
    // customLogo : seulement si l'utilisateur a changé le logo affiché (URL
    // saisie, favicon modifiée ou fichier importé). Sinon le logo du
    // catalogue reste prioritaire (asset local, marche hors ligne).
    customLogo: !logo ? false : logo !== wizardLogoOriginal || wizardCustomOriginal === true,
    accent: $('#svc-accent').value,
    accent2: $('#svc-accent2').value,
  };
  if (wizardMode === 'edit') {
    data.url = $('#svc-url-edit').value.trim() || analysis.url;
    data.excludeRegex = $('#svc-exclude').value.trim() || null;
    data.blockNavRegex = $('#svc-blocknav').value.trim() || null;
    await api.updateService(editServiceId, data);
  } else {
    await api.addService({ ...data, url: analysis.url });
  }
  closeWizard();
}

// --- Suppression (avec choix session conservée / déconnectée) ---

function openRemove(svc) {
  pendingRemoveId = svc.id;
  $('#remove-title').textContent = t('removeConfirm', { name: svc.name });
  $('#remove-overlay').classList.remove('hidden');
  api.setModalOpen(true);
}

function closeRemove() {
  $('#remove-overlay').classList.add('hidden');
  api.setModalOpen(false);
  pendingRemoveId = null;
}

// --- Export / import du registre ---

async function exportRegistry() {
  const res = await api.exportRegistry();
  if (res.ok) return;
  if (!res.canceled) toast(t('registryExportError', { error: res.error || '…' }));
}

async function importRegistry() {
  const res = await api.importRegistry();
  if (res.ok) {
    if (res.added > 0) toast(t('registryImportAdded', { n: res.added }));
    else toast(t('registryImportNone'));
  } else if (!res.canceled) {
    toast(t('registryImportError', { error: res.error || '…' }));
  }
}

// --- Historique : menu contextuel + renommage inline ---

let entryMenu = null;

function closeEntryMenu() {
  if (entryMenu) {
    entryMenu.remove();
    entryMenu = null;
  }
}

function openEntryMenu(entry, x, y) {
  closeEntryMenu();
  entryMenu = document.createElement('div');
  entryMenu.className = 'entry-menu';

  const pinBtn = document.createElement('button');
  pinBtn.textContent = entry.pinned ? t('entryUnpin') : t('entryPin');
  pinBtn.addEventListener('click', () => {
    closeEntryMenu();
    api.setPinnedHistoryEntry(entry.serviceId, entry.url, !entry.pinned);
  });
  entryMenu.appendChild(pinBtn);

  const rename = document.createElement('button');
  rename.textContent = t('entryRename');
  rename.addEventListener('click', () => {
    closeEntryMenu();
    startRename(entry);
  });
  entryMenu.appendChild(rename);

  const removeBtn = document.createElement('button');
  removeBtn.textContent = t('entryRemove');
  removeBtn.className = 'danger';
  removeBtn.addEventListener('click', () => {
    closeEntryMenu();
    api.removeHistoryEntry(entry.serviceId, entry.url);
  });
  entryMenu.appendChild(removeBtn);

  document.body.appendChild(entryMenu);
  // Clamp dans la sidebar (les WebContentsView commencent à sa droite).
  const sb = $('#sidebar').getBoundingClientRect();
  const rect = entryMenu.getBoundingClientRect();
  entryMenu.style.left = Math.max(4, Math.min(x, sb.right - rect.width - 6)) + 'px';
  entryMenu.style.top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 6)) + 'px';
}

// Retrouve le bouton vivant dans la liste (un render() a pu reconstruire
// le DOM entre l'ouverture du menu et le clic sur « Renommer »).
function findEntryBtn(entry) {
  return [...document.querySelectorAll('.chat-entry')].find(
    (b) => b.dataset.historyUrl === entry.url
  );
}

function startRename(entry) {
  const btn = findEntryBtn(entry);
  if (!btn) return;
  const input = document.createElement('input');
  input.className = 'chat-rename';
  input.value = entry.title;
  btn.querySelector('.chat-title').replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    if (save && value && value !== entry.title) {
      api.renameHistoryEntry(entry.serviceId, entry.url, value);
    } else {
      render();
    }
  };

  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

// --- Relais / Battle : prompt UniChat → services choisis ---

// Le prompt vit dans UniChat (jamais lu depuis les sites, E2EE respecté) et
// est mémorisé localement pour survivre à la fermeture de la modal.
// Battle : le même prompt est relayé vers plusieurs IA, une par une — la
// barre #battle-bar (dans la sidebar, jamais cachée sous les vues) copie
// et enchaîne. Avec une seule IA sélectionnée, c'est le relais classique.
const RELAY_KEY = 'unichat.relay.prompt';
const PROMPTS_KEY = 'unichat.relay.prompts';
let toastTimer = null;
let relaySelected = new Set(); // ids des services choisis
let battle = null; // { services: [svc…], idx, prompt }

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4500);
}

// Bibliothèque de prompts : mémorisés localement, cliquables en un clic.

function savedPrompts() {
  try {
    const v = JSON.parse(localStorage.getItem(PROMPTS_KEY));
    return Array.isArray(v) ? v.filter((p) => typeof p === 'string' && p) : [];
  } catch {
    return [];
  }
}

function savePrompt() {
  const text = $('#relay-text').value.trim();
  if (!text) {
    $('#relay-text').focus();
    return;
  }
  const list = [text, ...savedPrompts().filter((p) => p !== text)].slice(0, 12);
  localStorage.setItem(PROMPTS_KEY, JSON.stringify(list));
  renderPromptChips();
  toast(t('promptSaved'));
}

function renderPromptChips() {
  const wrap = $('#relay-prompt-chips');
  wrap.replaceChildren();
  for (const text of savedPrompts()) {
    const chip = document.createElement('button');
    chip.className = 'prompt-chip';
    chip.type = 'button';
    chip.title = text;

    const label = document.createElement('span');
    label.className = 'chip-label';
    label.textContent = text.length > 40 ? text.slice(0, 40) + '…' : text;
    chip.appendChild(label);

    const del = document.createElement('span');
    del.className = 'chip-x';
    del.title = t('promptDelete');
    del.textContent = '×';
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      localStorage.setItem(PROMPTS_KEY, JSON.stringify(savedPrompts().filter((p) => p !== text)));
      renderPromptChips();
    });
    chip.appendChild(del);

    chip.addEventListener('click', () => {
      $('#relay-text').value = text;
      localStorage.setItem(RELAY_KEY, text);
    });
    wrap.appendChild(chip);
  }
}

function renderRelayList() {
  const listEl = $('#relay-list');
  listEl.innerHTML = '';
  const enabled = services.filter((s) => s.enabled !== false);
  for (const svc of enabled) {
    const selected = relaySelected.has(svc.id);
    const btn = document.createElement('button');
    btn.className = 'cat-entry relay-entry' + (selected ? ' selected' : '');
    btn.title = `${t('relayRelay')} → ${svc.name}`;

    btn.appendChild(serviceLogo(svc));
    const name = document.createElement('span');
    name.className = 'cat-name';
    name.textContent = svc.name;
    btn.appendChild(name);

    const check = document.createElement('span');
    check.className = 'cat-check';
    if (selected) check.appendChild(svg('check'));
    btn.appendChild(check);

    btn.addEventListener('click', () => {
      if (relaySelected.has(svc.id)) relaySelected.delete(svc.id);
      else relaySelected.add(svc.id);
      renderRelayList();
    });
    listEl.appendChild(btn);
  }
  updateRelayButton();
}

function updateRelayButton() {
  const n = relaySelected.size;
  const btn = $('#relay-battle');
  btn.textContent = n === 0 ? t('relayPick') : n === 1 ? t('relayRelay') : t('relayBattle', { n });
  btn.disabled = n === 0;
}

// Battle automatique : pour chaque IA — le prompt est copié dans le
// presse-papiers, collé dans le champ du site, puis Entrée est simulé pour
// l'envoyer. Dès que la page navigue (l'IA crée la conversation = message
// envoyé), l'IA suivante prend le relais — aucune action humaine. Repli :
// sans navigation après 10 s, on avance quand même (l'IA garde la main,
// le bouton ▶ force l'IA suivante).
let advanceTimer = null;
let advanceToken = 0;

function battleNext() {
  if (!battle) return;
  clearTimeout(advanceTimer);
  advanceToken += 1; // une étape à la fois, jamais deux avances en course
  api.armBattleAdvance(null); // désarme la détection d'envoi de l'étape
  if (battle.idx >= battle.services.length - 1) {
    battleStop();
    toast(t('battleDoneToast'));
    return;
  }
  battle.idx += 1;
  battleStep();
}

async function battleStep() {
  const token = ++advanceToken;
  const svc = battle.services[battle.idx];
  await api.relayCopy(battle.prompt);
  activeServiceId = svc.id;
  if (splitServiceId === svc.id) splitServiceId = null;
  updateSplitButton();
  api.showService(svc.id);
  render();
  const label = $('#battle-label');
  label.textContent = t('battleLabel', { i: battle.idx + 1, n: battle.services.length, name: svc.name });
  label.title = svc.name;
  $('#battle-next').title =
    battle.idx === battle.services.length - 1
      ? t('battleFinish')
      : t('battleNext', { name: battle.services[battle.idx + 1].name });
  $('#battle-bar').classList.remove('hidden');

  // Collage (400 ms : laisser la vue s'afficher), puis envoi (Entrée),
  // puis armement de la détection d'envoi.
  setTimeout(async () => {
    if (!battle || token !== advanceToken) return;
    await api.relayPaste(svc.id);
    if (!battle || token !== advanceToken) return;
    toast(t('battleStepToast', { name: svc.name }));
    setTimeout(async () => {
      if (!battle || token !== advanceToken) return;
      await api.relaySend(svc.id);
      if (!battle || token !== advanceToken) return;
      api.armBattleAdvance(svc.id);
      clearTimeout(advanceTimer);
      advanceTimer = setTimeout(() => {
        // Repli : l'IA n'a pas changé d'URL (SPA racine, envoi manuel,
        // Entrée sans effet) — on avance quand même après 10 s.
        if (battle && token === advanceToken) battleNext();
      }, 10000);
    }, 600);
  }, 400);
}

// L'IA courante a navigué = le message est envoyé : IA suivante.
api.onBattleAdvance(() => battleNext());

function battleStop() {
  clearTimeout(advanceTimer);
  advanceToken += 1;
  api.armBattleAdvance(null);
  battle = null;
  $('#battle-bar').classList.add('hidden');
}

async function startBattle() {
  const text = $('#relay-text').value.trim();
  if (!text) {
    $('#relay-text').focus();
    return;
  }
  const list = services.filter((s) => s.enabled !== false && relaySelected.has(s.id));
  if (list.length === 0) return;
  localStorage.setItem(RELAY_KEY, text);
  battle = { services: list, idx: 0, prompt: text };
  closeRelay();
  battleStep();
}

function openRelay() {
  $('#relay-text').value = localStorage.getItem(RELAY_KEY) || '';
  // Sélection par défaut : les services actifs, sauf sélection mémorisée
  // obsolète (service désactivé/supprimé depuis).
  const enabled = services.filter((s) => s.enabled !== false);
  for (const s of enabled) {
    if (!relaySelected.has(s.id)) relaySelected.add(s.id);
  }
  relaySelected = new Set([...relaySelected].filter((id) => enabled.some((s) => s.id === id)));
  renderPromptChips();
  renderRelayList();
  $('#relay-overlay').classList.remove('hidden');
  api.setModalOpen(true);
  $('#relay-text').focus();
}

function closeRelay() {
  $('#relay-overlay').classList.add('hidden');
  api.setModalOpen(false);
}

$('#relay-open').addEventListener('click', openRelay);
$('#relay-close').addEventListener('click', closeRelay);
$('#relay-overlay').addEventListener('click', (e) => {
  if (e.target === $('#relay-overlay')) closeRelay();
});
$('#relay-text').addEventListener('input', (e) => {
  localStorage.setItem(RELAY_KEY, e.target.value);
});
$('#relay-save-prompt').addEventListener('click', savePrompt);
$('#relay-battle').addEventListener('click', startBattle);
$('#battle-next').addEventListener('click', battleNext);
// Arrêt manuel : le battle s'arrête là, l'IA courante garde la main.
$('#battle-stop').addEventListener('click', battleStop);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#relay-overlay').classList.contains('hidden')) {
    closeRelay();
  }
});

// --- Thème clair / sombre : suit l'OS, ou forcé via un clic ---

// 'system' suit le réglage de l'ordinateur, 'light'/'dark' force.
// Appliqué côté process principal (nativeTheme.themeSource) : la sidebar
// ET les vues des services suivent, y compris leurs propres styles
// prefers-color-scheme.
const THEME_ORDER = ['system', 'light', 'dark'];
let appTheme = 'system';

function themeLabel(code) {
  return t('theme' + code.charAt(0).toUpperCase() + code.slice(1));
}

function updateThemeButton() {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(appTheme) + 1) % THEME_ORDER.length];
  const btn = $('#theme-toggle');
  btn.replaceChildren(svg('theme-' + appTheme));
  btn.title = t('themeButtonTitle', { current: themeLabel(appTheme), next: themeLabel(next).toLowerCase() });
}

$('#theme-toggle').addEventListener('click', async () => {
  const next = THEME_ORDER[(THEME_ORDER.indexOf(appTheme) + 1) % THEME_ORDER.length];
  const applied = await api.setTheme(next);
  if (applied) {
    appTheme = applied;
    updateThemeButton();
  }
});

// --- Sidebar réduite (rail d'icônes) ---

// L'état vit dans le process principal (settings.json) : layoutViews() en
// a besoin pour placer les WebContentsView à droite du rail.
let sidebarCollapsed = false;

function applySidebarCollapsed() {
  document.body.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  $('#sidebar-toggle').title = sidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse');
}

async function setSidebarCollapsed(collapsed) {
  sidebarCollapsed = collapsed === true;
  applySidebarCollapsed();
  await api.setSidebarCollapsed(sidebarCollapsed);
}

$('#sidebar-toggle').addEventListener('click', () => setSidebarCollapsed(!sidebarCollapsed));

// --- Écran partagé : deux IA côte à côte ---

// La moitié gauche est le service actif, la moitié droite splitServiceId.
// Ouverture : bouton de la sidebar (Ctrl/Cmd+E) puis Ctrl/clic sur un
// service pour choisir la droite ; le même Ctrl/clic la referme.
let splitServiceId = null;

async function setSplit(serviceId) {
  // Bascule ON sans service : premier service actif différent de l'actuel.
  if (serviceId === undefined) {
    const next = services.find((s) => s.enabled !== false && s.id !== activeServiceId);
    if (!next) {
      toast(t('splitNone'));
      return;
    }
    serviceId = next.id;
  }
  splitServiceId = await api.setSplit(serviceId);
  updateSplitButton();
  render();
}

function updateSplitButton() {
  const btn = $('#split-toggle');
  const on = splitServiceId !== null;
  btn.classList.toggle('active', on);
  btn.title = on ? t('splitTitleOn') : t('splitTitle');
}

$('#split-toggle').addEventListener('click', () => setSplit(splitServiceId === null ? undefined : null));

// --- Réglages : thème, langue, services, registre (bouton ⚙ du footer) ---

let languageSetting = 'system';

function openSettings() {
  updateSettingsRows();
  $('#settings-overlay').classList.remove('hidden');
  api.setModalOpen(true);
}

function closeSettings() {
  $('#settings-overlay').classList.add('hidden');
  api.setModalOpen(false);
}

function updateSettingsRows() {
  document.querySelectorAll('#theme-row .settings-opt').forEach((b) => {
    b.classList.toggle('on', b.dataset.theme === appTheme);
  });
  document.querySelectorAll('#lang-row .settings-opt').forEach((b) => {
    b.classList.toggle('on', b.dataset.lang === languageSetting);
  });
}

$('#settings-open').addEventListener('click', openSettings);
$('#settings-close').addEventListener('click', closeSettings);
$('#settings-overlay').addEventListener('click', (e) => {
  if (e.target === $('#settings-overlay')) closeSettings();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#settings-overlay').classList.contains('hidden')) closeSettings();
});

document.querySelectorAll('#theme-row .settings-opt').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const applied = await api.setTheme(btn.dataset.theme);
    if (applied) {
      appTheme = applied;
      updateThemeButton();
      updateSettingsRows();
    }
  });
});

document.querySelectorAll('#lang-row .settings-opt').forEach((btn) => {
  btn.addEventListener('click', async () => {
    // Le rechargement retraduit tout d'un coup (statique et dynamique) :
    // un changement de langue est rare, pas d'état résiduel toléré.
    const applied = await api.setLanguage(btn.dataset.lang);
    if (applied) window.location.reload();
  });
});

// --- Palette universelle : une recherche, tous les services ---

// Ctrl/Cmd+Tab : chercher une conversation (ou un service) parmi tous les
// services actifs et y aller d'une touche. C'est le geste qui fait
// disparaître la notion de « site » : on pense « une conversation ».
let paletteIndex = 0;

function paletteResults(query) {
  const q = (query || '').trim().toLowerCase();
  const svcById = new Map(services.map((s) => [s.id, s]));
  const convs = history
    .filter((e) => {
      const svc = svcById.get(e.serviceId);
      return svc && svc.enabled !== false;
    })
    .filter((e) => {
      if (!q) return true;
      const svc = svcById.get(e.serviceId);
      return e.title.toLowerCase().includes(q) || svc.name.toLowerCase().includes(q);
    })
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt)
    .slice(0, q ? 24 : 10)
    .map((e) => ({ kind: 'conv', svc: svcById.get(e.serviceId), entry: e }));
  // Un service qui matche par son nom : aller au service lui-même.
  const svcs = q
    ? services
        .filter((s) => s.enabled !== false && s.name.toLowerCase().includes(q))
        .map((s) => ({ kind: 'svc', svc: s }))
    : [];
  return [...convs, ...svcs];
}

function renderPalette() {
  const listEl = $('#palette-list');
  listEl.replaceChildren();
  const rows = paletteResults($('#palette-input').value);
  if (rows.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'palette-empty';
    empty.textContent = t('paletteEmpty');
    listEl.appendChild(empty);
    paletteIndex = 0;
    return;
  }
  if (paletteIndex >= rows.length) paletteIndex = 0;
  rows.forEach((row, i) => {
    const btn = document.createElement('button');
    btn.className = 'palette-row' + (i === paletteIndex ? ' selected' : '');
    btn.appendChild(serviceLogo(row.svc));
    const title = document.createElement('span');
    title.className = 'p-title';
    title.textContent = row.kind === 'conv' ? row.entry.title : row.svc.name;
    btn.appendChild(title);
    const meta = document.createElement('span');
    meta.className = 'p-meta';
    meta.textContent =
      row.kind === 'conv' ? `${row.svc.name} · ${timeAgo(row.entry.updatedAt)}` : t('paletteService');
    btn.appendChild(meta);
    btn.addEventListener('click', () => activatePalette(row));
    btn.addEventListener('mousemove', () => {
      if (paletteIndex !== i) {
        paletteIndex = i;
        highlightPalette();
      }
    });
    listEl.appendChild(btn);
  });
  const sel = listEl.querySelector('.palette-row.selected');
  if (sel && typeof sel.scrollIntoView === 'function') sel.scrollIntoView({ block: 'nearest' });
}

function highlightPalette() {
  const rows = [...$('#palette-list').querySelectorAll('.palette-row')];
  rows.forEach((r, i) => r.classList.toggle('selected', i === paletteIndex));
  const sel = rows[paletteIndex];
  if (sel && typeof sel.scrollIntoView === 'function') sel.scrollIntoView({ block: 'nearest' });
}

function activatePalette(row) {
  if (!row) return;
  closePalette();
  activeServiceId = row.svc.id;
  // La cible devient principale : l'écran partagé se referme si besoin
  // (le main fait de même dans showService).
  if (splitServiceId === row.svc.id) splitServiceId = null;
  updateSplitButton();
  if (row.kind === 'conv') api.navigate(row.svc.id, row.entry.url);
  else api.showService(row.svc.id);
  render();
}

function openPalette() {
  paletteIndex = 0;
  $('#palette-input').value = '';
  renderPalette();
  $('#palette-overlay').classList.remove('hidden');
  api.setModalOpen(true);
  $('#palette-input').focus();
}

function closePalette() {
  $('#palette-overlay').classList.add('hidden');
  api.setModalOpen(false);
}

function togglePalette() {
  if ($('#palette-overlay').classList.contains('hidden')) openPalette();
  else closePalette();
}

$('#palette-input').addEventListener('input', () => {
  paletteIndex = 0;
  renderPalette();
});
$('#palette-input').addEventListener('keydown', (e) => {
  const rows = paletteResults($('#palette-input').value);
  if (rows.length === 0) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    paletteIndex = (paletteIndex + 1) % rows.length;
    highlightPalette();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    paletteIndex = (paletteIndex - 1 + rows.length) % rows.length;
    highlightPalette();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    activatePalette(rows[paletteIndex]);
  }
});
$('#palette-overlay').addEventListener('click', (e) => {
  if (e.target === $('#palette-overlay')) closePalette();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#palette-overlay').classList.contains('hidden')) {
    closePalette();
  }
});

// --- Événements ---

$('#add-service').addEventListener('click', () => openCatalog(false));
$('#catalog-add-url').addEventListener('click', () => {
  // Service absent du catalogue : on retombe sur le wizard classique.
  closeCatalog();
  openWizard();
});
$('#wizard-cancel').addEventListener('click', closeWizard);
$('#wizard-analyze').addEventListener('click', analyze);
$('#svc-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') analyze();
});
$('#wizard-back').addEventListener('click', () => {
  $('#wizard-step-confirm').classList.add('hidden');
  $('#wizard-step-url').classList.remove('hidden');
});
$('#wizard-save').addEventListener('click', saveService);

// Multi-comptes : duplique le service édité — nouvelle entrée de registre,
// nouvel id, donc une NOUVELLE partition persist:<id> : connexion
// totalement indépendante (Le Chat perso + pro par exemple).
$('#wizard-duplicate').addEventListener('click', async () => {
  if (!editService) return;
  // Suffixe « (n) » : « (2) » pour la première copie, (3), (4)… ensuite.
  const base = editService.name.replace(/ \(\d+\)$/, '');
  const n = services.filter((s) => s.url === editService.url).length + 1;
  closeWizard();
  const dup = await api.addService({
    name: `${base} (${n})`,
    url: editService.url,
    accent: editService.accent,
    accent2: editService.accent2,
    logo: editService.logo,
    customLogo: editService.customLogo,
    excludeRegex: editService.excludeRegex,
    blockNavRegex: editService.blockNavRegex,
    stripTitleRegex: editService.stripTitleRegex,
    rootChat: editService.rootChat,
    genericTitleRegex: editService.genericTitleRegex,
  });
  toast(t('duplicatedToast', { name: dup.name }));
});
$('#wizard-overlay').addEventListener('click', (e) => {
  if (e.target === $('#wizard-overlay')) closeWizard();
});
$('#svc-name').addEventListener('input', (e) => {
  $('#svc-name-preview').textContent = e.target.value;
});
$('#svc-logo-url').addEventListener('input', (e) => {
  $('#svc-logo').src = e.target.value;
});
$('#svc-logo-import').addEventListener('click', async () => {
  const res = await api.importLogo();
  if (res.ok) {
    $('#svc-logo-url').value = res.logo;
    $('#svc-logo').src = res.logo;
  } else if (!res.canceled) {
    toast(t('wizardImportError', { error: res.error || '…' }));
  }
});

$('#remove-delete-session').addEventListener('click', () => {
  if (pendingRemoveId) api.removeService(pendingRemoveId, false);
  closeRemove();
});
$('#remove-keep-session').addEventListener('click', () => {
  if (pendingRemoveId) api.removeService(pendingRemoveId, true);
  closeRemove();
});
$('#remove-cancel').addEventListener('click', closeRemove);
$('#remove-overlay').addEventListener('click', (e) => {
  if (e.target === $('#remove-overlay')) closeRemove();
});

$('#search').addEventListener('input', (e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  render();
});

$('#open-external').addEventListener('click', () => {
  const url = currentUrl || (services.find((s) => s.id === activeServiceId) || {}).url;
  if (url) api.openExternal(url);
});

$('#settings-export').addEventListener('click', exportRegistry);
$('#settings-import').addEventListener('click', importRegistry);
$('#settings-manage').addEventListener('click', () => {
  closeSettings();
  openCatalog(false);
});

$('#catalog-done').addEventListener('click', closeCatalog);
$('#catalog-close').addEventListener('click', closeCatalog);
$('#catalog-overlay').addEventListener('click', (e) => {
  if (e.target === $('#catalog-overlay')) closeCatalog();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#catalog-overlay').classList.contains('hidden')) {
    closeCatalog();
  }
});

// Raccourcis : Ctrl/Cmd+1..9 change de service, Ctrl/Cmd+K = recherche,
// Ctrl/Cmd+P = relais d'une demande.
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('#search').focus();
    return;
  }
  if (e.key.toLowerCase() === 'p') {
    e.preventDefault();
    openRelay();
    return;
  }
  if (e.key.toLowerCase() === 'b') {
    e.preventDefault();
    setSidebarCollapsed(!sidebarCollapsed);
    return;
  }
  if (e.key.toLowerCase() === 'e') {
    e.preventDefault();
    setSplit(splitServiceId === null ? undefined : null);
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    togglePalette();
    return;
  }
  if (e.key === ',') {
    e.preventDefault();
    openSettings();
    return;
  }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 9 && services[n - 1]) {
    activeServiceId = services[n - 1].id;
    if (splitServiceId === activeServiceId) splitServiceId = null;
    updateSplitButton();
    api.showService(activeServiceId);
    render();
  }
});

// Fermeture du menu contextuel d'historique : clic ailleurs, Échap,
// perte de focus de la fenêtre.
document.addEventListener('click', (e) => {
  if (entryMenu && !entryMenu.contains(e.target)) closeEntryMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeEntryMenu();
});
window.addEventListener('blur', closeEntryMenu);

// --- Abonnements au process principal ---

api.onServicesUpdated((updated) => {
  services = updated;
  render();
  // Popup catalogue ouverte : refléter les changements d'état activé/désactivé.
  if (!$('#catalog-overlay').classList.contains('hidden')) {
    renderCatalog();
  }
});

api.onHistoryUpdated(refreshHistory);

api.onActiveServiceChanged((id) => {
  activeServiceId = id;
  if (splitServiceId === id) splitServiceId = null;
  updateSplitButton();
  const svc = services.find((s) => s.id === id);
  applyTheme(svc || null);
  render();
});

api.onActiveUrlChanged((url) => {
  currentUrl = url || '';
  updateAddressBar();
});

// --- Démarrage ---

(async () => {
  catalogEntries = await api.getCatalog();
  services = await api.getServices();
  history = await api.getHistory();
  appTheme = (await api.getTheme()) || 'system';
  updateThemeButton();
  sidebarCollapsed = (await api.getSidebarCollapsed()) === true;
  applySidebarCollapsed();
  languageSetting = (await api.getLanguage()) || 'system';
  // Textes statiques traduits + <html lang> avant le premier rendu.
  applyI18n();
  updateRelayButton();
  activeServiceId = services.length > 0 ? services[0].id : null;
  updateSplitButton();
  applyTheme(services.find((s) => s.id === activeServiceId) || null);
  render();
  // Premier lancement, registre vide : onboarding via le catalogue.
  if (services.length === 0) openCatalog(true);
})();
