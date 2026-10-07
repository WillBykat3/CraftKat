// The client: everything one player experiences. Talks to the GameHost
// through `conn` (loopback for the host's own player, WebRTC for friends).

import * as THREE from 'three';
import {
  BLOCK, BLOCKS, HEIGHT, CHUNK, isBlockId, toolOf, breakTime, ITEMS, CREATIVE_BLOCKS,
} from './blocks.js';
import { World, chunkKey } from './world.js';
import { gatherRegion, computeLight, regionIndex } from './lighting.js';
import { collides, moveBody, boxOverlapsBlock } from './physics.js';
import { addItem, takeOne, foodValue, makeStack, INVENTORY_SIZE, HOTBAR_SIZE } from './inventory.js';
import { EntityViews } from './entities.js';
import { InventoryScreen, HUD } from './ui.js';
import { sound } from './sound.js';
import { uvOf } from './atlas-layout.js';
import { lightCurve, toLinear } from './renderer.js';

const $ = (id) => document.getElementById(id);

const GRAVITY = 32;
const JUMP_SPEED = 8.9;        // ~1.25 blocks, like Minecraft
const WALK = 4.317;
const SPRINT = 5.612;
const SNEAK = 1.31;
const FLY = 10.9;
const HALF_W = 0.3;
const HEIGHT_STAND = 1.8;
const EYE = 1.62;
const EYE_SNEAK = 1.32;
const REACH = 5;
const STEP = 1 / 60;
const MAX_AIR = 300;

export class Game {
  constructor({ renderer, textures, conn, isHost, onQuit, settings }) {
    this.r = renderer;
    this.textures = textures;
    this.conn = conn;
    this.isHost = isHost;
    this.onQuit = onQuit;
    this.settings = settings;
    this.iconURL = textures.iconURL;
    this.world = null;
    this.playing = false;

    this.player = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, halfW: HALF_W, height: HEIGHT_STAND,
      yaw: 0, pitch: 0, onGround: false, flying: false, sneaking: false, sprinting: false,
      inWater: false, headInWater: false, fallStart: null,
    };
    this.stats = { health: 20, food: 20, air: MAX_AIR, exhaustion: 0, regen: 0, starve: 0, invuln: 0, hurtFlash: false };
    this.mode = 'survival';
    this.inv = new Array(INVENTORY_SIZE).fill(null);
    this.selected = 0;
    this.spawn = [0.5, 40, 0.5];
    this.time = 1000;
    this.myId = null;
    this.dead = false;

    this.keys = {};
    this.mouse = { left: false, right: false };
    this.breaking = null; // {x, y, z, progress}
    this.useCooldown = 0;
    this.attackCooldown = 0;
    this.eating = 0;
    this.lastTap = { KeyW: 0, Space: 0 };
    this.physicsTime = 0;
    this.lastSent = 0;
    this.lastSentState = '';
    this.saveTimer = 0;
    this.invDirty = false;
    this.stepDist = 0;
    this.pickupTried = new Map();
    this.lightCache = new Map();
    this.lightBudget = 1;
    this.swing = 0;
    this.bob = 0;
    this.chatOpen = false;
    this.showDebug = false;

    this.entities = new EntityViews(renderer.scene, textures);
    this.screen = new InventoryScreen(this);
    this.hud = new HUD(this.iconURL);
    this.buildHand();
    this.bindInput();

