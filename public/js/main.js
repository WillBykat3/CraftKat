import * as THREE from 'three';
import { CHUNK, HEIGHT, BLOCK, BLOCKS, PLACEABLE, DEFAULT_HOTBAR, isSolid } from './blocks.js';
import { World, chunkKey } from './world.js';
import { createAtlas } from './textures.js';
import { buildChunkMesh } from './mesher.js';
import { RemotePlayers } from './players.js';

const $ = (id) => document.getElementById(id);

// ---------- settings ----------
let renderDist = 6;             // in chunks, chosen on the join screen
const CHUNK_BUILDS_PER_FRAME = 2;
const REACH = 6;
const GRAVITY = 28;
const JUMP_SPEED = 8.2;
const WALK_SPEED = 4.3;
const SPRINT_SPEED = 5.8;
const FLY_SPEED = 11;
const HALF_W = 0.3;             // player is 0.6 wide
const PLAYER_H = 1.8;
const EYE_H = 1.62;
const EPS = 1e-4;
const PHYSICS_STEP = 1 / 60;    // fixed timestep keeps movement identical at any frame rate
const SKY = 0x8ec9f5;

// ---------- renderer & scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 0, 1);

function setRenderDistance(chunks) {
  renderDist = chunks;
  scene.fog.near = chunks * CHUNK * 0.55;
  scene.fog.far = chunks * CHUNK * 0.95;
}
setRenderDistance(renderDist);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 1000);
camera.rotation.order = 'YXZ';

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const atlas = createAtlas();
const blockMaterial = new THREE.MeshBasicMaterial({
  map: atlas.texture,
  vertexColors: true,
  alphaTest: 0.5,
});

const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }),
);
highlight.visible = false;
scene.add(highlight);

const remotePlayers = new RemotePlayers(scene);

// ---------- game state ----------
let world = null;
let myId = null;
let socket = null;
let playing = false;   // joined the server
let chatOpen = false;
let inventoryOpen = false;

const player = {
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  yaw: 0,
  pitch: 0,
  onGround: false,
  flying: false,
};
let spawnPoint = [0.5, 40, 0.5];

const hotbar = [...DEFAULT_HOTBAR];
let selectedSlot = 0;

// ---------- chunk meshes ----------
const meshes = new Map(); // chunkKey -> Mesh | null (null = nothing to draw)

function disposeMesh(key) {
  const mesh = meshes.get(key);
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
  }
  meshes.delete(key);
}

function buildChunk(cx, cz) {
  const key = chunkKey(cx, cz);
  disposeMesh(key);
  const data = buildChunkMesh(world, cx, cz, atlas.uv);
  if (!data) {
    meshes.set(key, null);
    return;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, blockMaterial);
  mesh.position.set(cx * CHUNK, 0, cz * CHUNK);
  scene.add(mesh);
  meshes.set(key, mesh);
}

function updateChunks(buildAll = false) {
  const pcx = Math.floor(player.pos.x / CHUNK);
  const pcz = Math.floor(player.pos.z / CHUNK);

  const missing = [];
  for (let dz = -renderDist; dz <= renderDist; dz++) {
    for (let dx = -renderDist; dx <= renderDist; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > renderDist * renderDist) continue;
      if (!meshes.has(chunkKey(pcx + dx, pcz + dz))) missing.push([pcx + dx, pcz + dz, d2]);
    }
  }
  missing.sort((a, b) => a[2] - b[2]);
  const n = buildAll ? missing.length : Math.min(CHUNK_BUILDS_PER_FRAME, missing.length);
  for (let i = 0; i < n; i++) buildChunk(missing[i][0], missing[i][1]);

  for (const key of [...meshes.keys()]) {
    const [cx, cz] = key.split(',').map(Number);
    if ((cx - pcx) ** 2 + (cz - pcz) ** 2 > (renderDist + 1) ** 2) disposeMesh(key);
  }
  world.unloadFar(pcx, pcz, renderDist + 3);
}

