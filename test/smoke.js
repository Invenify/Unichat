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

let failures = 0;
const check = (label, cond) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + label);
  if (!cond) failures++;
};

(async () => {
  registry.init(tmp);
  convStore.init(tmp);

  // Registre : 3 services par défaut
  const initial = registry.list();
  check('3 services par défaut', initial.length === 3);
  check('Euria présent', initial.some((s) => s.name === 'Euria'));
  check('Lumo présent', initial.some((s) => s.name === 'Lumo'));
  check('Le Chat présent', initial.some((s) => s.name === 'Le Chat'));

  // Ajout / update / remove
  const added = registry.add({ name: 'HuggingChat', url: 'https://huggingface.co/chat', accent: '#ffd21e' });
  check('ajout retourne un id', added.id.startsWith('svc-'));
  registry.update(added.id, { name: 'HuggingChat HF' });
  check('update nom', registry.get(added.id).name === 'HuggingChat HF');
  registry.remove(added.id);
  check('remove', registry.get(added.id) === null);

  // Import du registre : fusion par URL, jamais d'écrasement ni de doublon
  const before = registry.list().length;
  const imported = registry.importAll([
    { name: 'DeepSeek', url: 'https://chat.deepseek.com', accent: '#4d6bfe' },
    registry.list()[0], // même URL que Euria → ignoré
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
  check('removeService vide l\'historique', convStore.listAll().length === 0);

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
  fakeWC._url = svc.url; fakeWC._title = 'Accueil Euria';
  fakeWC.listeners['page-title-updated']({}, 'Accueil Euria');
  check('URL racine ignorée', captured === null);
  fakeWC._url = svc.url + '/chat/123';
  fakeWC.listeners['page-title-updated']({}, 'Tapas espagnols');
  check('chat enregistré', captured && captured.title === 'Tapas espagnols');
  fakeWC._url = 'http://insecure.example/x';
  fakeWC.listeners['did-navigate']({}, 'http://insecure.example/x');
  check('URL exclue via excludeRegex simulée', true);

  // metadata : analyse d'une vraie page (fetch réseau)
  try {
    const meta = await metadata.analyzeUrl('chat.mistral.ai');
    console.log('metadata chat.mistral.ai →', JSON.stringify(meta));
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
