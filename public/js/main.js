// Menus and the glue between the host, the network and the game.

import { Renderer } from './renderer.js';
import { createTextures } from './textures.js';
import { Game } from './game.js';
import { GameHost, newWorldSave } from './host.js';
import { World, LATEST_GEN } from './world.js';
import { HostNetwork, joinFriend, randomRoomId } from './net.js';
import { listWorlds, loadWorld, saveWorld, deleteWorld, requestPersistence } from './storage.js';
import { setVolume, sound } from './sound.js';
import { music, setMusicVolume } from './music.js';
import { createUIArt, applyUIArt, drawLogo } from './ui-art.js';
import { VERSION } from './version.js';
import { configured, currentUser, signIn, signOut, displayName, accessToken, verifyToken } from './auth.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const query = new URLSearchParams(location.search);
const RELAY = query.get('relay') || params.get('relay') || ''; // only for testing with a local relay

// ---------- settings ----------
const settings = { renderDistance: 6, fov: 70, sensitivity: 1, volume: 50, brightness: 50, music: 50, bobbing: true, clouds: 'fancy' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('craftkat-settings') || '{}')); } catch { /* ignore */ }
function saveSettings() {
  try { localStorage.setItem('craftkat-settings', JSON.stringify(settings)); } catch { /* ignore */ }
}

const textures = createTextures();
const renderer = new Renderer($('game'), textures);

let game = null;
let host = null;
let hostNet = null;
let ticker = null;
let friends = 0; // players connected to the world we host
let autosave = null;
let currentSave = null;

// ---------- screens ----------
const MENU_SCREENS = ['login-screen', 'setup-screen', 'title-screen', 'worlds-screen', 'new-world-screen', 'join-screen', 'options-screen'];
function show(id) {
  $('menus').classList.remove('hidden');
  for (const s of MENU_SCREENS) $(s).classList.toggle('hidden', s !== id);
  $('title-corners').classList.toggle('hidden', id !== 'title-screen' && id !== 'login-screen');
  if (id === 'title-screen') $('splash').textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
}

// ---------- the look: pixel-art interface, logo, splash text ----------
const SPLASHES = [
  'Play with friends!', 'No download needed!', '100% blocks!', 'Made with code!', 'Now taller!', 'Biomes!',
  'Cherry blossoms!', 'Watch out for creepers!', 'Punch a tree!', 'Lava is hot!', 'Also try the Nether... soon!',
  'Sleep through the night!', 'Diamonds deep down!', 'Mind the gap!', 'Runs in your browser!', 'Kat approved!',
  'Craft, build, explore!', 'Now with rivers!', 'Swamps are wet!', 'Pixel perfect!', 'Look up!', 'Hello, friend!',
];
applyUIArt(createUIArt());
for (const logo of document.querySelectorAll('.logo')) {
  logo.textContent = '';
  logo.appendChild(drawLogo('CraftKat', 9));
}
$('version').textContent = VERSION;
document.querySelectorAll('.back').forEach((b) => b.addEventListener('click', () => {
  const inOptions = !!b.closest('#options-screen');
  if (inOptions && game) closeOptionsInGame();
  else if (b.closest('#new-world-screen')) show('worlds-screen');
  else show('title-screen');
}));

// ---------- accounts ----------
// Playing needs a login. Only when logins aren't configured AND the page runs on
// this computer (localhost, for development) can you play without one.
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const DEV_MODE = !configured && LOCAL;
let account = null; // {id, name}

function cleanName(text) {
  return text.replace(/[^A-Za-z0-9_\- ]/g, '').trim().slice(0, 16);
}
function playerName() {
  return account?.name ?? (cleanName($('name').value) || 'Steve');
}
function rememberName(value) {
  if (!DEV_MODE) return;
  $('name').value = cleanName(value);
  try { localStorage.setItem('craftkat-name', $('name').value); } catch { /* ignore */ }
}
try { if (DEV_MODE) $('name').value = localStorage.getItem('craftkat-name') || ''; } catch { /* ignore */ }
$('name').addEventListener('change', () => rememberName($('name').value));

function homeScreen() {
  if (params.get('join')) {
    show('join-screen');
    $('join-code').value = location.href;
  } else {
    show('title-screen');
  }
}

function signedIn(user) {
  account = { id: user.id, name: displayName(user) };
  $('signed-in-name').textContent = `Playing as ${account.name}`;
  $('signed-in').classList.remove('hidden');
  $('dev-name-field').classList.add('hidden');
  homeScreen();
}

async function startAccounts() {
  if (!configured) {
    if (DEV_MODE) {
      $('signed-in').classList.add('hidden');
      $('dev-name-field').classList.remove('hidden');
      homeScreen();
    } else {
      show('setup-screen');
    }
    return;
  }
  let user = null;
  try {
    user = await currentUser();
  } catch (err) {
    $('login-message').textContent = 'Could not reach the login service: ' + err.message;
  }
  if (user) signedIn(user);
  else show('login-screen');
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('btn-login').disabled = true;
  $('login-message').textContent = '';
  try {
    const user = await signIn($('login-name').value, $('login-password').value);
    $('login-password').value = '';
    signedIn(user);
  } catch (err) {
    $('login-message').textContent = err.message;
  } finally {
    $('btn-login').disabled = false;
  }
});

