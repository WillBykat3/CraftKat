// The client: everything one player experiences. Talks to the GameHost
// through `conn` (loopback for the host's own player, WebRTC for friends).

import * as THREE from 'three';
import {
  BLOCK, BLOCKS, HEIGHT, CHUNK, isSupported, blockItem, armorOf, canHoldAttached, ITEM, isBlockId, toolOf, breakTime, ITEMS, CREATIVE_BLOCKS,
  fluidOf, isSource, isFurnace, isContainer, maxDurability,
} from './blocks.js';
import { World, chunkKey } from './world.js';
import { gatherRegion, computeLight, regionIndex } from './lighting.js';
import { collides, moveBody, boxOverlapsBlock } from './physics.js';
import { BREED_FOOD } from './mob-ai.js';
import { addItem, takeOne, foodValue, makeStack, INVENTORY_SIZE, HOTBAR_SIZE, countItem, takeItems, extras } from './inventory.js';
import { EntityViews } from './entities.js';
import { InventoryScreen, HUD, setDials } from './ui.js';
import { Precipitation, lightningBolt } from './weather.js';
import { stepVehicle, SIZES } from './riding.js';
import { isRail, railInfo, railId, computeShape } from './rails.js';
import { sound, setRain } from './sound.js';
import { blockGeometry, hasBlockModel } from './textures.js';
import { selectionBoxes, rayBox, boundsOf, facingFromYaw } from './shapes.js';
import { BIOMES, BIOME, FROZEN } from './biomes.js';
import { VERSION } from './version.js';
import { Particles } from './particles.js';
import { levelInfo, pointsForLevel } from './xp.js';
import { lightCurve, toLinear } from './renderer.js';
import { NETHER_FOG } from './terrain-nether.js';
import { POTIONS, EFFECTS, FOOD_EFFECTS } from './effects.js';
import { flowAt } from './fluids.js';
import { protectionPoints, wears, level as enchLevel, tableOffers, anvilCombine, grind } from './enchant.js';

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
    this.stats = { health: 20, food: 20, air: MAX_AIR, exhaustion: 0, regen: 0, starve: 0, invuln: 0, hurtFlash: false, xpTotal: 0, xpLevel: 0, xpProgress: 0 };
    this.mode = 'survival';
    this.inv = new Array(INVENTORY_SIZE).fill(null);
    this.armor = [null, null, null, null]; // helmet, chestplate, leggings, boots
    this.offhand = null; // F swaps it with the selected hotbar slot
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
    this.effects = {}; // status effects: name -> {amp, time}
    this.absorb = 0;
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
    // where your own fishing line starts: the tip of the rod, top right of the view
    this.entities.selfRodTip = () => {
      const p = this.player, f = new THREE.Vector3(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
      const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
      if (this.perspective !== 0) return new THREE.Vector3(p.x, p.y + 1.9, p.z).addScaledVector(f, 0.9).addScaledVector(right, 0.35);
      return new THREE.Vector3(p.x, p.y + this.eyeHeight(), p.z).addScaledVector(f, 1).addScaledVector(right, 0.42).add(new THREE.Vector3(0, 0.3, 0));
    };
    this.particles = new Particles(renderer.scene, textures);
    this.precipitation = new Precipitation(renderer.scene);
    this.weather = 'clear';
    this.perspective = 0; // 0 first person, 1 third person behind, 2 third person in front (F5)
    this.bobAmount = 0;
    this.caveTimer = 60;
    this.screen = new InventoryScreen(this);
    this.hud = new HUD(this.iconURL);
    $('chat-log').replaceChildren(); // (nothing left over from the last world)
    $('effects').replaceChildren();
    this.buildHand();
    this.bindInput();

    conn.onMessage = (msg) => this.handle(msg);
    conn.onClose = (reason) => this.disconnected(reason);
  }

  // ---------- networking ----------
  send(msg) {
    this.conn.send({ ...msg, ds: this.ds }); // which trip between dimensions it belongs to (see host.js)
  }

  handle(msg) {
    switch (msg.t) {
      case 'welcome': return this.welcome(msg);
      case 'dimension': return this.changeDimension(msg);
      case 'error': return this.disconnected(msg.msg);
      case 'join':
        this.entities.addPlayer(msg.id, msg.name, msg.p, msg.r);
        if (msg.armor) this.entities.setArmor(msg.id, msg.armor);
        return;
      case 'leave': return this.entities.removePlayer(msg.id);
      case 'state':
        for (const [id, x, y, z, yaw, pitch, , flags = 0] of msg.players) if (id !== this.myId) this.entities.movePlayer(id, [x, y, z], [yaw, pitch], flags);
        return;
      case 'entities': return this.entities.syncEntities(msg.list);
      case 'set':
        if (this.world) this.applyBlock(msg.x, msg.y, msg.z, msg.id);
        return;
      case 'chat': return this.addChat(`<${msg.from}> ${msg.msg}`);
      case 'sys': return this.addChat(msg.msg, 'sys');
      case 'time': this.time = msg.time; return;
      case 'weather': this.weather = msg.w; return;
      case 'lightning': {
        if (this.dim !== 'overworld') return;
        lightningBolt(this.r.scene, msg.x, msg.y, msg.z);
        this.r.flash = 1;
        const d = Math.hypot(msg.x - this.player.x, msg.z - this.player.z);
        setTimeout(() => sound.thunder(d), Math.min(3000, d * 15)); // sound is slower than light
        return;
      }
      case 'mode':
        this.mode = msg.mode;
        if (msg.mode === 'survival') this.player.flying = false;
        return;
      case 'mounted': {
        const [halfW, height] = SIZES[msg.kind] || [0.5, 1];
        this.ride = { id: msg.e, kind: msg.kind, x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw || 0, vx: 0, vy: 0, vz: 0, halfW, height, onGround: false,
          seat: msg.seat, speed: msg.kind === 'pig' ? 2.3 : msg.speed, jump: msg.kind === 'horse' ? msg.jump : 0, tamed: msg.tamed, saddled: msg.saddled, missing: 0 };
        this.player.flying = false;
        return;
      }
      case 'dismounted':
        if (msg.thrown) this.addChat('The horse threw you off! (It trusts you a little more each time.)', 'sys');
        return this.unmount(false);
      case 'teleport':
        this.ride = null;
        this.player.x = msg.p[0]; this.player.y = msg.p[1]; this.player.z = msg.p[2];
        this.player.vx = this.player.vy = this.player.vz = 0;
        this.player.fallStart = null;
        return;
      case 'give': {
        const extra = extras(msg);
        const left = addItem(this.inv, msg.id, msg.count, msg.dur, extra);
        if (left > 0) this.dropStack({ id: msg.id, count: left, dur: msg.dur, ...extra });
        sound.pop();
        this.invDirty = true;
        if (this.screen.isOpen) this.screen.render();
        return;
      }
      case 'effect': return this.applyPotion(msg.potion, msg.scale);
      case 'hurt':
        if (msg.fire && this.mode === 'survival') this.onFire = Math.max(this.onFire || 0, msg.fire);
        if (Array.isArray(msg.effects) && this.mode === 'survival') for (const [n, amp, t] of msg.effects) this.addEffect(n, amp, t);
        return this.damage(msg.amount, msg.cause, msg.from, true, msg.by);
      case 'equip': return this.entities.setArmor(msg.id, msg.armor);
      case 'xp': return this.addXP(this.mend(msg.amount));
      case 'hiss': if (Math.hypot(msg.x - this.player.x, msg.y - this.player.y, msg.z - this.player.z) < 32) sound.hiss(); return;
      case 'mobhurt': {
        const v = this.entities.entities.get(msg.e);
        this.entities.hurt(msg.e);
        if (v && v.group.position.distanceTo(this.r.camera.position) < 24) sound.mobHurt(v.mob);
        return;
      }
      case 'mobdeath': return;
      case 'trades':
        if (this.screen.kind === 'trade' && this.screen.trade.e === msg.e) { this.screen.trade = msg; this.screen.render(); }
        else if (!this.screen.isOpen) this.openScreen('trade', msg);
        return;
      case 'traded': return this.finishTrade(msg);
      case 'reeled':
        if (msg.caught && this.held()?.id === ITEM.FISHING_ROD) { this.useTool(1); this.invDirty = true; }
        return;
      case 'consume':
        if (this.mode === 'survival' && this.inv[this.selected]) { takeOne(this.inv, this.selected); this.invDirty = true; }
        return;
      case 'boss':
        $('bossbar').classList.toggle('hidden', !(msg.hp > 0));
        if (msg.hp > 0) {
          $('boss-name').textContent = msg.name || 'Ender Dragon';
          $('boss-fill').style.width = `${(msg.hp / (msg.max || 200)) * 100}%`;
        }
        return;
      case 'sfx':
        if ((msg.everywhere || Math.hypot(msg.x - this.player.x, msg.y - this.player.y, msg.z - this.player.z) < 64) && typeof sound[msg.s] === 'function') sound[msg.s]();
        return;
      case 'furnace': return this.screen.setFurnaceState(msg);
      case 'brewing': return this.screen.setBrewState(msg);
      case 'chest': return this.screen.setChestState(msg);
      case 'chest_gone': if (this.screen.kind === 'chest') this.closeScreen(); return;
      case 'sleeping': return this.startSleeping(msg.at);
      case 'wake': return this.stopSleeping();
      case 'boom': {
        const d = Math.hypot(msg.x - this.player.x, msg.y - this.player.y, msg.z - this.player.z);
        if (d < 48) { sound.boom(); this.shake = Math.max(this.shake || 0, Math.max(0, 1 - d / 24)); }
        return;
      }
      case 'cursor':
        if (this.screen.isOpen) return this.screen.setCursor(msg.stack);
        // the screen was closed before the host answered: put the item back in the inventory
        if (msg.stack) {
          const left = addItem(this.inv, msg.stack.id, msg.stack.count, msg.stack.dur, extras(msg.stack));
          if (left > 0) this.dropStack({ ...msg.stack, count: left });
          this.invDirty = true;
        }
        return;
    }
  }

  welcome(msg) {
    this.myId = msg.id;
    this.ride = null;
    this.entities.selfId = msg.id;
    this.name = msg.name;
    this.dim = msg.dim || 'overworld';
    this.ds = 0;
    $('bossbar').classList.add('hidden');
    $('portal-overlay').classList.add('hidden');
    this.world = new World(msg.seed, msg.gen || 1, this.dim);
    this.world.importEdits(msg.edits);
    this.spawn = msg.spawn;
    this.time = msg.time;
    this.weather = msg.weather || 'clear';
    this.mode = msg.mode;
    const me = msg.me;
    [this.player.x, this.player.y, this.player.z] = me.pos;
    [this.player.yaw, this.player.pitch] = me.rot;
    if (Array.isArray(me.inv)) this.inv = me.inv.map((s) => (s ? { ...s } : null));
    else if (this.mode === 'survival') this.inv = new Array(INVENTORY_SIZE).fill(null);
    else this.giveCreativeStarter();
    this.stats.health = me.health ?? 20;
    this.stats.food = me.food ?? 20;
    this.stats.xpTotal = Number.isInteger(me.xp) ? me.xp : 0;
    this.enchSeed = Number.isInteger(me.enchSeed) ? me.enchSeed : Math.floor(Math.random() * 2 ** 31);
    this.armor = Array.isArray(me.armor) && me.armor.length === 4 ? me.armor.map((s) => (s ? { ...s } : null)) : [null, null, null, null];
    this.offhand = me.offhand ? { ...me.offhand } : null;
    this.armorChanged();
    this.addXP(0);
    if (this.stats.health <= 0) this.stats.health = 20;
    this.unstick();
    for (const p of msg.players) {
      this.entities.addPlayer(p.id, p.name, p.p, p.r);
      if (p.armor) this.entities.setArmor(p.id, p.armor);
    }
    this.r.startWorld(msg.seed, msg.edits, msg.gen || 1, this.dim);
    this.r.setRenderDistance(this.settings.renderDistance);
    this.playing = true;
    this.sentArmor = null;
    this.armorChanged(); // tell the others what we're wearing
    this.addChat(`Welcome to ${msg.worldName}, ${msg.name}!`, 'sys');
    this.addChat('E: inventory · T: chat · Q: drop · /help for commands', 'sys');
  }

  // The host moved us to another dimension (through a portal, by dying, or /tp).
  changeDimension(msg) {
    const { seed, gen } = this.world;
    this.dim = msg.dim;
    this.ds = msg.ds;
    this.world = new World(seed, gen, msg.dim);
    this.world.importEdits(msg.edits);
    this.lightCache.clear();
    this.entities.clear();
    this.particles.clear();
    if (this.screen.isOpen) this.closeScreen();
    for (const q of msg.players) {
      this.entities.addPlayer(q.id, q.name, q.p, q.r);
      if (q.armor) this.entities.setArmor(q.id, q.armor);
    }
    const p = this.player;
    [p.x, p.y, p.z] = msg.pos;
    p.vx = p.vy = p.vz = 0;
    p.fallStart = null;
    this.unstick();
    this.r.startWorld(seed, msg.edits, gen, msg.dim);
    this.r.setRenderDistance(this.settings.renderDistance);
    this.portalGlow = 0;
    $('bossbar').classList.add('hidden');
    sound.portal(true);
    // "Loading terrain..." until the ground under us is drawn
    this.loadingTerrain = performance.now();
    $('loading-text').textContent = 'Loading terrain…';
    $('loading').classList.remove('hidden');
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
    const old = this.world ? this.world.getBlock(x, y, z) : 0;
    if (!this.world.setBlock(x, y, z, id)) return;
    // broken (or replaced, like ice melting): pieces fly off, if it's near enough to see
    if (old !== id && old !== BLOCK.AIR && !BLOCKS[old].liquid && (id === BLOCK.AIR || BLOCKS[id].liquid)) {
      const p = this.player;
      if (Math.abs(p.x - x) + Math.abs(p.y - y) + Math.abs(p.z - z) < 48) this.particles.breakBlock(x, y, z, old, this.lightAt(x + 0.5, y + 0.5, z + 0.5));
    }
    this.r.blockChanged(x, y, z, id);
    // light can change up to 15 blocks away: forget cached light for nearby chunks
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.lightCache.delete(chunkKey(cx + dx, cz + dz));
    if (this.screen.kind === 'furnace' && !isFurnace(id)) {
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

  brewClick(at, slot, button, cursor) {
    this.send({ t: 'brew_click', x: at[0], y: at[1], z: at[2], slot, button, cursor });
  }

  chestClick(at, slot, button, cursor) {
    this.send({ t: 'chest_click', x: at[0], y: at[1], z: at[2], slot, button, cursor });
  }

  chestPut(at, stack) {
    this.send({ t: 'chest_put', x: at[0], y: at[1], z: at[2], stack });
  }

  chestTake(at, slot) {
    this.send({ t: 'chest_take', x: at[0], y: at[1], z: at[2], slot });
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
        if (!this.chatOpen && !this.screen.isOpen && !this.dead && !this.player.sleeping) this.showPause(true);
      } else {
        this.showPause(false);
      }
    });
    on(canvas, 'click', () => { if (this.playing && !this.locked() && !this.screen.isOpen && !this.dead && !this.player.sleeping) this.lock(); });

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
    if (e.code === 'KeyF') { [this.inv[this.selected], this.offhand] = [this.offhand, this.inv[this.selected] ?? null]; this.invDirty = true; }
    if (e.code === 'F3') { this.showDebug = !this.showDebug; e.preventDefault(); }
    if (e.code === 'F1') { $('hud').classList.toggle('hidden-hud'); e.preventDefault(); }
    if (e.code === 'F5') { this.perspective = (this.perspective + 1) % 3; e.preventDefault(); }
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
    if (this.screen.kind === 'brewing') {
      const [x, y, z] = this.screen.brewer.at;
      this.send({ t: 'brew_close', x, y, z });
    }
    if (this.screen.kind === 'chest') {
      const [x, y, z] = this.screen.chest.at;
      this.send({ t: 'chest_close', x, y, z });
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

  // Voxel walk along the view ray (skips air, and water unless asked for).
  raycast(maxDist = REACH, hitWater = false) {
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
      if (id !== BLOCK.AIR && (hitWater || !BLOCKS[id].liquid) && y >= 0 && y < HEIGHT) {
        const def = BLOCKS[id];
        if (def.render === 'cube' || def.liquid) return { x, y, z, id, normal: [...normal], dist: t, box: [0, 0, 0, 1, 1, 1] };
        // smaller blocks (slabs, doors, plants...): only their actual boxes can be hit
        const boxes = selectionBoxes(id, (dx, dy, dz) => this.world.getBlock(x + dx, y + dy, z + dz));
        let best = null;
        for (const box of boxes) {
          const r = rayBox([o.x, o.y, o.z], [d.x, d.y, d.z], box, x, y, z);
          if (r && r.t <= maxDist && (!best || r.t < best.t)) best = r;
        }
        if (best) return { x, y, z, id, normal: best.normal, dist: best.t, box: boundsOf(boxes) };
      }
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
        this.send({ t: 'attack', e: mob.id, tool: this.heldId(), ench: this.held()?.ench, str: this.effectLevel('strength') - this.effectLevel('weakness') });
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
    this.send({ t: 'dig', x: hit.x, y: hit.y, z: hit.z, tool: this.heldId(), ench: this.held()?.ench });
    this.applyBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
    sound.broke(id);
    if (this.mode === 'survival') {
      // only tools wear out from breaking blocks (not bows, rods or shields)
      const kind = toolOf(this.heldId())?.kind;
      if (BLOCKS[id].hardness > 0 && ['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears'].includes(kind)) this.useTool(kind === 'sword' ? 2 : 1);
      this.stats.exhaustion += 0.005;
    }
  }

  useTool(wear) {
    if (this.mode !== 'survival') return;
    const s = this.held();
    if (!s || s.dur === undefined || !wears(s)) return;
    s.dur -= wear;
    if (s.dur <= 0) {
      this.inv[this.selected] = null;
      sound.broke(BLOCK.GLASS);
    }
    this.invDirty = true;
  }

  rightClick() {
    if (this.player.sleeping) return;
    const hit = this.raycast();
    const held = this.held();
    const mob = this.targetMob(hit);
    if (mob && this.entities.entities.get(mob.id)?.mob === 'villager') {
      this.send({ t: 'interact', e: mob.id });
      this.swing = 1;
      return;
    }
    if (mob && held?.id === ITEM.BUCKET && this.entities.entities.get(mob.id)?.mob === 'cow') {
      if (this.mode === 'survival') {
        takeOne(this.inv, this.selected);
        const left = addItem(this.inv, ITEM.MILK_BUCKET, 1);
        if (left) this.dropStack({ id: ITEM.MILK_BUCKET, count: 1 });
      }
      sound.splash();
      this.invDirty = true;
      return;
    }
    // feeding, breeding and taming animals (the host says if the food was eaten, with 'consume')
    const kind = mob && this.entities.entities.get(mob.id)?.mob;
    const flags = mob ? this.entities.entities.get(mob.id)?.flags || 0 : 0;
    if (kind && held && (BREED_FOOD[kind]?.includes(held.id) || (kind === 'wolf' && held.id === ITEM.BONE))) {
      this.send({ t: 'interact', e: mob.id, tool: held.id });
      this.swing = 1;
      this.useCooldown = 0.25;
      return;
    }
    if (kind === 'wolf' && (flags & 4096)) { this.send({ t: 'interact', e: mob.id }); this.useCooldown = 0.25; return; } // sit / stand
    if (kind === 'horse' && held && [ITEM.WHEAT, ITEM.SUGAR, ITEM.APPLE, ITEM.GOLDEN_CARROT, ITEM.GOLDEN_APPLE, BLOCK.HAY_BALE].includes(held.id)) {
      this.send({ t: 'interact', e: mob.id, tool: held.id }); // feed it (the host replies 'consume' if it eats)
      this.swing = 1; this.useCooldown = 0.25;
      return;
    }
    if (((kind === 'horse' && (flags & 4096)) || kind === 'pig') && held?.id === ITEM.SADDLE && !(flags & 1) && !(flags & 256)) {
      this.send({ t: 'interact', e: mob.id, tool: held.id }); // saddle it
      this.useCooldown = 0.25;
      return;
    }
    if (!this.ride && !this.player.sneaking && (kind === 'boat' || kind === 'minecart' || (kind === 'horse' && !(flags & 256)) || (kind === 'pig' && (flags & 1)))) {
      this.send({ t: 'mount', e: mob.id });
      this.useCooldown = 0.4;
      return;
    }
    if (kind === 'sheep' && held && ITEMS[held.id]?.dye !== undefined && ((flags >> 14) & 15) !== ITEMS[held.id].dye) {
      this.send({ t: 'interact', e: mob.id, tool: held.id }); // dye it (the host replies 'consume')
      this.swing = 1;
      this.useCooldown = 0.25;
      return;
    }
    if (mob && held?.id === ITEM.SHEARS) {
      this.send({ t: 'interact', e: mob.id, tool: held.id });
      this.useTool(1);
      this.swing = 1;
      return;
    }
    if (hit && !this.player.sneaking) {
      const at = [hit.x, hit.y, hit.z];
      if (hit.id === BLOCK.CRAFTING_TABLE) { this.openScreen('crafting'); return; }
      if (hit.id === BLOCK.ENCHANTING_TABLE) { this.openScreen('enchant', { at }); return; }
      if (hit.id === BLOCK.ANVIL || hit.id === BLOCK.CHIPPED_ANVIL || hit.id === BLOCK.DAMAGED_ANVIL) { this.openScreen('anvil', { at }); return; }
      if (hit.id === BLOCK.GRINDSTONE) { this.openScreen('grindstone', { at }); return; }
      if (hit.id === BLOCK.BREWING_STAND) {
        this.openScreen('brewing', { at });
        this.send({ t: 'brew_open', x: hit.x, y: hit.y, z: hit.z });
        return;
      }
      if (isFurnace(hit.id)) {
        this.openScreen('furnace', { at, name: BLOCKS[hit.id].name });
        this.send({ t: 'furnace_open', x: hit.x, y: hit.y, z: hit.z });
        return;
      }
      if (isContainer(hit.id)) {
        this.openScreen('chest', { at, name: BLOCKS[hit.id].name });
        this.send({ t: 'chest_open', x: hit.x, y: hit.y, z: hit.z });
        return;
      }
      if (hit.id === BLOCK.BED) {
        this.send({ t: 'sleep', x: hit.x, y: hit.y, z: hit.z });
        return;
      }
      if (BLOCKS[hit.id].shape === 'door') {
        // open or close both halves right away; the host does the same for everyone
        const lowerY = BLOCKS[hit.id].upper ? hit.y - 1 : hit.y;
        for (const yy of [lowerY, lowerY + 1]) {
          const d = this.world.getBlock(hit.x, yy, hit.z);
          if (BLOCKS[d].shape === 'door') this.applyBlock(hit.x, yy, hit.z, BLOCK.OAK_DOOR + ((d - BLOCK.OAK_DOOR) ^ 4));
        }
        this.send({ t: 'use', x: hit.x, y: hit.y, z: hit.z });
        sound.door(!BLOCKS[hit.id].open);
        this.swing = 1;
        this.useCooldown = 0.25;
        return;
      }
    }
    if (hit && !this.player.sneaking && this.useRedstone(hit, held)) return;
    if (held?.id === ITEM.BOW) return; // drawn while the button is held (see update)
    if (held?.id === ITEM.EYE_OF_ENDER) { this.useEye(hit); return; }
    // seeds, carrots and potatoes go on farmland (before eating them)
    if (hit && held && ITEMS[held.id]?.plants && (hit.id === BLOCK.FARMLAND || !ITEMS[held.id].food)) { this.placeBlock(hit, held, ITEMS[held.id].plants); return; }
    if (hit && held && this.useOnBlock(hit, held)) return;
    if (held && armorOf(held.id)) { this.equipHeld(held); return; }
    if (held && (held.id === ITEM.BUCKET || held.id === ITEM.WATER_BUCKET || held.id === ITEM.LAVA_BUCKET)) {
      this.useBucket(held);
      return;
    }
    if (held && (held.id === ITEM.POTION || held.id === ITEM.MILK_BUCKET)) { this.eating = 0.001; return; }
    if (held && held.id === ITEM.MINECART) {
      if (hit && isRail(hit.id)) {
        this.send({ t: 'place_vehicle', kind: 'minecart', x: hit.x + 0.5, y: hit.y + 0.0625, z: hit.z + 0.5, yaw: this.player.yaw });
        if (this.mode === 'survival') { takeOne(this.inv, this.selected); this.invDirty = true; }
        this.swing = 1;
        this.useCooldown = 0.4;
      }
      return;
    }
    if (held && held.id === ITEM.BOAT) {
      // boats go on water (or on the ground, where they're slow)
      const w = this.raycast(REACH, true);
      const spot = w && fluidOf(w.id) === 'water' ? [w.x + 0.5, w.y + 0.75, w.z + 0.5] : hit ? [hit.x + 0.5, hit.y + 1, hit.z + 0.5] : null;
      if (spot) {
        this.send({ t: 'place_vehicle', kind: 'boat', x: spot[0], y: spot[1], z: spot[2], yaw: this.player.yaw });
        if (this.mode === 'survival') { takeOne(this.inv, this.selected); this.invDirty = true; }
        this.swing = 1;
        this.useCooldown = 0.4;
      }
      return;
    }
    if (held && held.id === ITEM.FISHING_ROD) {
      // cast, or reel in (the host knows which)
      this.send({ t: 'fish', yaw: this.player.yaw, pitch: this.player.pitch, lure: enchLevel(held, 'lure'), luck: enchLevel(held, 'luck_of_the_sea') });
      this.swing = 1;
      this.useCooldown = 0.3;
      return;
    }
    if (held && (held.id === ITEM.SPLASH_POTION || held.id === ITEM.EXPERIENCE_BOTTLE || held.id === ITEM.EGG)) {
      // throw it
      this.send({ t: 'throw', kind: held.id === ITEM.SPLASH_POTION ? 'splash' : held.id === ITEM.EGG ? 'egg' : 'xp', potion: held.potion, yaw: this.player.yaw, pitch: this.player.pitch });
      if (this.mode === 'survival') takeOne(this.inv, this.selected);
      sound.bow();
      this.swing = 1;
      this.useCooldown = 0.4;
      this.invDirty = true;
      return;
    }
    if (held && held.id === ITEM.GLASS_BOTTLE) {
      // fill it with water
      const w = this.raycast(REACH, true);
      if (w && fluidOf(w.id) === 'water') {
        if (this.mode === 'survival') takeOne(this.inv, this.selected);
        const left = addItem(this.inv, ITEM.POTION, 1, undefined, { potion: 'water' });
        if (left) this.dropStack({ id: ITEM.POTION, count: 1, potion: 'water' });
        sound.splash();
        this.useCooldown = 0.3;
        this.invDirty = true;
      }
      return;
    }
    if (held && ITEMS[held.id]?.food) {
      if (this.mode === 'survival' && (this.stats.food < 20 || ITEMS[held.id].alwaysEat)) this.eating = 0.001;
      return;
    }
    if (hit && held && held.id === ITEM.OAK_DOOR) { this.placeDoor(hit); return; }
    if (hit && (!held || !isBlockId(held.id)) && this.offhand && isBlockId(this.offhand.id)) {
      // the main hand has nothing to place: use the offhand (torches, blocks)
      this.fromOffhand = true;
      this.placeBlock(hit, this.offhand);
      this.fromOffhand = false;
      return;
    }
    if (!hit || !held || !isBlockId(held.id)) return;
    this.placeBlock(hit, held);
  }

  // Levers flip, buttons press, repeaters change delay, flint and steel lights TNT.
  useRedstone(hit, held) {
    const def = BLOCKS[hit.id];
    const light = held?.id === ITEM.FLINT_AND_STEEL && hit.id === BLOCK.TNT;
    if (!light && def.redstone !== 'lever' && def.redstone !== 'button' && def.redstone !== 'repeater') return false;
    if (def.redstone === 'lever') { this.applyBlock(hit.x, hit.y, hit.z, hit.id + (def.on ? -5 : 5)); sound.click(); }
    if (def.redstone === 'repeater') {
      const off = hit.id - BLOCK.REPEATER;
      this.applyBlock(hit.x, hit.y, hit.z, BLOCK.REPEATER + (off & 16) + ((((off >> 2) & 3) + 1) % 4) * 4 + (off & 3));
      sound.click();
    }
    if (def.redstone === 'button') sound.click();
    if (light) this.useTool(1);
    this.send({ t: 'use', x: hit.x, y: hit.y, z: hit.z, item: light ? ITEM.FLINT_AND_STEEL : undefined });
    this.swing = 1;
    this.useCooldown = 0.25;
    return true;
  }

  // ---------- enchanting ----------
  // Bookshelves around an enchanting table: two blocks away, on its level or one up, with air between.
  countShelves([x, y, z]) {
    let n = 0;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2) continue;
      for (let dy = 0; dy <= 1; dy++) {
        if (this.world.getBlock(x + dx, y + dy, z + dz) !== BLOCK.BOOKSHELF) continue;
        if (this.world.getBlock(x + Math.trunc(dx / 2), y + dy, z + Math.trunc(dz / 2)) === BLOCK.AIR) n++;
      }
    }
    return Math.min(15, n);
  }

  enchanted() {
    sound.levelUp();
    this.invDirty = true;
  }

  anvilUsed([x, y, z]) {
    this.send({ t: 'anvil_used', x, y, z });
    this.invDirty = true;
  }

  // ---------- trading ----------
  tradeOffer(i) {
    const t = this.screen.trade;
    const o = t?.offers[i];
    if (!o || o.uses >= o.max || this.tradePending) return;
    if (!o.cost.every(([id, n]) => countItem(this.inv, id) >= n)) return;
    this.tradePending = true;
    this.send({ t: 'trade', e: t.e, i });
  }

  // The villager agreed: pay and take the goods.
  finishTrade(msg) {
    this.tradePending = false;
    const o = this.screen.kind === 'trade' && this.screen.trade.e === msg.e ? this.screen.trade.offers[msg.i] : null;
    if (!msg.ok || !o) return;
    if (!o.cost.every(([id, n]) => countItem(this.inv, id) >= n)) return;
    for (const [id, n] of o.cost) takeItems(this.inv, id, n);
    const result = { ...makeStack(o.result[0], o.result[1]), ...(o.ench ? { ench: { ...o.ench } } : {}) };
    const left = addItem(this.inv, result.id, result.count, result.dur, extras(result));
    if (left > 0) this.dropStack({ ...result, count: left });
    sound.pop();
    this.invDirty = true;
    this.screen.render();
  }

  // An eye of ender goes into an empty End portal frame, or is thrown to find a stronghold.
  useEye(hit) {
    if (this.useCooldown > 0) return;
    if (hit && hit.id === BLOCK.END_PORTAL_FRAME) {
      this.applyBlock(hit.x, hit.y, hit.z, BLOCK.END_PORTAL_FRAME + 1);
      this.send({ t: 'use', x: hit.x, y: hit.y, z: hit.z, item: ITEM.EYE_OF_ENDER });
      sound.place(BLOCK.STONE);
    } else if (hit && hit.id === BLOCK.END_PORTAL_FRAME + 1) {
      return; // already has one
    } else if (this.dim === 'overworld' && this.world.strongholds().length) {
      this.send({ t: 'eye' });
    } else {
      return; // eyes only show the way in the Overworld
    }
    if (this.mode === 'survival') { takeOne(this.inv, this.selected); this.invDirty = true; }
    this.swing = 1;
    this.useCooldown = 0.5;
  }

  // Hoes till soil, bone meal grows crops. Returns true if the item was used.
  useOnBlock(hit, held) {
    const tool = toolOf(held.id);
    const above = this.world.getBlock(hit.x, hit.y + 1, hit.z);
    let id = null;
    if (tool?.kind === 'hoe' && (hit.id === BLOCK.GRASS || hit.id === BLOCK.DIRT) && hit.normal[1] >= 0 && above === BLOCK.AIR) {
      id = BLOCK.FARMLAND;
      this.useTool(1);
      sound.place(BLOCK.DIRT);
    } else if (held.id === ITEM.FLINT_AND_STEEL && hit.id !== BLOCK.TNT) {
      // the host checks for an obsidian frame around the block in front of the clicked face
      if (this.world.getBlock(hit.x + hit.normal[0], hit.y + hit.normal[1], hit.z + hit.normal[2]) !== BLOCK.AIR) return false;
      this.useTool(1);
      sound.ignite();
      this.send({ t: 'use', x: hit.x, y: hit.y, z: hit.z, item: held.id, face: hit.normal });
      this.swing = 1;
      this.useCooldown = 0.25;
      return true;
    } else if (held.id === ITEM.BONE_MEAL && BLOCKS[hit.id].crop && BLOCKS[hit.id].crop.stage < BLOCKS[hit.id].crop.max) {
      if (this.mode === 'survival') { takeOne(this.inv, this.selected); this.invDirty = true; }
      sound.place(BLOCK.TALL_GRASS);
    } else {
      return false;
    }
    if (id !== null) this.applyBlock(hit.x, hit.y, hit.z, id);
    this.send({ t: 'use', x: hit.x, y: hit.y, z: hit.z, item: held.id });
    this.swing = 1;
    this.useCooldown = 0.25;
    return true;
  }

  // Doors take two blocks and face away from the player.
  placeDoor(hit) {
    const replace = BLOCKS[hit.id].replaceable;
    const x = replace ? hit.x : hit.x + hit.normal[0];
    const y = replace ? hit.y : hit.y + hit.normal[1];
    const z = replace ? hit.z : hit.z + hit.normal[2];
    if (y < 1 || y + 1 >= HEIGHT) return;
    if (!BLOCKS[this.world.getBlock(x, y, z)].replaceable || !BLOCKS[this.world.getBlock(x, y + 1, z)].replaceable) return;
    if (!BLOCKS[this.world.getBlock(x, y - 1, z)].solid) return;
    if (boxOverlapsBlock(this.player, x, y, z) || boxOverlapsBlock(this.player, x, y + 1, z)) return;
    const facing = facingFromYaw(this.player.yaw);
    for (const [yy, id] of [[y, BLOCK.OAK_DOOR + facing], [y + 1, BLOCK.OAK_DOOR + 8 + facing]]) {
      this.send({ t: 'set', x, y: yy, z, id });
      this.applyBlock(x, yy, z, id);
    }
    sound.place(BLOCK.PLANKS);
    this.swing = 1;
    this.useCooldown = 0.25;
    if (this.mode === 'survival') { takeOne(this.inv, this.selected); this.invDirty = true; }
  }

  placeBlock(hit, held, placeId = held.id) {
    let id = placeId;
    // a slab on top of the same slab makes a full block
    if (BLOCKS[id].shape === 'slab' && hit.id === id && hit.normal[1] === 1) {
      this.send({ t: 'set', x: hit.x, y: hit.y, z: hit.z, id: BLOCKS[id].full });
      this.applyBlock(hit.x, hit.y, hit.z, BLOCKS[id].full);
      this.afterPlace(id);
      return;
    }
    if (BLOCKS[id].shape === 'stairs') id += facingFromYaw(this.player.yaw);
    if (BLOCKS[id].redstone === 'repeater') id += facingFromYaw(this.player.yaw);
    if (BLOCKS[id].redstone === 'piston') {
      // pistons face the player, up or down when placed from above or below
      const pitch = this.player.pitch;
      id = id - BLOCKS[id].facing6 + (pitch < -0.8 ? 4 : pitch > 0.8 ? 5 : (facingFromYaw(this.player.yaw) + 2) % 4);
    }
    if (BLOCKS[id].attach !== undefined) {
      // torches, levers and buttons: on the floor, or on the side of a block (not below one)
      if (hit.normal[1] < 0 || !canHoldAttached(hit.id)) return;
      const f = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]].findIndex(([nx, , nz]) => nx === hit.normal[0] && nz === hit.normal[2] && hit.normal[1] === 0);
      id = id - BLOCKS[id].attach + (hit.normal[1] > 0 ? 0 : f + 1);
    }
    if (BLOCKS[id].shape === 'ladder') {
      // ladders go on the side of a full block, facing away from it
      const f = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]].findIndex(([nx, , nz]) => nx === hit.normal[0] && nz === hit.normal[2] && hit.normal[1] === 0);
      if (f < 0 || BLOCKS[hit.id].render !== 'cube' || !BLOCKS[hit.id].solid) return;
      id += f;
    }
    const replace = BLOCKS[hit.id].replaceable && hit.id !== id;
    const x = replace ? hit.x : hit.x + hit.normal[0];
    const y = replace ? hit.y : hit.y + hit.normal[1];
    const z = replace ? hit.z : hit.z + hit.normal[2];
    if (y < 1 || y >= HEIGHT) return;
    const current = this.world.getBlock(x, y, z);
    if (!BLOCKS[current].replaceable || current === id) return;
    if (BLOCKS[id].solid && boxOverlapsBlock(this.player, x, y, z)) return;
    if (!isSupported(id, this.world.getBlock(x, y - 1, z))) return;
    if (isRail(id)) {
      // rails join up with the rails around them (the host does the same, and turns the neighbours)
      const info = railInfo(id);
      id = railId({ powered: info.powered, on: false, shape: computeShape((a, b, c) => this.world.getBlock(a, b, c), x, y, z, info.powered, this.player.yaw) });
    }
    for (const v of this.entities.entities.values()) {
      if (v.mob && BLOCKS[id].solid) {
        const p = v.group.position;
        if (Math.abs(p.x - (x + 0.5)) < 0.9 && Math.abs(p.z - (z + 0.5)) < 0.9 && p.y < y + 1 && p.y + 1.8 > y) return;
      }
    }
    this.send({ t: 'set', x, y, z, id });
    this.applyBlock(x, y, z, id);
    this.afterPlace(id);
  }

  afterPlace(id) {
    sound.place(id);
    this.swing = 1;
    this.useCooldown = 0.25;
    if (this.mode === 'survival') {
      if (this.fromOffhand) { if (--this.offhand.count <= 0) this.offhand = null; }
      else takeOne(this.inv, this.selected);
      this.invDirty = true;
    }
  }

  // ---------- riding ----------
  // While riding, the keys steer the vehicle (a horse needs to be tame and saddled, a pig needs
  // a carrot on a stick) and you sit on it; Shift gets off.
  rideStep(dt) {
    const p = this.player, v = this.ride, k = this.keys;
    if (k.ShiftLeft || k.ShiftRight) return this.unmount(true);
    let forward = (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), strafe = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0);
    if (v.kind === 'horse' && !(v.tamed && v.saddled)) forward = strafe = 0;
    if (v.kind === 'pig') { forward = this.held()?.id === ITEM.CARROT_ON_A_STICK ? 1 : 0; strafe = 0; }
    stepVehicle(this.world, v, { forward, strafe, jump: !!k.Space, lookYaw: p.yaw }, dt);
    p.x = v.x; p.y = v.y + v.seat; p.z = v.z;
    p.vx = p.vy = p.vz = 0;
    p.onGround = true;
    p.fallStart = null;
    p.sprinting = p.sneaking = false;
    p.height = HEIGHT_STAND;
    if (v.y < -40) this.unmount(true);
  }

  unmount(tell) {
    const v = this.ride;
    if (!v) return;
    this.ride = null;
    if (tell) this.send({ t: 'dismount' });
    // step off to the side, wherever there's room
    const p = this.player;
    for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2], [0, 0]]) {
      for (const dy of [0, 1, v.seat + 0.9]) {
        const spot = { ...p, x: v.x + dx, y: v.y + dy, z: v.z + dz, height: HEIGHT_STAND };
        if (!collides(this.world, spot)) { p.x = spot.x; p.y = spot.y; p.z = spot.z; p.vx = p.vy = p.vz = 0; return; }
      }
    }
  }

  // Whether rain is falling on the player (not snow, not in a desert, nothing overhead).
  inRain() {
    if (this.dim !== 'overworld' || this.weather === 'clear') return false;
    const x = Math.floor(this.player.x), z = Math.floor(this.player.z);
    const biome = this.world.biomeAt(x, z);
    if (biome === BIOME.DESERT || biome === BIOME.SAVANNA || FROZEN.has(biome)) return false;
    return this.world.topBlockY(x, z) < this.player.y + 1.6;
  }

  // Which hand holds a shield that right click would raise: 'main', 'off' or null.
  shieldHand() {
    const held = this.held();
    if (held?.id === ITEM.SHIELD) return 'main';
    if (this.offhand?.id !== ITEM.SHIELD) return null;
    // the main hand goes first when it has a use of its own
    if (held && (isBlockId(held.id) || ITEMS[held.id]?.food || ITEMS[held.id]?.drink || ITEMS[held.id]?.plants ||
      [ITEM.BOW, ITEM.FISHING_ROD, ITEM.POTION, ITEM.SPLASH_POTION, ITEM.EXPERIENCE_BOTTLE, ITEM.EGG, ITEM.ENDER_PEARL, ITEM.EYE_OF_ENDER,
        ITEM.BUCKET, ITEM.WATER_BUCKET, ITEM.LAVA_BUCKET, ITEM.MILK_BUCKET, ITEM.FLINT_AND_STEEL, ITEM.GLASS_BOTTLE].includes(held.id))) return null;
    return 'off';
  }

  // The pictures compasses and clocks show (0-15): the compass points at the world spawn, the
  // clock shows the time of day; both spin wildly in the Nether and the End.
  dialFrames() {
    if (this.dim !== 'overworld') { const f = Math.floor(performance.now() / 70) % 16; return [f, (f * 7) % 16]; }
    const p = this.player, [sx, , sz] = this.spawn || [0, 0, 0];
    const dx = sx - p.x, dz = sz - p.z;
    const ahead = -Math.sin(p.yaw) * dx - Math.cos(p.yaw) * dz, right = Math.cos(p.yaw) * dx - Math.sin(p.yaw) * dz;
    const compass = (Math.round((Math.atan2(right, ahead) / (Math.PI * 2)) * 16) + 16) % 16;
    const clock = (Math.round((((this.time || 0) - 6000) / 24000) * 16) % 16 + 16) % 16;
    return [compass, clock];
  }

  // Empty bucket scoops up water; a water bucket pours it out.
  useBucket(held) {
    const survival = this.mode === 'survival';
    if (held.id === ITEM.BUCKET) {
      // only a source block (water or lava) can be scooped up
      const hit = this.raycast(REACH, true);
      if (!hit || !isSource(hit.id)) return;
      const full = hit.id === BLOCK.LAVA ? ITEM.LAVA_BUCKET : ITEM.WATER_BUCKET;
      this.send({ t: 'bucket', x: hit.x, y: hit.y, z: hit.z, fill: true });
      this.applyBlock(hit.x, hit.y, hit.z, BLOCK.AIR);
      if (survival) {
        if (held.count > 1) { held.count--; const left = addItem(this.inv, full, 1); if (left) this.dropStack({ id: full, count: 1 }); }
        else this.inv[this.selected] = { id: full, count: 1 };
      }
    } else {
      const lava = held.id === ITEM.LAVA_BUCKET;
      const hit = this.raycast();
      if (!hit) return;
      const replace = BLOCKS[hit.id].replaceable && !isSource(hit.id);
      const x = replace ? hit.x : hit.x + hit.normal[0];
      const y = replace ? hit.y : hit.y + hit.normal[1];
      const z = replace ? hit.z : hit.z + hit.normal[2];
      const current = this.world.getBlock(x, y, z);
      if (!BLOCKS[current].replaceable || isSource(current) || y < 1) return;
      if (survival) this.inv[this.selected] = { id: ITEM.BUCKET, count: 1 };
      if (this.dim === 'nether' && !lava) {
        // water boils away in the Nether, like Minecraft
        sound.hiss();
        this.particles.breakBlock(x, y, z, BLOCK.SNOW, 1); // a puff of steam
        this.swing = 1;
        this.useCooldown = 0.3;
        this.invDirty = true;
        return;
      }
      this.send({ t: 'bucket', x, y, z, fill: false, lava });
      if (!(fluidOf(current) && fluidOf(current) !== (lava ? 'lava' : 'water'))) this.applyBlock(x, y, z, lava ? BLOCK.LAVA : BLOCK.WATER);
    }
    sound.splash();
    this.swing = 1;
    this.useCooldown = 0.3;
    this.invDirty = true;
  }

  // ---------- beds ----------
  startSleeping(at) {
    const p = this.player;
    p.sleeping = true;
    p.x = at[0] + 0.5; p.y = at[1] + 9 / 16; p.z = at[2] + 0.5;
    p.vx = p.vy = p.vz = 0;
    $('sleep').classList.remove('hidden');
    document.exitPointerLock();
  }

  stopSleeping(tellHost = false) {
    if (!this.player.sleeping) return;
    this.player.sleeping = false;
    $('sleep').classList.add('hidden');
    if (tellHost) this.send({ t: 'wake' });
    this.unstick();
    this.lock();
    // waking up at morning isn't a click, so the browser may refuse to grab the mouse:
    // show the menu as a "click to play" screen (it hides itself once the mouse is captured)
    if (!this.locked()) this.showPause(true);
  }

  pickBlock() {
    const hit = this.raycast();
    if (!hit) return;
    const id = blockItem(hit.id);
    if (!id) return;
    const found = this.inv.slice(0, HOTBAR_SIZE).findIndex((s) => s && s.id === id);
    if (found >= 0) { this.selected = found; return; }
    if (this.mode === 'creative' && (CREATIVE_BLOCKS.includes(id) || ITEMS[id])) {
      const empty = this.inv.slice(0, HOTBAR_SIZE).findIndex((s) => !s);
      if (empty >= 0) this.selected = empty;
      this.inv[this.selected] = makeStack(id, 64);
      this.invDirty = true;
    }
  }

  // ---------- armor ----------
  armorChanged() {
    let points = 0;
    for (const s of this.armor) points += armorOf(s?.id)?.defense ?? 0;
    this.stats.armorPoints = points;
    this.invDirty = true;
    const ids = this.armor.map((s) => s?.id ?? 0);
    if (JSON.stringify(ids) !== JSON.stringify(this.sentArmor)) {
      this.sentArmor = ids;
      if (this.playing) this.send({ t: 'equip', armor: ids });
      this.entities.setSelfArmor(ids);
    }
  }

  // Minecraft's armor formula; each worn piece wears down a little.
  armorReduce(amount) {
    let defense = 0, toughness = 0;
    for (const s of this.armor) {
      const a = armorOf(s?.id);
      if (a) { defense += a.defense; toughness += a.toughness; }
    }
    if (defense === 0) return amount;
    const reduced = amount * (1 - Math.min(20, Math.max(defense / 5, defense - amount / (2 + toughness / 4))) / 25);
    const wear = Math.max(1, Math.floor(amount / 4));
    this.armor.forEach((s, i) => {
      if (!s || !wears(s, Math.random, true)) return;
      s.dur -= wear;
      if (s.dur <= 0) { this.armor[i] = null; sound.broke(BLOCK.GLASS); }
    });
    this.armorChanged();
    return reduced;
  }

  // Minecraft's bow: full power after a second of drawing.
  shootBow(seconds) {
    const power = Math.min(1, (seconds * seconds + 2 * seconds) / 3);
    if (power < 0.1) return;
    const p = this.player;
    this.send({ t: 'shoot', power, yaw: p.yaw, pitch: p.pitch, ench: this.held()?.ench });
    sound.bow();
    if (this.mode === 'survival') {
      const i = this.inv.findIndex((st) => st && st.id === ITEM.ARROW);
      if (i >= 0 && !enchLevel(this.held(), 'infinity')) takeOne(this.inv, i); // Infinity: arrows aren't used up
      this.useTool(1);
    }
  }

  // Right-clicking with armor in hand puts it on (swapping with what you wear).
  equipHeld(held) {
    const a = armorOf(held.id);
    const old = this.armor[a.slot];
    this.armor[a.slot] = held;
    this.inv[this.selected] = old;
    this.armorChanged();
    sound.place(BLOCK.WOOL);
  }

  // ---------- experience ----------
  // Mending: experience repairs held and worn items that have it first (2 durability per point).
  // Returns what's left for the experience bar.
  mend(amount) {
    const items = [this.held(), ...this.armor].filter((s) => s && s.dur !== undefined && enchLevel(s, 'mending'));
    for (const s of items) {
      const max = maxDurability(s.id);
      while (amount > 0 && s.dur < max) { s.dur = Math.min(max, s.dur + 2); amount--; }
    }
    if (items.length) this.invDirty = true;
    return amount;
  }

  // Spends experience levels (enchanting, anvils), keeping the progress into the level.
  spendLevels(n) {
    const s = this.stats;
    const { level, progress } = levelInfo(s.xpTotal);
    const to = Math.max(0, level - n);
    let total = 0;
    for (let l = 0; l < to; l++) total += pointsForLevel(l);
    s.xpTotal = total + Math.floor(progress * pointsForLevel(to));
    this.addXP(0);
    this.invDirty = true;
  }

  addXP(amount) {
    const s = this.stats;
    const before = s.xpLevel;
    s.xpTotal = Math.max(0, s.xpTotal + amount);
    const { level, progress } = levelInfo(s.xpTotal);
    s.xpLevel = level;
    s.xpProgress = progress;
    if (amount > 0) {
      sound.xp();
      if (level > before && level % 5 === 0) sound.levelUp();
      this.invDirty = true;
    }
  }

  // ---------- survival ----------
  damage(amount, cause = 'died', from = null, armored = false, by = null) {
    if (this.mode !== 'survival' || this.dead || this.stats.invuln > 0) return;
    if (this.effects.fire_resistance && /lava|fire|flames|burn|floor was lava/.test(cause)) return;
    if (this.blocking && from && /slain|shot|blown up|fireball|Fireball/.test(cause)) {
      // a raised shield stops attacks from in front (within 90 degrees of where you're looking)
      const p = this.player, dx = from[0] - p.x, dz = from[1] - p.z;
      if (-Math.sin(p.yaw) * dx - Math.cos(p.yaw) * dz > 0) {
        const hand = this.shieldHand();
        const shield = hand === 'main' ? this.held() : this.offhand;
        if (amount >= 3 && shield && wears(shield)) {
          shield.dur -= 1 + Math.floor(amount);
          if (shield.dur <= 0) { if (hand === 'main') this.inv[this.selected] = null; else this.offhand = null; sound.broke(BLOCK.GLASS); }
        }
        sound.shieldBlock();
        const len = Math.hypot(dx, dz) || 1;
        p.vx -= (dx / len) * 2; p.vz -= (dz / len) * 2; // a little push back
        this.invDirty = true;
        return;
      }
    }
    if (this.effects.resistance && !/out of the world/.test(cause)) amount *= Math.max(0, 1 - 0.2 * this.effectLevel('resistance'));
    if (this.absorb > 0) {
      // absorption hearts go first
      const soak = Math.min(this.absorb, amount);
      this.absorb -= soak;
      amount -= soak;
      if (amount <= 0) { this.stats.invuln = 0.5; this.invDirty = true; return; }
    }
    if (armored) amount = this.armorReduce(amount);
    // protection enchantments (4% per point, up to 80%); not against falling out of the world or starving
    const kind = /lava|fire|flames|burn/.test(cause) ? 'fire' : /blown up|Intentional/.test(cause) ? 'blast'
      : /shot|fireball/.test(cause) ? 'projectile' : /fell from/.test(cause) ? 'fall' : /out of the world|starved/.test(cause) ? null : 'other';
    if (kind) amount *= 1 - protectionPoints(this.armor, kind) / 25;
    // thorns hurt whoever hit you
    if (by) {
      const thorns = Math.max(0, ...this.armor.map((a) => enchLevel(a, 'thorns')));
      if (thorns && Math.random() < 0.15 * thorns) this.send({ t: 'thorns', e: by, amount: 1 + Math.floor(Math.random() * 4) });
    }
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
    this.ride = null;
    this.effects = {};
    this.absorb = 0;
    const items = this.inv.concat(this.armor, [this.offhand]).filter(Boolean);
    this.offhand = null;
    this.inv = new Array(INVENTORY_SIZE).fill(null);
    this.armor = [null, null, null, null];
    this.armorChanged();
    this.send({ t: 'died', items, cause, xp: this.stats.xpTotal });
    $('death-score').textContent = this.stats.xpTotal;
    this.stats.xpTotal = 0;
    this.addXP(0);
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

  // Flames at the bottom of the screen while you're on fire, like Minecraft.
  updateFireOverlay() {
    $('fire-overlay').classList.toggle('hidden', !(this.onFire > 0) || this.mode !== 'survival' || this.dead);
  }

  // Purple swirl while standing in a Nether portal, like Minecraft's nausea-free portal overlay.
  updatePortalOverlay(dt) {
    const p = this.player;
    const at = (dy) => BLOCKS[this.world.getBlock(Math.floor(p.x), Math.floor(p.y + dy), Math.floor(p.z))].shape === 'portal';
    const inside = at(0.1) || at(1.2);
    const rate = this.mode === 'creative' ? 4 : 0.25; // full after 4 seconds, like the trip
    this.portalGlow = Math.max(0, Math.min(1, (this.portalGlow || 0) + (inside ? dt * rate : -dt * 2)));
    if (inside && !this.inPortal) sound.portal(false);
    this.inPortal = inside;
    const el = $('portal-overlay');
    if (!el.style.backgroundImage) el.style.backgroundImage = `url(${this.textures.tileURL('nether_portal')})`;
    el.classList.toggle('hidden', this.portalGlow <= 0);
    el.style.opacity = (this.portalGlow * 0.8).toFixed(3);
    if (this.loadingTerrain) {
      const key = chunkKey(Math.floor(p.x / CHUNK), Math.floor(p.z / CHUNK));
      if (this.r.meshes.has(key) || performance.now() - this.loadingTerrain > 8000) {
        this.loadingTerrain = 0;
        $('loading').classList.add('hidden');
      }
    }
  }

  unstick() {
    const p = this.player;
    let guard = 0;
    while (collides(this.world, p) && p.y < HEIGHT + 2 && guard++ < 200) p.y = Math.floor(p.y) + 1.0001;
  }

  survivalTick(dt) {
    const s = this.stats;
    s.invuln = Math.max(0, s.invuln - dt);
    if (this.mode !== 'survival' || this.dead) { s.air = MAX_AIR; this.onFire = 0; this.updateFireOverlay(); return; }
    this.updateFireOverlay();
    if (this.player.onHot && !this.player.sneaking) {
      this.hotTimer = (this.hotTimer || 0) + dt;
      if (this.hotTimer >= 0.5) { this.hotTimer = 0; this.damage(1, 'discovered the floor was lava'); }
    } else this.hotTimer = 0;

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

    // lava burns, and sets you on fire for 15 seconds; fire for 8; water puts it out
    const pl = this.player;
    if (pl.inLava) {
      s.lavaTimer = (s.lavaTimer || 0) + dt;
      if (s.lavaTimer >= 0.5) { s.lavaTimer = 0; this.damage(4, 'tried to swim in lava', null, true); }
      this.onFire = 15;
    } else s.lavaTimer = 0.5; // the first touch hurts straight away
    if (pl.inFire) {
      s.fireTimer = (s.fireTimer || 0) + dt;
      if (s.fireTimer >= 0.5) { s.fireTimer = 0; this.damage(1, 'went up in flames', null, true); }
      this.onFire = Math.max(this.onFire || 0, 8);
    } else s.fireTimer = 0.5;
    if (pl.inWater && !pl.inLava) this.onFire = 0;
    if (this.onFire > 0 && this.inRain()) this.onFire = 0; // the rain puts you out
    if (this.onFire > 0) {
      this.onFire -= dt;
      s.burnTimer = (s.burnTimer || 0) + dt;
      if (s.burnTimer >= 1) { s.burnTimer = 0; if (!pl.inLava && !pl.inFire) this.damage(1, 'burned to death', null, true); }
    }

    // drowning
    if (this.player.headInWater && !this.effects.water_breathing) {
      s.air -= dt * 20;
      if (s.air <= -20) { s.air = 0; this.damage(2, 'drowned'); }
      const resp = enchLevel(this.armor[0], 'respiration');
      if (resp && Math.random() < resp / (resp + 1)) s.air += dt * 20; // respiration: breath lasts longer
    } else {
      s.air = Math.min(MAX_AIR, s.air + dt * 60);
    }

  }

  // Eating and drinking: hold right click for 1.6 seconds. Potions and milk work in creative too.
  tickEating(dt) {
    if (this.eating <= 0) return;
    const s = this.stats;
    const held = this.held();
    const drink = held && (held.id === ITEM.POTION || held.id === ITEM.MILK_BUCKET);
    const food = held && ITEMS[held.id]?.food && this.mode === 'survival' && (s.food < 20 || ITEMS[held.id].alwaysEat);
    if (!this.mouse.right || (!drink && !food) || this.dead) { this.eating = 0; return; }
    this.eating += dt;
    if (Math.floor(this.eating * 5) !== Math.floor((this.eating - dt) * 5)) drink ? sound.drink() : sound.eat();
    if (this.eating < 1.6) return;
    this.eating = 0;
    this.invDirty = true;
    if (held.id === ITEM.MILK_BUCKET) {
      // milk clears every effect
      this.effects = {};
      if (this.mode === 'survival') this.inv[this.selected] = { id: ITEM.BUCKET, count: 1 };
      return;
    }
    if (held.id === ITEM.POTION) {
      this.applyPotion(held.potion);
      if (this.mode === 'survival') this.inv[this.selected] = { id: ITEM.GLASS_BOTTLE, count: 1 };
      return;
    }
    s.food = Math.min(20, s.food + foodValue(held.id));
    for (const [name, amp, seconds, chance = 1] of FOOD_EFFECTS[held.id] || []) if (Math.random() < chance) this.addEffect(name, amp, seconds);
    takeOne(this.inv, this.selected);
  }

  // ---------- status effects ----------
  addEffect(name, amp, seconds) {
    if (name === 'instant_health') { this.stats.health = Math.min(20, this.stats.health + 4 * 2 ** amp); this.invDirty = true; return; }
    if (name === 'instant_damage') { this.damage(6 * 2 ** amp, 'was killed by magic'); return; }
    if (name === 'saturation') { this.stats.food = Math.min(20, this.stats.food + amp + 1); return; }
    const cur = this.effects[name];
    if (cur && (cur.amp > amp || (cur.amp === amp && cur.time > seconds))) return;
    this.effects[name] = { amp, time: seconds };
    if (name === 'absorption') this.absorb = 4 * (amp + 1);
  }

  applyPotion(potion, scale = 1) {
    for (const [name, amp, seconds] of POTIONS[potion]?.effects || []) {
      if (name.startsWith('instant')) {
        if (name === 'instant_health') { this.stats.health = Math.min(20, this.stats.health + 4 * 2 ** amp * scale); this.invDirty = true; }
        else this.damage(6 * 2 ** amp * scale, 'was killed by magic');
      } else if (seconds * scale >= 1) this.addEffect(name, amp, Math.round(seconds * scale));
    }
  }

  effectLevel(name) {
    const e = this.effects[name];
    return e ? e.amp + 1 : 0;
  }

  tickEffects(dt) {
    for (const [name, e] of Object.entries(this.effects)) {
      e.time -= dt;
      e.acc = (e.acc || 0) + dt;
      const survival = this.mode === 'survival' && !this.dead;
      if (name === 'regeneration' && e.acc >= 2.5 / 2 ** e.amp) { e.acc = 0; if (survival && this.stats.health < 20) { this.stats.health = Math.min(20, this.stats.health + 1); this.invDirty = true; } }
      if (name === 'poison' && e.acc >= 1.25 / 2 ** e.amp) { e.acc = 0; if (survival && this.stats.health > 1) this.damage(1, 'was poisoned', null, false, null, true); }
      if (name === 'wither' && e.acc >= 2 / 2 ** e.amp) { e.acc = 0; if (survival) this.damage(1, 'withered away', null, false, null, true); }
      if (name === 'hunger' && survival) this.stats.exhaustion += 0.1 * (e.amp + 1) * dt;
      if (e.time <= 0) { delete this.effects[name]; if (name === 'absorption') this.absorb = 0; }
    }
    this.renderEffects();
  }

  // Effect icons in the top right corner, with the time left.
  renderEffects() {
    const key = Object.entries(this.effects).map(([n, e]) => `${n}${e.amp}${Math.ceil(e.time)}`).join();
    if (key === this.lastEffectsKey) return;
    this.lastEffectsKey = key;
    const box = $('effects');
    box.innerHTML = '';
    for (const [name, e] of Object.entries(this.effects)) {
      const d = document.createElement('div');
      d.className = 'effect' + (EFFECTS[name][2] ? '' : ' bad');
      const t = Math.ceil(e.time);
      d.innerHTML = `<i style="background:${EFFECTS[name][1]}"></i><span>${EFFECTS[name][0]}${e.amp ? ' ' + ['', 'II', 'III', 'IV'][e.amp] : ''}<br>${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</span>`;
      box.appendChild(d);
    }
  }

  // ---------- physics ----------
  physics(dt) {
    const p = this.player;
    if (p.sleeping) return;
    if (this.ride) { this.rideStep(dt); return; }
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
    if (this.blocking && !p.flying) { speed = Math.min(speed, SNEAK); p.sprinting = false; } // slowed while blocking
    if (p.inWater && !p.flying) speed *= p.inLava ? 0.3 : 0.5 + 0.5 * Math.min(3, enchLevel(this.armor[3], 'depth_strider')) / 3;
    const under = BLOCKS[this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.05), Math.floor(p.z))];
    if (p.onGround && under.slow) speed *= under.slow; // soul sand
    speed *= Math.max(0, 1 + 0.2 * this.effectLevel('speed') - 0.15 * this.effectLevel('slowness'));
    p.onHot = p.onGround && !!under.hot;                 // magma blocks burn unless you sneak
    const control = p.onGround || p.flying ? 20 : p.inWater ? 6 : 5;
    const a = Math.min(1, dt * control);
    p.vx += (wx * speed - p.vx) * a;
    p.vz += (wz * speed - p.vz) * a;

    // ladders: climb by walking into them or jumping, hold sneak to stay put
    p.onLadder = !p.flying && this.touching((id) => BLOCKS[id].climbable);
    if (p.onLadder) {
      p.fallStart = null;
      if (forward || strafe || k.Space) p.vy = 2.35;
      else if (p.sneaking) p.vy = 0;
      else p.vy = Math.max(p.vy - GRAVITY * dt, -3);
    } else if (p.flying) {
      const up = (k.Space ? 1 : 0) - (k.ShiftLeft || k.ShiftRight ? 1 : 0);
      p.vy += (up * FLY * 0.75 - p.vy) * Math.min(1, dt * 12);
    } else if (p.inWater) {
      p.vy = Math.max(-3, p.vy - GRAVITY * 0.25 * dt);
      if (k.Space) p.vy = Math.min(p.vy + 30 * dt, 3.5);
    } else {
      // slow falling: drift down gently, and no fall damage
      p.vy = Math.max(this.effects.slow_falling ? -2.4 : -60, p.vy - GRAVITY * (this.effects.slow_falling && p.vy < 0 ? 0.15 : 1) * dt);
      if (this.effects.slow_falling) p.fallStart = null;
      if ((k.Space || this.jumpQueued) && p.onGround) {
        p.vy = JUMP_SPEED + 2 * this.effectLevel('jump_boost');
        this.stats.exhaustion += p.sprinting ? 0.2 : 0.05;
        if (p.sprinting) { p.vx += wx * 2; p.vz += wz * 2; }
      }
    }

    if (collides(this.world, p)) { p.y = Math.floor(p.y) + 1.0001; p.vy = 0; }

    const before = { x: p.x, z: p.z };
    const wasOnGround = p.onGround;
    const vyBefore = p.vy;
    const res = moveBody(this.world, p, dt, p.flying ? 0 : 0.6);

    // Swimming into a wall pushes you up, so you can climb out onto a bank (like Minecraft).
    // Checked against any part of the body touching water, not just the feet, because at the
    // surface your feet bob in and out of the water.
    if (res.hitWall && !p.flying && (forward || strafe || k.Space)) {
      const touchingWater = [0.1, 0.5, 1.0].some((dy) => BLOCKS[this.world.getBlock(Math.floor(p.x), Math.floor(p.y + dy), Math.floor(p.z))].liquid);
      if (touchingWater) p.vy = Math.max(p.vy, JUMP_SPEED);
    }

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

    // slime blocks: bounce back up (unless sneaking), and never hurt
    if (res.onGround && !p.flying && BLOCKS[this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.05), Math.floor(p.z))].bouncy) {
      if (!p.sneaking && vyBefore < -3) { p.vy = -vyBefore * 0.85; res.onGround = false; sound.slime(); }
      p.fallStart = null;
    }
    // fall damage
    if (!res.onGround && !p.inWater && !p.flying) {
      if (p.fallStart === null || p.y > p.fallStart) p.fallStart = p.y;
    }
    if (res.onGround || p.inWater || p.flying) {
      if (p.fallStart !== null && res.onGround && !p.inWater && !p.flying) {
        const dist = p.fallStart - p.y;
        const fall = Math.floor(dist - 3) - this.effectLevel('jump_boost');
        if (dist > 3.5 && fall > 0) this.damage(fall, 'fell from a high place');
      }
      p.fallStart = null;
    }
    if (res.onGround && p.flying) p.flying = false;
    p.onGround = res.onGround;

    const feet = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.4), Math.floor(p.z));
    const wasInWater = p.inWater;
    p.inWater = !!BLOCKS[feet].liquid; // swimming works in water and lava
    p.inLava = [0.1, 1.0].some((dy) => fluidOf(this.world.getBlock(Math.floor(p.x), Math.floor(p.y + dy), Math.floor(p.z))) === 'lava');
    p.inFire = this.touching((id) => id === BLOCK.FIRE);
    if (p.inWater && !wasInWater && p.vy < -6 && fluidOf(feet) === 'water') sound.splash();
    const head = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + this.eyeHeight()), Math.floor(p.z));
    p.headInWater = fluidOf(head) === 'water';
    p.headInLava = fluidOf(head) === 'lava';
    // flowing water carries you along
    if (fluidOf(feet) === 'water' && !p.flying) {
      const [fx, fz] = flowAt(this.world, Math.floor(p.x), Math.floor(p.y + 0.4), Math.floor(p.z));
      p.vx += fx * 14 * dt; p.vz += fz * 14 * dt;
    }

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

  // Whether any block the player's body is in matches test(id).
  touching(test) {
    const p = this.player;
    for (let y = Math.floor(p.y); y <= Math.floor(p.y + p.height - 0.01); y++) {
      for (let z = Math.floor(p.z - p.halfW); z <= Math.floor(p.z + p.halfW); z++) {
        for (let x = Math.floor(p.x - p.halfW); x <= Math.floor(p.x + p.halfW); x++) {
          if (test(this.world.getBlock(x, y, z))) return true;
        }
      }
    }
    return false;
  }

  // ---------- held item ----------
  buildHand() {
    this.handScene = new THREE.Scene();
    this.handCamera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 10);
    this.handGroup = new THREE.Group();
    this.handScene.add(this.handGroup);
    this.offGroup = new THREE.Group(); // the offhand item, on the left
    this.handScene.add(this.offGroup);
    this.offKey = null;
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
      } else if (isBlockId(id) && hasBlockModel(id)) {
        mesh = new THREE.Mesh(blockGeometry(id, 0.28), new THREE.MeshBasicMaterial({ map: this.textures.atlasSRGB, alphaTest: 0.5 }));
        mesh.position.set(0.46, -0.4, -0.72);
        mesh.rotation.set(0.1, Math.PI / 4, 0);
      } else if (id === ITEM.SHIELD) {
        mesh = this.shieldMesh();
        mesh.position.set(0.45, -0.45, -0.7);
      } else {
        mesh = this.itemMesh(id);
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
    const blockWith = this.blocking ? this.shieldHand() : null;
    if (blockWith === 'main') { mesh.position.set(0.18, -0.28, -0.55); mesh.rotation.set(0, 0.15, 0); this.handGroup.rotation.x = 0; }
    else if (id === ITEM.SHIELD) mesh.rotation.set(0, -0.35, 0);
    this.updateOffhand(brightness, blockWith === 'off');
  }

  // The offhand item, mirrored on the left (a raised shield moves to the middle).
  updateOffhand(brightness, raised) {
    const id = this.offhand?.id ?? 0;
    if (id !== this.offKey) {
      this.offKey = id;
      for (const c of [...this.offGroup.children]) { this.offGroup.remove(c); c.geometry?.dispose(); c.material?.dispose(); }
      if (id) {
        let mesh;
        if (id === ITEM.SHIELD) { mesh = this.shieldMesh(); mesh.position.set(-0.45, -0.45, -0.7); mesh.rotation.set(0, 0.35, 0); }
        else if (isBlockId(id) && hasBlockModel(id)) {
          mesh = new THREE.Mesh(blockGeometry(id, 0.28), new THREE.MeshBasicMaterial({ map: this.textures.atlasSRGB, alphaTest: 0.5 }));
          mesh.position.set(-0.46, -0.4, -0.72); mesh.rotation.set(0.1, Math.PI / 4, 0);
        } else { mesh = this.itemMesh(id); mesh.position.set(-0.5, -0.35, -0.7); mesh.rotation.set(0, Math.PI / 2.6, -Math.PI / 16); }
        this.offBase = { p: mesh.position.clone(), r: mesh.rotation.clone(), color: mesh.material.color.clone() };
        this.offGroup.add(mesh);
      }
    }
    const mesh = this.offGroup.children[0];
    this.offGroup.visible = !this.dead && !!mesh;
    if (!mesh) return;
    mesh.material.color.copy(this.offBase.color).multiplyScalar(brightness);
    if (raised) { mesh.position.set(-0.18, -0.28, -0.55); mesh.rotation.set(0, -0.15, 0); }
    else { mesh.position.copy(this.offBase.p); mesh.rotation.copy(this.offBase.r); mesh.position.y += Math.abs(Math.cos(this.bob)) * 0.02; }
  }

  itemMesh(id) {
    const map = isBlockId(id) ? this.textures.tileTexture(BLOCKS[id].tex[0]) : this.textures.itemTexture(id);
    return new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide }));
  }

  shieldMesh() {
    return new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.05), new THREE.MeshBasicMaterial({ map: this.textures.itemTexture(ITEM.SHIELD), alphaTest: 0.5 }));
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
    this.tickEating(dt);
    this.tickEffects(dt);

    this.attackCooldown -= dt;
    this.useCooldown -= dt;

    const cam = this.r.camera;
    cam.position.set(p.x, p.y + (p.sleeping ? 0.3 : this.eyeHeight()), p.z);
    cam.rotation.set(p.pitch, p.yaw, 0);
    // view bobbing: the camera sways a little with each step, like Minecraft's
    const speed = Math.hypot(p.vx, p.vz);
    const bobTarget = this.settings.bobbing !== false && p.onGround && !p.flying && !p.inWater ? Math.min(1, speed / 4.3) : 0;
    this.bobAmount += (bobTarget - this.bobAmount) * Math.min(1, dt * 10);
    if (this.bobAmount > 0.001 && this.perspective === 0) {
      const phase = this.bob * 0.7;
      const a = this.bobAmount * 0.06;
      const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
      cam.position.addScaledVector(right, Math.sin(phase) * a);
      cam.position.y -= Math.abs(Math.cos(phase)) * a * 1.6 - a * 0.8;
      cam.rotation.z = Math.sin(phase) * this.bobAmount * 0.012;
      cam.rotation.x += Math.abs(Math.cos(phase - 0.2)) * this.bobAmount * 0.015;
    }
    // F5: third person, behind or in front of the player, pulled in so it never goes into walls
    if (this.perspective > 0) {
      const dir = new THREE.Vector3(0, 0, -1).applyEuler(cam.rotation);
      if (this.perspective === 1) dir.negate();
      let dist = 4;
      for (let t = 0.2; t <= 4; t += 0.1) {
        const q = cam.position.clone().addScaledVector(dir, t);
        if (BLOCKS[this.world.getBlock(Math.floor(q.x), Math.floor(q.y), Math.floor(q.z))].solid) { dist = Math.max(0, t - 0.3); break; }
      }
      cam.position.addScaledVector(dir, dist);
      if (this.perspective === 2) cam.rotation.set(-p.pitch, p.yaw + Math.PI, 0);
    }
    this.entities.setSelf(this.perspective > 0 && !this.dead, p, this.name, dt);
    if (this.shake > 0) { // explosion camera shake
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.4;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.4;
      this.shake = Math.max(0, this.shake - dt * 1.5);
    }
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
        const aqua = this.armor.some((a) => enchLevel(a, 'aqua_affinity'));
        const t = breakTime(hit.id, this.heldId(), enchLevel(this.held(), 'efficiency')) * (p.onGround || p.flying ? 1 : 5) * (p.headInWater && !aqua ? 5 : 1) /
          (1 + 0.2 * this.effectLevel('haste')) / (this.effects.mining_fatigue ? 0.3 ** this.effectLevel('mining_fatigue') : 1);
        this.breaking.progress += t === 0 ? 1 : dt / t;
        this.breaking.sound -= dt;
        if (this.breaking.sound <= 0) {
          sound.dig(hit.id);
          this.particles.hitBlock(hit, this.lightAt(hit.x + 0.5 + hit.normal[0], hit.y + 0.5 + hit.normal[1], hit.z + 0.5 + hit.normal[2]));
          this.breaking.sound = 0.25;
          this.swing = 1;
        }
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
    this.lastHit = hit;

    // bows: hold right click to draw, let go to shoot
    const heldNow = this.held();
    const hasArrows = this.mode === 'creative' || this.inv.some((st) => st && st.id === ITEM.ARROW);
    if (heldNow?.id === ITEM.BOW && this.mouse.right && hasArrows && this.locked() && !this.dead) {
      this.bowDraw = (this.bowDraw || 0) + dt;
    } else if (this.bowDraw > 0) {
      if (heldNow?.id === ITEM.BOW && !this.mouse.right) this.shootBow(this.bowDraw);
      this.bowDraw = 0;
    }
    this.r.zoom = 1 - 0.15 * Math.min(1, this.bowDraw || 0);

    // shields: hold right click to block (with a shield in either hand, when the main hand
    // has nothing better to do); it takes a quarter of a second to raise
    const wantBlock = this.mouse.right && !this.dead && this.locked() && this.eating === 0 && !(this.bowDraw > 0) && !!this.shieldHand();
    this.blockTime = wantBlock ? (this.blockTime || 0) + dt : 0;
    this.blocking = this.blockTime >= 0.25;

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
    const fogTint = this.dim === 'nether' ? NETHER_FOG[this.world.netherBiome(Math.floor(p.x), Math.floor(p.z))] : null;
    this.r.nightVision = !!this.effects.night_vision;
    this.r.blind = !!this.effects.blindness;
    // weather: the sky greys over as rain comes in, and clears slowly
    const raining = this.dim === 'overworld' && this.weather !== 'clear';
    this.r.rain = (this.r.rain ?? 0) + ((raining ? 1 : 0) - (this.r.rain ?? 0)) * Math.min(1, dt * 0.4);
    this.r.thunder = (this.r.thunder ?? 0) + ((raining && this.weather === 'thunder' ? 1 : 0) - (this.r.thunder ?? 0)) * Math.min(1, dt * 0.4);
    this.r.updateEnvironment(this.time, p.headInLava ? 'lava' : p.headInWater ? 'water' : null, p.sprinting && !p.sneaking, fogTint);
    const rainLight = Math.max(0.25, this.entities.lightAt(cam.position.x, cam.position.y, cam.position.z));
    setRain(this.precipitation.update(dt, cam.position, this.dim === 'overworld' ? this.world : null, raining ? 1 : 0, rainLight) * (p.headInWater ? 0.3 : 1));
    // nausea makes the view sway
    this.r.camera.rotation.z = this.effects.nausea ? Math.sin(performance.now() / 600) * 0.12 : 0;
    this.lightBudget = 1;
    this.time += dt * 20;
    this.entities.lightAt = (x, y, z) => this.lightAt(x, y, z);
    if (this.ride) {
      const view = this.entities.entities.get(this.ride.id);
      if (view) { view.target.set(this.ride.x, this.ride.y, this.ride.z); view.group.position.copy(view.target); view.tYaw = view.yaw = this.ride.yaw; this.ride.missing = 0; }
      else if ((this.ride.missing += dt) > 1.5) this.unmount(false); // it was broken
    }
    this.entities.selfSitting = !!this.ride;
    this.entities.update(dt);
    this.particles.update(dt, this.world, (x, y, z) => this.lightAt(x, y, z));
    this.particles.setViewportHeight(window.innerHeight / Math.tan(this.r.camera.fov * Math.PI / 360) / 2);
    // now and then, a distant rumble in dark caves
    this.caveTimer -= dt;
    if (this.caveTimer <= 0) {
      this.caveTimer = 60 + Math.random() * 120;
      const light = this.lightCache.get(chunkKey(Math.floor(p.x / CHUNK), Math.floor(p.z / CHUNK)));
      const by = Math.floor(p.y + 1);
      if (light && by > 0 && by < HEIGHT && p.y < this.world.seaLevel - 8) {
        const i = regionIndex(Math.floor(p.x) - Math.floor(p.x / CHUNK) * CHUNK, by, Math.floor(p.z) - Math.floor(p.z / CHUNK) * CHUNK);
        if (light.sky[i] === 0 && light.block[i] < 8) sound.cave();
      }
    }
    this.updateHand(dt, this.lightAt(p.x, p.y + this.eyeHeight(), p.z));
    $('water-overlay').classList.toggle('hidden', !p.headInWater);
    this.updatePortalOverlay(dt);

    // network
    if (now - this.lastSent > 100) {
      this.lastSent = now;
      const pos = [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)];
      const rot = [+p.yaw.toFixed(3), +p.pitch.toFixed(3)];
      const ride = this.ride ? [+this.ride.x.toFixed(2), +this.ride.y.toFixed(2), +this.ride.z.toFixed(2), +this.ride.yaw.toFixed(3)] : undefined;
      const state = JSON.stringify([pos, rot, this.heldId(), ride]);
      if (state !== this.lastSentState) {
        this.lastSentState = state;
        this.send({ t: 'pos', p: pos, r: rot, h: this.heldId(), inv: this.effects.invisibility ? 1 : 0, v: ride });
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
      this.send({ t: 'save', inv: this.inv, armor: this.armor, offhand: this.offhand, health: this.stats.health, food: this.stats.food, xp: this.stats.xpTotal, enchSeed: this.enchSeed });
    }

    // HUD
    this.stats.hurtFlash = (this.stats.hurtUntil || 0) > now;
    this.stats.absorb = this.absorb;
    setDials(...this.dialFrames());
    this.hud.render(this.inv, this.selected, this.stats, this.mode, this.offhand);
    const dbg = $('debug');
    dbg.classList.toggle('hidden', !this.showDebug);
    if (this.showDebug && now - (this.debugUpdated || 0) > 250) {
      this.debugUpdated = now;
      this.renderDebug();
    }
  }

  // The F3 screen, laid out like Minecraft's.
  renderDebug() {
    const p = this.player;
    const w = this.world;
    const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    const y0 = w.yOffset;
    const cx = Math.floor(bx / CHUNK), cz = Math.floor(bz / CHUNK);
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const facing = Math.abs(fz) >= Math.abs(fx)
      ? (fz < 0 ? 'north (Towards negative Z)' : 'south (Towards positive Z)')
      : (fx > 0 ? 'east (Towards positive X)' : 'west (Towards negative X)');
    const yawDeg = ((((180 - p.yaw * 180 / Math.PI) % 360) + 540) % 360) - 180; // Minecraft's yaw: 0 = south
    let light = '';
    const lc = this.lightCache.get(chunkKey(cx, cz));
    if (lc && by >= 0 && by < HEIGHT) {
      const i = regionIndex(bx - cx * CHUNK, by, bz - cz * CHUNK);
      light = `Client Light: ${Math.max(lc.sky[i], lc.block[i])} (${lc.sky[i]} sky, ${lc.block[i]} block)`;
    }
    const biome = this.dim === 'nether' ? ['nether_wastes', 'soul_sand_valley', 'basalt_deltas'][w.netherBiome(bx, bz)]
      : this.dim === 'end' ? (Math.hypot(bx, bz) < 900 ? 'the_end' : 'end_highlands') : BIOMES[w.biomeAt(bx, bz)]?.name || '?';
    const day = Math.floor(this.time / 24000);
    const left = [
      `${VERSION} (${w.gen >= 3 ? 'gen 3' : 'gen ' + w.gen})`,
      `${this.fps || 0} fps`,
      `C: ${this.r.meshes.size} (${this.r.pending.size} loading) D: ${this.r.renderDistance}`,
      `E: ${this.entities.entities.size}  P: ${this.entities.players.size + 1}`,
      '',
      `XYZ: ${p.x.toFixed(3)} / ${(p.y - y0).toFixed(5)} / ${p.z.toFixed(3)}`,
      `Block: ${bx} ${by - y0} ${bz}`,
      `Chunk: ${bx - cx * CHUNK} ${by & 15} ${bz - cz * CHUNK} in ${cx} ${Math.floor((by - y0) / 16)} ${cz}`,
      `Facing: ${facing} (${yawDeg.toFixed(1)} / ${(-p.pitch * 180 / Math.PI).toFixed(1)})`,
      light,
      `Biome: minecraft:${biome}`,
      `Dimension: minecraft:${{ overworld: 'overworld', nether: 'the_nether', end: 'the_end' }[this.dim] || 'overworld'}`,
      `Day ${day}, time ${Math.floor(this.time % 24000)}`,
    ].filter((line, i) => line !== '' || i === 4);
    const gl = this.r.renderer.getContext();
    if (this.gpuName === undefined) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      this.gpuName = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)).slice(0, 60) : 'WebGL';
    }
    const mem = performance.memory;
    const right = [
      `Browser: ${navigator.userAgent.match(/(Firefox|Edg|Chrome|Safari)\/[\d.]+/)?.[0] || 'unknown'}`,
      mem ? `Mem: ${Math.round(mem.usedJSHeapSize / mem.totalJSHeapSize * 100)}% ${Math.round(mem.usedJSHeapSize / 1048576)}/${Math.round(mem.totalJSHeapSize / 1048576)}MB` : '',
      '',
      `Display: ${window.innerWidth}x${window.innerHeight}`,
      this.gpuName,
    ];
    const hit = this.lastHit;
    if (hit) {
      right.push('', `Targeted Block: ${hit.x}, ${hit.y - y0}, ${hit.z}`, `craftkat:${BLOCKS[hit.id].name.toLowerCase().replace(/ /g, '_')}`);
    }
    const fill = (el, lines) => {
      el.textContent = '';
      for (const line of lines) {
        const span = document.createElement('span');
        if (!line) span.className = 'gap';
        span.textContent = line;
        el.appendChild(span);
      }
    };
    fill($('debug-left'), left);
    fill($('debug-right'), right.filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== '')));
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
      if (this.lightCache.size > 12) this.lightCache.clear();
      light = computeLight(gatherRegion(this.world, cx, cz), this.world.hasSky);
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
    // the held item is only drawn in first person
    if (this.perspective === 0) this.r.render(this.handScene, this.handCamera);
    else this.r.render();
  }

  // Leaving the world: tell the host our final state.
  quit() {
    if (this.playing) this.send({ t: 'save', inv: this.inv, armor: this.armor, offhand: this.offhand, health: this.stats.health, food: this.stats.food, xp: this.stats.xpTotal, enchSeed: this.enchSeed });
    this.playing = false;
    this.closed = true;
    this.screen.close();
    this.unbind();
    this.entities.clear();
    this.entities.setSelf(false);
    this.particles.clear();
    this.r.clearChunks();
    document.exitPointerLock?.();
  }
}
