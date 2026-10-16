Recettes optionnelles de sélecteurs CSS, une par domaine : <domaine>.json

Format :
{
  "listSelector": "...",
  "itemSelector": "...",
  "titleSelector": "...",
  "linkSelector": "...",
  "unreadSelector": "..."
}

Règles :
- Trouvez les sélecteurs à la main via F12 ; ne les inventez jamais.
- Si aucune recette n'existe pour un domaine, l'app reste pleinement
  fonctionnelle en mode titres seuls.
- Si les sélecteurs ne matchent plus (interface changée), l'état dégradé
  doit rester silencieux.
