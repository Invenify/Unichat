// app.js — UI UniChat : sidebar agrégée (services + historique de titres),
// wizard « Ajouter un service », thème par service, recherche, raccourcis.

const api = window.unichat;

let services = [];
let history = [];
let activeServiceId = null;
let searchTerm = '';
let analysis = null; // résultat du wizard en cours
let wizardMode = 'add'; // 'add' | 'edit'
let editServiceId = null;
let currentUrl = ''; // URL courante de la vue active
let pendingRemoveId = null;
let catalogEntries = [];

const $ = (sel) => document.querySelector(sel);

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
  if (s < 60) return "à l'instant";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 604800) return `${Math.floor(s / 86400)} j`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function serviceLogo(svc) {
  if (svc.logo) {
    const img = document.createElement('img');
    img.src = svc.logo;
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
    header.title = svc.url;

    header.appendChild(serviceLogo(svc));
    const name = document.createElement('span');
    name.className = 'svc-name';
    name.textContent = svc.name;
    header.appendChild(name);

    const edit = document.createElement('button');
    edit.className = 'svc-edit';
    edit.textContent = '✎';
    edit.title = 'Modifier ce service (nom, couleurs, logo)';
    edit.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openEdit(svc);
    });
    header.appendChild(edit);

    const remove = document.createElement('button');
    remove.className = 'svc-remove';
    remove.textContent = '×';
    remove.title = 'Supprimer ce service';
    remove.addEventListener('click', (ev) => {
      ev.stopPropagation();
      openRemove(svc);
    });
    header.appendChild(remove);

    header.addEventListener('click', () => {
      activeServiceId = svc.id;
      api.showService(svc.id);
      render();
    });
    group.appendChild(header);

    const entries = history.filter(
      (e) => e.serviceId === svc.id && matchesSearch(e.title)
    );
    for (const entry of entries.slice(0, 30)) {
      const btn = document.createElement('button');
      btn.className = 'chat-entry';
      btn.title = entry.title;

      const dot = document.createElement('span');
      dot.className = 'dot';
      btn.appendChild(dot);

      const title = document.createElement('span');
      title.className = 'chat-title';
      title.textContent = entry.title;
      btn.appendChild(title);

      const date = document.createElement('span');
      date.className = 'chat-date';
      date.textContent = timeAgo(entry.updatedAt);
      btn.appendChild(date);

      btn.addEventListener('click', () => {
        activeServiceId = svc.id;
        api.navigate(svc.id, entry.url);
        render();
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
  const svc = services.find((s) => s.url === url);
  return !!svc && svc.enabled !== false;
}

function renderCatalog() {
  const listEl = $('#catalog-list');
  listEl.innerHTML = '';

  // Services personnalisés (ajoutés via le wizard) d'abord, puis le catalogue.
  const custom = services
    .filter((s) => !catalogEntries.some((c) => c.url === s.url))
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
    check.textContent = isEnabled(entry.url) ? '✓' : '＋';
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
  $('#catalog-title').textContent = onboarding
    ? 'Bienvenue — choisissez vos services IA'
    : 'Gérer les services';
  $('#catalog-sub').textContent = onboarding
    ? 'Sélectionnez les chats IA que vous voulez réunir dans UniChat. Tout est modifiable ensuite.'
    : "Cliquez pour activer ou désactiver un service. Désactiver conserve la session et l'historique ; supprimer (×) efface tout.";
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
  $('#wizard-title').textContent = 'Ajouter un service';
  $('#wizard-save').textContent = 'Ajouter le service';
  $('#svc-url').value = '';
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
  analysis = { url: svc.url };
  setEditFieldsVisible(true);
  $('#wizard-title').textContent = 'Modifier le service';
  $('#wizard-save').textContent = 'Enregistrer';
  $('#svc-name').value = svc.name;
  $('#svc-logo').src = svc.logo || '';
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
    $('#svc-accent').value = normalizeColor(analysis.accent);
    $('#svc-accent2').value = normalizeColor(analysis.accent2);
    $('#svc-name-preview').textContent = analysis.name;
    $('#wizard-step-url').classList.add('hidden');
    $('#wizard-step-confirm').classList.remove('hidden');
  } catch (e) {
    err.textContent = `Analyse impossible : ${e.message || e}. Vérifiez l'URL, ou saisissez le service manuellement.`;
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
  const data = {
    name: $('#svc-name').value.trim() || analysis.name,
    logo: $('#svc-logo').getAttribute('src') || null,
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
  $('#remove-title').textContent = `Supprimer « ${svc.name} » ?`;
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
  if (!res.canceled) alert("Export impossible : " + (res.error || 'erreur inconnue'));
}

async function importRegistry() {
  const res = await api.importRegistry();
  if (res.ok) {
    if (res.added > 0) alert(`${res.added} service(s) importé(s).`);
    else alert('Aucun nouveau service : les entrées du fichier existent déjà (fusion par URL).');
  } else if (!res.canceled) {
    alert("Import impossible : " + (res.error || 'erreur inconnue'));
  }
}

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
$('#wizard-overlay').addEventListener('click', (e) => {
  if (e.target === $('#wizard-overlay')) closeWizard();
});
$('#svc-name').addEventListener('input', (e) => {
  $('#svc-name-preview').textContent = e.target.value;
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

$('#export-registry').addEventListener('click', exportRegistry);
$('#import-registry').addEventListener('click', importRegistry);

$('#manage-services').addEventListener('click', () => openCatalog(false));
$('#catalog-done').addEventListener('click', closeCatalog);
$('#catalog-overlay').addEventListener('click', (e) => {
  if (e.target === $('#catalog-overlay')) closeCatalog();
});

// Raccourcis : Ctrl/Cmd+1..9 change de service, Ctrl/Cmd+K = recherche.
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('#search').focus();
    return;
  }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 9 && services[n - 1]) {
    activeServiceId = services[n - 1].id;
    api.showService(activeServiceId);
    render();
  }
});

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
  activeServiceId = services.length > 0 ? services[0].id : null;
  applyTheme(services.find((s) => s.id === activeServiceId) || null);
  render();
  // Premier lancement, registre vide : onboarding via le catalogue.
  if (services.length === 0) openCatalog(true);
})();
