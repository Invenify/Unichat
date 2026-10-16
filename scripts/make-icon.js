// make-icon.js — génère build/icon.png (512x512) sans dépendance.
// Carré arrondi en dégradé (accent → accent2) + glyphe « U » blanc.
// electron-builder convertit ce PNG en .ico (NSIS) et .icns (dmg) au build.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const OUT = path.join(__dirname, '..', 'build', 'icon.png');

const ACCENT = [0x6c, 0x5c, 0xe7]; // #6c5ce7
const ACCENT2 = [0xa2, 0x9b, 0xfe]; // #a29bfe
const WHITE = [255, 255, 255];

// Distance signée à un rectangle arrondi centré en (cx, cy), demi-tailles (hw, hh).
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

// « U » = contour de rectangle arrondi extérieur, moins le creux intérieur.
function glyphDistance(px, py) {
  const outer = sdRoundRect(px, py, 256, 246, 106, 126, 40);
  const inner = sdRoundRect(px, py, 256, 216, 46, 96, 26);
  if (outer > 0) return outer;
  // À l'intérieur du contour : le creux ne compte que s'il est vraiment ouvert en haut.
  return -Math.min(-outer, inner);
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Alpha lissé sur ~1 px autour du zéro de la SDF.
function alpha(dist) {
  return Math.max(0, Math.min(1, 0.5 - dist));
}

function render() {
  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    const row = Buffer.alloc(1 + SIZE * 4); // filtre 0 (None) + RGBA
    for (let x = 0; x < SIZE; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const bgDist = sdRoundRect(px, py, 256, 256, 246, 246, 96) + 10; // marge
      const gDist = glyphDistance(px, py);
      const gA = alpha(gDist);
      const bgA = alpha(bgDist);
      const grad = mix(ACCENT, ACCENT2, (px + py) / (2 * SIZE));
      const color = gA > 0.5 ? WHITE : grad;
      const a = Math.max(bgA, gA > 0.5 ? bgA : 0);
      const o = 1 + x * 4;
      row[o] = color[0];
      row[o + 1] = color[1];
      row[o + 2] = color[2];
      row[o + 3] = Math.round(a * 255);
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
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

function encodePng(raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, encodePng(render()));
console.log('OK ' + OUT + ' (' + SIZE + 'x' + SIZE + ', ' + fs.statSync(OUT).size + ' octets)');
