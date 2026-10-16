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
const logos = require(path.join(ROOT, 'src/main/logos'));

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
  check('DiDi présent (service personnalisé)', catalogList.some((c) => c.name === 'DiDi' && c.url === 'https://chat.nexio.ovh'));
  const didi = catalogList.find((c) => c.name === 'DiDi');
  check('DiDi vert (dinosaure)', didi.accent === '#3aa14d');
  check('logos locaux présents (DiDi)', didi.logo.startsWith('assets/logos/') && fs.existsSync(path.join(ROOT, 'src/renderer', didi.logo)));
  check('tous les logos locaux existent', catalogList.every((c) => c.logo.startsWith('assets/logos/') && fs.existsSync(path.join(ROOT, 'src/renderer', c.logo))));
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

  // customLogo : le logo choisi dans la modal ✎ prime sur celui du catalogue
  registry.update(added.id, { logo: 'unichat-logo://f/abc123.png', customLogo: true });
  check('customLogo persisté', registry.get(added.id).customLogo === true);
  check('logo importé référencé par le schéma interne', registry.get(added.id).logo === 'unichat-logo://f/abc123.png');
  check('customLogo désactivable (retour au catalogue)', (registry.update(added.id, { customLogo: false }), registry.get(added.id).customLogo === false));

  // logos : import d'un fichier image (copie vers userData/logos/)
  const srcPng = path.join(tmp, 'logo-src.png');
  fs.writeFileSync(srcPng, Buffer.from('89504e470d0a1a0a', 'hex'));
  const copiedName = logos.importFile(srcPng, path.join(tmp, 'logos'));
  check('importLogo copie le fichier', !!copiedName && fs.existsSync(path.join(tmp, 'logos', copiedName)));
  check('importLogo conserve l\'extension', copiedName.endsWith('.png'));
  check('importLogo génère des noms uniques', logos.importFile(srcPng, path.join(tmp, 'logos')) !== copiedName);
  const txtPath = path.join(tmp, 'note.txt');
  fs.writeFileSync(txtPath, 'pas une image');
  check('importLogo refuse un non-image', logos.importFile(txtPath, path.join(tmp, 'logos')) === null);
  check('mime par extension', logos.mimeFor('a.png') === 'image/png' && logos.mimeFor('b.svg') === 'image/svg+xml' && logos.mimeFor('c.xyz') === 'application/octet-stream');

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

  // conv-store : remove/rename d'une entrée (clic droit dans la sidebar)
  convStore.upsert(svc.id, svc.url + '/chat/abc', 'Titre auto');
  convStore.rename(svc.id, svc.url + '/chat/abc#frag', 'Titre manuel'); // normalisation : #frag ignoré
  let renamed = convStore.listAll()[0];
  check('rename change le titre', renamed.title === 'Titre manuel');
  check('rename marque manuel', renamed.manual === true);
  convStore.upsert(svc.id, svc.url + '/chat/abc', 'Nouveau titre de la page');
  check('titre manuel résiste à la page', convStore.listAll()[0].title === 'Titre manuel');
  check('rename entrée inconnue → null', convStore.rename(svc.id, svc.url + '/chat/zzz', 'X') === null);
  check('rename titre vide → null', convStore.rename(svc.id, svc.url + '/chat/abc', '') === null);
  convStore.remove(svc.id, svc.url + '/chat/abc#frag'); // normalisation : le fragment est ignoré
  check('remove retire une entrée', convStore.listAll().length === 0);
  convStore.remove(svc.id, svc.url + '/chat/abc');
  check('remove entrée absente sans erreur', convStore.listAll().length === 0);

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
  fakeWC._url = 'https://auth.autre-hote.com/login';
  fakeWC.listeners['page-title-updated']({}, 'Connexion SSO');
  check('SSO sur un autre hôte ignoré', captured === null);
  fakeWC._url = svc.url + '?ksuite-mode=main';
  fakeWC.listeners['page-title-updated']({}, 'Accueil du service');
  check('racine avec paramètre ignorée', captured === null);
  fakeWC._url = 'https://' + new URL(svc.url).hostname + '/chat/456';
  fakeWC.listeners['page-title-updated']({}, 'Deuxième chat');
  check('chat même hôte enregistré', captured && captured.title === 'Deuxième chat');

  // title-tracker : les pages « accueil/liste » du catalogue ne sont pas des
  // conversations (excludeRegex) — ex. Gemini /app, Le Chat /chat.
  const gemini = catalog.list().find((c) => c.name === 'Gemini');
  check('Gemini : /app (liste) ignoré', titleTracker.isChatUrl(gemini, 'https://gemini.google.com/app') === false);
  check('Gemini : /app/<id> enregistré', titleTracker.isChatUrl(gemini, 'https://gemini.google.com/app/c1de979d1d05e9f0') === true);
  check('Gemini : /u/1/app (multi-compte) ignoré', titleTracker.isChatUrl(gemini, 'https://gemini.google.com/u/1/app') === false);
  check('Gemini : /u/1/app/<id> enregistré', titleTracker.isChatUrl(gemini, 'https://gemini.google.com/u/1/app/abc') === true);
  const lechat = catalog.list().find((c) => c.name === 'Le Chat');
  check('Le Chat : /chat (nouvelle conversation) ignoré', titleTracker.isChatUrl(lechat, 'https://chat.mistral.ai/chat') === false);
  check('Le Chat : /chat/<id> enregistré', titleTracker.isChatUrl(lechat, 'https://chat.mistral.ai/chat/abc') === true);

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