// Applies a block change and rebuilds every loaded chunk whose mesh it affects
// (including diagonal neighbours, because of ambient occlusion).
function applyBlock(x, y, z, id) {
  if (!world.setBlock(x, y, z, id)) return;
  const rebuild = new Set();
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      rebuild.add(chunkKey(Math.floor((x + dx) / CHUNK), Math.floor((z + dz) / CHUNK)));
    }
  }
  for (const key of rebuild) {
    if (!meshes.has(key)) continue;
    const [cx, cz] = key.split(',').map(Number);
    buildChunk(cx, cz);
  }
}

// ---------- physics ----------
function collides() {
  const { x, y, z } = player.pos;
  const x0 = Math.floor(x - HALF_W), x1 = Math.floor(x + HALF_W);
  const y0 = Math.floor(y), y1 = Math.floor(y + PLAYER_H);
  const z0 = Math.floor(z - HALF_W), z1 = Math.floor(z + HALF_W);
  for (let by = y0; by <= y1; by++) {
    for (let bz = z0; bz <= z1; bz++) {
      for (let bx = x0; bx <= x1; bx++) {
        if (isSolid(world.getBlock(bx, by, bz))) return true;
      }
    }
  }
  return false;
}

// Moves along one axis (by less than one block) and snaps back against any block hit.
function moveAxis(axis, amount) {
  if (amount === 0) return false;
  player.pos[axis] += amount;
  if (!collides()) return false;
  const below = axis === 'y' ? 0 : HALF_W;
  const above = axis === 'y' ? PLAYER_H : HALF_W;
  if (amount > 0) player.pos[axis] = Math.floor(player.pos[axis] + above) - above - EPS;
  else player.pos[axis] = Math.floor(player.pos[axis] - below) + 1 + below + EPS;
  return true;
}

function physics(dt) {
  const forward = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  let wx = -sin * forward + cos * strafe;
  let wz = -cos * forward - sin * strafe;
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }

  let speed = WALK_SPEED;
  if (player.flying) speed = FLY_SPEED;
  else if (keys.ShiftLeft || keys.ShiftRight) speed = SPRINT_SPEED;

  const control = player.onGround || player.flying ? 18 : 4;
  const k = Math.min(1, dt * control);
  player.vel.x += (wx * speed - player.vel.x) * k;
  player.vel.z += (wz * speed - player.vel.z) * k;

  if (player.flying) {
    const up = (keys.Space ? 1 : 0) - (keys.ShiftLeft || keys.ShiftRight ? 1 : 0);
    player.vel.y += (up * FLY_SPEED * 0.8 - player.vel.y) * Math.min(1, dt * 12);
  } else {
    player.vel.y = Math.max(-50, player.vel.y - GRAVITY * dt);
    if ((keys.Space || jumpQueued) && player.onGround) player.vel.y = JUMP_SPEED;
  }

  // if something got placed inside us, pop up
  if (collides()) {
    player.pos.y = Math.floor(player.pos.y) + 1 + EPS;
    player.vel.y = 0;
  }

  const dx = player.vel.x * dt;
  const dy = player.vel.y * dt;
  const dz = player.vel.z * dt;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.4));
  player.onGround = false;
  for (let i = 0; i < steps; i++) {
    if (moveAxis('x', dx / steps)) player.vel.x = 0;
    if (moveAxis('z', dz / steps)) player.vel.z = 0;
    if (moveAxis('y', dy / steps)) {
      if (dy < 0) { player.onGround = true; if (player.flying) player.flying = false; }
      player.vel.y = 0;
    }
  }

  if (player.pos.y < -30) respawn();
}

// A random open spot near the world origin, so players don't spawn inside each other.
function findSpawn() {
  for (let tries = 0; tries < 30; tries++) {
    const x = Math.floor(Math.random() * 9) - 4;
    const z = Math.floor(Math.random() * 9) - 4;
    const y = world.heightAt(x, z) + 1;
    if (world.getBlock(x, y, z) === BLOCK.AIR && world.getBlock(x, y + 1, z) === BLOCK.AIR) {
      return [x + 0.5, y + EPS, z + 0.5];
    }
  }
  return [0.5, world.heightAt(0, 0) + 1 + EPS, 0.5];
}

