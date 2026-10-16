# UniChat

Tous vos chats IA dans une seule interface. Desktop (Electron, Windows/Mac) et, à terme, Android (Capacitor).

## Concept

- **Registre de services dynamique** : on colle l'URL d'un chat IA, l'app récupère automatiquement le nom, le logo (favicon) et les couleurs (theme-color, manifest.json), modifiables avant enregistrement.
- **Moteur de titres universel** : à chaque navigation dans un WebView, l'app enregistre `{serviceId, url, titre de la page, date}`. La sidebar est construite à partir de cet historique local — aucun sélecteur CSS à maintenir, le titre de la page EST le titre du chat.
- **Finitions** : édition d'un service (nom, couleurs, logo), suppression avec session conservable ou déconnectée, barre d'adresse affichant l'URL courante, export/import du registre en JSON (fusion par URL), raccourcis Ctrl/Cmd+1…9 et Ctrl/Cmd+K.
- **Catalogue de services connus** (`src/main/catalog.js`, purement déclaratif) : au premier lancement, une popup propose les chats IA connus (ChatGPT, Claude, Gemini, Euria, Lumo, Le Chat, DiDI…). Le bouton ⚙ rouvre cette popup pour activer/désactiver à tout moment — désactiver conserve la session et l'historique.
- **Règle d'or** : aucun code spécifique à un service. Un service = une entrée JSON dans le registre.

## Démarrage

```bash
npm install
npm start
```

- `npm run icon` — génère le logo « licorne qui parle » : `build/icon.png` (512px, converti en .ico/.icns par electron-builder) et `src/renderer/assets/logo.png` (sidebar)
- `npm run dist:win` — packaging NSIS Windows
- `npm run dist:mac` — packaging DMG Mac (icônes `build/icon.ico` / `build/icon.icns`)

## Architecture

```
src/
├── main/
│   ├── main.js            # Fenêtre, WebContentsView par service, IPC
│   ├── registry.js        # Registre de services (services.json)
│   └── metadata.js        # Analyse auto d'une URL : favicon, couleurs, titre
├── preload/preload.js     # Pont IPC
├── renderer/              # UI (sidebar, wizard)
│   ├── index.html
│   ├── app.js
│   └── theme.css
├── engine/
│   ├── title-tracker.js   # did-navigate / page-title-updated → historique
│   └── conv-store.js      # Historique local (history.json, 100 % local)
└── recipes/               # OPTIONNEL : sélecteurs par service (non-lus, listes complètes)
```

## Données (100 % locales)

| Fichier | Contenu |
|---|---|
| `userData/services.json` | Registre des services (id, nom, url, couleurs, logo, enabled) |
| `userData/history.json` | Historique des chats visités, dédoublonné par (service, url) |
| Partitions `persist:<id>` | Sessions/cookies par service, conservées entre lancements |

## Recettes optionnelles

Le moteur de titres ne donne ni les non-lus ni les conversations jamais ouvertes. Pour cela, déposez `recipes/<domaine>.json` :

```json
{
  "listSelector": "...",
  "itemSelector": "...",
  "titleSelector": "...",
  "linkSelector": "...",
  "unreadSelector": "..."
}
```

L'app fonctionne toujours sans recette ; les sélecteurs se trouvent à la main via F12 (ne jamais les inventer).

## Vie privée

Historique 100 % local ; aucun envoi réseau autre que vers les services eux-mêmes. Pour Lumo (E2EE), on ne capture que le titre affiché à l'écran, sur l'appareil.
