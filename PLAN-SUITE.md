# UniChat — Plan de suite (reprise de conversation)

> Écrit le 2026-10-16. Ce document permet de reprendre le développement
> dans une nouvelle conversation. Il complète le README et la feuille de
> route initiale (phases 0–2, 4–5–6 du plan d'origine).

## 1. État actuel — ce qui est fait

MVP complet + finitions. Tout est committé sur `main` (voir `git log` pour
le dernier commit).

- **Phase 1** : wizard « ajouter par URL » (analyse `<head>` : favicon,
  theme-color, manifest, title), WebContentsView par service, partitions
  `persist:<id>` (sessions conservées), suppression avec session
  conservable ou déconnectée.
- **Phase 2** : moteur de titres universel (`title-tracker.js` +
  `conv-store.js`), sidebar agrégée par service, recherche (Ctrl/Cmd+K),
  raccourcis Ctrl/Cmd+1…9, navigation au clic.
- **Phase 4** : édition d'un service (✎ : nom, couleurs, URL, exclusions,
  regex de blocage), export/import du registre (dialogues natifs, fusion
  par URL), barre d'adresse dynamique (URL courante de la vue active).
- **Catalogue** (`src/shared/catalog.js`, déclaratif, 19 services : ChatGPT,
  Claude, Gemini, Copilot, Perplexity, Le Chat, Euria, Lumo, Grok,
  DeepSeek, HuggingChat, Poe, Qwen, Kimi, Meta AI, Character.AI, You.com,
  Z.ai, Pi).
  - Onboarding au 1er lancement (registre vide → popup de choix).
  - Bouton ＋ et bouton ⚙ → même popup : activer/désactiver (champ `enabled`,
    la session et l'historique sont conservés à la désactivation).
  - « ＋ Ajouter par URL… » dans la popup → wizard classique.
- **Thème clair/sombre** : palette en variables CSS + `prefers-color-scheme`
  (suit l'OS, réactif à chaud, les WebView suivent aussi).
- **Logo app** : licorne qui parle (bulle sombre, points blancs) générée
  par `scripts/make-icon.js` (SDF + PNG en pur Node) → `build/icon.png`
  (converti par electron-builder) + `src/renderer/assets/logo.png` (sidebar).
- **Icônes UI** : SVG inline partout (＋, ⚙, export, import, ↗, ×, ✎, ✓) —
  les glyphes texte ne sont pas rendus par le thème GTK de l'utilisateur.

## 2. Règles du moteur de titres (important)

`src/engine/title-tracker.js` — une URL n'est enregistrée QUE si :
1. `https?` ;
2. **même hostname que son service** (les SSO type `login.infomaniak.com`,
   `v2.auth.mistral.ai`, `account.proton.me` ne polluent jamais) ;
3. pas une page de connexion (`/login|signin|signup|register|auth|connexion`) ;
4. pas exclue par `excludeRegex` du service (Lumo : `/guest`) ;
5. pas la racine du service (origine + chemin, paramètres ignorés) ;
6. le titre est nettoyé par `stripTitleRegex` du service (ex. Open WebUI :
   `'\s*/\s*Open WebUI$'` → on garde le nom du chat seul).

`isChatUrl` et `cleanTitle` sont exportés (tests, purge d'historique).

## 3. Pièges découverts (à se rappeler)

- **WebContentsView recouvrent la fenêtre** : les modals du renderer sont
  invisibles dessous. Le main masque les vues pendant une modal
  (`set-modal-open` IPC + `modalOpen` dans `layoutViews`). Toute nouvelle
  modal DOIT appeler `api.setModalOpen(true/false)` à l'ouverture/fermeture.
- **Euria → KSuite** : la SPA d'Euria redirige les comptes kSuite vers
  `ksuite.infomaniak.com/<org>/euria`. Contournements cumulables :
  URL `…/?ksuite-mode=main` (le paramètre coupe la redirection à la source)
  ET `blockNavRegex: '^https://ksuite\.infomaniak\.com'` (will-navigate /
  will-redirect bloqués). Les deux sont dans le catalogue.
- **Pages « accueil/liste » ≠ conversations (2026-10-16)** : les SPA
  enregistrent leur page liste comme un chat (ex. Gemini `/app` « Google
  Gemini », Le Chat `/chat`). Corrigé par `excludeRegex` catalogue :
  Gemini `/app$`, Le Chat `/chat$` (couvre le multi-compte Google
  `/u/<n>/app`). Le patch au boot de main.js propage l'exclusion aux
  services déjà enregistrés (si leur `excludeRegex` est null). Si un autre
  service pollue ainsi (Claude `/new` probable), même recette.
- **Titres avec suffixe de marque (2026-10-16)** : Open WebUI titre ses
  pages « <chat> / Open WebUI ». Champ `stripTitleRegex` (catalogue →
  registre, même propagation au boot que excludeRegex) appliqué par
  title-tracker (`cleanTitle`). Au boot, main.js auto-nettoie
  l'historique pré-fixe : `convStore.stripTitle` (titres non manuels) et
  `convStore.purgeMatching` (entrées qui matchent une excludeRegex) —
  idempotents. Même recette pour un autre service pollué par son suffixe.
- **Correspondance par origine** (pas URL exacte) entre registre et
  catalogue, sinon doublon « Euria perso » (à cause du paramètre d'URL).
- **Favicons** : certains sites bloquent curl (403) mais pas le renderer ;
  pour les récalcitrants on utilise le proxy Google :
  `https://www.google.com/s2/favicons?domain=<hôte>&sz=64`.
- **Install Electron** (npm 11) : le postinstall est bloqué →
  `npm install-scripts approve electron`, et si l'extraction ne produit
  qu'un fichier : `unzip ~/.cache/electron/*/*.zip -d node_modules/electron/dist`
  + `printf 'electron' > node_modules/electron/path.txt` (SANS retour à la
  ligne).
- `ELECTRON_RUN_AS_NODE` peut être défini dans certains shells → l'agent de
  test doit faire `env -u ELECTRON_RUN_AS_NODE`.
- **Bazzite/Linux** : les messages ALSA/GTK/UPower dans les logs de
  `npm start` sont du bruit bénin.

## 4. Environnement de dev

- Machine : Bazzite, Node v26 (FlyEnv), l'utilisateur = Hugo.
- Vérifier : `node --check <fichier>` sur tout .js modifié ;
  `node test/smoke.js` (73 PASS attendus, 75 si le réseau répond pour
  les tests metadata) ;
  boot : `env -u ELECTRON_RUN_AS_NODE timeout 8 npx electron .`
  (exit 124 = pas de crash).
- **Les données utilisateur ont été réinitialisées le 2026-10-16** à la
  demande de l'utilisateur (onboarding fraîchement testé). Sauvegarde des
  anciennes données : `~/.config/unichat-backup-2026-10-16.tar.gz`
  (141 Mo, sessions + historique) — restaurable par `tar xzf` dans ~/.config.
- Les tests ne peuvent pas cliquer dans l'UI : les modals et le rendu
  doivent être vérifiés visuellement par l'utilisateur (`npm start`).

## 5. Prochaines étapes (validées avec l'utilisateur)

Priorité proposée :

1. **#2 — Gérer l'historique — FAIT (2026-10-16)** : clic droit sur une
   entrée → menu « Renommer » (édition inline, Enter valide, Échap annule,
   le titre manuel ne sera plus écrasé par le titre de la page grâce au
   champ `manual` dans history.json) et « Retirer de la liste ».
   `conv-store.js` : `remove(serviceId, url)` + `rename(serviceId, url,
   title)` ; IPC `history-remove` / `history-rename` (42 PASS au smoke).
   Le menu contextuel reste dans la sidebar → jamais caché sous les vues.
2. **#3 — Logo personnalisé — FAIT (2026-10-16)** : la modal ✎/wizard a un
   champ « Logo (URL, ou importez un fichier) » + bouton « Importer… ».
   - Import : dialogue natif → copie vers `userData/logos/` (module
     `src/main/logos.js`, nom aléatoire, png/jpg/gif/svg/ico/webp), servi au
     renderer via le schéma interne `unichat-logo://f/<nom>` (protocole
     `protocol.handle`, CSP img-src mise à jour) — le file:// direct vers
     userData est bloqué par Chromium.
   - Drapeau `customLogo` dans services.json : le logo changé par
     l'utilisateur prime sur l'asset du catalogue ; sinon l'asset catalogue
     reste prioritaire (favicon distante éventuellement morte).
   - Vidé le champ → retour au logo du catalogue.
3. **#1 — Relais d'une demande vers une autre IA — FAIT (2026-10-16)**,
   mode universel (fonctionnalité vedette) :
   - UniChat ne peut PAS lire le contenu des conversations (WebView, E2EE
     chez Lumo). Le prompt est saisi dans UNE BARRE UNICHAT (textarea de la
     modal « Relayer une demande ») et mémorisé dans localStorage
     (`unichat.relay.prompt`).
   - Bouton avion en bas de sidebar ou Ctrl/Cmd+P → modal avec le prompt +
     grille des services activés ; clic sur un service → `clipboard` (IPC
     `relay-copy` dans le main), bascule sur le service, toast « Prompt
     copié — collez-le (Ctrl+V) dans X » (coin bas-gauche, dans la sidebar,
     jamais sous les vues). L'utilisateur colle et envoie. Zéro sélecteur,
     marche partout.
   - Mode recettes (plus tard) : `recipes/<domaine>.json` avec
     `inputSelector` → collage + envoi automatiques, dégradation silencieuse
     si l'UI change. C'est la « phase 3 » de la feuille de route d'origine.
4. **#4 — Comparaison — ANNULÉ (2026-10-16, décision de l'utilisateur)** :
   vues en colonnes ne sera pas fait. **#5 — Recettes non-lus — ANNULÉ
   également.**
5. **#6 — Systray — FAIT (2026-10-16)** :
   - `Tray` (main.js) créé au boot avec le logo licorne (22 px), tooltip
     « UniChat », menu « Afficher UniChat » / « Quitter ». Clic sur l'icône
     → restaurer la fenêtre (show/restore/focus).
   - Fermer la fenêtre la CACHE (l'app tourne en arrière-plan, sessions et
     historique vivants) : handler `close` + drapeau `isQuitting` levé par
     `before-quit` (seul « Quitter » du tray quitte vraiment).
   - Notification (une fois par session) au premier cachage : « UniChat
     continue en arrière-plan ».
   - Si le tray échoue (pas de zone de notifications), `tray` reste null →
     la fermeture de la fenêtre quitte l'app comme avant (jamais
     d'application impossible à fermer). `activate` (macOS) réaffiche.
6. **#7 — Épingler des favoris — FAIT (2026-10-16)** :
   - Clic droit sur une entrée d'historique → « Épingler » /
     « Désépingler » (avant Renommer/Retirer).
   - Champ `pinned` dans history.json (`conv-store.setPinned`, IPC
     `history-set-pinned`, preload `setPinnedHistoryEntry`). Survit aux
     upserts (comme `manual`), normalisation d'URL identique à rename.
   - Dans la sidebar : les épinglées trient en tête de leur groupe de
     service (tri stable, ordre updatedAt conservé au sein de chaque
     sous-ensemble) et portent une épingle SVG couleur d'accent.
7. **#9 — Packaging réel** : `npm run dist:win` / `dist:mac` jamais testés
   (icône OK : electron-builder convertit `build/icon.png`). Tester un
   vrai build.
8. **#10 — Android via Capacitor — EN COURS (2026-10-16)** : voir la
   section 7 « Android » ci-dessous (phases 1–4 faites, 5–7 à faire ;
   A4 écrit à l'aveugle, à compiler sur la machine d'Hugo).

## 6. Architecture (rappel rapide)

```
src/
├── shared/            # PORTABLE desktop + Android (zéro API Node/Electron)
│   ├── title-rules.js # isRoot, isAuthUrl, isChatUrl, cleanTitle
│   ├── catalog.js      # catalogue déclaratif + sameOrigin
│   └── service.js      # mkService, importable (fusion par URL), newId
├── main/
│   ├── main.js        # fenêtre, vues par service, IPC, modalOpen, blocage nav
│   ├── registry.js    # services.json (enabled, customLogo, excludeRegex, blockNavRegex)
│   ├── metadata.js    # analyse auto d'une URL
│   └── logos.js       # import d'un logo → userData/logos/ (schéma unichat-logo://)
├── preload/preload.js # pont IPC (getCatalog, setServiceEnabled, setModalOpen, relayCopy, importLogo…)
├── renderer/          # sidebar, wizard, popup catalogue, relais (app.js, theme.css)
├── engine/
│   ├── title-tracker.js  # did-navigate/page-title-updated → historique (règles dans shared/)
│   └── conv-store.js     # history.json (100 % local)
└── scripts/make-icon.js   # logo licorne (pur Node)
```

Données : `~/.config/unichat/` → `services.json`, `history.json`,
partitions `Partitions/persist:<id>`.

## 7. Android (Capacitor) — plan et état

> Décision de l'utilisateur (2026-10-16) : **un seul dépôt** (monorepo),
> frontières = dossiers. Ordre des phases : UI propre d'abord (1→2→3→4→5→6→7).

### Décisions structurantes

- **Capacitor 8.5** (appId `com.hugo.unichat`, appName UniChat, webDir `www`).
- **UI mobile** dans `mobile/` (index.html, theme.css, app.js, api.js),
  bundlée par **esbuild** vers `www/` (résout les modules CJS de `src/shared/`
  sans autre outil). `www/` est gitignoré (généré) ; `android/` est committé.
- **`mobile/api.js`** = façade async unique entre l'UI et le stockage.
  Aujourd'hui : localStorage (`unichat.services`, `unichat.history`,
  `unichat.theme`). Les phases 4–6 remplaceront l'INTÉRIEUR de cette façade
  (plugin natif WebView, Filesystem, HTTP natif) SANS toucher à l'UI.
- **Mêmes règles métier** que le desktop : l'UI mobile appelle
  `isChatUrl`/`cleanTitle` (`src/shared/title-rules.js`) dans
  `api.recordNavigation` — les 6 règles du moteur de titres s'appliquent.
- **Thème** : `prefers-color-scheme` (la WebView Android suit l'OS) +
  `data-theme="light|dark"` sur `<html>` pour le forçage manuel.

### Fait (commits sur main)

- **A1 — shared/** (`0038951`) : extraction title-rules / catalog / service ;
  desktop et `test/smoke.js` repointés ; `src/main/catalog.js` supprimé
  (`scripts/fetch-logos.js` aussi).
- **A2 — socle Capacitor** (`9ab4500`) : `cap init` + `cap add android`,
  `scripts/build-mobile.js`, scripts npm `mobile`, `mobile:sync`, `mobile:open`.
- **A3 — UI mobile** (`f28ca5d`) : 3 écrans (Chats / Services / Réglages),
  nav basse, bottom-sheets (catalogue + onboarding 1er lancement, wizard
  « Analyser → confirmer », menus ⋮ service/chat), recherche, épingle (SVG),
  renommage inline, switch activer/désactiver, suppression (session
  conservable — la purge cookies arrive en A4), export presse-papiers /
  import fichier, thème. Placeholder WebView (`#webview-holder`) : la vue
  native viendra dedans (A4).
  - Tests : `npm test` = smoke desktop + `test/mobile-smoke.js` (api.js,
    23 PASS) + `test/mobile-dom.js` (jsdom, 22 PASS — charge le `www/` réel).
  - **A3 validé sur appareil par Hugo (2026-10-16).**
- **A4 — plugin natif multi-WebView (2026-10-16)** :
  - `android/app/src/main/java/com/hugo/unichat/UniChatWebViews.kt` :
    une `WebView` par service (map id → vue, créée au 1er `open`, gardée
    vivante en arrière-plan), ajoutée au conteneur du pont Capacitor
    (par-dessus le DOM), positionnée sur le rect CSS de `#webview-slot`
    (x/y/w/h transmis par le JS × densité ; repositionnée via
    `position()` sur resize + un `OnLayoutChangeListener` sur la WebView
    Capacitor — clavier/rotation/insets).
  - Events → JS : `onReceivedTitle` + `onPageFinished` **et** un poll
    `evaluateJavascript` (1,5 s) url+titre — indispensable : les SPA qui
    changent de chat par pushState ne déclenchent AUCUN événement de
    navigation sur WebView. JS → `api.recordNavigation` → `renderChats()`.
    Dédoublonnage par état « url|titre » émis.
  - `blockNavRegex` → `shouldOverrideUrlLoading` (schémas non-http ouverts
    via `Intent.ACTION_VIEW`, jamais chargés dans la vue).
  - `MainActivity.java` : `registerPlugin(UniChatWebViews.class)` AVANT
    `super.onCreate` + `onBackPressed` → `handleSystemBack()` : retour dans
    l'historique de la page, sinon fermeture (event `closed` → JS recache
    le holder). Le bouton ‹ de la barre referme la vue directement.
  - « Déconnecter » = `clearSession({url})` : expiration de chaque cookie
    du domaine (les deux variantes hôte et `.domaine`, via `setCookie`
    Max-Age=0 — pas d'API de suppression scopée) + `WebStorage.deleteOrigin`
    (localStorage/indexedDB du domaine). Session conservée sinon : cookies
    persistants, vues gardées en mémoire.
  - `mobile/webviews.js` : façade unique vers le plugin
    (`Capacitor.Plugins.UniChatWebViews`, repli sur le proxy global). Hors
    natif (navigateur, jsdom) : no-op silencieux + placeholder — l'UI reste
    testable. `open/close/hide/show/position/clearSession/destroy/onPage/onClosed`.
  - Z-order sheets : une vue native COUVRE toujours le DOM (contrairement à
    ce que disait la note précédente — le z-index CSS ne traverse pas la
    frontière natif). `openSheet()`/`closeSheets()` appellent donc
    `webviews.hide()/show()` quand une vue est ouverte (comme le
    `setModalOpen` du desktop).
  - Divers : `windowSoftInputMode=adjustResize` (manifest), UA sans
    `; wv` (certains services filtrent les WebView), assombrissement
    algorithmique du thème sombre via androidx.webkit (best effort),
    Kotlin 2.1.21 (classpath racine + `org.jetbrains.kotlin.android` sur
    le module app), token JS anti-course ouvrir/fermer.
  - Tests : `mobile-smoke` +6 (façade no-op), `mobile-dom` +3 (placeholder,
    suppression+déconnexion sans erreur). **Pas compilable dans le bac à
    sable : premier `mobile:sync` + build Android Studio à faire par Hugo.**

### À faire (phases restantes)
- **A5 — stockage** : migrer `mobile/api.js` de localStorage vers
  `@capacitor/filesystem` (mêmes schémas JSON, migration des données
  existantes au 1er lancement). Export → share sheet Android.
- **A6 — métadonnées** : `analyzeUrl` via fetch natif (plugin HTTP ou le
  plugin A4) — favicon, theme-color, manifest, titre (pas de CORS).
  Réimplémente `src/main/metadata.js` côté natif ; le fallback catalogue
  actuel reste utile hors ligne.
- **A7 — build** : icônes launcher Android depuis `build/icon.png`
  (pas d'ImageMagick dans le bac à sable — régénérer par SDF aux tailles
  cibles dans `scripts/make-icon.js`, ou capacitor-assets), splash,
  `dist:apk` / `dist:aab` (gradle assembleRelease), signature.

### Pièges / notes Android

- **Le bac à sable agent n'a NI Java NI SDK Android** : `cap sync` marche,
  mais la compilation Kotlin ne peut être vérifiée que sur la machine
  d'Hugo (Android Studio). **A4 est écrit à l'aveugle — première chose à
  faire : `npm run mobile:sync` puis build/run dans Android Studio.** Si
  `registerPlugin` n'existe pas sous ce nom dans Capacitor 8, c'est la
  méthode BridgeActivity à vérifier en premier.
- **À vérifier sur appareil (A4)** : géométrie au clavier (adjustResize +
  edge-to-edge Android 15 : le slot doit être recalé, les insets au
  statut de test visuel), blockNavRegex (Euria/kSuite), titres des SPA
  sur changement de chat (poll), retour système, « Supprimer et
  déconnecter », et que `Capacitor.Plugins.UniChatWebViews` est bien
  exposé (sinon le repli placeholder s'affiche → le voir, c'est le
  signe que le proxy manque).
- **Cookies partagés** : tous les services partagent le même
  CookieManager global. Deux services sur le MÊME domaine se
  déconnecteraient ensemble ; l'isolation par service (comme les
  partitions desktop) demanderait WebViewProfile — plus tard.
- `onBackPressed` est déprécié (predictive back, Android 13+) mais
  fonctionne ; la version propre passe par
  `OnBackPressedDispatcher` si besoin.
- jsdom refuse localStorage sur origine `file://` → test DOM avec
  `url: 'https://localhost/index.html'`.
- Firefox headless du bac à sable : lancer avec `LD_LIBRARY_PATH=` vidé
  (conflit GLIBCXX avec l'extension VSCode).
- Normalisation d'URL mobile identique au desktop (fragment ignoré) :
  `api.normUrl` ; le champ `manual` résiste au titre de page (même logique
  que conv-store).

### Boucle de dev Android

```bash
npm test            # tout : desktop + mobile api + DOM (rebuild www/ inclus)
npm run mobile:sync # build www/ + copie android/
npm run mobile:open  # Android Studio → Run
```
