// Assemble the static site into ./dist for Cloudflare Workers static-asset deploys.
// Root stays the source of truth; ./dist is generated (git-ignored) and rebuilt here.
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// The files that make up the deployable app (source lives at the repo root).
// NOTE: minification is intentionally left to Cloudflare (Auto-Minify / brotli)
// or a real bundler (esbuild / lightningcss) — a hand-rolled minifier would
// corrupt the regex literals in script.js and the data-URI SVG masks in style.css.
const FILES = [
  'index.html',
  'style.css',
  'script.js',
  'sw.js',
  'manifest.json',
  'robots.txt',
  'sitemap.xml',
  'openapi.json',
  'api-docs.html',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

let copied = 0;
for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { console.warn('skip (missing):', f); continue; }
  fs.copyFileSync(src, path.join(DIST, f));
  copied++;
}

console.log(`Built ${copied} assets into ./dist`);