function respawn() {
  player.pos.set(spawnPoint[0], spawnPoint[1], spawnPoint[2]);
  player.vel.set(0, 0, 0);
  // make sure we're not stuck inside terrain
  while (collides() && player.pos.y < HEIGHT + 2) player.pos.y += 1;
}

// ---------- block targeting ----------
// Steps through the voxel grid along the view direction (Amanatides & Woo).
// Uses the player state directly, so it is exact even between rendered frames.
function raycast() {
  const origin = { x: player.pos.x, y: player.pos.y + EYE_H, z: player.pos.z };
  const cp = Math.cos(player.pitch);
  const dir = { x: -Math.sin(player.yaw) * cp, y: Math.sin(player.pitch), z: -Math.cos(player.yaw) * cp };
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
  const tDeltaX = stepX ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ ? Math.abs(1 / dir.z) : Infinity;
  let tMaxX = stepX > 0 ? (x + 1 - origin.x) * tDeltaX : stepX < 0 ? (origin.x - x) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - origin.y) * tDeltaY : stepY < 0 ? (origin.y - y) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - origin.z) * tDeltaZ : stepZ < 0 ? (origin.z - z) * tDeltaZ : Infinity;
  const normal = [0, 0, 0];

  for (let t = 0; t <= REACH;) {
    const id = world.getBlock(x, y, z);
    if (id !== BLOCK.AIR && y >= 0) return { x, y, z, id, normal: [...normal] };
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX; t = tMaxX; tMaxX += tDeltaX; normal[0] = -stepX; normal[1] = 0; normal[2] = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY; t = tMaxY; tMaxY += tDeltaY; normal[0] = 0; normal[1] = -stepY; normal[2] = 0;
    } else {
      z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; normal[0] = 0; normal[1] = 0; normal[2] = -stepZ;
    }
  }
  return null;
}

function overlapsPlayer(bx, by, bz) {
  const p = player.pos;
  return bx < p.x + HALF_W && bx + 1 > p.x - HALF_W &&
    by < p.y + PLAYER_H && by + 1 > p.y &&
    bz < p.z + HALF_W && bz + 1 > p.z - HALF_W;
}

function changeBlock(x, y, z, id) {
  applyBlock(x, y, z, id);
  send({ t: 'set', x, y, z, id });
}

function breakBlock() {
  const hit = raycast();
  if (!hit || hit.id === BLOCK.BEDROCK) return;
  changeBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
}

function placeBlock() {
  const hit = raycast();
  if (!hit) return;
  const x = hit.x + hit.normal[0];
  const y = hit.y + hit.normal[1];
  const z = hit.z + hit.normal[2];
  if (y < 1 || y >= HEIGHT) return;
  if (world.getBlock(x, y, z) !== BLOCK.AIR) return;
  if (overlapsPlayer(x, y, z)) return;
  changeBlock(x, y, z, hotbar[selectedSlot]);
}

function pickBlock() {
  const hit = raycast();
  if (!hit || !PLACEABLE.includes(hit.id)) return;
  const existing = hotbar.indexOf(hit.id);
  if (existing >= 0) selectedSlot = existing;
  else hotbar[selectedSlot] = hit.id;
  renderHotbar();
}

// ---------- input ----------
const keys = {};
let mouseHeld = -1;
let mouseRepeat = 0;
let lastSpaceTap = 0;
let jumpQueued = false; // remembers a Space tap that was shorter than one frame

function locked() {
  return document.pointerLockElement === renderer.domElement;
}

function lockPointer() {
  try {
    const result = renderer.domElement.requestPointerLock();
    if (result && result.catch) result.catch(() => {});
  } catch { /* browser refused; the pause screen asks for a click */ }
}

