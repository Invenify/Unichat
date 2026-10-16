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
- **Catalogue** (`src/main/catalog.js`, déclaratif, 20 services : ChatGPT,
  Claude, Gemini, Copilot, Perplexity, Le Chat, Euria, Lumo, Grok,
  DeepSeek, HuggingChat, Poe, Qwen, Kimi, Meta AI, Character.AI, You.com,
  Z.ai, Pi, **DiDi** = chat.nexio.ovh, vert #3aa14d).
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
5. pas la racine du service (origine + chemin, paramètres ignorés).

`isChatUrl` est exporté (utilisé par les tests et la purge d'historique).

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
  `node test/smoke.js` (52 PASS attendus, 54 si le réseau répond pour
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
4. **#4 — Comparaison** : même prompt relayé vers N services + vues en
   colonnes (découpage des bounds des WebContentsView).
5. **#6 — Systray** (fermeture en arrière-plan), **#7 — épingler des favoris**.
6. **#5 — Recettes non-lus** (fragile, optionnel).
7. **#9 — Packaging réel** : `npm run dist:win` / `dist:mac` jamais testés
   (icône OK : electron-builder convertit `build/icon.png`). Tester un
   vrai build.
8. **#10 — Android via Capacitor** (phase 6 du plan d'origine).

## 6. Architecture (rappel rapide)

```
src/
├── main/
│   ├── main.js        # fenêtre, vues par service, IPC, modalOpen, blocage nav
│   ├── registry.js    # services.json (enabled, customLogo, excludeRegex, blockNavRegex)
│   ├── catalog.js     # catalogue déclaratif + sameOrigin
│   ├── metadata.js    # analyse auto d'une URL
│   └── logos.js       # import d'un logo → userData/logos/ (schéma unichat-logo://)
├── preload/preload.js # pont IPC (getCatalog, setServiceEnabled, setModalOpen, relayCopy, importLogo…)
├── renderer/          # sidebar, wizard, popup catalogue, relais (app.js, theme.css)
├── engine/
│   ├── title-tracker.js  # did-navigate/page-title-updated → historique
│   └── conv-store.js     # history.json (100 % local)
└── scripts/make-icon.js   # logo licorne (pur Node)
```

Données : `~/.config/unichat/` → `services.json`, `history.json`,
partitions `Partitions/persist:<id>`.
