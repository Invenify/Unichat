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
  // Langue forcée en français : sans elle, jsdom annonce « en-US » et
  // l'interface se chargerait en anglais.
  window.localStorage.setItem('unichat.lang', 'fr');
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

  // Activer Le Chat puis fermer : il apparaît dans Services
  const lechat = [...doc.querySelectorAll('.cat-entry')].find((e) => e.textContent.includes('Le Chat'));
  lechat.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  $('#catalog-done').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check('catalogue fermé', !visible('#sheet-catalog'));
  check('Le Chat enregistré', JSON.parse(window.localStorage.getItem('unichat.services')).length === 1);

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

  // Wizard : URL du catalogue reconnue (Le Chat), étape confirmation
  $('#add-service').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check('wizard ouvert', visible('#sheet-wizard'));
  $('#svc-url').value = 'chat.mistral.ai';
  $('#wizard-next').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check('analyse → étape confirmation', visible('#wizard-step-confirm') && !visible('#wizard-step-url'));
  check('nom complété depuis le catalogue', $('#svc-name').value === 'Le Chat');
  check('couleur accent du catalogue', $('#svc-accent').value === '#fa520f');
  $('#wizard-cancel').dispatchEvent(new window.Event('click', { bubbles: true }));
  check('wizard annulé', !visible('#sheet-wizard'));

  // Vue service : sans plugin natif (jsdom), placeholder dans le slot
  $('.nav-btn[data-screen="services"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  doc.querySelector('.svc-row').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 60)); // requestAnimationFrame du câblage natif
  check('vue service affichée', visible('#webview-holder'));
  check('titre de la vue = nom du service', $('#webview-title').textContent === 'Le Chat');
  check('placeholder sans plugin natif', $('#webview-slot').textContent.includes('app Android'));
  $('#webview-back').dispatchEvent(new window.Event('click', { bubbles: true }));
  check('retour ferme la vue service', !visible('#webview-holder'));

  // Ouverture du catalogue via le bouton ⚙ de l'écran Services
  $('#open-catalog').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check('catalogue rouvert via ⚙', visible('#sheet-catalog'));
  check('Le Chat marqué activé', [...doc.querySelectorAll('.cat-entry')].find((e) => e.textContent.includes('Le Chat')).classList.contains('enabled'));
  $('#sheet-overlay').dispatchEvent(new window.Event('click', { bubbles: true }));

  // Suppression avec déconnexion : la façade native est absente (jsdom) —
  // clearSession/destroy sont des no-ops, le flux ne lève pas.
  $('.nav-btn[data-screen="services"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  doc.querySelector('.svc-row .svc-more').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  const del = [...doc.querySelectorAll('#menu-body button')].find((b) => b.textContent === 'Supprimer…');
  del.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  const confirmBtn = [...doc.querySelectorAll('#menu-body button')].find((b) => b.textContent === 'Supprimer et déconnecter');
  confirmBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check('service supprimé et déconnecté sans erreur', JSON.parse(window.localStorage.getItem('unichat.services')).length === 0);
  check('historique du service purgé', JSON.parse(window.localStorage.getItem('unichat.history')).length === 0);

  // Battle d'IA : activer 2 services, prompt mémorisé (bibliothèque),
  // relais 1/2 → 2/2 → terminé. Sans plugin natif : placeholder + toast
  // « copie impossible », le flux ne lève pas.
  $('#open-catalog').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  for (const name of ['Le Chat', 'Lumo']) {
    [...doc.querySelectorAll('.cat-entry')].find((e) => e.textContent.includes(name))
      .dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
  }
  $('#catalog-done').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check('deux services actifs pour le battle', JSON.parse(window.localStorage.getItem('unichat.services')).length === 2);

  window.localStorage.setItem('unichat.relay.prompts', JSON.stringify(['Rédige un haïku sur le vin']));
  $('.nav-btn[data-screen="chats"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  $('#battle-open').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check('sheet battle ouvert', visible('#sheet-battle'));
  check('les 2 IA sont présélectionnées', doc.querySelectorAll('.battle-svc.selected').length === 2);
  check('bibliothèque de prompts rendue', doc.querySelector('.prompt-chip .chip-label').textContent.includes('haïku'));
  doc.querySelector('.prompt-chip').dispatchEvent(new window.Event('click', { bubbles: true }));
  check('clic sur un prompt mémorisé remplit le champ', $('#battle-text').value.includes('haïku'));
  check('bouton battle libellé « 2 IA »', $('#battle-start').textContent.includes('2 IA'));

  $('#battle-start').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80)); // rAF du câblage de la vue
  check('battle : première IA ouverte', visible('#webview-holder') && $('#webview-title').textContent === 'Le Chat');
  check('battle : bouton suivante visible', visible('#battle-next') && $('#battle-next').textContent.includes('1/2'));
  check('battle : prompt mémorisé', window.localStorage.getItem('unichat.relay.prompt').includes('haïku'));

  $('#battle-next').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  check('battle : deuxième IA ouverte', $('#webview-title').textContent === 'Lumo');
  check('battle : dernier bouton = Terminer', $('#battle-next').textContent.includes('Terminer'));

  $('#battle-next').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check('battle terminé : bouton caché', !visible('#battle-next'));
  check('battle terminé : toast affiché', $('#toast').textContent.includes('Battle terminé'));
  $('#webview-back').dispatchEvent(new window.Event('click', { bubbles: true }));
  check('vue fermée après le battle', !visible('#webview-holder'));

  console.log(failures === 0 ? 'ALL DOM TESTS PASSED' : failures + ' FAILURES');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('ERREUR DOM TEST:', e);
  process.exit(1);
});