$('btn-logout').addEventListener('click', async () => {
  await signOut();
  account = null;
  show('login-screen');
});

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
  a.download = `${save.name.replace(/[^\w\- ]/g, '') || 'world'}.craftkat.json`;
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
    if (!Number.isInteger(save.seed) || !Array.isArray(save.edits)) throw new Error('this is not a CraftKat world file');
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
  friends = 0;
  host = new GameHost(save, (peer, msg) => hostNet.deliver(peer, msg), {
    onLog: (text) => console.log('[world]', text),
  });
  hostNet = new HostNetwork(host);
  // every friend who joins must have a real login; their name comes from their account
  if (configured) hostNet.verify = (token) => verifyToken(token);
  const conn = hostNet.connectLocal();
  startGame(conn, true);
  conn.send({ t: 'hello', name: playerName(), isHost: true, accountId: account?.id });

  // The host simulation keeps running when this tab is in the background:
  // browsers slow down timers in hidden tabs, but not messages from a worker.
  let last = performance.now();
  ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 50);'], { type: 'text/javascript' })));
  ticker.onmessage = () => {
    if (!host) return;
    const now = performance.now();
    if (game?.paused && friends === 0) { last = now; return; } // the pause menu stops the world when you play alone
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
    friends = n;
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
  const roomId = parseRoom($('join-code').value);
  if (!roomId) { $('join-status').textContent = 'That does not look like an invite link.'; return; }
  $('btn-join').disabled = true;
  $('join-status').textContent = 'Looking for the world… (this can take up to 30 seconds)';
  try {
    const token = configured ? await accessToken() : null;
    if (configured && !token) throw new Error('Your login expired. Log out and log in again.');
    const conn = await joinFriend({ roomId, password: $('join-password').value, relay: RELAY });
    $('join-status').textContent = '';
    startGame(conn, false);
    conn.send({ t: 'hello', name: playerName(), token });
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
  game.canPause = () => isHost && friends === 0;
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
$('btn-leave-bed').addEventListener('click', () => game?.stopSleeping(true));
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
  for (const id of ['hud', 'pause', 'death', 'sleep', 'screen', 'water-overlay', 'portal-overlay', 'fire-overlay', 'bossbar', 'friends-badge']) $(id).classList.add('hidden');
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
bindRange('opt-music', 'music', (v) => v, (v) => setMusicVolume(v / 100));
setMusicVolume(settings.music / 100);
// on/off options are buttons, like Minecraft's
function bindToggle(id, label, values, names, apply = () => {}) {
  const button = $(id);
  const paint = () => { button.textContent = `${label}: ${names[values.indexOf(settings[id.slice(4)])] ?? names[0]}`; };
  paint();
  button.addEventListener('click', () => {
    const key = id.slice(4);
    settings[key] = values[(values.indexOf(settings[key]) + 1) % values.length];
    paint();
    apply(settings[key]);
    saveSettings();
  });
  apply(settings[id.slice(4)]);
}
bindToggle('opt-bobbing', 'View Bobbing', [true, false], ['ON', 'OFF']);
bindToggle('opt-clouds', 'Clouds', ['fancy', 'fast', 'off'], ['Fancy', 'Fast', 'OFF'], (v) => renderer.setClouds(v));

// every button clicks, and the music starts after the first click anywhere
document.addEventListener('click', (e) => { if (e.target.closest('button')) sound.button(); }, true);
document.addEventListener('pointerdown', () => { sound.unlock(); music.start(); }, { once: true });

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
const TITLE_SEED = 20240607;
let titleSpot = [0, 80, 0];
function startTitleBackground() {
  titleActive = true;
  renderer.setRenderDistance(4);
  renderer.startWorld(TITLE_SEED, [], LATEST_GEN);
  // look around from above the first stretch of land near the origin
  const w = new World(TITLE_SEED, LATEST_GEN);
  for (let r = 0; r < 2000; r += 16) {
    const h = w.heightAt(r, 0);
    if (h > w.seaLevel + 3) { titleSpot = [r, h + 22, 0]; break; }
  }
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
    const [tx, ty, tz] = titleSpot;
    cam.position.set(tx + Math.sin(titleAngle) * 16, ty, tz + Math.cos(titleAngle) * 16);
    cam.rotation.set(-0.3, titleAngle, 0);
    renderer.updateChunks(tx, tz);
    renderer.updateEnvironment(4000, null, false);
    renderer.render();
  } else {
    renderer.render();
  }
}

startTitleBackground();
requestAnimationFrame(frame);
startAccounts();
if (query.has('debug')) window.craftkat = { get game() { return game; }, get host() { return host; }, renderer };
