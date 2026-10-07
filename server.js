// BlockCraft server: serves the game to browsers and relays multiplayer state.
//
//   npm start                      -> http://localhost:3000
//   PORT=8080 npm start            -> different port
//   SERVER_PASSWORD=secret npm start  -> friends need the password to join

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { BLOCKS, BLOCK, HEIGHT } from './public/js/blocks.js';
import { World } from './public/js/world.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const VENDOR_DIR = path.join(ROOT, 'node_modules', 'three', 'build');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PASSWORD = process.env.SERVER_PASSWORD || '';
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 20;
const WORLD_FILE = process.env.WORLD_FILE || path.join(ROOT, 'world-data.json');
const REACH_LIMIT = 10; // blocks; a bit more than the client's reach to allow for lag

// ---------- world persistence ----------
function loadWorldFile() {
  try {
    const saved = JSON.parse(fs.readFileSync(WORLD_FILE, 'utf8'));
    if (Number.isInteger(saved.seed)) return saved;
    console.warn(`${WORLD_FILE} has no valid seed; starting a new world.`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`Could not read ${WORLD_FILE} (${err.message}); starting a new world.`);
  }
  const envSeed = Number.parseInt(process.env.WORLD_SEED, 10);
  const seed = Number.isInteger(envSeed) ? envSeed : crypto.randomInt(1, 2 ** 31 - 1);
  return { seed, edits: [], lastPositions: {} };
}

const saved = loadWorldFile();
const world = new World(saved.seed);
world.importEdits(Array.isArray(saved.edits) ? saved.edits : []);
const lastPositions = saved.lastPositions && typeof saved.lastPositions === 'object' ? saved.lastPositions : {};
let dirty = false;

function saveWorld() {
  if (!dirty) return;
  dirty = false;
  const data = JSON.stringify({ seed: world.seed, edits: world.exportEdits(), lastPositions });
  const tmp = WORLD_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, WORLD_FILE); // atomic, so a crash never leaves a half-written file
  } catch (err) {
    dirty = true;
    console.error('Failed to save world:', err.message);
  }
}
setInterval(saveWorld, 10_000).unref();

// ---------- static files ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

function serveFile(res, root, relPath) {
  const filePath = path.join(root, relPath);
  // refuse anything that escapes the root (e.g. /../server.js)
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  if (pathname.startsWith('/vendor/')) {
    serveFile(res, VENDOR_DIR, pathname.slice('/vendor/'.length));
    return;
  }
  serveFile(res, PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname.slice(1));
});

// ---------- multiplayer ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
const players = new Map(); // ws -> player
let nextId = 1;

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg, except = null) {
  const data = JSON.stringify(msg);
  for (const [ws] of players) if (ws !== except && ws.readyState === ws.OPEN) ws.send(data);
}

function systemMessage(text) {
  broadcast({ t: 'sys', msg: text });
  console.log(`[server] ${text}`);
}

