// Prepares the game for static hosting (GitHub Pages):
//   public/vendor/  <- three.js + bundled Trystero (needed for local play too)
//   dist/           <- everything to upload (only with --dist)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const vendor = path.join(pub, 'vendor');

fs.mkdirSync(vendor, { recursive: true });
for (const file of ['three.module.js', 'three.core.js']) {
  fs.copyFileSync(path.join(root, 'node_modules', 'three', 'build', file), path.join(vendor, file));
}
await build({
  entryPoints: [path.join(root, 'scripts', 'trystero-entry.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
  platform: 'browser',
  outfile: path.join(vendor, 'trystero.js'),
  logLevel: 'warning',
});
console.log('vendor files ready in public/vendor');

if (process.argv.includes('--dist')) {
  const dist = path.join(root, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.cpSync(pub, dist, { recursive: true });
  fs.writeFileSync(path.join(dist, '.nojekyll'), ''); // serve files as-is on GitHub Pages
  console.log('site ready in dist/');
}
