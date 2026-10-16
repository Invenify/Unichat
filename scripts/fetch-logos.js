// fetch-logos.js — récupère UNE FOIS les logos du catalogue et les range en
// local (src/renderer/assets/logos/). Une fois les fichiers commités, plus
// aucune requête réseau n'est nécessaire : les logos s'affichent toujours,
// même hors ligne, même si le site bloque les favicons distants.
//
//   node scripts/fetch-logos.js
//
// Sources essayées dans l'ordre (toutes gratuites, sans clé) :
//   1. favicon direct du site (favicon.ico, /static/favicon.png…) ;
//   2. Google faviconV2 (gstatic) — ce que sert www.google.com/s2/favicons ;
//   3. www.google.com/s2/favicons?sz=64 en secours.
// Le fichier n'est gardé que si c'est une vraie image (PNG/JPEG/GIF/ICO/SVG)
// et que la réponse est 200.

const fs = require('fs');
const path = require('path');

const catalog = require(path.join(__dirname, '..', 'src/main/catalog'));

const OUT_DIR = path.join(__dirname, '..', 'src/renderer/assets/logos');

// Favicons directs connus (meilleure qualité que le proxy Google).
const DIRECT = {
  'chat.nexio.ovh': '/static/favicon.png',
  'www.perplexity.ai': '/favicon.svg',
};

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function ext(bytes) {
  const b = Buffer.from(bytes);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 6 && b.toString('ascii', 0, 3) === 'GIF') return 'gif';
  if (b.length >= 4 && b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'ico';
  if (b.length >= 4 && b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x02 && b[3] === 0x00) return 'cur';
  const head = b.toString('utf8', 0, Math.min(512, b.length)).trim();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'svg';
  if (b.length >= 4 && b.toString('ascii', 0, 4) === 'RIFF') return 'webp';
  return null;
}

async function tryFetch(url) {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) UniChat/0.1' },
    });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 100) return null;
    const e = ext(bytes);
    if (!e) return null;
    return { bytes, ext: e };
  } catch {
    return null;
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifest = {};
  let failures = [];

  for (const entry of catalog.list()) {
    const u = new URL(entry.url);
    const domain = u.hostname;
    const name = slug(entry.name);

    const sources = [];
    const directPath = DIRECT[domain] || '/favicon.ico';
    sources.push(`${u.origin}${directPath}`);
    sources.push(
      `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(entry.url)}&size=64`
    );
    sources.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=64`);

    let got = null;
    let used = -1;
    for (let i = 0; i < sources.length && !got; i++) {
      got = await tryFetch(sources[i]);
      if (got) used = i;
    }

    if (!got) {
      failures.push(entry.name);
      continue;
    }

    const file = `${name}.${got.ext}`;
    fs.writeFileSync(path.join(OUT_DIR, file), got.bytes);
    manifest[entry.name] = `assets/logos/${file}`;
    console.log(
      `${entry.name.padEnd(14)} -> ${file} (${got.bytes.length} o, source ${used === 0 ? 'direct' : used === 1 ? 'gstatic' : 's2'})`
    );
  }

  if (failures.length) {
    console.error('ÉCHECS :', failures.join(', '));
    process.exitCode = 1;
  } else {
    console.log('Tous les logos sont téléchargés.');
  }
}

main();