function passwordOk(given) {
  if (!PASSWORD) return true;
  const a = crypto.createHash('sha256').update(String(given ?? '')).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function cleanName(raw) {
  let name = String(raw ?? '').replace(/[^A-Za-z0-9_\- ]/g, '').trim().slice(0, 16);
  if (!name) name = 'Player' + Math.floor(Math.random() * 1000);
  const taken = new Set([...players.values()].map((p) => p.name.toLowerCase()));
  let unique = name;
  for (let i = 2; taken.has(unique.toLowerCase()); i++) unique = name.slice(0, 13) + i;
  return unique;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);

// Simple token bucket: allows `rate` actions per second with bursts up to `burst`.
function bucket(rate, burst) {
  let tokens = burst;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * rate);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

function handleHello(ws, msg) {
  if (!passwordOk(msg.password)) {
    send(ws, { t: 'error', msg: 'Wrong server password.' });
    ws.close();
    return;
  }
  if (players.size >= MAX_PLAYERS) {
    send(ws, { t: 'error', msg: `Server is full (${MAX_PLAYERS} players).` });
    ws.close();
    return;
  }
  const name = cleanName(msg.name);
  const last = lastPositions[name.toLowerCase()];
  const player = {
    id: nextId++,
    name,
    p: Array.isArray(last) ? last : [0.5, world.heightAt(0, 0) + 1, 0.5],
    r: [0, 0],
    canBuild: bucket(20, 40),
    canChat: bucket(1, 5),
  };
  players.set(ws, player);

  send(ws, {
    t: 'welcome',
    id: player.id,
    name,
    seed: world.seed,
    edits: world.exportEdits(),
    lastPos: Array.isArray(last) ? last : null,
    players: [...players.values()].filter((p) => p !== player).map(({ id, name: n, p, r }) => ({ id, name: n, p, r })),
  });
  broadcast({ t: 'join', id: player.id, name, p: player.p, r: player.r }, ws);
  systemMessage(`${name} joined the game (${players.size} online)`);
}

function handleSet(ws, player, msg) {
  const { x, y, z, id } = msg;
  if (!isInt(x) || !isInt(y) || !isInt(z) || !isInt(id)) return;
  if (Math.abs(x) > 1e7 || Math.abs(z) > 1e7 || y < 0 || y >= HEIGHT) return;

  // terrain is regenerated on demand (edits are kept), so the cache can simply be emptied
  if (world.chunks.size > 4096) world.chunks.clear();
  const current = world.getBlock(x, y, z);
  const reject = () => send(ws, { t: 'set', x, y, z, id: current }); // undo the client's guess

  const dist = Math.hypot(x + 0.5 - player.p[0], y + 0.5 - (player.p[1] + 1.6), z + 0.5 - player.p[2]);
  const valid =
    id >= 0 && id < BLOCKS.length && id !== BLOCK.BEDROCK &&
    y >= 1 && current !== BLOCK.BEDROCK &&
    // place only into air, break only real blocks
    (id === BLOCK.AIR ? current !== BLOCK.AIR : current === BLOCK.AIR) &&
    dist <= REACH_LIMIT;
  if (!valid || !player.canBuild()) {
    reject();
    return;
  }
  world.setBlock(x, y, z, id);
  dirty = true;
  broadcast({ t: 'set', x, y, z, id }, ws);
}

function handleChat(ws, player, msg) {
  if (typeof msg.msg !== 'string') return;
  const text = msg.msg.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
  if (!text) return;
  if (text === '/list') {
    send(ws, { t: 'sys', msg: `Online (${players.size}): ${[...players.values()].map((p) => p.name).join(', ')}` });
    return;
  }
  if (!player.canChat()) {
    send(ws, { t: 'sys', msg: 'You are sending messages too fast.' });
    return;
  }
  console.log(`<${player.name}> ${text}`);
  broadcast({ t: 'chat', from: player.name, msg: text });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    const player = players.get(ws);
    if (!player) {
      if (msg.t === 'hello') handleHello(ws, msg);
      return;
    }
    switch (msg.t) {
      case 'pos':
        if (Array.isArray(msg.p) && msg.p.length === 3 && msg.p.every(isNum) &&
            Array.isArray(msg.r) && msg.r.length === 2 && msg.r.every(isNum) &&
            Math.abs(msg.p[0]) < 1e7 && Math.abs(msg.p[2]) < 1e7 && msg.p[1] > -100 && msg.p[1] < 1000) {
          player.p = msg.p;
          player.r = msg.r;
          player.moved = true;
        }
        break;
      case 'set':
        handleSet(ws, player, msg);
        break;
      case 'chat':
        handleChat(ws, player, msg);
        break;
    }
  });

  ws.on('close', () => {
    const player = players.get(ws);
    if (!player) return;
    players.delete(ws);
    if (player.p[1] > 0) {
      lastPositions[player.name.toLowerCase()] = player.p;
      dirty = true;
    }
    broadcast({ t: 'leave', id: player.id });
    systemMessage(`${player.name} left the game (${players.size} online)`);
  });
});

// Send everyone's position 10 times a second (only players who moved).
setInterval(() => {
  const moved = [];
  for (const p of players.values()) {
    if (!p.moved) continue;
    p.moved = false;
    moved.push([p.id, p.p[0], p.p[1], p.p[2], p.r[0], p.r[1]]);
  }
  if (moved.length) broadcast({ t: 'state', players: moved });
}, 100);

// Drop connections that stopped responding (closed laptops, dropped Wi-Fi...).
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000).unref();

// ---------- start / stop ----------
function shutdown() {
  console.log('\nSaving world and shutting down…');
  for (const [ws, player] of players) {
    lastPositions[player.name.toLowerCase()] = player.p;
    ws.close();
  }
  dirty = true;
  saveWorld();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`\nBlockCraft server running! (world seed ${world.seed})\n`);
  console.log(`  On this computer:      http://localhost:${PORT}`);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  Same Wi-Fi / network:  http://${a.address}:${PORT}`);
    }
  }
  console.log('\n  Friends elsewhere? See README.md, "Playing with friends over the internet".');
  console.log(PASSWORD ? '  A password is required to join.\n' : '  No password set (SERVER_PASSWORD) - anyone with the link can join.\n');
});
