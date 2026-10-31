// Smoke test de la couche mobile (mobile/api.js) — hors WebView :
// localStorage est simulé, les modules ESM/CJS sont chargés par Node.
// Valide que les règles partagées (src/shared/) s'appliquent à l'identique
// côté mobile : moteur de titres, fusion d'import, thème.

const path = require('path');

// Shim minimal de localStorage (utilisé par mobile/api.js).
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let failures = 0;
const check = (label, cond) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + label);
  if (!cond) failures++;
};

(async () => {
  const { api } = await import(path.join(__dirname, '..', 'mobile', 'api.js'));
  const catalog = await import(path.join(__dirname, '..', 'src', 'shared', 'catalog.js'));

  // Registre vide au départ, then onboarding via le catalogue
  check('registre vide au départ', (await api.getServices()).length === 0);
  const lechat = catalog.find('https://chat.mistral.ai');
  check('Le Chat trouvé au catalogue', !!lechat && lechat.name === 'Le Chat');

  const svc = await api.addService({ ...lechat, stripTitleRegex: '\\s*/\\s*Open WebUI$', enabled: true });
  check('ajout retourne un id svc-', svc.id.startsWith('svc-'));
  check('stripTitleRegex conservé', (await api.getServices())[0].stripTitleRegex === '\\s*/\\s*Open WebUI$');

  // Moteur de titres : mêmes règles que le desktop
  const r1 = await api.recordNavigation(svc, svc.url, 'Open WebUI');
  check('URL racine ignorée', r1 === null);
  const r2 = await api.recordNavigation(svc, svc.url + '/c/abc', 'meteo montreal / Open WebUI');
  check('chat enregistré, suffixe retiré', r2 && r2.title === 'meteo montreal');
  const r3 = await api.recordNavigation(svc, svc.url + '/c/abc#frag', 'Titre modifié');
  check('dédoublonnage par (service, url), # ignoré', (await api.getHistory()).length === 1);
  check('titre auto mis à jour', (await api.getHistory())[0].title === 'Titre modifié');
  check('page de connexion ignorée', (await api.recordNavigation(svc, svc.url + '/auth/login', 'Connexion')) === null);
  check('hôte différent ignoré', (await api.recordNavigation(svc, 'https://auth.autre.com/x', 'SSO')) === null);

  // Renommage manuel puis épinglage : le manuel résiste aux titres de page
  await api.renameEntry(svc.id, svc.url + '/c/abc', 'Mon titre');
  await api.recordNavigation(svc, svc.url + '/c/abc', 'Nouveau titre de page');
  check('titre manuel résiste à la page', (await api.getHistory())[0].title === 'Mon titre');
  await api.setPinned(svc.id, svc.url + '/c/abc#frag', true);
  check('épingle survit au upsert', (await api.getHistory())[0].pinned === true);

  // Import : fusion par URL, jamais d'écrasement
  const n1 = await api.importRegistry([
    { name: 'DeepSeek', url: 'https://chat.deepseek.com', accent: '#4d6bfe' },
    svc, // même URL → ignoré
    { name: 'Sans URL' },
    null,
  ]);
  check('import ajoute seulement les nouvelles URLs', n1 === 1);
  check('ré-import → 0 doublon', (await api.importRegistry([{ name: 'DeepSeek', url: 'https://chat.deepseek.com' }])) === 0);
  check('importé préserve les champs', (await api.getServices()).some((s) => s.accent === '#4d6bfe'));

  // Réordonnancement (drag & drop du dock) : ids listés en tête dans cet
  // ordre, ids absents en fin dans leur ordre actuel.
  const deep = (await api.getServices()).find((s) => s.name === 'DeepSeek');
  const ro = await api.reorderServices([deep.id, 'svc-inconnu']);
  check('reorder : id listé en tête', ro[0].id === deep.id);
  check('reorder : absents en fin, ordre conservé', ro.length === 2 && ro[1].id === svc.id);
  check('reorder persisté', (await api.getServices())[0].id === deep.id);
  await api.reorderServices([svc.id, deep.id]); // retour à l'état initial

  // analyzeUrl : complétion via le catalogue (avant le fetch natif, phase 6)
  const meta = await api.analyzeUrl('chat.mistral.ai');
  check('analyzeUrl normalise https', meta.url === 'https://chat.mistral.ai');
  check('analyzeUrl complète via catalogue', meta.name === 'Le Chat' && meta.accent === '#fa520f' && meta.logo.includes('le-chat.png'));
  const meta2 = await api.analyzeUrl('https://mon-chat.example.com');
  check('analyzeUrl fallback hostname', meta2.name === 'mon-chat.example.com' && meta2.accent === '#6c5ce7');

  // Moteur de titres : parité rootChat / titres génériques avec le desktop
  // (Duck.ai = service racine ; Copilot = racine refusée)
  const duckEntry = catalog.find('https://duck.ai');
  check('Duck.ai au catalogue, rootChat', !!duckEntry && duckEntry.rootChat === true);
  const duckSvc = await api.addService({ ...duckEntry, enabled: true });
  const d1 = await api.recordNavigation(duckSvc, 'https://duck.ai/', 'Duck.ai');
  check('Duck.ai : repli « Conversation en cours » à la racine', d1 && d1.title === 'Conversation en cours');
  const d2 = await api.recordNavigation(duckSvc, 'https://duck.ai/', 'Meilleure recette de paella');
  check('Duck.ai : vrai titre remplace le repli', d2 && d2.title === 'Meilleure recette de paella');
  check('Duck.ai : une seule entrée (dédoublonnage racine)', (await api.getHistory()).filter((e) => e.serviceId === duckSvc.id).length === 1);
  const copilotEntry = catalog.find('https://copilot.microsoft.com');
  const copSvc = await api.addService({ ...copilotEntry, enabled: true });
  check('Copilot : racine ignorée (pas de rootChat)', (await api.recordNavigation(copSvc, 'https://copilot.microsoft.com/', 'Copilot')) === null);
  // Historique de test nettoyé : les assertions de fin supposent un
  // historique ne contenant que celui du service principal.
  await api.removeServiceHistory(duckSvc.id);
  await api.removeServiceHistory(copSvc.id);

  // Rétention de l'historique (identique au desktop)
  await api.setRetention(30);
  const DAY = 86400000;
  check('rétention : set/get', (await api.getRetention()) === 30);
  // Une entrée datée de 40 jours doit disparaître au prochain passage.
  await api.recordNavigation(svc, svc.url + '/c/jeune', 'Chat récent');
  const hist = JSON.parse(localStorage.getItem('unichat.history'));
  hist.find((e) => e.url.endsWith('/c/jeune')).timestamp = Date.now() - 40 * DAY;
  localStorage.setItem('unichat.history', JSON.stringify(hist));
  const purged = await api.purgeOldHistory();
  check('rétention : entrée trop ancienne purgée', purged === 1 && (await api.getHistory()).every((e) => !e.url.endsWith('/c/jeune')));
  await api.setRetention(0);
  check('rétention 0 = illimité (no-op)', (await api.purgeOldHistory()) === 0);

  // Espaces de travail (identiques au desktop, dans localStorage)
  check('workspaces vides au départ', (await api.getWorkspaces()).active === 'all');
  const w1 = await api.workspacesCreate('Pro', ['svc-1']);
  check('workspaces create → actif', w1.active === w1.list[0].id && w1.list[0].name === 'Pro');
  await api.workspacesToggleService(w1.list[0].id, 'svc-2', true);
  const w2 = await api.getWorkspaces();
  check('workspaces toggle service', w2.list[0].services.includes('svc-2'));
  await api.workspacesActivate('all');
  check('workspaces activate all', (await api.getWorkspaces()).active === 'all');
  await api.workspacesActivate(w2.list[0].id);
  check('workspaces activate espace', (await api.getWorkspaces()).active === w2.list[0].id);
  await api.workspacesDelete(w2.list[0].id);
  const w3 = await api.getWorkspaces();
  check('workspaces delete → retour all', w3.active === 'all' && w3.list.length === 0);

  // Profil multi-appareil : export/import au format partagé
  const exported = await api.exportProfile();
  check('profile : export au format v1', exported.version === 1 && Array.isArray(exported.services));
  const stats = await api.importProfile({
    version: 1,
    services: [{ id: 'svc-x', name: 'Qwen', url: 'https://chat.qwen.ai', accent: '#615ced' }],
    workspaces: [],
    settings: { theme: 'dark', language: 'fr' },
    history: [{ serviceId: 'svc-x', url: 'https://chat.qwen.ai/c/1', title: 'Chat Qwen', timestamp: Date.now() }],
  });
  check('profile : import ajoute service + historique', stats && stats.servicesAdded === 1 && stats.historyMerged === 1);
  check('profile : historique remappé sur le nouvel id', (await api.getHistory()).some((e) => e.title === 'Chat Qwen'));
  check('profile : réglage importé', (await api.getTheme()) === 'dark');
  check('profile : import invalide → null', (await api.importProfile({ foo: 1 })) === null);
  // État restauré pour les assertions suivantes (thème, purge).
  await api.setTheme('system');
  const qwenSvc = (await api.getServices()).find((s) => s.url === 'https://chat.qwen.ai');
  await api.removeService(qwenSvc.id);
  await api.removeServiceHistory(qwenSvc.id);

  // Thème
  check('thème défaut system', (await api.getTheme()) === 'system');
  check('setTheme dark', (await api.setTheme('dark')) === 'dark');
  check('setTheme refuse valeur inconnue', (await api.setTheme('neon')) === null);

  // Suppression : registre + historique du service
  await api.removeServiceHistory(svc.id);
  check('removeServiceHistory vide l\u2019historique', (await api.getHistory()).length === 0);
  await api.removeService(svc.id);
  check('removeService retire le service', (await api.getServices()).every((s) => s.id !== svc.id));

  // Façade webviews (mobile/webviews.js) : sans Capacitor natif, tout est
  // no-op/false et aucune méthode ne lève — l'UI reste utilisable.
  const { webviews, nativeWebViews } = await import(path.join(__dirname, '..', 'mobile', 'webviews.js'));
  check('webviews non disponible hors natif', nativeWebViews() === false && webviews.available() === false);
  check('open → false sans plugin', (await webviews.open({ id: 'x' }, 'https://a.com', { x: 0, y: 0, w: 1, h: 1 })) === false);
  await webviews.position({ x: 0, y: 0, w: 1, h: 1 });
  await webviews.close();
  await webviews.hide();
  await webviews.show();
  check('close/hide/show/position no-ops sans erreur', true);
  await webviews.clearSession('https://a.com');
  await webviews.destroy('x');
  check('clearSession/destroy no-ops sans erreur', true);
  check('onPage/onClosed retournent un désabonnement', typeof webviews.onPage(() => {}) === 'function' && typeof webviews.onClosed(() => {}) === 'function');

  console.log(failures === 0 ? 'ALL MOBILE TESTS PASSED' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})();
