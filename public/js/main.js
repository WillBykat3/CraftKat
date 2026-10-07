// Menus and the glue between the host, the network and the game.

import { Renderer } from './renderer.js';
import { createTextures } from './textures.js';
import { Game } from './game.js';
import { GameHost, newWorldSave } from './host.js';
import { HostNetwork, joinFriend, randomRoomId } from './net.js';
import { listWorlds, loadWorld, saveWorld, deleteWorld, requestPersistence } from './storage.js';
import { setVolume, sound } from './sound.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const query = new URLSearchParams(location.search);
const RELAY = query.get('relay') || params.get('relay') || ''; // only for testing with a local relay

// ---------- settings ----------
const settings = { renderDistance: 6, fov: 70, sensitivity: 1, volume: 50, brightness: 50 };
try { Object.assign(settings, JSON.parse(localStorage.getItem('blockcraft-settings') || '{}')); } catch { /* ignore */ }
function saveSettings() {
  try { localStorage.setItem('blockcraft-settings', JSON.stringify(settings)); } catch { /* ignore */ }
}

const textures = createTextures();
const renderer = new Renderer($('game'), textures);

let game = null;
let host = null;
let hostNet = null;
let ticker = null;
let autosave = null;
let currentSave = null;

// ---------- screens ----------
const MENU_SCREENS = ['title-screen', 'worlds-screen', 'new-world-screen', 'join-screen', 'options-screen'];
function show(id) {
  $('menus').classList.remove('hidden');
  for (const s of MENU_SCREENS) $(s).classList.toggle('hidden', s !== id);
}
document.querySelectorAll('.back').forEach((b) => b.addEventListener('click', () => {
  const inOptions = !!b.closest('#options-screen');
  if (inOptions && game) closeOptionsInGame();
  else if (b.closest('#new-world-screen')) show('worlds-screen');
  else show('title-screen');
}));

// ---------- player name (shared by the title and join screens) ----------
function cleanName(text) {
  return text.replace(/[^A-Za-z0-9_\- ]/g, '').trim().slice(0, 16);
}
function playerName() {
  return cleanName($('name').value) || cleanName($('join-name').value) || 'Steve';
}
function rememberName(value) {
  const n = cleanName(value);
  $('name').value = n;
  $('join-name').value = n;
  try { localStorage.setItem('blockcraft-name', n); } catch { /* ignore */ }
}
try { rememberName(localStorage.getItem('blockcraft-name') || ''); } catch { /* ignore */ }
$('name').addEventListener('change', () => rememberName($('name').value));
$('join-name').addEventListener('change', () => rememberName($('join-name').value));

// ---------- world list ----------
$('btn-worlds').addEventListener('click', async () => {
  sound.unlock();
  rememberName($('name').value);
  show('worlds-screen');
  await renderWorldList();
});

function button(text, onClick, cls = '') {
  const b = document.createElement('button');
  b.textContent = text;
  b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}

async function renderWorldList() {
  const list = $('world-list');
  list.innerHTML = '';
  const note = (text, cls = 'hint') => {
    const p = document.createElement('p');
    p.className = cls;
    p.textContent = text;
    list.appendChild(p);
  };
  let worlds;
  try {
    worlds = await listWorlds();
  } catch (err) {
    note('Could not open saved worlds: ' + err.message, 'message');
    return;
  }
  if (!worlds.length) note('No worlds yet. Create one!');
  for (const w of worlds) {
    const row = document.createElement('div');
    row.className = 'world-row';
    const info = document.createElement('div');
    info.className = 'world-info';
    const name = document.createElement('strong');
    name.textContent = w.name;
    const meta = document.createElement('small');
    meta.textContent = `${w.mode === 'creative' ? 'Creative' : 'Survival'} · ${new Date(w.lastPlayed).toLocaleString()}`;
    info.append(name, document.createElement('br'), meta);
    row.append(
      info,
      button('Play', () => playWorld(w.id)),
      button('Export', () => exportWorld(w.id), 'secondary small'),
      button('Delete', async () => {
        if (!confirm(`Delete "${w.name}" forever?`)) return;
        await deleteWorld(w.id);
        renderWorldList();
      }, 'secondary small danger'),
    );
    list.appendChild(row);
  }
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

$('btn-new-world').addEventListener('click', () => show('new-world-screen'));
$('btn-create').addEventListener('click', async () => {
  const seedText = $('world-seed').value.trim();
  let seed;
  if (!seedText) seed = crypto.getRandomValues(new Int32Array(1))[0];
  else if (/^-?\d+$/.test(seedText)) seed = Number(seedText) | 0;
  else seed = [...seedText].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 0); // text seeds work too
  const save = newWorldSave({
    name: $('world-name').value.trim() || 'New World',
    seed,
    mode: $('world-mode').value,
    cheats: $('world-cheats').checked,
  });
  save.id = newId();
  try {
    await saveWorld(save);
  } catch (err) {
    alert('Could not create the world: ' + err.message);
    return;
  }
  requestPersistence();
  playWorld(save.id);
});

