// make-android-icons.js — icônes Android du logo UniChat (licorne).
// Réutilise les calques SDF de make-icon.js pour re-rendre le logo à chaque
// densité nettement (anti-aliasing par SDF, pas de redimensionnement).
// Pur Node, zéro dépendance. Sorties (android/app/src/main/res) :
//   mipmap-*/ic_launcher.png|ic_launcher_round.png  — launcher legacy
//   mipmap-*/ic_launcher_foreground.png             — icône adaptative
//   drawable*/splash.png                            — écran de lancement
//   drawable/ic_launcher_background.xml             — fond dégradé adaptatif
//   mipmap-anydpi-v26/*.xml                         — patchés vers ce drawable

const fs = require('fs');
const path = require('path');
const { layers, encodePng } = require('./make-icon.js');

const RES = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

// Licorne seule (sans le fond en carré arrondi) : calques 1..n de make-icon.
// Enveloppe du glyphe dans l'espace 512 : x 90..464, y 60..415 (bulle incluse).
const GLYPH = layers.slice(1);
const GLYPH_CX = 277;   // centre de l'enveloppe (espace 512)
const GLYPH_CY = 237.5;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Rend `calques` dans un canvas WxH. Le logo (espace 512) occupe `span`
// pixels, centré sur le point (cx, cy) de l'espace 512. `seed` = fond blanc
// opaque (splash). Retourne RGBA prémultiplié.
function render(W, H, span, cx, cy, calques, seed) {
  const r = new Float64Array(W * H).fill(seed ? 255 : 0);
  const g = new Float64Array(W * H).fill(seed ? 255 : 0);
  const b = new Float64Array(W * H).fill(seed ? 255 : 0);
  const a = new Float64Array(W * H).fill(seed ? 1 : 0);
  const k = 512 / span; // unités espace-512 par pixel
  for (const layer of calques) {
    for (let y = 0; y < H; y++) {
      const py = cy + (y + 0.5 - H / 2) * k;
      if (py < -8 || py > 520) continue; // hors logo (marge anti-aliasing)
      for (let x = 0; x < W; x++) {
        const px = cx + (x + 0.5 - W / 2) * k;
        if (px < -8 || px > 520) continue;
        const alpha = clamp01(0.5 - layer.dist(px, py) / k);
        if (alpha <= 0) continue;
        const c = layer.color(px, py);
        const i = y * W + x;
        r[i] = c[0] * alpha + r[i] * (1 - alpha);
        g[i] = c[1] * alpha + g[i] * (1 - alpha);
        b[i] = c[2] * alpha + b[i] * (1 - alpha);
        a[i] = alpha + a[i] * (1 - alpha);
      }
    }
  }
  return { r, g, b, a };
}

// Dé-prémultiplie en tampon brut RGBA ; `mask` module l'alpha (icône ronde).
function rawRgba(img, W, H, mask) {
  const { r, g, b, a } = img;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    const row = y * (W * 4 + 1);
    raw[row] = 0; // filtre PNG : None
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const al = mask ? a[i] * mask(x, y, W, H) : a[i];
      const o = row + 1 + x * 4;
      raw[o] = a[i] > 0 ? Math.min(255, Math.round(r[i] / a[i])) : 0;
      raw[o + 1] = a[i] > 0 ? Math.min(255, Math.round(g[i] / a[i])) : 0;
      raw[o + 2] = a[i] > 0 ? Math.min(255, Math.round(b[i] / a[i])) : 0;
      raw[o + 3] = Math.round(al * 255);
    }
  }
  return raw;
}

const circleMask = (x, y, W, H) =>
  clamp01(0.5 - (Math.hypot(x + 0.5 - W / 2, y + 0.5 - H / 2) - Math.min(W, H) / 2));

function write(png, rel) {
  fs.writeFileSync(path.join(RES, rel), png);
  console.log('OK ' + rel);
}

// --- Launcher legacy : la tuile complète (fond dégradé + licorne). ---
// --- Adaptatif : glyphe seul sur fond dégradé (drawable ci-dessous). ---
// Glyphe ~52 dp sur le canvas 108 dp : la bulle reste dans la zone sûre
// (cercle 66 dp) quel que soit le masque du launcher.
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, mult] of Object.entries(DENSITIES)) {
  const S = Math.round(48 * mult);
  write(encodePng(rawRgba(render(S, S, S, 256, 256, layers), S, S), S), `mipmap-${d}/ic_launcher.png`);
  write(encodePng(rawRgba(render(S, S, S, 256, 256, layers), S, S, circleMask), S), `mipmap-${d}/ic_launcher_round.png`);

  const F = Math.round(108 * mult);
  write(encodePng(rawRgba(render(F, F, 0.65 * F, GLYPH_CX, GLYPH_CY, GLYPH), F, F), F), `mipmap-${d}/ic_launcher_foreground.png`);
}

// --- Fond de l'icône adaptative : même dégradé que la tuile (accent → accent2).
fs.writeFileSync(path.join(RES, 'drawable', 'ic_launcher_background.xml'),
`<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <gradient android:angle="315" android:startColor="#665CE7" android:endColor="#A29BFE" android:type="linear"/>
</shape>
`);
for (const name of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  const p = path.join(RES, 'mipmap-anydpi-v26', name);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8')
    .replace('@color/ic_launcher_background', '@drawable/ic_launcher_background'));
  console.log('OK mipmap-anydpi-v26/' + name);
}

// --- Splash : logo centré sur fond blanc, mêmes dimensions par fichier. ---
const pngSize = (p) => {
  const d = fs.readFileSync(p);
  return { W: d.readUInt32BE(16), H: d.readUInt32BE(20) };
};
for (const dir of fs.readdirSync(RES).filter((n) => n.startsWith('drawable'))) {
  const p = path.join(RES, dir, 'splash.png');
  if (!fs.existsSync(p)) continue;
  const { W, H } = pngSize(p);
  const span = 0.28 * Math.min(W, H);
  write(encodePng(rawRgba(render(W, H, span, 256, 256, layers, true), W, H), W, H), `${dir}/splash.png`);
}
