// Smoke test DOM de l'UI mobile (www/, sortie de scripts/build-mobile.js).
// Charge index.html dans jsdom et exécute le bundle : vérifie le
// câblage des événements, l'onboarding (catalogue) et les interactions.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const WWW = path.join(__dirname, '..', 'www');
let failures = 0;
const check = (label, cond) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + label);
  if (!cond) failures++;
};

const dom = new JSDOM(fs.readFileSync(path.join(WWW, 'index.html'), 'utf8'), {
  url: 'https://localhost/index.html', // origine https : localStorage disponible (pas en file://)
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;

(async () => {
  // Le bundle www/app.js est auto-suffisant (esbuild, plus d'import).
  window.window.eval(fs.readFileSync(path.join(WWW, 'app.js'), 'utf8'));
  // Laisse tourner les promesses de démarrage.
  await new Promise((r) => setTimeout(r, 50));

  const doc = window.document;
  const $ = (s) => doc.querySelector(s);
  const visible = (s) => !$(s).classList.contains('hidden');

  // Démarrage : écran Chats actif, onboarding (catalogue) ouvert
  check('écran Chats actif', $('#screen-chats').classList.contains('active'));
  check('onboarding : catalogue ouvert', visible('#sheet-catalog'));
  check('catalogue : 20 entrées', doc.querySelectorAll('.cat-entry').length === 20);

  // Activer DiDi puis fermer : il apparaît dans Services
  const didi = [...doc.querySelectorAll('.cat-entry')].find((e) => e.textContent.includes('DiDi'));
  didi.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  $('#catalog-done').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check('catalogue fermé', !visible('#sheet-catalog'));
  check('DiDi enregistré', JSON.parse(window.localStorage.getItem('unichat.services')).length === 1);

  // Écran Services : une ligne, switch activé
  $('.nav-btn[data-screen="services"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  check('écran Services actif', $('#screen-services').classList.contains('active'));
  check('une ligne de service', doc.querySelectorAll('.svc-row').length === 1);
  check('switch activé', doc.querySelector('.svc-row .switch').classList.contains('on'));

  // Désactivation via le switch, puis réactivation
  doc.querySelector('.svc-row .switch').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check('désactivation persistée', JSON.parse(window.localStorage.getItem('unichat.services'))[0].enabled === false);
  doc.querySelector('.svc-row .switch').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));

  // Écran Chats : vide (pas d'historique), message d'aide
  $('.nav-btn[data-screen="chats"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  check('chat-list affiche l\u2019aide', $('#chat-list').textContent.includes('Aucune conversation'));

  // Thème : passage en sombre forcé → attribut sur <html>
  $('.nav-btn[data-screen="settings"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  $('.theme-opt[data-theme="dark"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check('thème sombre appliqué', doc.documentElement.dataset.theme === 'dark');
  $('.theme-opt[data-theme="system"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check('retour au thème système', doc.documentElement.dataset.theme === undefined);

  // Wizard : URL du catalogue reconnue (DiDi), étape confirmation
  $('#add-service').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check('wizard ouvert', visible('#sheet-wizard'));
  $('#svc-url').value = 'chat.nexio.ovh';
  $('#wizard-next').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check('analyse → étape confirmation', visible('#wizard-step-confirm') && !visible('#wizard-step-url'));
  check('nom complété depuis le catalogue', $('#svc-name').value === 'DiDi');
  check('couleur accent du catalogue', $('#svc-accent').value === '#3aa14d');
  $('#wizard-cancel').dispatchEvent(new window.Event('click', { bubbles: true }));
  check('wizard annulé', !visible('#sheet-wizard'));

  // Vue service : placeholder WebView (la native arrive en phase 4)
  $('.nav-btn[data-screen="services"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  doc.querySelector('.svc-row').dispatchEvent(new window.Event('click', { bubbles: true }));
  check('vue service affichée', visible('#webview-holder'));
  check('titre de la vue = nom du service', $('#webview-title').textContent === 'DiDi');
  $('#webview-back').dispatchEvent(new window.Event('click', { bubbles: true }));
  check('retour ferme la vue service', !visible('#webview-holder'));

  // Ouverture du catalogue via le bouton ⚙ de l'écran Services
  $('#open-catalog').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check('catalogue rouvert via ⚙', visible('#sheet-catalog'));
  check('DiDi marqué activé', [...doc.querySelectorAll('.cat-entry')].find((e) => e.textContent.includes('DiDi')).classList.contains('enabled'));

  console.log(failures === 0 ? 'ALL DOM TESTS PASSED' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('ERREUR DOM TEST:', e);
  process.exit(1);
});
