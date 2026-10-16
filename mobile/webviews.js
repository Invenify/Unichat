// webviews.js — pont entre l'UI mobile et le plugin natif UniChatWebViews
// (Capacitor Android, android/app/src/main/java/com/hugo/unichat/).
//
// En dehors du natif (navigateur de bureau, tests jsdom) : mode dégradé —
// open() retourne false, tout le reste est un no-op, aucune méthode ne lève.
// L'UI garde alors son comportement actuel (placeholder dans le slot).

function cap() {
  return typeof window !== 'undefined' ? window.Capacitor : undefined;
}

function plugin() {
  const c = cap();
  if (!c || typeof c.isNativePlatform !== 'function' || !c.isNativePlatform()) return null;
  if (c.Plugins && c.Plugins.UniChatWebViews) return c.Plugins.UniChatWebViews;
  // Proxy global injecté par le pont en l'absence de wrapper JS.
  return typeof window.UniChatWebViews !== 'undefined' ? window.UniChatWebViews : null;
}

function onError() {
  // Échec silencieux : l'UI reste utilisable, la session native aussi.
}

export function nativeWebViews() {
  return plugin() !== null;
}

export const webviews = {
  available: nativeWebViews,

  // Crée (ou réutilise) la WebView du service et la positionne sur le slot.
  async open(svc, url, rect) {
    const p = plugin();
    if (!p) return false;
    try {
      await p.open({ id: svc.id, url, blockNav: svc.blockNavRegex || null, ...rect });
      return true;
    } catch {
      return false;
    }
  },

  async position(rect) {
    const p = plugin();
    if (p) p.position({ ...rect }).catch(onError);
  },

  // Masque la WebView (session vivante en arrière-plan).
  async close() {
    const p = plugin();
    if (p) p.close().catch(onError);
  },

  // Un bottom-sheet s'ouvre au-dessus : une vue native couvre toujours le
  // DOM, le z-index CSS ne peut rien — on masque la vue le temps du sheet.
  async hide() {
    const p = plugin();
    if (p) p.hide().catch(onError);
  },

  async show() {
    const p = plugin();
    if (p) p.show().catch(onError);
  },

  // « Déconnecter » : cookies + stockage du domaine, côté natif.
  async clearSession(url) {
    const p = plugin();
    if (p) p.clearSession({ url }).catch(onError);
  },

  async destroy(id) {
    const p = plugin();
    if (p) p.destroy({ id }).catch(onError);
  },

  // events "page" { id, url, title } — titre/URL de la vue → historique.
  onPage(cb) {
    const p = plugin();
    if (!p) return () => {};
    let handle = null;
    p.addListener('page', cb).then((h) => { handle = h; }).catch(onError);
    return () => { if (handle && handle.remove) handle.remove(); };
  },

  // "closed" : le retour système a fermé la vue → recacher le holder.
  onClosed(cb) {
    const p = plugin();
    if (!p) return () => {};
    let handle = null;
    p.addListener('closed', cb).then((h) => { handle = h; }).catch(onError);
    return () => { if (handle && handle.remove) handle.remove(); };
  },
};
