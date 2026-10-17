// make-icon.js — génère le logo UniChat : une licorne qui parle (bulle de dialogue).
// Tout est dessiné en SDF (signed distance fields) puis encodé en PNG à la main
// (zlib), zéro dépendance. Sorties :
//   build/icon.png                    — icône de l'app (512px, convertie en
//                                       .ico/.icns par electron-builder au build)
//   src/renderer/assets/logo.png      — même image, logo de la sidebar

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const OUT_ICON = path.join(__dirname, '..', 'build', 'icon.png');
const OUT_LOGO = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'logo.png');

// --- Palette ---
const ACCENT = [0x6c, 0x5c, 0xe7];
const ACCENT2 = [0xa2, 0x9b, 0xfe];
const WHITE = [255, 255, 255];
const SHADOW = [0xf3, 0xf0, 0xfb]; // museau, très léger gris-lavande
const DARK = [0x44, 0x3a, 0x63]; // yeux, narines
const GOLD = [0xff, 0xd2, 0x1e]; // corne
const GOLD2 = [0xf5, 0xb9, 0x16]; // rayures de la corne

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// --- SDF primitives ---
function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdEllipse(px, py, cx, cy, rx, ry) {
  const d = Math.hypot((px - cx) / rx, (py - cy) / ry) - 1;
  return d * Math.min(rx, ry);
}

function pointSegDist(px, py, ax, ay, bx, by) {
  const ex = bx - ax;
  const ey = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey)));
  return Math.hypot(px - (ax + ex * t), py - (ay + ey * t));
}

function sdTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d01 = pointSegDist(px, py, ax, ay, bx, by);
  const d12 = pointSegDist(px, py, bx, by, cx, cy);
  const d20 = pointSegDist(px, py, cx, cy, ax, ay);
  const outside = Math.min(d01, d12, d20);
  // Intérieur = les trois produits vectoriels sont de même signe
  // (test exact, contrairement à la formule de Quilez qui délire loin du triangle).
  const s1 = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const s2 = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  const s3 = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  const inside = (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  return inside ? -outside : outside;
}

// --- Couches, peintes de l'arrière vers l'avant ---
// Chaque couche : dist(x, y) → SDF, color(x, y) → [r, g, b].
const layers = [
  {
    // Fond : carré arrondi en dégradé accent → accent2.
    dist: (x, y) => sdRoundRect(x, y, 256, 256, 246, 246, 96) + 10,
    color: (x, y) => mix(ACCENT, ACCENT2, (x + y) / (2 * SIZE)),
  },
  {
    // Crinière : trois disques mauves derrière la tête.
    dist: (x, y) => Math.min(
      sdCircle(x, y, 150, 205, 60),
      sdCircle(x, y, 256, 150, 62),
      sdCircle(x, y, 362, 205, 60)
    ),
    color: (x, y) => mix(mix(ACCENT2, WHITE, 0.35), WHITE, (y - 140) / 140),
  },
  {
    // Oreilles.
    dist: (x, y) => Math.min(
      sdTriangle(x, y, 185, 228, 222, 210, 168, 152),
      sdTriangle(x, y, 290, 210, 327, 228, 344, 152)
    ),
    color: () => WHITE,
  },
  {
    // Tête.
    dist: (x, y) => sdCircle(x, y, 256, 310, 105),
    color: () => WHITE,
  },
  {
    // Corne : triangle doré, rayures horizontales alternées.
    dist: (x, y) => sdTriangle(x, y, 233, 225, 279, 225, 256, 78),
    color: (x, y) => (Math.floor((y - 78) / 24) % 2 === 0 ? GOLD : GOLD2),
  },
  {
    // Museau.
    dist: (x, y) => sdEllipse(x, y, 256, 362, 68, 46),
    color: () => SHADOW,
  },
  {
    // Narines.
    dist: (x, y) => Math.min(
      sdEllipse(x, y, 230, 368, 9, 12),
      sdEllipse(x, y, 282, 368, 9, 12)
    ),
    color: () => DARK,
  },
  {
    // Yeux.
    dist: (x, y) => Math.min(
      sdCircle(x, y, 203, 295, 11),
      sdCircle(x, y, 309, 295, 11)
    ),
    color: () => DARK,
  },
  {
    // Queue de la bulle : part du bord bas-gauche de la bulle, pointe vers la
    // tête en s'arrêtant sur la crinière — sans toucher l'oreille blanche.
    dist: (x, y) => sdTriangle(x, y, 336, 146, 374, 152, 344, 194),
    color: () => DARK,
  },
  {
    // Bulle de dialogue : « la licorne qui parle ». Fond sombre pour trancher
    // sur le dégradé clair du coin, points blancs pour être lisibles à 28 px.
    dist: (x, y) => sdRoundRect(x, y, 392, 105, 72, 45, 26),
    color: () => DARK,
  },
  {
    // Points de la bulle (blancs).
    dist: (x, y) => Math.min(
      sdCircle(x, y, 362, 105, 9),
      sdCircle(x, y, 392, 105, 9),
      sdCircle(x, y, 422, 105, 9)
    ),
    color: () => WHITE,
  },
];

function render() {
  // Accumulation premultipliée (opérateur « over »), RGBA 8 bits en sortie.
  const r = new Float64Array(SIZE * SIZE);
  const g = new Float64Array(SIZE * SIZE);
  const b = new Float64Array(SIZE * SIZE);
  const a = new Float64Array(SIZE * SIZE);

  for (const layer of layers) {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const alpha = Math.max(0, Math.min(1, 0.5 - layer.dist(px, py)));
        if (alpha <= 0) continue;
        const c = layer.color(px, py);
        const i = y * SIZE + x;
        const aOld = a[i];
        const aNew = alpha + aOld * (1 - alpha);
        r[i] = c[0] * alpha + r[i] * (1 - alpha);
        g[i] = c[1] * alpha + g[i] * (1 - alpha);
        b[i] = c[2] * alpha + b[i] * (1 - alpha);
        a[i] = aNew;
      }
    }
  }

  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    const rowStart = y * (SIZE * 4 + 1);
    raw[rowStart] = 0; // filtre PNG : None
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const o = rowStart + 1 + x * 4;
      const al = a[i];
      raw[o] = al > 0 ? Math.min(255, Math.round(r[i] / al)) : 0;
      raw[o + 1] = al > 0 ? Math.min(255, Math.round(g[i] / al)) : 0;
      raw[o + 2] = al > 0 ? Math.min(255, Math.round(b[i] / al)) : 0;
      raw[o + 3] = Math.round(al * 255);
    }
  }
  return { raw, r, g, b, a };
}

// --- Encodage PNG minimal (RGBA, 8 bits) ---

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(raw, width = SIZE, height = width) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const png = encodePng(render().raw);
fs.mkdirSync(path.dirname(OUT_ICON), { recursive: true });
fs.writeFileSync(OUT_ICON, png);
fs.mkdirSync(path.dirname(OUT_LOGO), { recursive: true });
fs.writeFileSync(OUT_LOGO, png);
console.log('OK ' + OUT_ICON + ' (' + png.length + ' octets)');
console.log('OK ' + OUT_LOGO);

module.exports = { render, layers, encodePng };
