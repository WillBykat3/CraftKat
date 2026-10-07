// Local web server for playing/testing:  npm run dev  ->  http://localhost:8080
// --relay  also starts a local signaling relay (ws://localhost:8787) so you can test
//          multiplayer offline by opening  http://localhost:8080/?relay=ws://localhost:8787

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', process.argv.includes('--dist') ? 'dist' : 'public');
const port = Number(process.env.PORT) || 8080;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  const file = path.join(root, p.endsWith('/') ? p + 'index.html' : p);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': (TYPES[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(port, () => console.log(`BlockCraft running at http://localhost:${port}`));

if (process.argv.includes('--relay')) {
  const { createWsRelayServer } = await import('@trystero-p2p/ws-relay/server');
  createWsRelayServer({ port: 8787 });
  console.log(`Local relay on ws://localhost:8787 -> open http://localhost:${port}/?relay=ws://localhost:8787`);
}