    conn.onMessage = (msg) => this.handle(msg);
    conn.onClose = (reason) => this.disconnected(reason);
  }

  // ---------- networking ----------
  send(msg) {
    this.conn.send(msg);
  }

  handle(msg) {
    switch (msg.t) {
      case 'welcome': return this.welcome(msg);
      case 'error': return this.disconnected(msg.msg);
      case 'join': return this.entities.addPlayer(msg.id, msg.name, msg.p, msg.r);
      case 'leave': return this.entities.removePlayer(msg.id);
      case 'state':
        for (const [id, x, y, z, yaw, pitch] of msg.players) if (id !== this.myId) this.entities.movePlayer(id, [x, y, z], [yaw, pitch]);
        return;
      case 'entities': return this.entities.syncEntities(msg.list);
      case 'set':
        if (this.world) this.applyBlock(msg.x, msg.y, msg.z, msg.id);
        return;
      case 'chat': return this.addChat(`<${msg.from}> ${msg.msg}`);
      case 'sys': return this.addChat(msg.msg, 'sys');
      case 'time': this.time = msg.time; return;
      case 'mode':
        this.mode = msg.mode;
        if (msg.mode === 'survival') this.player.flying = false;
        return;
      case 'teleport':
        this.player.x = msg.p[0]; this.player.y = msg.p[1]; this.player.z = msg.p[2];
        this.player.vx = this.player.vy = this.player.vz = 0;
        this.player.fallStart = null;
        return;
      case 'give': {
        const left = addItem(this.inv, msg.id, msg.count, msg.dur);
        if (left > 0) this.dropStack({ id: msg.id, count: left, dur: msg.dur });
        sound.pop();
        this.invDirty = true;
        if (this.screen.isOpen) this.screen.render();
        return;
      }
      case 'hurt': return this.damage(msg.amount, msg.cause, msg.from);
      case 'mobhurt': {
        const v = this.entities.entities.get(msg.e);
        this.entities.hurt(msg.e);
        if (v && v.group.position.distanceTo(this.r.camera.position) < 24) sound.mobHurt(v.mob);
        return;
      }
      case 'mobdeath': return;
      case 'furnace': return this.screen.setFurnaceState(msg);
      case 'cursor': return this.screen.setCursor(msg.stack);
    }
  }

  welcome(msg) {
    this.myId = msg.id;
    this.name = msg.name;
    this.world = new World(msg.seed);
    this.world.importEdits(msg.edits);
    this.spawn = msg.spawn;
    this.time = msg.time;
    this.mode = msg.mode;
    const me = msg.me;
    [this.player.x, this.player.y, this.player.z] = me.pos;
    [this.player.yaw, this.player.pitch] = me.rot;
    if (Array.isArray(me.inv)) this.inv = me.inv.map((s) => (s ? { ...s } : null));
    else if (this.mode === 'survival') this.inv = new Array(INVENTORY_SIZE).fill(null);
    else this.giveCreativeStarter();
    this.stats.health = me.health ?? 20;
    this.stats.food = me.food ?? 20;
    if (this.stats.health <= 0) this.stats.health = 20;
    this.unstick();
    for (const p of msg.players) this.entities.addPlayer(p.id, p.name, p.p, p.r);
    this.r.startWorld(msg.seed, msg.edits);
    this.r.setRenderDistance(this.settings.renderDistance);
    this.playing = true;
    this.addChat(`Welcome to ${msg.worldName}, ${msg.name}!`, 'sys');
    this.addChat('E: inventory · T: chat · Q: drop · /help for commands', 'sys');
  }

  giveCreativeStarter() {
    this.inv = new Array(INVENTORY_SIZE).fill(null);
    [BLOCK.GRASS, BLOCK.STONE, BLOCK.PLANKS, BLOCK.LOG, BLOCK.GLASS, BLOCK.BRICK, BLOCK.TORCH, BLOCK.SAND, BLOCK.WATER]
      .forEach((id, i) => { this.inv[i] = makeStack(id, 64); });
  }

  disconnected(reason) {
    if (this.closed) return;
    this.closed = true;
    this.playing = false;
    document.exitPointerLock?.();
    this.onQuit?.(reason || 'Disconnected');
  }

  // ---------- world changes ----------
  applyBlock(x, y, z, id) {
    if (!this.world.setBlock(x, y, z, id)) return;
    this.r.blockChanged(x, y, z, id);
    // light can change up to 15 blocks away: forget cached light for nearby chunks
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.lightCache.delete(chunkKey(cx + dx, cz + dz));
    if (this.screen.kind === 'furnace' && id !== BLOCK.FURNACE) {
      const at = this.screen.furnace.at;
      if (at[0] === x && at[1] === y && at[2] === z) this.closeScreen();
    }
  }

  dropStack(stack) {
    if (!stack) return;
    this.send({ t: 'drop', stack, yaw: this.player.yaw, pitch: this.player.pitch });
  }

  onInventoryChange() {
    this.invDirty = true;
  }

  furnaceClick(at, slot, button, cursor) {
    this.send({ t: 'furnace_click', x: at[0], y: at[1], z: at[2], slot, button, cursor });
  }

  // ---------- input ----------
  locked() {
    return document.pointerLockElement === this.r.renderer.domElement;
  }

  lock() {
    try {
      const p = this.r.renderer.domElement.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* ignored: the pause screen asks for a click */ }
  }

  bindInput() {
    const canvas = this.r.renderer.domElement;
    this.handlers = [];
    const on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this.handlers.push([target, type, fn, opts]);
    };

    on(document, 'pointerlockchange', () => {
      if (!this.playing) return;
      if (!this.locked()) {
        for (const k in this.keys) this.keys[k] = false;
        this.mouse.left = this.mouse.right = false;
        if (!this.chatOpen && !this.screen.isOpen && !this.dead) this.showPause(true);
      } else {
        this.showPause(false);
      }
    });
    on(canvas, 'click', () => { if (this.playing && !this.locked() && !this.screen.isOpen && !this.dead) this.lock(); });

    on(document, 'mousemove', (e) => {
      if (!this.locked()) return;
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return; // browser glitch
      const s = 0.0022 * this.settings.sensitivity;
      this.player.yaw -= e.movementX * s;
      this.player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.player.pitch - e.movementY * s));
    });

    on(document, 'mousedown', (e) => {
      if (!this.locked()) return;
      sound.unlock();
      if (e.button === 0) { this.mouse.left = true; this.leftClick(); }
      if (e.button === 2) { this.mouse.right = true; this.useCooldown = 0; this.rightClick(); }
      if (e.button === 1) { this.pickBlock(); e.preventDefault(); }
    });
    on(document, 'mouseup', (e) => {
      if (e.button === 0) { this.mouse.left = false; this.breaking = null; }
      if (e.button === 2) { this.mouse.right = false; this.eating = 0; }
    });
    on(document, 'contextmenu', (e) => e.preventDefault());
    on(document, 'wheel', (e) => {
      if (!this.locked()) return;
      this.selected = (this.selected + (e.deltaY > 0 ? 1 : -1) + HOTBAR_SIZE) % HOTBAR_SIZE;
    }, { passive: true });

    on(document, 'keydown', (e) => this.keyDown(e));
    on(document, 'keyup', (e) => { this.keys[e.code] = false; });

    const chat = $('chat-input');
    on(chat, 'keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { this.closeChat(true); e.preventDefault(); }
      else if (e.key === 'Escape') { this.closeChat(false); e.preventDefault(); }
    });
  }

  unbind() {
    for (const [target, type, fn, opts] of this.handlers) target.removeEventListener(type, fn, opts);
  }

  keyDown(e) {
    if (!this.playing || this.chatOpen || this.dead) return;
    if (e.code === 'KeyE' || (e.code === 'Escape' && this.screen.isOpen)) {
      e.preventDefault();
      if (this.screen.isOpen) this.closeScreen();
      else if (this.locked()) this.openScreen(this.mode === 'creative' ? 'creative' : 'inventory');
      return;
    }
    if (this.screen.isOpen || !this.locked()) return;
    if (e.code === 'Escape') { document.exitPointerLock(); return; } // browsers usually do this themselves
    if (e.code === 'KeyT' || e.code === 'Enter' || e.code === 'Slash') {
      e.preventDefault();
      this.openChat(e.code === 'Slash' ? '/' : '');
      return;
    }
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 9) this.selected = n - 1;
    }
    if (e.code === 'KeyQ') this.dropSelected(e.shiftKey);
    if (e.code === 'F3') { this.showDebug = !this.showDebug; e.preventDefault(); }
    if (e.code === 'F1') { $('hud').classList.toggle('hidden-hud'); e.preventDefault(); }
    const now = performance.now();
    if (!e.repeat && (e.code === 'KeyW' || e.code === 'Space')) {
      if (now - this.lastTap[e.code] < 280) {
        if (e.code === 'KeyW') this.player.sprinting = true;
        else if (this.mode === 'creative') { this.player.flying = !this.player.flying; this.player.vy = 0; }
      }
      this.lastTap[e.code] = now;
    }
    this.keys[e.code] = true;
    if (e.code === 'Space' && !e.repeat) this.jumpQueued = true;
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  }

  showPause(show) {
    $('pause').classList.toggle('hidden', !show);
    if (show) this.onPause?.();
  }

  openScreen(kind, data) {
    this.screen.open(kind, data);
    document.exitPointerLock();
    this.showPause(false);
  }

  closeScreen() {
    if (this.screen.kind === 'furnace') {
      const [x, y, z] = this.screen.furnace.at;
      this.send({ t: 'furnace_close', x, y, z });
    }
    this.screen.close();
    this.lock();
  }

  dropSelected(all) {
    const s = this.inv[this.selected];
    if (!s) return;
    if (all || s.count === 1) {
      this.dropStack(s);
      this.inv[this.selected] = null;
    } else {
      this.dropStack({ ...s, count: 1 });
      s.count--;
    }
    this.invDirty = true;
    this.swing = 1;
  }

  // ---------- chat ----------
  addChat(text, cls = '') {
    const log = $('chat-log');
    const line = document.createElement('div');
    line.className = 'line ' + cls;
    line.textContent = text; // never innerHTML: text comes from other players
    log.appendChild(line);
    while (log.children.length > 80) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
    setTimeout(() => line.classList.add('old'), 10000);
  }

  openChat(prefill) {
    this.chatOpen = true;
    $('chat').classList.add('open');
    const input = $('chat-input');
    input.value = prefill;
    document.exitPointerLock();
    input.focus(); // right away, so fast typing isn't lost (the T keypress itself is suppressed)
  }

  closeChat(send) {
    const input = $('chat-input');
    const text = input.value.trim();
    if (send && text) this.send({ t: 'chat', msg: text });
    input.value = '';
    input.blur();
    this.chatOpen = false;
    $('chat').classList.remove('open');
    this.lock();
  }

  // ---------- interaction ----------
  eyeHeight() {
    return this.player.sneaking ? EYE_SNEAK : EYE;
  }

  viewRay() {
    const p = this.player;
    const cp = Math.cos(p.pitch);
    return {
      origin: { x: p.x, y: p.y + this.eyeHeight(), z: p.z },
      dir: { x: -Math.sin(p.yaw) * cp, y: Math.sin(p.pitch), z: -Math.cos(p.yaw) * cp },
    };
  }

  // Voxel walk along the view ray (skips air, water and nothing else).
  raycast(maxDist = REACH) {
    const { origin: o, dir: d } = this.viewRay();
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
    const tdx = sx ? Math.abs(1 / d.x) : Infinity, tdy = sy ? Math.abs(1 / d.y) : Infinity, tdz = sz ? Math.abs(1 / d.z) : Infinity;
    let tx = sx > 0 ? (x + 1 - o.x) * tdx : sx < 0 ? (o.x - x) * tdx : Infinity;
    let ty = sy > 0 ? (y + 1 - o.y) * tdy : sy < 0 ? (o.y - y) * tdy : Infinity;
    let tz = sz > 0 ? (z + 1 - o.z) * tdz : sz < 0 ? (o.z - z) * tdz : Infinity;
    const normal = [0, 0, 0];
    let t = 0;
    while (t <= maxDist) {
      const id = this.world.getBlock(x, y, z);
      if (id !== BLOCK.AIR && id !== BLOCK.WATER && y >= 0 && y < HEIGHT) return { x, y, z, id, normal: [...normal], dist: t };
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; normal[0] = -sx; normal[1] = 0; normal[2] = 0; }
      else if (ty < tz) { y += sy; t = ty; ty += tdy; normal[0] = 0; normal[1] = -sy; normal[2] = 0; }
      else { z += sz; t = tz; tz += tdz; normal[0] = 0; normal[1] = 0; normal[2] = -sz; }
    }
    return null;
  }

  targetMob(blockHit) {
    const { origin, dir } = this.viewRay();
    const mob = this.entities.raycastMobs(origin, dir, 3.5);
    if (mob && (!blockHit || mob.dist < blockHit.dist)) return mob;
    return null;
  }

  held() {
    return this.inv[this.selected];
  }

  heldId() {
    return this.inv[this.selected]?.id ?? 0;
  }

  leftClick() {
    this.swing = 1;
    const hit = this.raycast();
    const mob = this.targetMob(hit);
    if (mob) {
      if (this.attackCooldown <= 0) {
        this.send({ t: 'attack', e: mob.id, tool: this.heldId() });
        this.attackCooldown = 0.35;
        this.useTool(1);
        this.stats.exhaustion += 0.1;
      }
      return;
    }
    if (hit && this.mode === 'creative') {
      this.breakBlockAt(hit);
      this.useCooldown = 0.25;
    }
  }

  breakBlockAt(hit) {
    const id = this.world.getBlock(hit.x, hit.y, hit.z);
    this.send({ t: 'dig', x: hit.x, y: hit.y, z: hit.z, tool: this.heldId() });
    this.applyBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
    sound.broke(id);
    if (this.mode === 'survival') {
      if (BLOCKS[id].hardness > 0) this.useTool(toolOf(this.heldId())?.kind === 'sword' ? 2 : 1);
      this.stats.exhaustion += 0.005;
    }
  }

  useTool(wear) {
    if (this.mode !== 'survival') return;
    const s = this.held();
    if (!s || s.dur === undefined) return;
    s.dur -= wear;
    if (s.dur <= 0) {
      this.inv[this.selected] = null;
      sound.broke(BLOCK.GLASS);
    }
    this.invDirty = true;
  }

  rightClick() {
    const hit = this.raycast();
    const held = this.held();
    if (hit && !this.player.sneaking) {
      if (hit.id === BLOCK.CRAFTING_TABLE) { this.openScreen('crafting'); return; }
      if (hit.id === BLOCK.FURNACE) {
        this.openScreen('furnace', { at: [hit.x, hit.y, hit.z] });
        this.send({ t: 'furnace_open', x: hit.x, y: hit.y, z: hit.z });
        return;
      }
    }
    if (held && ITEMS[held.id]?.food) {
      if (this.mode === 'survival' && this.stats.food < 20) this.eating = 0.001;
      return;
    }
    if (!hit || !held || !isBlockId(held.id)) return;
    this.placeBlock(hit, held);
  }

  placeBlock(hit, held) {
    const id = held.id;
    const replace = BLOCKS[hit.id].replaceable && hit.id !== id;
    const x = replace ? hit.x : hit.x + hit.normal[0];
    const y = replace ? hit.y : hit.y + hit.normal[1];
    const z = replace ? hit.z : hit.z + hit.normal[2];
    if (y < 1 || y >= HEIGHT) return;
    const current = this.world.getBlock(x, y, z);
    if (!BLOCKS[current].replaceable || current === id) return;
    if (BLOCKS[id].solid && boxOverlapsBlock(this.player, x, y, z)) return;
    if (BLOCKS[id].needsSupport && !BLOCKS[this.world.getBlock(x, y - 1, z)].solid) return;
    for (const v of this.entities.entities.values()) {
      if (v.mob && BLOCKS[id].solid) {
        const p = v.group.position;
        if (Math.abs(p.x - (x + 0.5)) < 0.9 && Math.abs(p.z - (z + 0.5)) < 0.9 && p.y < y + 1 && p.y + 1.8 > y) return;
      }
    }
    this.send({ t: 'set', x, y, z, id });
    this.applyBlock(x, y, z, id);
    sound.place(id);
    this.swing = 1;
    this.useCooldown = 0.25;
    if (this.mode === 'survival') {
      takeOne(this.inv, this.selected);
      this.invDirty = true;
    }
  }

  pickBlock() {
    const hit = this.raycast();
    if (!hit) return;
    const id = hit.id;
    const found = this.inv.slice(0, HOTBAR_SIZE).findIndex((s) => s && s.id === id);
    if (found >= 0) { this.selected = found; return; }
    if (this.mode === 'creative' && CREATIVE_BLOCKS.includes(id)) {
      const empty = this.inv.slice(0, HOTBAR_SIZE).findIndex((s) => !s);
      if (empty >= 0) this.selected = empty;
      this.inv[this.selected] = makeStack(id, 64);
      this.invDirty = true;
    }
  }

  // ---------- survival ----------
  damage(amount, cause = 'died', from = null) {
    if (this.mode !== 'survival' || this.dead || this.stats.invuln > 0) return;
    this.stats.health = Math.max(0, this.stats.health - amount);
    this.stats.invuln = 0.5;
    this.stats.hurtUntil = performance.now() + 300;
    this.stats.exhaustion += 0.1;
    sound.hurt();
    $('damage-flash').classList.remove('on');
    void $('damage-flash').offsetWidth;
    $('damage-flash').classList.add('on');
    if (from) {
      const dx = this.player.x - from[0], dz = this.player.z - from[1], len = Math.hypot(dx, dz) || 1;
      this.player.vx += (dx / len) * 7;
      this.player.vz += (dz / len) * 7;
      this.player.vy = Math.max(this.player.vy, 5);
    }
    this.invDirty = true;
    if (this.stats.health <= 0) this.die(cause);
  }

  die(cause) {
    this.dead = true;
    const items = this.inv.filter(Boolean);
    this.inv = new Array(INVENTORY_SIZE).fill(null);
    this.send({ t: 'died', items, cause });
    this.screen.close();
    document.exitPointerLock();
    $('death-cause').textContent = `${this.name} ${cause}`;
    $('death').classList.remove('hidden');
    this.invDirty = true;
  }

  respawn() {
    this.dead = false;
    $('death').classList.add('hidden');
    Object.assign(this.stats, { health: 20, food: 20, air: MAX_AIR, exhaustion: 0, invuln: 1 });
    const p = this.player;
    [p.x, p.y, p.z] = this.spawn;
    p.vx = p.vy = p.vz = 0;
    p.fallStart = null;
    this.unstick();
    this.invDirty = true;
    this.send({ t: 'respawn' });
    this.lock();
  }

  unstick() {
    const p = this.player;
    let guard = 0;
    while (collides(this.world, p) && p.y < HEIGHT + 2 && guard++ < 200) p.y = Math.floor(p.y) + 1.0001;
  }

  survivalTick(dt) {
    const s = this.stats;
    s.invuln = Math.max(0, s.invuln - dt);
    if (this.mode !== 'survival' || this.dead) { s.air = MAX_AIR; return; }

    // hunger
    while (s.exhaustion >= 4) { s.exhaustion -= 4; s.food = Math.max(0, s.food - 1); this.invDirty = true; }
    if (s.food >= 18 && s.health < 20) {
      s.regen += dt;
      if (s.regen >= 4) { s.regen = 0; s.health = Math.min(20, s.health + 1); s.exhaustion += 6; this.invDirty = true; }
    } else s.regen = 0;
    if (s.food === 0) {
      s.starve += dt;
      if (s.starve >= 4) { s.starve = 0; if (s.health > 1) this.damage(1, 'starved to death'); }
    }

    // drowning
    if (this.player.headInWater) {
      s.air -= dt * 20;
      if (s.air <= -20) { s.air = 0; this.damage(2, 'drowned'); }
    } else {
      s.air = Math.min(MAX_AIR, s.air + dt * 60);
    }

    // eating (hold right click for 1.6 s)
    if (this.eating > 0) {
      const held = this.held();
      if (!this.mouse.right || !held || !ITEMS[held.id]?.food || s.food >= 20) this.eating = 0;
      else {
        this.eating += dt;
        if (Math.floor(this.eating * 5) !== Math.floor((this.eating - dt) * 5)) sound.eat();
        if (this.eating >= 1.6) {
          s.food = Math.min(20, s.food + foodValue(held.id));
          takeOne(this.inv, this.selected);
          this.eating = 0;
          this.invDirty = true;
        }
      }
    }
  }

  // ---------- physics ----------
  physics(dt) {
    const p = this.player;
    const k = this.keys;
    const creative = this.mode === 'creative';
    if (!creative) p.flying = false;

    const forward = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0);
    const strafe = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    if (forward <= 0 || p.sneaking || (this.stats.food <= 6 && !creative)) p.sprinting = false;
    p.sneaking = !!(k.ShiftLeft || k.ShiftRight) && !p.flying;
    p.height = p.sneaking ? 1.5 : HEIGHT_STAND;

    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    let wx = -sin * forward + cos * strafe;
    let wz = -cos * forward - sin * strafe;
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }

    let speed = p.flying ? (p.sprinting ? FLY * 2 : FLY) : p.sneaking ? SNEAK : p.sprinting ? SPRINT : WALK;
    if (p.inWater && !p.flying) speed *= 0.5;
    const control = p.onGround || p.flying ? 20 : p.inWater ? 6 : 5;
    const a = Math.min(1, dt * control);
    p.vx += (wx * speed - p.vx) * a;
    p.vz += (wz * speed - p.vz) * a;

    if (p.flying) {
      const up = (k.Space ? 1 : 0) - (k.ShiftLeft || k.ShiftRight ? 1 : 0);
      p.vy += (up * FLY * 0.75 - p.vy) * Math.min(1, dt * 12);
    } else if (p.inWater) {
      p.vy = Math.max(-3, p.vy - GRAVITY * 0.25 * dt);
      if (k.Space) p.vy = Math.min(p.vy + 30 * dt, 3.5);
    } else {
      p.vy = Math.max(-60, p.vy - GRAVITY * dt);
      if ((k.Space || this.jumpQueued) && p.onGround) {
        p.vy = JUMP_SPEED;
        this.stats.exhaustion += p.sprinting ? 0.2 : 0.05;
        if (p.sprinting) { p.vx += wx * 2; p.vz += wz * 2; }
      }
    }

    if (collides(this.world, p)) { p.y = Math.floor(p.y) + 1.0001; p.vy = 0; }

    const before = { x: p.x, z: p.z };
    const wasOnGround = p.onGround;
    const res = moveBody(this.world, p, dt);

    // sneaking: don't walk off edges
    if (p.sneaking && wasOnGround && !res.onGround && p.vy <= 0) {
      const probe = { ...p, y: p.y - 0.6 };
      const supported = (x, z) => collides(this.world, { ...probe, x, z });
      if (!supported(p.x, p.z)) {
        if (supported(before.x, p.z)) p.x = before.x;
        else if (supported(p.x, before.z)) p.z = before.z;
        else { p.x = before.x; p.z = before.z; }
        p.y = Math.floor(p.y + 0.5);
        p.vy = 0;
        res.onGround = true;
      }
    }

    // fall damage
    if (!res.onGround && !p.inWater && !p.flying) {
      if (p.fallStart === null || p.y > p.fallStart) p.fallStart = p.y;
    }
    if (res.onGround || p.inWater || p.flying) {
      if (p.fallStart !== null && res.onGround && !p.inWater && !p.flying) {
        const dist = p.fallStart - p.y;
        if (dist > 3.5) this.damage(Math.floor(dist - 3), 'fell from a high place');
      }
      p.fallStart = null;
    }
    if (res.onGround && p.flying) p.flying = false;
    p.onGround = res.onGround;

    const feet = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.4), Math.floor(p.z));
    const wasInWater = p.inWater;
    p.inWater = feet === BLOCK.WATER;
    if (p.inWater && !wasInWater && p.vy < -6) sound.splash();
    p.headInWater = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + this.eyeHeight()), Math.floor(p.z)) === BLOCK.WATER;

    // footsteps and sprint exhaustion
    const moved = Math.hypot(p.x - before.x, p.z - before.z);
    if (p.onGround) {
      this.stepDist += moved;
      if (this.stepDist > (p.sprinting ? 2.2 : 1.8)) {
        this.stepDist = 0;
        sound.step(this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.1), Math.floor(p.z)));
      }
    }
    if (p.sprinting) this.stats.exhaustion += moved * 0.1;
    this.bob += moved * 2.2;

    if (p.y < -40) {
      if (this.mode === 'survival') this.damage(1000, 'fell out of the world');
      else { p.y = HEIGHT + 10; p.vy = 0; }
    }
  }

  // ---------- held item ----------
  buildHand() {
    this.handScene = new THREE.Scene();
    this.handCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 10);
    this.handGroup = new THREE.Group();
    this.handScene.add(this.handGroup);
    window.addEventListener('resize', () => {
      this.handCamera.aspect = window.innerWidth / window.innerHeight;
      this.handCamera.updateProjectionMatrix();
    });
    this.handKey = null;
  }

  updateHand(dt, brightness) {
    const id = this.heldId();
    const key = id + ':' + (this.dead ? 'dead' : '');
    if (key !== this.handKey) {
      this.handKey = key;
      for (const c of [...this.handGroup.children]) { this.handGroup.remove(c); c.geometry?.dispose(); c.material?.dispose(); }
      let mesh;
      if (!id) {
        const geo = new THREE.BoxGeometry(0.22, 0.22, 0.7);
        mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xd8a47f }));
        mesh.position.set(0.42, -0.42, -0.55);
        mesh.rotation.set(0.2, -0.15, 0);
      } else if (isBlockId(id) && BLOCKS[id].render === 'cube') {
        const geo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
        const tex = BLOCKS[id].tex;
        const faces = [tex[3], tex[3], tex[0], tex[2], tex[1], tex[1]];
        const uv = geo.attributes.uv;
        for (let f = 0; f < 6; f++) {
          const [u0, v0, u1, v1] = uvOf(faces[f]);
          for (let v = 0; v < 4; v++) uv.setXY(f * 4 + v, uv.getX(f * 4 + v) ? u1 : u0, uv.getY(f * 4 + v) ? v1 : v0);
        }
        mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.textures.atlasSRGB, alphaTest: 0.5 }));
        mesh.position.set(0.46, -0.4, -0.72);
        mesh.rotation.set(0.1, Math.PI / 4, 0);
      } else {
        const map = isBlockId(id) ? this.textures.tileTexture(BLOCKS[id].tex[0]) : this.textures.itemTexture(id);
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide }));
        mesh.position.set(0.5, -0.35, -0.7);
        mesh.rotation.set(0, -Math.PI / 2.6, Math.PI / 16);
      }
      this.handBase = mesh.position.clone();
      this.handColor = mesh.material.color.clone();
      this.handGroup.add(mesh);
    }
    const mesh = this.handGroup.children[0];
    if (!mesh) return;
    mesh.material.color.copy(this.handColor).multiplyScalar(brightness);
    this.swing = Math.max(0, this.swing - dt * 4);
    const swing = Math.sin((1 - this.swing) * Math.PI) * (this.swing > 0 ? 1 : 0);
    const eat = this.eating > 0 ? Math.sin(this.eating * 20) * 0.03 : 0;
    mesh.position.set(
      this.handBase.x - swing * 0.2 + Math.sin(this.bob) * 0.015,
      this.handBase.y + swing * 0.15 + Math.abs(Math.cos(this.bob)) * 0.02 + eat + (this.eating > 0 ? 0.15 : 0),
      this.handBase.z - swing * 0.15,
    );
    this.handGroup.rotation.x = -swing * 0.6;
    this.handGroup.visible = !this.dead;
  }

  // ---------- main loop ----------
  update(rawDt) {
    if (!this.playing || !this.world) return;
    const dt = Math.min(0.25, rawDt);
    const p = this.player;

    this.physicsTime += dt;
    let stepped = false;
    while (this.physicsTime >= STEP) {
      this.physics(STEP);
      this.physicsTime -= STEP;
      stepped = true;
    }
    if (stepped) this.jumpQueued = false; // a tap shorter than one frame still jumps
    this.survivalTick(dt);

    this.attackCooldown -= dt;
    this.useCooldown -= dt;

    const cam = this.r.camera;
    cam.position.set(p.x, p.y + this.eyeHeight(), p.z);
    cam.rotation.set(p.pitch, p.yaw, 0);
    this.r.updateChunks(p.x, p.z);

    // targeting, breaking and repeated placing
    const hit = this.locked() && !this.dead ? this.raycast() : null;
    let progress = 0;
    if (hit && this.mouse.left && !this.targetMob(hit)) {
      if (this.mode === 'creative') {
        if (this.useCooldown <= 0) { this.breakBlockAt(hit); this.useCooldown = 0.25; this.swing = 1; }
      } else {
        const b = this.breaking;
        if (!b || b.x !== hit.x || b.y !== hit.y || b.z !== hit.z) this.breaking = { x: hit.x, y: hit.y, z: hit.z, progress: 0, sound: 0 };
        const t = breakTime(hit.id, this.heldId()) * (p.onGround || p.flying ? 1 : 5) * (p.headInWater ? 5 : 1);
        this.breaking.progress += t === 0 ? 1 : dt / t;
        this.breaking.sound -= dt;
        if (this.breaking.sound <= 0) { sound.dig(hit.id); this.breaking.sound = 0.25; this.swing = 1; }
        progress = this.breaking.progress;
        if (progress >= 1) {
          this.breakBlockAt(hit);
          this.breaking = null;
          progress = 0;
          this.useCooldown = 0.15;
        }
      }
    } else if (!this.mouse.left) {
      this.breaking = null;
    }
    if (this.mouse.right && this.useCooldown <= 0 && this.eating === 0 && this.locked()) {
      const held = this.held();
      if (hit && held && isBlockId(held.id)) this.placeBlock(hit, held);
    }
    this.r.setTarget(hit, progress);

    // pick up nearby items (not while dead, or you'd grab back what you just dropped)
    const now = performance.now();
    for (const [id, v] of this.dead ? [] : this.entities.entities) {
      if (v.item === undefined) continue;
      const pos = v.group.position;
      if (Math.abs(pos.x - p.x) < 1.5 && Math.abs(pos.z - p.z) < 1.5 && pos.y > p.y - 1 && pos.y < p.y + 2.3) {
        if ((this.pickupTried.get(id) || 0) < now - 400 && this.canFit(v.item)) {
          this.pickupTried.set(id, now);
          this.send({ t: 'pickup', e: id });
        }
      }
    }
    if (this.pickupTried.size > 200) this.pickupTried.clear();

    // environment
    this.r.updateEnvironment(this.time, p.headInWater, p.sprinting && !p.sneaking);
    this.lightBudget = 1;
    this.time += dt * 20;
    this.entities.lightAt = (x, y, z) => this.lightAt(x, y, z);
    this.entities.update(dt);
    this.updateHand(dt, this.lightAt(p.x, p.y + this.eyeHeight(), p.z));
    $('water-overlay').classList.toggle('hidden', !p.headInWater);

    // network
    if (now - this.lastSent > 100) {
      this.lastSent = now;
      const pos = [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)];
      const rot = [+p.yaw.toFixed(3), +p.pitch.toFixed(3)];
      const state = JSON.stringify([pos, rot, this.heldId()]);
      if (state !== this.lastSentState) {
        this.lastSentState = state;
        this.send({ t: 'pos', p: pos, r: rot, h: this.heldId() });
      }
    }
    this.unloadTimer = (this.unloadTimer || 0) + dt;
    if (this.unloadTimer > 5) {
      // forget terrain far behind us (edits are kept, so it regenerates identically)
      this.unloadTimer = 0;
      this.world.unloadFar(Math.floor(p.x / CHUNK), Math.floor(p.z / CHUNK), this.r.renderDistance + 2);
    }
    this.saveTimer += dt;
    if (this.invDirty && this.saveTimer > 2) {
      this.saveTimer = 0;
      this.invDirty = false;
      this.send({ t: 'save', inv: this.inv, health: this.stats.health, food: this.stats.food });
    }

    // HUD
    this.stats.hurtFlash = (this.stats.hurtUntil || 0) > now;
    this.hud.render(this.inv, this.selected, this.stats, this.mode);
    const dbg = $('debug');
    dbg.classList.toggle('hidden', !this.showDebug);
    if (this.showDebug) {
      dbg.textContent = `XYZ ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}\n` +
        `Facing ${((p.yaw * 180 / Math.PI) % 360).toFixed(0)}°  Time ${Math.floor(this.time)}  ${this.fps || 0} fps\n` +
        `Chunks ${this.r.meshes.size} (${this.r.pending.size} loading)  Players ${this.entities.players.size + 1}  Entities ${this.entities.entities.size}`;
    }
  }

  // Light for mobs, items and the hand, using the same light engine as the terrain.
  // Light is computed per chunk on demand (at most one new chunk per frame) and cached.
  lightAt(x, y, z) {
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    const skyFactor = this.r.skyFactor ?? 1;
    if (by >= HEIGHT) return toLinear(lightCurve(skyFactor));
    if (by < 0) return toLinear(lightCurve(0));
    const cx = Math.floor(bx / CHUNK), cz = Math.floor(bz / CHUNK);
    const key = chunkKey(cx, cz);
    let light = this.lightCache.get(key);
    if (!light && this.lightBudget > 0) {
      this.lightBudget--;
      if (this.lightCache.size > 24) this.lightCache.clear();
      light = computeLight(gatherRegion(this.world, cx, cz));
      this.lightCache.set(key, light);
    }
    if (!light) return toLinear(lightCurve(skyFactor * 0.8)); // not computed yet: assume outdoors
    const i = regionIndex(bx - cx * CHUNK, by, bz - cz * CHUNK);
    return toLinear(lightCurve(Math.max(light.sky[i] / 15 * skyFactor, light.block[i] / 15)));
  }

  canFit(id) {
    const s = this.inv;
    return s.some((x) => !x || (x.id === id && x.dur === undefined && x.count < 64));
  }

  render() {
    this.r.render(this.handScene, this.handCamera);
  }

  // Leaving the world: tell the host our final state.
  quit() {
    if (this.playing) this.send({ t: 'save', inv: this.inv, health: this.stats.health, food: this.stats.food });
    this.playing = false;
    this.closed = true;
    this.screen.close();
    this.unbind();
    this.entities.clear();
    this.r.clearChunks();
    document.exitPointerLock?.();
  }
}
