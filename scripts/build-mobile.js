// build-mobile.js — construit l'UI mobile (mobile/) vers www/ (webDir Capacitor).
// esbuild bundle app.js : les modules CommonJS de src/shared/ sont résolus et
// inclus sans outil supplémentaire. Les fichiers statiques sont copiés.

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'mobile');
const OUT = path.join(ROOT, 'www');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(SRC, 'app.js')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: 'es2020',
  outfile: path.join(OUT, 'app.js'),
  logLevel: 'info',
});

for (const name of ['index.html', 'theme.css']) {
  fs.copyFileSync(path.join(SRC, name), path.join(OUT, name));
}

// Logos du catalogue : servis localement (affichage garanti hors ligne).
fs.cpSync(path.join(ROOT, 'src/renderer/assets/logos'), path.join(OUT, 'assets/logos'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'src/renderer/assets/logo.png'), path.join(OUT, 'assets/logo.png'));

console.log('www/ construit.');
