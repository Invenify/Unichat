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
  const didi = catalog.find('https://chat.nexio.ovh');
  check('DiDi trouvé au catalogue', !!didi && didi.name === 'DiDi');

  const svc = await api.addService({ ...didi, enabled: true });
  check('ajout retourne un id svc-', svc.id.startsWith('svc-'));
  check('stripTitleRegex conservé', (await api.getServices())[0].stripTitleRegex === didi.stripTitleRegex);

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

  // analyzeUrl : complétion via le catalogue (avant le fetch natif, phase 6)
  const meta = await api.analyzeUrl('chat.nexio.ovh');
  check('analyzeUrl normalise https', meta.url === 'https://chat.nexio.ovh');
  check('analyzeUrl complète via catalogue', meta.name === 'DiDi' && meta.accent === '#3aa14d' && meta.logo.includes('didi.png'));
  const meta2 = await api.analyzeUrl('https://mon-chat.example.com');
  check('analyzeUrl fallback hostname', meta2.name === 'mon-chat.example.com' && meta2.accent === '#6c5ce7');

  // Thème
  check('thème défaut system', (await api.getTheme()) === 'system');
  check('setTheme dark', (await api.setTheme('dark')) === 'dark');
  check('setTheme refuse valeur inconnue', (await api.setTheme('neon')) === null);

  // Suppression : registre + historique du service
  await api.removeServiceHistory(svc.id);
  check('removeServiceHistory vide l\u2019historique', (await api.getHistory()).length === 0);
  await api.removeService(svc.id);
  check('removeService retire le service', (await api.getServices()).every((s) => s.id !== svc.id));

  console.log(failures === 0 ? 'ALL MOBILE TESTS PASSED' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})();
