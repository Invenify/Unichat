// Smoke test des modules purs d'UniChat (hors Electron).
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unichat-test-'));

const ROOT = path.resolve(__dirname, '..');
const registry = require(path.join(ROOT, 'src/main/registry'));
const convStore = require(path.join(ROOT, 'src/engine/conv-store'));
const titleTracker = require(path.join(ROOT, 'src/engine/title-tracker'));
const titleRules = require(path.join(ROOT, 'src/shared/title-rules'));
const i18n = require(path.join(ROOT, 'src/shared/i18n'));
const trackers = require(path.join(ROOT, 'src/shared/trackers'));
const metadata = require(path.join(ROOT, 'src/main/metadata'));
const catalog = require(path.join(ROOT, 'src/shared/catalog'));
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
  const lechatEntry = catalogList.find((c) => c.name === 'Le Chat');
  check('Le Chat au catalogue', !!lechatEntry && lechatEntry.url === 'https://chat.mistral.ai');
  check('logos locaux présents (Le Chat)', lechatEntry.logo.startsWith('assets/logos/') && fs.existsSync(path.join(ROOT, 'src/renderer', lechatEntry.logo)));
  check('tous les logos locaux existent', catalogList.every((c) => c.logo.startsWith('assets/logos/') && fs.existsSync(path.join(ROOT, 'src/renderer', c.logo))));
  const euria = catalogList.find((c) => c.url.includes('euria.infomaniak.com'));
  check('Euria bloque KSuite', !!euria && euria.blockNavRegex.includes('ksuite'));
  const duckEntry = catalogList.find((c) => c.name === 'Duck.ai');
  check('Duck.ai : rootChat + filtre de titres génériques', duckEntry.rootChat === true && !!duckEntry.genericTitleRegex && !!duckEntry.stripTitleRegex);
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

  // Réordonnancement (glisser-déposer sidebar / dock mobile) : ids listés
  // en tête dans cet ordre, absents en fin, ordre conservé.
  const svcA = registry.add({ name: 'Svc A', url: 'https://a.example', accent: '#111111' });
  const svcB = registry.add({ name: 'Svc B', url: 'https://b.example', accent: '#222222' });
  const ro = registry.reorder([svcB.id, added.id, 'svc-inconnu']);
  check('reorder : ordre appliqué', ro[0].id === svcB.id && ro[1].id === added.id);
  check('reorder : absents en fin, ordre conservé', ro.slice(2).every((s) => s.id !== svcB.id && s.id !== added.id) && ro[ro.length - 1].id === svcA.id);
  registry.remove(svcA.id);
  registry.remove(svcB.id);

  // stripTitleRegex : suffixe de marque retiré des titres (ex. « <chat> / Open WebUI »)
  const owui = { stripTitleRegex: '\\s*/\\s*Open WebUI$' };
  check('stripTitleRegex retire « / Open WebUI »', titleTracker.cleanTitle(owui, 'meteo montreal / Open WebUI') === 'meteo montreal');
  check('titre sans suffixe intact', titleTracker.cleanTitle(owui, 'Hello') === 'Hello');
  check('titre réduit au suffixe → conservé', titleTracker.cleanTitle(owui, ' / Open WebUI') === ' / Open WebUI');
  check('service sans regex → titre intact', titleTracker.cleanTitle({ stripTitleRegex: null }, 'Hello / Open WebUI') === 'Hello / Open WebUI');
  registry.update(added.id, { stripTitleRegex: '\\s*-\\s*X$' });
  check('stripTitleRegex persisté', registry.get(added.id).stripTitleRegex === '\\s*-\\s*X$');

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

  // conv-store : épinglage des favoris (clic droit → Épingler)
  convStore.upsert(svc.id, svc.url + '/chat/abc', 'Favori');
  convStore.upsert(svc.id, svc.url + '/chat/def', 'Normal');
  check('setPinned épingle une entrée', (convStore.setPinned(svc.id, svc.url + '/chat/abc#frag', true) || {}).pinned === true);
  check('setPinned entrée inconnue → null', convStore.setPinned(svc.id, svc.url + '/chat/zzz', true) === null);
  convStore.upsert(svc.id, svc.url + '/chat/abc', 'Favori (mis à jour)');
  check("l'épingle survit à un upsert", convStore.listAll().find((e) => e.url.endsWith('/chat/abc')).pinned === true);
  check('les épinglées trient en tête', (function () {
    const sorted = convStore.listAll().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    return sorted[0].url.endsWith('/chat/abc');
  })());
  check('setPinned détache (false)', convStore.setPinned(svc.id, svc.url + '/chat/abc', false).pinned === false);
  convStore.removeService(svc.id);

  // conv-store : stripTitle (nettoyage au boot des titres avec suffixe)
  convStore.upsert('svc-test', 'https://chat.example.com/c/abc', 'Hello / Open WebUI');
  convStore.upsert('svc-test', 'https://chat.example.com/c/def', 'meteo montreal / Open WebUI');
  convStore.rename('svc-test', 'https://chat.example.com/c/def', 'Mon titre');
  check('stripTitle nettoie les titres auto', convStore.stripTitle('svc-test', '\\s*/\\s*Open WebUI$') === 1);
  const stripAll = convStore.listAll();
  check('suffixe retiré du titre', stripAll.find((e) => e.url.endsWith('/c/abc')).title === 'Hello');
  check('titre manuel épargné', stripAll.find((e) => e.url.endsWith('/c/def')).title === 'Mon titre');
  check('stripTitle idempotent (2e passage → 0)', convStore.stripTitle('svc-test', '\\s*/\\s*Open WebUI$') === 0);
  convStore.removeService('svc-test');

  // conv-store : purgeMatching (entrées exclues enregistrées avant l'exclusion)
  convStore.upsert('svc-test', 'https://gemini.google.com/app', 'Google Gemini');
  convStore.upsert('svc-test', 'https://gemini.google.com/app/abc', 'Mon chat');
  check('purgeMatching retire les entrées exclues', convStore.purgeMatching('svc-test', '/app$') === 1);
  check('purgeMatching garde le reste', convStore.listAll().every((e) => e.url.endsWith('/app/abc')));
  check('purgeMatching idempotent (2e passage → 0)', convStore.purgeMatching('svc-test', '/app$') === 0);
  convStore.removeService('svc-test');

  // conv-store : purgeMatchingTitle (titres de marque enregistrés avant le
  // filtre genericTitleRegex, ex. « Copilot » à la racine)
  convStore.upsert('svc-gen', 'https://copilot.microsoft.com/c/1', 'Copilot');
  convStore.upsert('svc-gen', 'https://copilot.microsoft.com/c/2', 'Mon Copilot');
  convStore.upsert('svc-gen', 'https://copilot.microsoft.com/c/3', 'Projet X');
  convStore.rename('svc-gen', 'https://copilot.microsoft.com/c/3', 'Copilot'); // renommé « Copilot » à la main
  check('purgeMatchingTitle retire les titres génériques auto', convStore.purgeMatchingTitle('svc-gen', '^(Microsoft\\s+)?Copilot$') === 1);
  const genAll = convStore.listAll().filter((e) => e.serviceId === 'svc-gen');
  check('purgeMatchingTitle garde les titres non génériques', genAll.some((e) => e.url.endsWith('/c/2') && e.title === 'Mon Copilot'));
  check('purgeMatchingTitle épargne les titres renommés à la main', genAll.some((e) => e.url.endsWith('/c/3') && e.title === 'Copilot'));
  check('purgeMatchingTitle idempotent', convStore.purgeMatchingTitle('svc-gen', '^(Microsoft\\s+)?Copilot$') === 0);
  convStore.removeService('svc-gen');

  // conv-store : purgeRoot (entrées racine d'un service sans rootChat,
  // enregistrées par une version précédente puis retirées du catalogue)
  convStore.upsert('svc-root', 'https://copilot.microsoft.com/', 'Copilot — conversation en cours');
  convStore.upsert('svc-root', 'https://copilot.microsoft.com/?form=CHS00N', 'Autre repli');
  convStore.upsert('svc-root', 'https://copilot.microsoft.com/c/abc', 'Vrai chat');
  check('purgeRoot retire les entrées racine', convStore.purgeRoot('svc-root', 'https://copilot.microsoft.com') === 2);
  check('purgeRoot garde les vraies conversations', convStore.listAll().every((e) => e.url.endsWith('/c/abc')));
  check('purgeRoot idempotent', convStore.purgeRoot('svc-root', 'https://copilot.microsoft.com') === 0);
  convStore.removeService('svc-root');

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

  // Navigation SPA (History API) : did-navigate-in-page, invisible de did-navigate.
  captured = null;
  fakeWC._url = svc.url + '/chat/789';
  fakeWC._title = 'Troisième chat';
  fakeWC.listeners['did-navigate-in-page']({}, svc.url + '/chat/789', true);
  check('navigation SPA in-page enregistrée', captured && captured.title === 'Troisième chat');
  captured = null;
  fakeWC.listeners['did-navigate-in-page']({}, svc.url + '/iframe', false);
  check('navigation in-page hors main-frame ignorée', captured === null);

  // Copilot / Lumo : retour au comportement d'origine — la racine n'est pas
  // une conversation, rien ne s'enregistre (vide accepté par l'utilisateur).
  const copilot = catalog.list().find((c) => c.name === 'Copilot');
  check("Copilot : racine ignorée (pas de rootChat)", titleTracker.isChatUrl(copilot, 'https://copilot.microsoft.com/?form=CHS00N') === false);
  const lumo = catalog.list().find((c) => c.name === 'Lumo');
  check("Lumo : racine ignorée (pas de rootChat)", titleTracker.isChatUrl(lumo, 'https://lumo.proton.me/') === false);
  check('Lumo : /guest ignoré', titleTracker.isChatUrl(lumo, 'https://lumo.proton.me/guest') === false);

  // Duck.ai : service racine — entrée « Conversation en cours » tant que
  // le site ne publie que son titre de marque.
  const duck = catalog.list().find((c) => c.name === 'Duck.ai');
  check('Duck.ai : racine acceptée (rootChat)', titleTracker.isChatUrl(duck, 'https://duck.ai/') === true);
  check('Duck.ai : titre de marque refusé', titleTracker.isRecordableTitle(duck, 'Duck.ai') === false);
  check('Duck.ai : titre de conversation accepté', titleTracker.isRecordableTitle(duck, 'Idées de recettes vegan') === true);

  // resolveTitle : décision partagée desktop/mobile (nettoyage → filtre
  // générique → repli rootChat)
  check('resolveTitle : vrai titre conservé', titleRules.resolveTitle(duck, 'https://duck.ai/', 'Idées de recettes vegan') === 'Idées de recettes vegan');
  check('resolveTitle : repli « Conversation en cours » à la racine', titleRules.resolveTitle(duck, 'https://duck.ai/', 'Duck.ai') === 'Conversation en cours');
  check('resolveTitle : null sans rootChat', titleRules.resolveTitle(copilot, 'https://copilot.microsoft.com/', 'Copilot') === null);
  check('resolveTitle : null hors racine même avec rootChat', titleRules.resolveTitle(duck, 'https://duck.ai/chats', 'Duck.ai') === null);
  check('resolveTitle : suffixe de marque retiré avant décision', titleRules.resolveTitle(duck, 'https://duck.ai/', 'Meilleure recette de paella - Duck.ai') === 'Meilleure recette de paella');

  // Tracker de bout en bout sur un service racine : titre de marque →
  // repli « Conversation en cours », vrai titre le remplace (et retour).
  let rootCaptured = null;
  const fakeRoot = {
    _url: 'https://duck.ai/',
    _title: '',
    listeners: {},
    on(ev, fn) { this.listeners[ev] = fn; },
    getURL() { return this._url; },
    getTitle() { return this._title; },
  };
  titleTracker.attach(fakeRoot, { ...duck, id: 'svc-duck' }, (e) => { rootCaptured = e; });
  fakeRoot._title = 'Duck.ai';
  fakeRoot.listeners['page-title-updated']({}, 'Duck.ai');
  check("Duck.ai : marque → entrée « Conversation en cours »", rootCaptured && rootCaptured.title === 'Conversation en cours' && rootCaptured.url === 'https://duck.ai/');
  fakeRoot.listeners['page-title-updated']({}, 'Idées de recettes vegan');
  check('Duck.ai : vrai titre remplace le repli', rootCaptured && rootCaptured.title === 'Idées de recettes vegan');
  fakeRoot.listeners['page-title-updated']({}, 'Duck.ai');
  check("Duck.ai : marque → retour au repli", rootCaptured && rootCaptured.title === 'Conversation en cours');

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

  // settings : thème 'system' par défaut, forçage light/dark persistant
  const settings = require(path.join(ROOT, 'src/main/settings'));
  const s1 = settings.init(path.join(tmp, 'settings'));
  check('settings défaut system', s1.theme === 'system');
  check('settings setTheme dark', settings.setTheme('dark').theme === 'dark');
  const s2 = settings.init(path.join(tmp, 'settings'));
  check('settings thème persisté', s2.theme === 'dark');
  check('settings refuse thème inconnu', settings.setTheme('neon') === null);
  check('settings THEMES', JSON.stringify(settings.THEMES) === JSON.stringify(['system', 'light', 'dark']));
  check('settings sidebar non réduite par défaut', s1.sidebarCollapsed === false);
  check('settings setSidebarCollapsed', settings.setSidebarCollapsed(true).sidebarCollapsed === true);
  check('settings sidebar réduite persistée', settings.init(path.join(tmp, 'settings')).sidebarCollapsed === true);
  check('settings setSidebarCollapsed(false) normalise', settings.setSidebarCollapsed('nimporte').sidebarCollapsed === false);
  check('settings langue défaut system', settings.init(path.join(tmp, 'settings')).language === 'system');
  check('settings setLanguage en', settings.setLanguage('en').language === 'en');
  check('settings langue persistée', settings.init(path.join(tmp, 'settings')).language === 'en');
  check('settings refuse langue inconnue', settings.setLanguage('klingon') === null);

  // Bloque-pisteurs : domaine de la liste (et sous-domaines) coupé, le
  // reste (site du chat, SSO…) toujours autorisé.
  check('trackers : doubleclick bloqué', trackers.isTrackerUrl('https://stats.g.doubleclick.net/r/collect?x=1') === true);
  check('trackers : googletagmanager bloqué', trackers.isTrackerUrl('https://www.googletagmanager.com/gtag/js?id=G-1') === true);
  check('trackers : facebook.net bloqué', trackers.isTrackerUrl('https://connect.facebook.net/fr_FR/fbevents.js') === true);
  check('trackers : chat autorisé', trackers.isTrackerUrl('https://chat.mistral.ai/chat/abc') === false);
  check('trackers : SSO autorisé', trackers.isTrackerUrl('https://account.proton.me/login') === false);
  check('trackers : URL invalide → false', trackers.isTrackerUrl('pas une url') === false);
  check('trackers : liste non vide', trackers.TRACKER_DOMAINS.length > 10);
  check('settings blockTrackers défaut false', settings.init(path.join(tmp, 'settings')).blockTrackers === false);
  check('settings setBlockTrackers true', settings.setBlockTrackers(true).blockTrackers === true);
  check('settings blockTrackers persisté', settings.init(path.join(tmp, 'settings')).blockTrackers === true);

  // Rétention de l'historique : purge des conversations trop anciennes
  const DAY = 86400000;
  convStore.upsert('svc-ret', 'https://chat.example.com/c/jeune', 'Chat récent');
  convStore.listAll().find((e) => e.url.includes('jeune')).updatedAt = Date.now() - 5 * DAY;
  convStore.upsert('svc-ret', 'https://chat.example.com/c/vieux', 'Chat ancien');
  convStore.listAll().find((e) => e.url.includes('vieux')).updatedAt = Date.now() - 400 * DAY;
  check('purgeOlderThan(365) retire les + d\u2019un an', convStore.purgeOlderThan(365) === 1);
  check('purgeOlderThan garde les récents', convStore.listAll().some((e) => e.url.includes('jeune')));
  check('purgeOlderThan(0) = illimité, no-op', convStore.purgeOlderThan(0) === 0);
  convStore.removeService('svc-ret');
  check('settings rétention défaut 0', settings.init(path.join(tmp, 'settings')).historyRetentionDays === 0);
  check('settings setHistoryRetention 90', settings.setHistoryRetention(90).historyRetentionDays === 90);
  check('settings rétention persistée', settings.init(path.join(tmp, 'settings')).historyRetentionDays === 90);
  check('settings refuse rétention inconnue', settings.setHistoryRetention(42) === null);

  // Hibernation des IA non affichées (réglage « Ressources »)
  check('settings hibernation défaut 0', settings.init(path.join(tmp, 'settings')).hibernateMinutes === 0);
  check('settings setHibernateMinutes 30', settings.setHibernateMinutes(30).hibernateMinutes === 30);
  check('settings hibernation persistée', settings.init(path.join(tmp, 'settings')).hibernateMinutes === 30);
  check('settings refuse hibernation inconnue', settings.setHibernateMinutes(7) === null);

  // Espaces de travail : sous-ensembles nommés de services
  const workspaces = require(path.join(ROOT, 'src/main/workspaces'));
  const wsState = workspaces.init(path.join(tmp, 'workspaces'));
  check('workspaces vides au départ', wsState.active === 'all' && wsState.list.length === 0);
  const svcList = [
    { id: 'a', name: 'A', url: 'https://a.com', enabled: true },
    { id: 'b', name: 'B', url: 'https://b.com', enabled: true },
    { id: 'c', name: 'C', url: 'https://c.com', enabled: false },
  ];
  check("visibleServices 'all' = actifs", workspaces.visibleServices(svcList).map((s) => s.id).join(',') === 'a,b');
  const pro = workspaces.create('Pro', ['a', 'b']);
  check('workspaces create', pro.name === 'Pro' && pro.services.join(',') === 'a,b');
  workspaces.activate(pro.id);
  check('workspaces activate', workspaces.get().active === pro.id);
  check("visibleServices filtre par l'espace", workspaces.visibleServices(svcList).map((s) => s.id).join(',') === 'a,b');
  workspaces.toggleService(pro.id, 'b', false);
  check('workspaces retire un service', workspaces.visibleServices(svcList).map((s) => s.id).join(',') === 'a');
  workspaces.toggleService(pro.id, 'b', true);
  check('workspaces remet un service', workspaces.visibleServices(svcList).map((s) => s.id).join(',') === 'a,b');
  check('workspaces persisté', workspaces.init(path.join(tmp, 'workspaces')).list[0].name === 'Pro');
  workspaces.activate('all');
  workspaces.remove(pro.id);
  check('workspaces remove → retour à all', workspaces.get().active === 'all' && workspaces.get().list.length === 0);
  check('workspaces activate id inconnu → all', workspaces.activate('ws-fantome').active === 'all');

  // Profil multi-appareil : fusion sans écrasement + REMAPPAGE des ids
  // (les ids de services diffèrent entre appareils, l'URL fait le pont).
  const profileLib = require(path.join(ROOT, 'src/shared/profile'));
  const localSvc = registry.list().find((s) => s.url === 'https://chat.deepseek.com') || registry.add({ name: 'DeepSeek', url: 'https://chat.deepseek.com', accent: '#4d6bfe' });
  const incoming = profileLib.makeProfile({
    services: [
      // DeepSeek existe déjà localement avec un AUTRE id : rien d'écrasé.
      { id: 'svc-ETRANGER', name: 'DeepSeek renommé côté import', url: 'https://chat.deepseek.com', accent: '#111111' },
      // Qwen est nouveau → ajouté.
      { id: 'svc-QWEN', name: 'Qwen', url: 'https://chat.qwen.ai', accent: '#615ced' },
    ],
    workspaces: [{ id: 'ws-etranger', name: 'Espace commun', services: ['svc-ETRANGER', 'svc-QWEN'] }],
    settings: { theme: 'dark', language: 'en', historyRetentionDays: 90 },
    history: [
      // Conversation DeepSeek : serviceId ENTRANT → doit être remappé sur
      // l'id LOCAL du même service (par URL).
      { serviceId: 'svc-ETRANGER', url: 'https://chat.deepseek.com/chat/abc', title: 'Chat fusionné', updatedAt: Date.now() },
    ],
  });
  check('profile : isProfile', profileLib.isProfile(incoming) === true);
  const localBefore = registry.list().length;
  const merged = profileLib.mergeProfile(
    {
      services: registry.list(),
      workspaces: [],
      settings: { theme: 'system', language: 'fr', historyRetentionDays: 0 },
      history: convStore.listAll(),
    },
    incoming
  );
  check('profile : 1 service ajouté', merged.stats.servicesAdded === 1 && merged.services.length === localBefore + 1);
  check('profile : service local préservé (nom non écrasé)', merged.services.find((s) => s.url === 'https://chat.deepseek.com').name !== 'DeepSeek renommé côté import');
  const qwenLocal = merged.services.find((s) => s.url === 'https://chat.qwen.ai');
  check('profile : Qwen ajouté', !!qwenLocal);
  const dsLocal = merged.services.find((s) => s.url === 'https://chat.deepseek.com');
  check('profile : espace fusionné, ids remappés', merged.workspaces[0].services.includes(dsLocal.id) && merged.workspaces[0].services.includes(qwenLocal.id));
  check('profile : réglages import gagne', merged.settings.theme === 'dark' && merged.settings.language === 'en' && merged.settings.historyRetentionDays === 90);
  const histEntry = merged.history.find((e) => e.url === 'https://chat.deepseek.com/chat/abc');
  check('profile : historique remappé sur l\u2019id local', histEntry && histEntry.serviceId === dsLocal.id);
  check('profile : fichier non-profil → null', profileLib.mergeProfile({ services: [] }, { foo: 1 }) === null);
  // Application desktop : workspaces.mergeIn + conv-store replaceAll.
  const wsMerged = workspaces.mergeIn(merged.workspaces);
  check('workspaces.mergeIn : espace ajouté', wsMerged.list.some((w) => w.name === 'Espace commun'));
  const histCount = convStore.replaceAll(merged.history);
  check('conv-store.replaceAll : historique appliqué', histCount === merged.history.length && convStore.listAll().some((e) => e.url === 'https://chat.deepseek.com/chat/abc'));
  registry.remove(qwenLocal.id);

  // i18n : dictionnaire partagé desktop/mobile, 5 langues + interpolation
  check('i18n : 5 langues', i18n.LANGS.length === 5 && i18n.LANGS.every((l) => /^[a-z]{2}$/.test(l.code)));
  i18n.setLang('fr');
  check('i18n fr par défaut', i18n.t('settings') === 'Réglages');
  i18n.setLang('en');
  check('i18n en', i18n.t('settings') === 'Settings');
  check('i18n interpolation', i18n.t('battleLabel', { i: 1, n: 3, name: 'Le Chat' }) === 'Battle 1/3 · Le Chat');
  check('i18n clé inconnue → clé', i18n.t('clé.inconnue') === 'clé.inconnue');
  i18n.setLang('de');
  check('i18n de', i18n.t('settings') === 'Einstellungen');
  check('i18n locale de', i18n.locale() === 'de-DE');
  check('i18n resolveLang system → navigateur', i18n.resolveLang('system', 'es-ES') === 'es');
  check('i18n resolveLang forcé', i18n.resolveLang('it', 'en-US') === 'it');
  check('i18n resolveLang inconnu → fr', i18n.resolveLang('system', 'zh-CN') === 'fr');
  i18n.setLang('es');
  check('i18n es', i18n.t('settings') === 'Ajustes');
  i18n.setLang('it');
  check('i18n it', i18n.t('settings') === 'Impostazioni');

  console.log(failures === 0 ? 'ALL TESTS PASSED' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})();
