// trackers.js — domaines de pistage/publicité bloqués dans les vues des
// services (réglage « Vie privée », desktop). Liste volontairement courte
// et conservatrice : uniquement du pistage et de la pub, jamais rien qui
// puisse casser une connexion ou un chat. Si un site en avait besoin, le
// réglage se désactive en un clic.

const TRACKER_DOMAINS = [
  // Publicité
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'adnxs.com',
  'criteo.com',
  'taboola.com',
  'outbrain.com',
  'adsrvr.org',
  'rubiconproject.com',
  'pubmatic.com',
  'ads-twitter.com',
  // Mesure d'audience
  'google-analytics.com',
  'googletagmanager.com',
  'scorecardresearch.com',
  'quantserve.com',
  'hotjar.com',
  'clarity.ms',
  'mixpanel.com',
  'amplitude.com',
  'mc.yandex.ru',
  // Réseaux sociaux (pixels)
  'facebook.net',
  'bat.bing.com',
];

// true si l'URL pointe vers un domaine de la liste (sous-domaines inclus).
function isTrackerUrl(url) {
  try {
    const host = new URL(url).hostname;
    return TRACKER_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

module.exports = { TRACKER_DOMAINS, isTrackerUrl };
