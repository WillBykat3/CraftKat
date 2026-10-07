import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { World } from '../public/js/world.js';
import { BLOCK } from '../public/js/blocks.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'blockcraft-'));
const WORLD_FILE = path.join(TMP, 'world.json');
let server;

function startServer(env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), WORLD_FILE, WORLD_SEED: '777', ...env },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    proc.stdout.on('data', (d) => { if (String(d).includes('server running')) resolve(proc); });
    proc.on('exit', (code) => reject(new Error('server exited with ' + code)));
  });
}

function stopServer(proc) {
  return new Promise((resolve) => {
    proc.removeAllListeners('exit');
    proc.on('exit', resolve);
    proc.kill('SIGTERM');
  });
}

// Connects a client and collects every message it receives.
function client(name, password) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const inbox = [];
    const waiters = [];
    ws.on('message', (d) => {
      const msg = JSON.parse(d);
      inbox.push(msg);
      for (const w of [...waiters]) if (w.match(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
    });
    ws.waitFor = (match, ms = 3000) => {
      const found = inbox.find(match);
      if (found) return Promise.resolve(found);
      return new Promise((res, rej) => {
        const w = { match, resolve: res };
        waiters.push(w);
        setTimeout(() => rej(new Error('timed out waiting for message')), ms);
      });
    };
    ws.inbox = inbox;
    ws.sendJson = (m) => ws.send(JSON.stringify(m));
    ws.on('open', () => { ws.sendJson({ t: 'hello', name, password }); resolve(ws); });
    ws.on('error', reject);
  });
}