document.addEventListener('pointerlockchange', () => {
  if (!playing) return;
  $('pause').classList.toggle('hidden', locked() || chatOpen || inventoryOpen);
  if (!locked()) {
    for (const k in keys) keys[k] = false;
    mouseHeld = -1;
  }
});

document.addEventListener('pointerlockerror', () => {
  if (playing && !chatOpen && !inventoryOpen) $('pause').classList.remove('hidden');
});

$('pause').addEventListener('click', lockPointer);
renderer.domElement.addEventListener('click', () => { if (playing && !locked()) lockPointer(); });

document.addEventListener('mousemove', (e) => {
  if (!locked()) return;
  // some browsers occasionally report a huge bogus jump right after locking; ignore it
  if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch -= e.movementY * 0.0022;
  player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.pitch));
});

function mouseAction(button) {
  if (button === 0) breakBlock();
  else if (button === 2) placeBlock();
}

document.addEventListener('mousedown', (e) => {
  if (!locked()) return;
  if (e.button === 1) { pickBlock(); e.preventDefault(); return; }
  mouseAction(e.button);
  mouseHeld = e.button;
  mouseRepeat = 0.3;
});
document.addEventListener('mouseup', (e) => { if (e.button === mouseHeld) mouseHeld = -1; });
document.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('wheel', (e) => {
  if (!locked()) return;
  selectedSlot = (selectedSlot + (e.deltaY > 0 ? 1 : -1) + hotbar.length) % hotbar.length;
  renderHotbar();
}, { passive: true });

document.addEventListener('keydown', (e) => {
  if (!playing) return;
  if (chatOpen) return; // the chat input handles its own keys
  if (e.code === 'KeyE') {
    toggleInventory();
    e.preventDefault();
    return;
  }
  if (inventoryOpen) {
    if (e.code === 'Escape') toggleInventory();
    return;
  }
  if (!locked()) return;
  if (e.code === 'KeyT' || e.code === 'Enter' || e.code === 'Slash') {
    openChat(e.code === 'Slash' ? '/' : '');
    e.preventDefault();
    return;
  }
  if (e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5));
    if (n >= 1 && n <= hotbar.length) { selectedSlot = n - 1; renderHotbar(); }
  }
  if (e.code === 'KeyF') player.flying = !player.flying;
  if (e.code === 'Space' && !e.repeat) {
    const now = performance.now();
    if (now - lastSpaceTap < 300) player.flying = !player.flying; // double-tap space to fly
    lastSpaceTap = now;
    jumpQueued = true;
  }
  if (e.code === 'KeyR') respawn();
  keys[e.code] = true;
  if (e.code === 'Space') e.preventDefault();
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

// ---------- hotbar & inventory UI ----------
function blockIcon(id, size = 36) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const tile = atlas.tileIndex(BLOCKS[id].tex[1]);
  const s = atlas.tileSize;
  ctx.drawImage(atlas.canvas, tile * s, 0, s, s, 0, 0, size, size);
  return canvas;
}

function renderHotbar() {
  const bar = $('hotbar');
  bar.innerHTML = '';
  hotbar.forEach((id, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot' + (i === selectedSlot ? ' selected' : '');
    slot.title = BLOCKS[id].name;
    slot.appendChild(blockIcon(id));
    const num = document.createElement('span');
    num.textContent = String(i + 1);
    slot.appendChild(num);
    bar.appendChild(slot);
  });
  $('blockname').textContent = BLOCKS[hotbar[selectedSlot]].name;
  $('blockname').classList.remove('fade');
  void $('blockname').offsetWidth; // restart the fade animation
  $('blockname').classList.add('fade');
}

function buildInventory() {
  const grid = $('inventory-grid');
  grid.innerHTML = '';
  for (const id of PLACEABLE) {
    const btn = document.createElement('button');
    btn.className = 'slot';
    btn.title = BLOCKS[id].name;
    btn.appendChild(blockIcon(id, 40));
    btn.addEventListener('click', () => {
      hotbar[selectedSlot] = id;
      renderHotbar();
    });
    grid.appendChild(btn);
  }
}

