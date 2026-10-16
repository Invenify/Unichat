// app.js — UI UniChat : sidebar agrégée (services + historique de titres),
// wizard « Ajouter un service », thème par service, recherche, raccourcis.

const api = window.unichat;

let services = [];
let history = [];
let activeServiceId = null;
let searchTerm = '';
let analysis = null; // résultat du wizard en cours

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

  for (const svc of services) {
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

    const remove = document.createElement('button');
    remove.className = 'svc-remove';
    remove.textContent = '×';
    remove.title = 'Supprimer ce service';
    remove.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (confirm(`Supprimer « ${svc.name} » ?\n\nOK = supprimer aussi la session (déconnexion)\nAnnuler = abandon`)) {
        api.removeService(svc.id, false);
      }
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

function applyTheme(svc) {
  const root = document.documentElement;
  root.style.setProperty('--accent', svc ? svc.accent : '#6c5ce7');
  root.style.setProperty('--accent2', svc ? svc.accent2 : '#a29bfe');
  $('#active-url').textContent = svc ? svc.url : '';
}

// --- Wizard ---

function openWizard() {
  analysis = null;
  $('#svc-url').value = '';
  $('#wizard-error').classList.add('hidden');
  $('#wizard-step-url').classList.remove('hidden');
  $('#wizard-step-confirm').classList.add('hidden');
  $('#wizard-overlay').classList.remove('hidden');
  $('#svc-url').focus();
}

function closeWizard() {
  $('#wizard-overlay').classList.add('hidden');
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
    url: analysis.url,
    logo: analysis.faviconUrl || null,
    accent: $('#svc-accent').value,
    accent2: $('#svc-accent2').value,
  };
  await api.addService(data);
  closeWizard();
}

// --- Événements ---

$('#add-service').addEventListener('click', openWizard);
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

$('#search').addEventListener('input', (e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  render();
});

$('#open-external').addEventListener('click', () => {
  const svc = services.find((s) => s.id === activeServiceId);
  if (svc) api.openExternal(svc.url);
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
});

api.onHistoryUpdated(refreshHistory);

api.onActiveServiceChanged((id) => {
  activeServiceId = id;
  const svc = services.find((s) => s.id === id);
  applyTheme(svc || null);
  render();
});

// --- Démarrage ---

(async () => {
  services = await api.getServices();
  history = await api.getHistory();
  activeServiceId = services.length > 0 ? services[0].id : null;
  applyTheme(services.find((s) => s.id === activeServiceId) || null);
  render();
})();