async function exportWorld(id) {
  const save = await loadWorld(id);
  const blob = new Blob([JSON.stringify(save)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${save.name.replace(/[^\w\- ]/g, '') || 'world'}.blockcraft.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('btn-import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const save = JSON.parse(await file.text());
    if (!Number.isInteger(save.seed) || !Array.isArray(save.edits)) throw new Error('this is not a BlockCraft world file');
    save.id = newId();
    delete save.roomId;
    save.players ||= {};
    save.furnaces ||= {};
    save.spawn ||= [0.5, 64, 0.5];
    await saveWorld(save);
    renderWorldList();
  } catch (err) {
    alert('Could not import: ' + err.message);
  }
});

// ---------- hosting ----------
async function playWorld(id) {
  loading('Loading world…');
  let save;
  try {
    save = await loadWorld(id);
  } catch (err) {
    loading(null);
    alert('Could not load the world: ' + err.message);
    return;
  }
  if (!save) { loading(null); return; }
  currentSave = save;
  host = new GameHost(save, (peer, msg) => hostNet.deliver(peer, msg), {
    onLog: (text) => console.log('[world]', text),
  });
  hostNet = new HostNetwork(host);
  const conn = hostNet.connectLocal();
  startGame(conn, true);
  conn.send({ t: 'hello', name: playerName(), isHost: true });

  // The host simulation keeps running when this tab is in the background:
  // browsers slow down timers in hidden tabs, but not messages from a worker.
  let last = performance.now();
  ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50);'], { type: 'text/javascript' })));
  ticker.onmessage = () => {
    if (!host) return;
    const now = performance.now();
    let dt = Math.min((now - last) / 1000, 1);
    last = now;
    while (dt > 0) {
      const step = Math.min(dt, 0.1);
      host.tick(step);
      dt -= step;
    }
    host.trimMemory();
  };
  autosave = setInterval(() => persist(), 30000);
}

async function persist() {
  if (!host) return;
  try {
    await saveWorld(host.serialize());
  } catch (err) {
    console.error('save failed', err);
    game?.addChat('Could not save the world: ' + err.message, 'sys');
  }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });
window.addEventListener('pagehide', () => { persist(); });
window.addEventListener('beforeunload', (e) => {
  if (host && hostNet?.peers.size) { e.preventDefault(); e.returnValue = ''; } // friends would be disconnected
});

$('btn-invite').addEventListener('click', () => $('invite-panel').classList.toggle('hidden'));
$('btn-open').addEventListener('click', () => {
  if (!hostNet) return;
  if (!currentSave.roomId) currentSave.roomId = randomRoomId();
  const password = $('invite-password').value;
  const updateCount = (n) => {
    $('invite-status').textContent = n === 0 ? 'Waiting for friends to join…' : `${n} friend${n === 1 ? '' : 's'} connected`;
    $('friends-badge').textContent = `👥 ${n + 1} playing`;
    $('friends-badge').classList.toggle('hidden', n === 0);
  };
  try {
    hostNet.open({ roomId: currentSave.roomId, password, relay: RELAY, onPeerCount: updateCount });
  } catch (err) {
    $('invite-status').textContent = 'Could not open the world: ' + err.message;
    return;
  }
  persist();
  const link = `${location.origin}${location.pathname}#join=${currentSave.roomId}${RELAY ? '&relay=' + encodeURIComponent(RELAY) : ''}`;
  $('invite-link').value = link;
  updateCount(0);
  $('invite-setup').classList.add('hidden');
  $('invite-ready').classList.remove('hidden');
  game?.addChat(password ? 'Your world is open to friends (password protected).' : 'Your world is open to friends. Anyone with the link can join.', 'sys');
});
$('btn-copy').addEventListener('click', async () => {
  const input = $('invite-link');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand('copy');
  }
  $('btn-copy').textContent = 'Copied!';
  setTimeout(() => { $('btn-copy').textContent = 'Copy'; }, 1500);
});

// ---------- joining ----------
$('btn-join-code').addEventListener('click', () => {
  sound.unlock();
  rememberName($('name').value);
  show('join-screen');
});

function parseRoom(text) {
  const t = text.trim();
  const m = t.match(/join=([a-z0-9]+)/i);
  if (m) return m[1];
  return /^[a-z0-9]{6,32}$/i.test(t) ? t : null;
}

$('btn-join').addEventListener('click', async () => {
  sound.unlock();
  rememberName($('join-name').value || $('name').value);
  const roomId = parseRoom($('join-code').value);
  if (!roomId) { $('join-status').textContent = 'That does not look like an invite link.'; return; }
  $('btn-join').disabled = true;
  $('join-status').textContent = 'Looking for the world… (this can take up to 30 seconds)';
  try {
    const conn = await joinFriend({ roomId, password: $('join-password').value, relay: RELAY });
    $('join-status').textContent = '';
    startGame(conn, false);
    conn.send({ t: 'hello', name: playerName() });
  } catch (err) {
    $('join-status').textContent = err.message;
  } finally {
    $('btn-join').disabled = false;
  }
});