function toggleInventory() {
  inventoryOpen = !inventoryOpen;
  $('inventory').classList.toggle('hidden', !inventoryOpen);
  if (inventoryOpen) {
    document.exitPointerLock();
    $('pause').classList.add('hidden');
  } else {
    lockPointer();
  }
}

// ---------- chat ----------
function addChat(text, cls = '') {
  const log = $('chat-log');
  const line = document.createElement('div');
  line.className = 'line ' + cls;
  line.textContent = text; // never innerHTML: messages come from other players
  log.appendChild(line);
  while (log.children.length > 60) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
  setTimeout(() => line.classList.add('old'), 10000);
}

function openChat(prefill) {
  chatOpen = true;
  $('chat').classList.add('open');
  const input = $('chat-input');
  input.value = prefill;
  document.exitPointerLock();
  $('pause').classList.add('hidden');
  setTimeout(() => input.focus(), 0);
}

function closeChat(sendIt) {
  const input = $('chat-input');
  const text = input.value.trim();
  if (sendIt && text) {
    if (text === '/help') {
      addChat('Commands: /list (who is online), /spawn (go to spawn), /help', 'sys');
    } else if (text === '/spawn') {
      respawn();
    } else {
      send({ t: 'chat', msg: text });
    }
  }
  input.value = '';
  input.blur();
  chatOpen = false;
  $('chat').classList.remove('open');
  lockPointer();
}

$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { closeChat(true); e.preventDefault(); }
  else if (e.key === 'Escape') { closeChat(false); e.preventDefault(); }
  e.stopPropagation();
});

// ---------- networking ----------
function send(msg) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function connect(name, password) {
  const status = $('status');
  status.textContent = 'Connecting…';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);

  socket.addEventListener('open', () => {
    send({ t: 'hello', name, password });
  });

  socket.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    handleMessage(msg);
  });

  socket.addEventListener('close', () => {
    if (playing) {
      playing = false;
      document.exitPointerLock();
      $('pause').classList.add('hidden');
      $('disconnected').classList.remove('hidden');
    } else if (!status.dataset.error) {
      status.textContent = 'Could not connect to the server.';
    }
    $('play').disabled = false;
  });
}

function handleMessage(msg) {
  switch (msg.t) {
    case 'error':
      $('status').textContent = msg.msg;
      $('status').dataset.error = '1';
      $('play').disabled = false;
      break;

    case 'welcome': {
      myId = msg.id;
      world = new World(msg.seed);
      world.importEdits(msg.edits);
      spawnPoint = findSpawn();
      if (msg.lastPos) {
        player.pos.set(msg.lastPos[0], msg.lastPos[1], msg.lastPos[2]);
        player.vel.set(0, 0, 0);
        while (collides() && player.pos.y < HEIGHT + 2) player.pos.y += 1;
      } else {
        respawn();
      }
      for (const p of msg.players) remotePlayers.add(p.id, p.name, p.p, p.r);
      for (const key of [...meshes.keys()]) disposeMesh(key); // drop the menu preview
      updateChunks(true);
      playing = true;
      $('menu').classList.add('hidden');
      $('hud').classList.remove('hidden');
      buildInventory();
      renderHotbar();
      addChat(`Welcome, ${msg.name}! Press T to chat, E for blocks, F to fly.`, 'sys');
      $('pause').classList.remove('hidden'); // hidden again once the pointer locks
      lockPointer();
      break;
    }

    case 'join':
      remotePlayers.add(msg.id, msg.name, msg.p, msg.r);
      break;

    case 'leave':
      remotePlayers.remove(msg.id);
      break;

    case 'state':
      for (const [id, x, y, z, yaw, pitch] of msg.players) {
        if (id !== myId) remotePlayers.setTarget(id, [x, y, z], [yaw, pitch]);
      }
      break;

    case 'set':
      if (world) applyBlock(msg.x, msg.y, msg.z, msg.id);
      break;

    case 'chat':
      addChat(`<${msg.from}> ${msg.msg}`);
      break;

    case 'sys':
      addChat(msg.msg, 'sys');
      break;
  }
}

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('name').value.trim();
  setRenderDistance(Number($('distance').value) || 6);
  try {
    localStorage.setItem('blockcraft-name', name);
    localStorage.setItem('blockcraft-distance', $('distance').value);
  } catch { /* storage unavailable */ }
  delete $('status').dataset.error;
  $('play').disabled = true;
  connect(name, $('password').value);
});