before(async () => { server = await startServer(); });
after(async () => {
  if (server) await stopServer(server);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('serves the game page, the 3D library and blocks path traversal', async () => {
  const page = await fetch(`http://localhost:${PORT}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /BlockCraft/);
  const three = await fetch(`http://localhost:${PORT}/vendor/three.module.js`);
  assert.equal(three.status, 200);
  const core = await fetch(`http://localhost:${PORT}/vendor/three.core.js`);
  assert.equal(core.status, 200);
  const js = await fetch(`http://localhost:${PORT}/js/main.js`);
  assert.match(js.headers.get('content-type'), /javascript/);
  for (const evil of ['/..%2fserver.js', '/vendor/..%2f..%2f..%2fserver.js', '/%2e%2e/package.json']) {
    const res = await fetch(`http://localhost:${PORT}${evil}`);
    assert.ok(res.status === 403 || res.status === 404, `${evil} -> ${res.status}`);
    assert.doesNotMatch(await res.text(), /WebSocketServer|"dependencies"/);
  }
});

test('two players see each other, blocks and chat', async () => {
  const alice = await client('Alice');
  const welcomeA = await alice.waitFor((m) => m.t === 'welcome');
  assert.equal(welcomeA.seed, 777);
  assert.equal(welcomeA.players.length, 0);

  const bob = await client('Bob');
  const welcomeB = await bob.waitFor((m) => m.t === 'welcome');
  assert.deepEqual(welcomeB.players.map((p) => p.name), ['Alice']);
  await alice.waitFor((m) => m.t === 'join' && m.name === 'Bob');

  // movement is relayed
  const world = new World(777);
  const ground = world.heightAt(0, 0);
  alice.sendJson({ t: 'pos', p: [0.5, ground + 1, 0.5], r: [1, 0.2] });
  const state = await bob.waitFor((m) => m.t === 'state' && m.players.some((p) => p[0] === welcomeA.id));
  assert.equal(state.players.find((p) => p[0] === welcomeA.id)[4], 1);

  // placing a block on the ground next to Alice is relayed to Bob
  const bx = 2, bz = 0, by = world.heightAt(2, 0) + 1;
  alice.sendJson({ t: 'set', x: bx, y: by, z: bz, id: BLOCK.BRICK });
  const set = await bob.waitFor((m) => m.t === 'set' && m.x === bx);
  assert.deepEqual([set.y, set.z, set.id], [by, bz, BLOCK.BRICK]);

  // breaking bedrock is refused, and the server tells the sender the real block
  alice.sendJson({ t: 'set', x: 0, y: 0, z: 0, id: BLOCK.AIR });
  const undo = await alice.waitFor((m) => m.t === 'set' && m.y === 0);
  assert.equal(undo.id, BLOCK.BEDROCK);

  // building far away is refused
  alice.sendJson({ t: 'set', x: 500, y: 40, z: 500, id: BLOCK.STONE });
  const far = await alice.waitFor((m) => m.t === 'set' && m.x === 500);
  assert.equal(far.id, BLOCK.AIR);

  // chat
  bob.sendJson({ t: 'chat', msg: 'hi alice <b>' });
  const chat = await alice.waitFor((m) => m.t === 'chat');
  assert.deepEqual([chat.from, chat.msg], ['Bob', 'hi alice <b>']);

  // a duplicate name gets a suffix
  const alice2 = await client('alice');
  const w2 = await alice2.waitFor((m) => m.t === 'welcome');
  assert.equal(w2.name, 'alice2');
  // the new player receives the earlier edit
  assert.ok(w2.edits.some(([x, y, z, id]) => x === bx && y === by && z === bz && id === BLOCK.BRICK));

  alice2.close();
  bob.close();
  await alice.waitFor((m) => m.t === 'leave' && m.id === welcomeB.id);
  alice.close();
});

test('junk messages do not crash the server', async () => {
  const ws = await client('Fuzz');
  await ws.waitFor((m) => m.t === 'welcome');
  for (const junk of ['nope', 'null', '[]', '{"t":"set","x":"1"}', '{"t":"pos","p":[1e999,0,0],"r":[0,0]}',
    '{"t":"set","x":0.5,"y":10,"z":0,"id":1}', '{"t":"chat","msg":{}}', '{"t":"set","x":0,"y":10,"z":0,"id":999}']) {
    ws.send(junk);
  }
  ws.sendJson({ t: 'chat', msg: '/list' });
  const list = await ws.waitFor((m) => m.t === 'sys' && m.msg.startsWith('Online'));
  assert.match(list.msg, /Fuzz/);
  ws.close();
});

test('world edits are saved and restored after a restart', async () => {
  const world = new World(777);
  const by = world.heightAt(1, 1) + 1;
  const ws = await client('Saver');
  await ws.waitFor((m) => m.t === 'welcome');
  ws.sendJson({ t: 'pos', p: [0.5, world.heightAt(0, 0) + 1, 0.5], r: [0, 0] });
  await new Promise((r) => setTimeout(r, 50));
  ws.sendJson({ t: 'set', x: 1, y: by, z: 1, id: BLOCK.GLASS });
  await new Promise((r) => setTimeout(r, 200));
  ws.close();
  await new Promise((r) => setTimeout(r, 100));

  await stopServer(server);
  server = await startServer({ WORLD_SEED: '1' }); // seed comes from the save file, not the env
  const back = await client('Saver');
  const welcome = await back.waitFor((m) => m.t === 'welcome');
  assert.equal(welcome.seed, 777);
  assert.ok(welcome.edits.some(([x, y, z, id]) => x === 1 && y === by && z === 1 && id === BLOCK.GLASS));
  assert.ok(Array.isArray(welcome.lastPos), 'remembers where the player logged out');
  back.close();
});

test('password protection', async () => {
  await stopServer(server);
  server = await startServer({ SERVER_PASSWORD: 'hunter2' });
  const bad = await client('Eve', 'wrong');
  const err = await bad.waitFor((m) => m.t === 'error');
  assert.match(err.msg, /password/i);
  const good = await client('Friend', 'hunter2');
  await good.waitFor((m) => m.t === 'welcome');
  good.close();
});