// ---------- the game itself ----------
function startGame(conn, isHost) {
  titleActive = false;
  renderer.fov = settings.fov;
  renderer.setRenderDistance(settings.renderDistance);
  renderer.clearChunks();
  game = new Game({ renderer, textures, conn, isHost, settings, onQuit: (reason) => quitToTitle(reason) });
  game.onPause = () => $('btn-invite').classList.toggle('hidden', !isHost);
  $('menus').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('invite-panel').classList.add('hidden');
  const open = !!hostNet?.isOpen();
  $('invite-setup').classList.toggle('hidden', open);
  $('invite-ready').classList.toggle('hidden', !open);
  $('btn-invite').classList.toggle('hidden', !isHost);
  loading(null);
  // pointer lock needs a click, so the pause menu doubles as a "click to play" screen
  $('pause').classList.remove('hidden');
}

$('btn-resume').addEventListener('click', () => {
  $('pause').classList.add('hidden');
  game?.lock();
});
$('btn-quit').addEventListener('click', () => quitToTitle());
$('btn-respawn').addEventListener('click', () => game?.respawn());
$('btn-death-quit').addEventListener('click', () => quitToTitle());

async function quitToTitle(reason) {
  const g = game;
  game = null;
  if (g) g.quit();
  if (host) {
    loading('Saving world…');
    host.disconnect('local');
    await persist();
    hostNet?.close();
    clearInterval(autosave);
    ticker?.terminate();
    ticker = null;
    host = null;
    hostNet = null;
    currentSave = null;
  }
  for (const id of ['hud', 'pause', 'death', 'screen', 'water-overlay', 'friends-badge']) $(id).classList.add('hidden');
  loading(null);
  show('title-screen');
  $('title-message').textContent = typeof reason === 'string' ? reason : '';
  startTitleBackground();
}

function loading(text) {
  $('loading').classList.toggle('hidden', !text);
  if (text) $('loading-text').textContent = text;
}

// ---------- options ----------
function bindRange(id, key, format, apply = () => {}) {
  const input = $(id);
  input.value = settings[key];
  $(id + '-value').textContent = format(input.value);
  input.addEventListener('input', () => {
    settings[key] = Number(input.value);
    $(id + '-value').textContent = format(input.value);
    apply(settings[key]);
    saveSettings();
  });
}
bindRange('opt-distance', 'renderDistance', (v) => v, (v) => { if (game) renderer.setRenderDistance(v); });
bindRange('opt-fov', 'fov', (v) => v, (v) => { renderer.fov = v; });
bindRange('opt-sens', 'sensitivity', (v) => Number(v).toFixed(1));
const brightLabel = (v) => (v <= 10 ? 'Moody' : v >= 90 ? 'Bright' : `${v}%`);
bindRange('opt-bright', 'brightness', brightLabel, (v) => renderer.setBrightness(v / 100));
renderer.setBrightness(settings.brightness / 100);
bindRange('opt-volume', 'volume', (v) => v, (v) => setVolume(v / 100));
setVolume(settings.volume / 100);

$('btn-options').addEventListener('click', () => show('options-screen'));
$('btn-pause-options').addEventListener('click', () => {
  $('pause').classList.add('hidden');
  show('options-screen');
});
function closeOptionsInGame() {
  $('menus').classList.add('hidden');
  $('pause').classList.remove('hidden');
}

// ---------- title screen background: a slowly turning view of a world ----------
let titleActive = false;
let titleAngle = 0;
function startTitleBackground() {
  titleActive = true;
  renderer.setRenderDistance(4);
  renderer.startWorld(20240607, []);
}

// ---------- main loop ----------
let lastFrame = performance.now();
let frames = 0, fpsTime = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0, (now - lastFrame) / 1000);
  lastFrame = now;
  if (game && game.playing) {
    game.update(dt);
    game.render();
    frames++;
    fpsTime += dt;
    if (fpsTime > 0.5) { game.fps = Math.round(frames / fpsTime); frames = 0; fpsTime = 0; }
  } else if (titleActive) {
    titleAngle += dt * 0.03;
    const cam = renderer.camera;
    cam.position.set(Math.sin(titleAngle) * 16, 62, Math.cos(titleAngle) * 16);
    cam.rotation.set(-0.3, titleAngle, 0);
    renderer.updateChunks(0, 0);
    renderer.updateEnvironment(4000, false, false);
    renderer.render();
  } else {
    renderer.render();
  }
}

startTitleBackground();
requestAnimationFrame(frame);
if (params.get('join')) {
  show('join-screen');
  $('join-code').value = location.href;
} else {
  show('title-screen');
}
if (query.has('debug')) window.blockcraft = { get game() { return game; }, get host() { return host; }, renderer };