try {
  $('name').value = localStorage.getItem('blockcraft-name') || '';
  const savedDistance = localStorage.getItem('blockcraft-distance');
  if (savedDistance && [...$('distance').options].some((o) => o.value === savedDistance)) $('distance').value = savedDistance;
} catch { /* storage unavailable */ }

// ---------- main loop ----------
let lastTime = performance.now();
let physicsTime = 0;
let lastSent = 0;
let lastSentState = '';
let fpsFrames = 0;
let fpsTime = 0;
let fps = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.max(0, (now - lastTime) / 1000);
  const dt = Math.min(0.25, elapsed); // after a long stall (e.g. hidden tab) don't simulate the whole gap
  lastTime = now;

  if (playing && world) {
    // keys are released whenever the pointer is unlocked, so this is safe while paused
    physicsTime += dt;
    let stepped = false;
    while (physicsTime >= PHYSICS_STEP) {
      physics(PHYSICS_STEP);
      physicsTime -= PHYSICS_STEP;
      stepped = true;
    }
    if (stepped) jumpQueued = false; // high refresh rate screens can have frames with no step

    camera.position.set(player.pos.x, player.pos.y + EYE_H, player.pos.z);
    camera.rotation.set(player.pitch, player.yaw, 0);

    updateChunks();

    if (mouseHeld >= 0 && locked()) {
      mouseRepeat -= dt;
      if (mouseRepeat <= 0) { mouseAction(mouseHeld); mouseRepeat = 0.22; }
    }

    const hit = raycast();
    highlight.visible = !!hit;
    if (hit) highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);

    remotePlayers.update(dt);

    if (now - lastSent > 100) {
      lastSent = now;
      const p = [+player.pos.x.toFixed(2), +player.pos.y.toFixed(2), +player.pos.z.toFixed(2)];
      const r = [+player.yaw.toFixed(3), +player.pitch.toFixed(3)];
      const state = JSON.stringify([p, r]);
      if (state !== lastSentState) {
        lastSentState = state;
        send({ t: 'pos', p, r });
      }
    }

    fpsFrames++;
    fpsTime += elapsed;
    if (fpsTime >= 0.5) { fps = Math.round(fpsFrames / fpsTime); fpsFrames = 0; fpsTime = 0; }
    $('info').textContent =
      `XYZ ${player.pos.x.toFixed(1)} ${player.pos.y.toFixed(1)} ${player.pos.z.toFixed(1)}` +
      `  |  ${fps} fps  |  ${remotePlayers.count + 1} online${player.flying ? '  |  flying' : ''}`;
  }

  renderer.render(scene, camera);
}

// menu background: a slowly orbiting view of a demo world
{
  const preview = new World(12345);
  world = preview;
  for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) buildChunk(cx, cz);
  world = null;
  const groundY = preview.heightAt(8, 8);
  let angle = 0;
  const orbit = () => {
    if (playing) return;
    requestAnimationFrame(orbit);
    angle += 0.0015;
    camera.position.set(8 + Math.sin(angle) * 30, groundY + 18, 8 + Math.cos(angle) * 30);
    camera.lookAt(8, groundY, 8);
  };
  orbit();
}
requestAnimationFrame(frame);

// Open the page with ?debug to poke at the game from the browser console.
if (new URLSearchParams(location.search).has('debug')) {
  window.blockcraft = { player, camera, scene, renderer, get world() { return world; }, raycast, breakBlock, placeBlock };
}
