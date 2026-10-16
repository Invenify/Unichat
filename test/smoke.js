// Smoke test des modules purs d'UniChat (hors Electron).
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unichat-test-'));

const ROOT = path.resolve(__dirname, '..');
const registry = require(path.join(ROOT, 'src/main/registry'));
const convStore = require(path.join(ROOT, 'src/engine/conv-store'));
const titleTracker = require(path.join(ROOT, 'src/engine/title-tracker'));
const metadata = require(path.join(ROOT, 'src/main/metadata'));
const catalog = require(path.join(ROOT, 'src/main/catalog'));

let failures = 0;
const check = (label, cond) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + label);
  if (!cond) failures++;
};

(async () => {
  registry.init(tmp);
  convStore.init(tmp);

  // Registre : vide au premier lancement (l'onboarding catalogue prend le relais)
  check('registre vide au départ', registry.list().length === 0);

  // Catalogue des services connus
  const catalogList = catalog.list();
  check('catalogue fourni', catalogList.length >= 15);
  check('DiDI présent (service personnalisé)', catalogList.some((c) => c.name === 'DiDI' && c.url === 'https://chat.nexio.ovh'));
  const didi = catalogList.find((c) => c.name === 'DiDI');
  check('DiDI vert (dinosaure)', didi.accent === '#3aa14d' && didi.logo.includes('chat.nexio.ovh'));
  const euria = catalogList.find((c) => c.url.includes('euria.infomaniak.com'));
  check('Euria bloque KSuite', !!euria && euria.blockNavRegex.includes('ksuite'));
  check('chaque entrée a nom, url, couleurs, logo', catalogList.every((c) => c.name && c.url && c.accent && c.accent2 && c.logo));
  check('sameOrigin ignore les paramètres', catalog.sameOrigin('https://euria.infomaniak.com/?ksuite-mode=main', 'https://euria.infomaniak.com') === true);
  check('sameOrigin distingue les hôtes', catalog.sameOrigin('https://a.com', 'https://b.com') === false);

  // Activation d'un service du catalogue + champ enabled
  const chatgpt = catalogList.find((c) => c.name === 'ChatGPT');
  const added = registry.add({ ...chatgpt, enabled: true });
  check('ajout catalogue retourne un id', added.id.startsWith('svc-'));
  check('ajout activé', added.enabled === true);
  check('enabled par défaut à true', registry.add({ name: 'X', url: 'https://x.example' }).enabled === true);
  registry.update(added.id, { enabled: false });
  check('désactivation via update', registry.get(added.id).enabled === false);
  registry.update(added.id, { enabled: true });
  check('réactivation via update', registry.get(added.id).enabled === true);

  // Ajout / update / remove
  registry.update(added.id, { name: 'ChatGPT FR' });
  check('update nom', registry.get(added.id).name === 'ChatGPT FR');
  registry.update(added.id, { blockNavRegex: '^https://ksuite\\.infomaniak\\.com' });
  check('update blockNavRegex', registry.get(added.id).blockNavRegex === '^https://ksuite\\.infomaniak\\.com');
  registry.update(added.id, { url: 'https://chatgpt.com/en' });
  check('update url (session indexee par id)', registry.get(added.id).url === 'https://chatgpt.com/en');
  const extra = registry.add({ name: 'HuggingChat', url: 'https://huggingface.co/chat', accent: '#ffd21e' });
  registry.remove(extra.id);
  check('remove', registry.get(extra.id) === null);

  // Import du registre : fusion par URL, jamais d'écrasement ni de doublon
  const before = registry.list().length;
  const imported = registry.importAll([
    { name: 'DeepSeek', url: 'https://chat.deepseek.com', accent: '#4d6bfe' },
    registry.list()[0], // même URL → ignoré
    { name: 'Sans URL' }, // invalide → ignoré
    null, // invalide → ignoré
  ]);
  check('import ne compte que les nouvelles URLs', imported === 1);
  check('import ajoute exactement 1 service', registry.list().length === before + 1);
  check('import préserve les champs', registry.list().some((s) => s.name === 'DeepSeek' && s.accent === '#4d6bfe'));
  check('import null-safe', registry.importAll(null) === 0);
  check('ré-import → 0 doublon', registry.importAll([{ name: 'DeepSeek', url: 'https://chat.deepseek.com' }]) === 0);

  // conv-store : upsert + dédoublonnage par (service, url)
  const svc = registry.list()[0];
  convStore.upsert(svc.id, svc.url + '/chat/abc#frag', 'Résumé du projet');
  convStore.upsert(svc.id, svc.url + '/chat/abc', 'Résumé du projet (renommé)');
  const all = convStore.listAll();
  check('dédoublonnage par (service, url)', all.length === 1);
  check('titre mis à jour au renommage', all[0].title === 'Résumé du projet (renommé)');
  convStore.removeService(svc.id);
  check("removeService vide l'historique", convStore.listAll().length === 0);

  // title-tracker : filtres racine / exclusions / https
  let captured = null;
  const fakeWC = {
    _url: '',
    _title: '',
    listeners: {},
    on(ev, fn) { this.listeners[ev] = fn; },
    getURL() { return this._url; },
    getTitle() { return this._title; },
  };
  titleTracker.attach(fakeWC, svc, (e) => { captured = e; });
  fakeWC._url = svc.url; fakeWC._title = 'Accueil';
  fakeWC.listeners['page-title-updated']({}, 'Accueil');
  check('URL racine ignorée', captured === null);
  fakeWC._url = svc.url + '/chat/123';
  fakeWC.listeners['page-title-updated']({}, 'Tapas espagnols');
  check('chat enregistré', captured && captured.title === 'Tapas espagnols');
  captured = null;
  fakeWC._url = svc.url + '/auth/login';
  fakeWC.listeners['page-title-updated']({}, 'Connexion - Mistral AI');
  check('page de connexion ignorée', captured === null);
  fakeWC._url = svc.url + '/account/login';
  fakeWC.listeners['page-title-updated']({}, 'Connexion');
  check('login en sous-chemin ignoré', captured === null);

  // metadata : analyse d'une vraie page (fetch réseau)
  try {
    const meta = await metadata.analyzeUrl('chat.nexio.ovh');
    console.log('metadata chat.nexio.ovh →', JSON.stringify(meta));
    check('analyzeUrl normalise https', meta.url.startsWith('https://'));
    check('analyzeUrl renvoie un nom', typeof meta.name === 'string' && meta.name.length > 0);
  } catch (e) {
    console.log('SKIP metadata réseau :', String(e));
  }

  // normalizeUrl
  check('normalizeUrl ajoute https', metadata.normalizeUrl('example.com') === 'https://example.com');

  console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})();
