// metadata.js — auto-détection des métadonnées d'un service.
// Fetch du <head> de la page : favicon, theme-color, manifest.json, <title>.
// Aucune connaissance spécifique d'un service : que du HTML standard.

const DEFAULT_ACCENT = '#6c5ce7';
const DEFAULT_ACCENT2 = '#a29bfe';

function normalizeUrl(raw) {
  let url = String(raw).trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  return url;
}

function resolveUrl(base, href) {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function extractAttr(tag, attr) {
  const re = new RegExp(`${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = tag.match(re);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? null;
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

function pickFavicon(head, baseUrl) {
  const links = head.match(/<link\b[^>]*>/gi) || [];
  const candidates = [];
  for (const link of links) {
    const rel = (extractAttr(link, 'rel') || '').toLowerCase();
    if (!/(^|\s)(icon|apple-touch-icon)(\s|$)|shortcut icon/.test(rel)) continue;
    const href = extractAttr(link, 'href');
    const resolved = resolveUrl(baseUrl, href);
    if (!resolved) continue;
    // Score : apple-touch-icon et rel="icon" avec type image/png privilégiés.
    let score = 0;
    if (rel.includes('apple-touch-icon')) score += 2;
    if (rel.includes('icon')) score += 1;
    const type = (extractAttr(link, 'type') || '').toLowerCase();
    if (type === 'image/png' || type === 'image/svg+xml') score += 1;
    const sizes = extractAttr(link, 'sizes') || '';
    const sizeMatch = sizes.match(/(\d+)x(\d+)/i);
    if (sizeMatch) score += Math.min(parseInt(sizeMatch[1], 10) / 64, 3);
    candidates.push({ url: resolved, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length > 0) return candidates[0].url;
  return resolveUrl(baseUrl, '/favicon.ico');
}

function pickThemeColor(head) {
  const metas = head.match(/<meta\b[^>]*>/gi) || [];
  for (const meta of metas) {
    const name = (extractAttr(meta, 'name') || '').toLowerCase();
    if (name === 'theme-color') {
      const c = extractAttr(meta, 'content');
      if (c) return c.trim();
    }
  }
  return null;
}

function pickManifestUrl(head, baseUrl) {
  const links = head.match(/<link\b[^>]*>/gi) || [];
  for (const link of links) {
    const rel = (extractAttr(link, 'rel') || '').toLowerCase();
    if (rel === 'manifest') return resolveUrl(baseUrl, extractAttr(link, 'href'));
  }
  return null;
}

function pickTitle(head) {
  const m = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]).trim() : null;
}

// « Tronqué proprement » : garde le premier segment avant un séparateur.
function cleanName(title, baseUrl) {
  if (title) {
    const seg = title.split(/\s+[–—|·•]\s+/)[0].trim();
    if (seg && seg.length > 0 && seg.length <= 40) return seg;
    if (seg) return seg.slice(0, 40).trim();
  }
  try {
    return new URL(baseUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'Nouveau service';
  }
}

async function fetchHead(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  // Le <head> suffit ; on coupe si le body commence tôt.
  const endHead = text.search(/<\/head>/i);
  return endHead === -1 ? text.slice(0, 100000) : text.slice(0, endHead);
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Point d'entrée du wizard « Analyser ».
async function analyzeUrl(rawUrl) {
  const url = normalizeUrl(rawUrl);
  const head = await fetchHead(url);

  const faviconUrl = pickFavicon(head, url);
  let accent = pickThemeColor(head);
  let accent2 = null;

  const manifestUrl = pickManifestUrl(head, url);
  if (manifestUrl) {
    const manifest = await fetchJson(manifestUrl);
    if (manifest) {
      accent = accent || manifest.theme_color || null;
      accent2 = manifest.background_color || null;
    }
  }

  return {
    url,
    name: cleanName(pickTitle(head), url),
    faviconUrl,
    accent: accent || DEFAULT_ACCENT,
    accent2: accent2 || DEFAULT_ACCENT2,
  };
}

module.exports = { analyzeUrl, normalizeUrl, DEFAULT_ACCENT, DEFAULT_ACCENT2 };
