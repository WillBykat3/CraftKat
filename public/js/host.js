// The game "server". It runs inside the host player's browser (and in tests),
// owns the authoritative world, and talks to every player, including the host
// themselves, through plain message objects.

import {
  BLOCK, BLOCKS, ITEM, HEIGHT, getDrops, isSupported, armorOf, supportOffset, FACING6, isBlockId, isValidId, maxStack, toolOf,
  SMELTING, FUEL, SMELT_SECONDS,
} from './blocks.js';
import { World, LATEST_GEN, DIMENSIONS } from './world.js';
import { moveBody, collides } from './physics.js';
import { clickSlot, quickMove } from './inventory.js';
import { levelOf, XP_SIZES, ORE_XP, SMELT_XP } from './xp.js';
import { BIOME, FROZEN } from './biomes.js';
import { gatherRegion, computeLight, regionIndex } from './lighting.js';
import { RedstoneSim } from './redstone-sim.js';
import { END_PLATFORM } from './terrain-end.js';

export const DAY_TICKS = 24000;     // one full day
export const TICKS_PER_SECOND = 20; // so a day lasts 20 minutes, like Minecraft
const REACH = 8;                    // blocks (client reach is ~5, plus lag allowance)
const VIEW = 64;                    // entities further than this from a player aren't sent
const ITEM_LIFETIME = 300;          // seconds before dropped items vanish
const PICKUP_DELAY = 0.5;
const MOB_TYPES = {
  pig: { hp: 10, halfW: 0.45, height: 0.9, speed: 1.2, hostile: false },
  cow: { hp: 10, halfW: 0.45, height: 1.4, speed: 1.0, hostile: false },
  sheep: { hp: 8, halfW: 0.45, height: 1.3, speed: 1.1, hostile: false },
  chicken: { hp: 4, halfW: 0.25, height: 0.7, speed: 1.0, hostile: false },
  zombie: { hp: 20, halfW: 0.3, height: 1.9, speed: 2.2, hostile: true, burns: true, damage: 3 },
  skeleton: { hp: 20, halfW: 0.3, height: 1.95, speed: 2.0, hostile: true, burns: true },
  spider: { hp: 16, halfW: 0.7, height: 0.9, speed: 2.8, hostile: true, damage: 2 },
  creeper: { hp: 20, halfW: 0.3, height: 1.7, speed: 2.0, hostile: true },
  husk: { hp: 20, halfW: 0.3, height: 1.9, speed: 2.2, hostile: true, damage: 3 },       // desert zombie, doesn't burn
  stray: { hp: 20, halfW: 0.3, height: 1.95, speed: 2.0, hostile: true, burns: true },  // snowy skeleton
  enderman: { hp: 40, halfW: 0.3, height: 2.9, speed: 3.2, hostile: true, damage: 7 }, // neutral until angered
};
const MOB_NAMES = { zombie: 'a Zombie', husk: 'a Husk', spider: 'a Spider', enderman: 'an Enderman', skeleton: 'a Skeleton', stray: 'a Stray' };
const PASSIVE = ['pig', 'cow', 'sheep', 'chicken'];
const HOSTILE = [['zombie', 0.38], ['skeleton', 0.24], ['creeper', 0.19], ['spider', 0.14], ['enderman', 0.05]];
const DESERT_BIOMES = new Set([BIOME.DESERT]);
const CREEPER_FUSE = 1.5;            // seconds from hissing to boom
const ARROW_DAMAGE = 3;
const isMob = (e) => !!MOB_TYPES[e.type];
// 4 slots, each empty or one piece of armor of the right kind
const validArmor = (a) => Array.isArray(a) && a.length === 4 && a.every((s, slot) => s === null || (validStack(s) && armorOf(s.id)?.slot === slot && s.count === 1));

export function newWorldSave({ name, seed, mode = 'survival', cheats = true }) {
  const world = new World(seed, LATEST_GEN);
  return {
    version: 2,
    genVersion: LATEST_GEN,
    name: String(name || 'New World').slice(0, 32),
    seed: seed | 0,
    mode: mode === 'creative' ? 'creative' : 'survival',
    cheats: !!cheats,
    spawn: findSpawn(world),
    time: 1000,
    edits: [],
    players: {},
    furnaces: {},
    chests: {},
    created: Date.now(),
    lastPlayed: Date.now(),
  };
}

// A dry land spot near the origin, preferably on grass.
export function findSpawn(world) {
  const tall = world.yOffset > 0; // tall worlds have big oceans, so look further
  const maxR = tall ? 1600 : 200, step = tall ? 8 : 4;
  let fallback = null;
  for (let r = 0; r < maxR; r += step) {
    const n = Math.max(16, Math.round(r / 6));
    for (let a = 0; a < n; a++) {
      const x = Math.round(Math.cos(a / n * Math.PI * 2) * r);
      const z = Math.round(Math.sin(a / n * Math.PI * 2) * r);
      const h = world.heightAt(x, z);
      if (h <= world.seaLevel) continue;
      const top = world.getBlock(x, h, z);
      const above = world.getBlock(x, h + 1, z);
      if (!BLOCKS[above].replaceable || BLOCKS[world.getBlock(x, h + 2, z)].solid) continue;
      if (top === BLOCK.GRASS) return [x + 0.5, h + 1, z + 0.5];
      if (!fallback && (top === BLOCK.SAND || top === BLOCK.SNOWY_GRASS)) fallback = [x + 0.5, h + 1, z + 0.5];
    }
    if (fallback && r > 64) return fallback;
  }
  return fallback || [0.5, world.heightAt(0, 0) + 1, 0.5];
}

// 0 at night, 1 at day, smooth at dawn and dusk.
export function daylight(time) {
  const t = ((time % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
  if (t < 12000) return 1;
  if (t < 13800) return 1 - (t - 12000) / 1800;
  if (t < 22200) return 0;
  return (t - 22200) / 1800;
}

const cleanName = (raw) => String(raw ?? '').replace(/[^A-Za-z0-9_\- ]/g, '').trim().slice(0, 16);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = Number.isInteger;

function bucket(rate, burst, now) {
  let tokens = burst;
  let last = now();
  return () => {
    const t = now();
    tokens = Math.min(burst, tokens + ((t - last) / 1000) * rate);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

function validStack(s) {
  return s === null || (s && typeof s === 'object' && isValidId(s.id) && isInt(s.count) &&
    s.count > 0 && s.count <= maxStack(s.id) && (s.dur === undefined || (isInt(s.dur) && s.dur >= 0)));
}

export class GameHost {
  // save: from newWorldSave() or a previous serialize()
  // send(peerId, msg): delivers a message to one player
  // options.password: if set, players must send it in their hello
  constructor(save, send, options = {}) {
    this.save = save;
    this.sendRaw = send;
    this.password = options.password || '';
    this.now = options.now || (() => Date.now());
    this.random = options.random || Math.random;
    this.maxPlayers = options.maxPlayers || 12;
    this.gen = save.genVersion ?? 1; // worlds made before generator versions existed use version 1
    // Each dimension has its own world, crops, redstone, furnaces and chests. Code runs
    // "in" one dimension at a time (this.ctx): this.world and friends follow it.
    this.dims = {};
    this.ctx = 'overworld';
    const saved = save.dims || {};
    for (const dim of DIMENSIONS) {
      const data = dim === 'overworld' ? save : saved[dim] || {};
      const world = new World(save.seed, this.gen, dim);
      world.importEdits(data.edits || []);
      // growing crops (only ever planted by players, so they're all in the edits)
      const crops = new Set();
      for (const [x, y, z, id] of world.exportEdits()) if (BLOCKS[id]?.crop) crops.add(`${x},${y},${z}`);
      this.dims[dim] = {
        world, crops, lightCache: null,
        furnaces: new Map(Object.entries(data.furnaces || {})), furnaceViewers: new Map(), // key -> Set(peerId)
        chests: new Map(Object.entries(data.chests || {})), chestViewers: new Map(),
      };
      this.dims[dim].redstone = new RedstoneSim(this, world);
    }
    this.portals = Array.isArray(save.portals) ? save.portals.filter((q) => Array.isArray(q) && DIMENSIONS.includes(q[0])) : []; // [dim, x, y, z, axis]
    this.players = new Map();   // peerId -> player
    this.entities = new Map();  // id -> entity
    this.nextPlayerId = 1;
    this.nextEntityId = 1;
    this.time = save.time ?? 1000;
    this.sleepTimer = 0;
    this.dirty = false;
    this.acc = { state: 0, spawn: 0, time: 0, furnace: 0 };
    this.onLog = options.onLog || (() => {});
  }

  // ---------- dimensions ----------
  get world() { return this.dims[this.ctx].world; }
  get crops() { return this.dims[this.ctx].crops; }
  get redstone() { return this.dims[this.ctx].redstone; }
  get furnaces() { return this.dims[this.ctx].furnaces; }
  get furnaceViewers() { return this.dims[this.ctx].furnaceViewers; }
  get chests() { return this.dims[this.ctx].chests; }
  get chestViewers() { return this.dims[this.ctx].chestViewers; }
  get lightCache() { return this.dims[this.ctx].lightCache; }
  set lightCache(v) { this.dims[this.ctx].lightCache = v; }

  // Runs fn with `dim` as the current dimension.
  inDim(dim, fn) {
    const before = this.ctx;
    this.ctx = dim;
    try { return fn(); } finally { this.ctx = before; }
  }

  // Players in the current dimension.
  here() {
    const out = [];
    for (const p of this.players.values()) if (p.dim === this.ctx) out.push(p);
    return out;
  }

  addEntity(e) {
    e.dim = this.ctx;
    this.entities.set(e.id, e);
    return e;
  }

  // ---------- messaging ----------
  send(peerId, msg) {
    this.sendRaw(peerId, msg);
  }

  broadcast(msg, exceptPeer = null) {
    for (const peerId of this.players.keys()) if (peerId !== exceptPeer) this.sendRaw(peerId, msg);
  }

  // To the players in the current dimension only (block changes, explosions...).
  broadcastHere(msg, exceptPeer = null) {
    for (const p of this.players.values()) if (p.dim === this.ctx && p.peerId !== exceptPeer) this.sendRaw(p.peerId, msg);
  }

  sys(text) {
    this.broadcast({ t: 'sys', msg: text });
    this.onLog(text);
  }

  connect(_peerId) {
    // nothing until the player says hello
  }

  disconnect(peerId) {
    const p = this.players.get(peerId);
    if (!p) return;
    this.storePlayer(p);
    this.players.delete(peerId);
    this.closeViewers(peerId);
    this.broadcast({ t: 'leave', id: p.id });
    this.sys(`${p.name} left the game`);
  }

  closeViewers(peerId) {
    for (const d of Object.values(this.dims)) {
      for (const viewers of d.furnaceViewers.values()) viewers.delete(peerId);
      for (const viewers of d.chestViewers.values()) viewers.delete(peerId);
    }
  }

  storePlayer(p) {
    const key = p.saveKey;
    const prev = this.save.players[key] || {};
    this.save.players[key] = {
      ...prev,
      pos: [p.x, p.y, p.z],
      rot: [p.yaw, p.pitch],
      mode: p.mode,
      inv: p.inv ?? prev.inv ?? null,
      health: p.health ?? prev.health ?? 20,
      food: p.food ?? prev.food ?? 20,
      bed: p.bed ?? prev.bed ?? null,
      xp: p.xp ?? prev.xp ?? 0,
      armor: p.armor ?? prev.armor ?? null,
      dim: p.dim,
    };
    this.dirty = true;
  }

  message(peerId, msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    const p = this.players.get(peerId);
    if (!p) {
      if (msg.t === 'hello') this.hello(peerId, msg);
      return;
    }
    this.ctx = p.dim;
    switch (msg.t) {
      case 'pos': return this.onPos(p, msg);
      case 'set': return this.onSet(peerId, p, msg);
      case 'dig': return this.onDig(peerId, p, msg);
      case 'pickup': return this.onPickup(peerId, p, msg);
      case 'drop': return this.onDrop(p, msg);
      case 'died': return this.onDied(p, msg);
      case 'respawn': return this.onRespawn(peerId, p);
      case 'attack': return this.onAttack(p, msg);
      case 'chat': return this.onChat(peerId, p, msg);
      case 'save': return this.onSave(p, msg);
      case 'equip': return this.onEquip(p, msg);
      case 'furnace_open': return this.onFurnaceOpen(peerId, p, msg);
      case 'furnace_close': return this.onFurnaceClose(peerId, msg);
      case 'furnace_click': return this.onFurnaceClick(peerId, p, msg);
      case 'chest_open': return this.onChestOpen(peerId, p, msg);
      case 'chest_close': return this.chestViewers.get(this.keyOf(msg))?.delete(peerId);
      case 'chest_click': return this.onChestClick(peerId, p, msg);
      case 'chest_put': return this.onChestPut(peerId, p, msg);
      case 'chest_take': return this.onChestTake(peerId, p, msg);
      case 'sleep': return this.onSleep(peerId, p, msg);
      case 'wake': p.sleeping = false; return;
      case 'bucket': return this.onBucket(peerId, p, msg);
      case 'interact': return this.onInteract(p, msg);
      case 'use': return this.onUse(peerId, p, msg);
      case 'shoot': return this.onShoot(p, msg);
    }
  }

  hello(peerId, msg) {
    if (this.password && msg.password !== this.password) {
      this.send(peerId, { t: 'error', msg: 'Wrong password.' });
      return;
    }
    if (this.players.size >= this.maxPlayers) {
      this.send(peerId, { t: 'error', msg: `The world is full (${this.maxPlayers} players).` });
      return;
    }
    let name = cleanName(msg.name) || 'Player' + Math.floor(this.random() * 1000);
    const taken = new Set([...this.players.values()].map((q) => q.name.toLowerCase()));
    const base = name.slice(0, 13);
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = base + i;

    // players with accounts are saved by account (so renaming keeps your stuff); older saves used names
    const saveKey = typeof msg.accountId === 'string' && msg.accountId ? 'id:' + msg.accountId : name.toLowerCase();
    const saved = this.save.players[saveKey] ?? this.save.players[name.toLowerCase()];
    const dim = DIMENSIONS.includes(saved?.dim) ? saved.dim : 'overworld';
    const pos = saved?.pos ?? this.save.spawn;
    const p = {
      dim,
      ds: 0, // counts dimension changes
      id: this.nextPlayerId++,
      peerId,
      name,
      saveKey,
      x: pos[0], y: pos[1], z: pos[2],
      yaw: saved?.rot?.[0] ?? 0, pitch: saved?.rot?.[1] ?? 0,
      mode: saved?.mode ?? this.save.mode,
      inv: saved?.inv ?? null,
      health: saved?.health ?? 20,
      food: saved?.food ?? 20,
      bed: saved?.bed ?? null,
      xp: saved?.xp ?? 0,
      armor: saved?.armor ?? null,
      isHost: !!msg.isHost && peerId === 'local',
      moved: true,
      canBuild: bucket(25, 50, this.now),
      canChat: bucket(1, 5, this.now),
    };
    this.players.set(peerId, p);
    this.ctx = dim;
    this.send(peerId, {
      t: 'welcome',
      dim,
      id: p.id,
      name,
      worldName: this.save.name,
      seed: this.save.seed,
      gen: this.gen,
      edits: this.world.exportEdits(),
      spawn: this.save.spawn,
      time: this.time,
      mode: p.mode,
      me: { pos: [p.x, p.y, p.z], rot: [p.yaw, p.pitch], inv: p.inv, health: p.health, food: p.food, bed: p.bed, xp: p.xp, armor: p.armor },
      players: this.here().filter((q) => q !== p).map((q) => this.playerInfo(q)),
    });
    this.broadcastHere({ t: 'join', ...this.playerInfo(p) }, peerId);
    this.sys(`${name} joined the game`);
  }

  playerInfo(p) {
    return { id: p.id, name: p.name, p: [p.x, p.y, p.z], r: [p.yaw, p.pitch], armor: (p.armor || []).map((s) => s?.id ?? 0) };
  }

  onPos(p, msg) {
    if (msg.ds !== undefined && msg.ds !== p.ds) return; // sent before the player changed dimension
    const { p: pos, r } = msg;
    if (!Array.isArray(pos) || pos.length !== 3 || !pos.every(isNum)) return;
    if (!Array.isArray(r) || r.length !== 2 || !r.every(isNum)) return;
    if (Math.abs(pos[0]) > 3e7 || Math.abs(pos[2]) > 3e7 || pos[1] < -64 || pos[1] > 512) return;
    [p.x, p.y, p.z] = pos;
    [p.yaw, p.pitch] = r;
    p.held = isValidId(msg.h) ? msg.h : 0;
    p.moved = true;
  }

  inReach(p, x, y, z) {
    return Math.hypot(x + 0.5 - p.x, y + 0.5 - (p.y + 1.6), z + 0.5 - p.z) <= REACH;
  }

  validCoords(msg) {
    return isInt(msg.x) && isInt(msg.y) && isInt(msg.z) && msg.y >= 0 && msg.y < HEIGHT &&
      Math.abs(msg.x) < 3e7 && Math.abs(msg.z) < 3e7;
  }

  // Changes a block, keeps the world consistent and tells everyone.
  setBlock(x, y, z, id, exceptPeer = null) {
    this.world.setBlock(x, y, z, id);
    const key = `${x},${y},${z}`;
    if (BLOCKS[id].crop) this.crops.add(key); else this.crops.delete(key);
    this.redstone?.changed(x, y, z, id);
    if (this.lightCache) {
      const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.lightCache.delete((cx + dx) + ',' + (cz + dz));
    }
    this.dirty = true;
    this.checkPortals(x, y, z);
    this.broadcastHere({ t: 'set', x, y, z, id }, exceptPeer);
  }

  correct(peerId, x, y, z) {
    this.send(peerId, { t: 'set', x, y, z, id: this.world.getBlock(x, y, z) });
  }

  onSet(peerId, p, msg) {
    if (!this.validCoords(msg)) return;
    const { x, y, z, id } = msg;
    const current = this.world.getBlock(x, y, z);
    const ok = isBlockId(id) && (id !== BLOCK.BEDROCK || p.mode === 'creative') &&
      (!BLOCKS[id].liquid || p.mode === 'creative') &&
      BLOCKS[current].replaceable && current !== id && this.inReach(p, x, y, z) && y >= 1 &&
      !this.blockedByEntity(x, y, z, id) && p.canBuild();
    if (!ok) return this.correct(peerId, x, y, z);
    this.setBlock(x, y, z, id, peerId);
    if (id === BLOCK.FURNACE) this.furnaces.set(`${x},${y},${z}`, { slots: [null, null, null], burn: 0, burnMax: 0, progress: 0 });
    if (id === BLOCK.CHEST) this.chests.set(`${x},${y},${z}`, { slots: new Array(27).fill(null) });
    this.settle(x, y, z);
  }

  blockedByEntity(x, y, z, id) {
    if (!BLOCKS[id].solid) return false;
    const box = (b) => x < b.x + b.halfW && x + 1 > b.x - b.halfW && y < b.y + b.height && y + 1 > b.y &&
      z < b.z + b.halfW && z + 1 > b.z - b.halfW;
    for (const e of this.entities.values()) if (isMob(e) && e.dim === this.ctx && box(e)) return true;
    return false;
  }

  onDig(peerId, p, msg) {
    if (!this.validCoords(msg)) return;
    const { x, y, z } = msg;
    const current = this.world.getBlock(x, y, z);
    const creative = p.mode === 'creative';
    const ok = current !== BLOCK.AIR && !BLOCKS[current].liquid &&
      (current !== BLOCK.BEDROCK || creative) && this.inReach(p, x, y, z) && p.canBuild();
    if (!ok) return this.correct(peerId, x, y, z);
    const held = isValidId(msg.tool) ? msg.tool : 0;
    this.breakBlock(x, y, z, creative ? null : held, peerId);
  }

  // Removes a block (dropping items unless tool === null) and handles what that causes.
  breakBlock(x, y, z, tool, exceptPeer = null) {
    const id = this.world.getBlock(x, y, z);
    let dropFrom = id;
    const pb = BLOCKS[id];
    if (pb.redstone === 'head' || (pb.redstone === 'piston' && pb.extended)) {
      // a piston and its head go together: breaking the head drops the piston, like Minecraft
      const [fx, fy, fz] = FACING6[pb.facing6];
      const s = pb.redstone === 'head' ? -1 : 1;
      const ox = x + fx * s, oy = y + fy * s, oz = z + fz * s;
      const other = this.world.getBlock(ox, oy, oz);
      if (BLOCKS[other].redstone === (pb.redstone === 'head' ? 'piston' : 'head')) {
        this.setBlock(ox, oy, oz, BLOCK.AIR);
        if (pb.redstone === 'head') dropFrom = other;
      }
    }
    if (BLOCKS[id].shape === 'door') {
      // a door is two blocks: both go, and it drops one door
      const oy = BLOCKS[id].upper ? y - 1 : y + 1;
      const other = this.world.getBlock(x, oy, z);
      if (BLOCKS[other].shape === 'door') {
        this.setBlock(x, oy, z, BLOCK.AIR);
        if (BLOCKS[id].upper) dropFrom = other;
      }
    }
    // breaking ice with something under it, or a block next to the sea, lets the water in
    const flood = (id === BLOCK.ICE && tool !== null && this.world.getBlock(x, y - 1, z) !== BLOCK.AIR) ||
      (y <= this.world.seaLevel && [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]
        .some(([dx, dy, dz]) => this.world.getBlock(x + dx, y + dy, z + dz) === BLOCK.WATER));
    this.setBlock(x, y, z, flood ? BLOCK.WATER : BLOCK.AIR, exceptPeer);
    if (flood && exceptPeer) this.send(exceptPeer, { t: 'set', x, y, z, id: BLOCK.WATER });
    if (tool !== null) {
      const drops = getDrops(dropFrom, tool, this.random);
      for (const [dropId, count] of drops) this.spawnItem(x + 0.5, y + 0.3, z + 0.5, dropId, count);
      const xp = ORE_XP[id];
      if (xp && drops.length) this.spawnXP(x + 0.5, y + 0.5, z + 0.5, xp[0] + Math.floor(this.random() * (xp[1] - xp[0] + 1)));
    }
    if (id === BLOCK.FURNACE) {
      const key = `${x},${y},${z}`;
      const f = this.furnaces.get(key);
      if (f) for (const s of f.slots) if (s) this.spawnItem(x + 0.5, y + 0.5, z + 0.5, s.id, s.count, s.dur);
      this.furnaces.delete(key);
      this.furnaceViewers.delete(key);
    }
    if (id === BLOCK.CHEST) {
      const key = `${x},${y},${z}`;
      const c = this.chests.get(key);
      if (c) for (const s of c.slots) if (s) this.spawnItem(x + 0.5, y + 0.5, z + 0.5, s.id, s.count, s.dur);
      for (const peer of this.chestViewers.get(key) || []) this.send(peer, { t: 'chest_gone' });
      this.chests.delete(key);
      this.chestViewers.delete(key);
    }
    this.settle(x, y + 1, z, tool !== null);
    this.popAttached(x, y, z, tool !== null);
  }

  // Torches, levers, buttons and ladders on the sides of a block that's gone fall off.
  popAttached(x, y, z, drops) {
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      const id = this.world.getBlock(nx, ny, nz);
      const off = supportOffset(id);
      if (!off || nx + off[0] !== x || ny + off[1] !== y || nz + off[2] !== z) continue;
      this.setBlock(nx, ny, nz, BLOCK.AIR);
      if (drops) for (const [d, c] of getDrops(id, ITEM.DIAMOND_PICKAXE, this.random)) this.spawnItem(nx + 0.5, ny + 0.3, nz + 0.5, d, c);
    }
  }

  // ---------- redstone hooks ----------
  // Where the (living) players are, as [x, z].
  playerSpots() {
    return this.here().filter((p) => !p.dead).map((p) => [p.x, p.z]);
  }

  // Everything that can stand on a pressure plate (items only count for wooden ones).
  entityBoxes(withItems) {
    const out = [];
    for (const p of this.here()) if (!p.dead) out.push({ x: p.x, y: p.y, z: p.z, halfW: 0.3, height: 1.8 });
    for (const e of this.entities.values()) {
      if (e.dim !== this.ctx) continue;
      if (isMob(e)) out.push(e);
      else if (withItems && e.type === 'item') out.push(e);
    }
    return out;
  }

  primeTnt(x, y, z, fuse) {
    const e = {
      id: this.nextEntityId++, type: 'tnt', x: x + 0.5, y, z: z + 0.5, halfW: 0.49, height: 0.98,
      vx: (this.random() - 0.5) * 0.4, vy: 2, vz: (this.random() - 0.5) * 0.4, fuse, age: 0, yaw: 0,
    };
    this.addEntity(e);
    this.broadcastHere({ t: 'hiss', x: e.x, y: e.y, z: e.z });
    return e;
  }

  tickTnt(e, dt) {
    e.fuse -= dt;
    e.vy -= 20 * dt;
    const res = moveBody(this.world, e, dt);
    if (res.onGround) { e.vx *= 0.7; e.vz *= 0.7; }
    if (e.fuse <= 0) {
      this.entities.delete(e.id);
      this.broadcast({ t: 'mobdeath', e: e.id });
      this.explode(e.x, e.y + 0.5, e.z, 4, 'was blown up by TNT');
    }
  }

  // After a change at (x, y, z): unsupported plants/torches pop off, sand and gravel fall.
  settle(x, y, z, drops = true) {
    for (let guard = 0; guard < HEIGHT && y < HEIGHT; guard++) {
      const id = this.world.getBlock(x, y, z);
      const below = this.world.getBlock(x, y - 1, z);
      if (!isSupported(id, below)) {
        this.setBlock(x, y, z, BLOCK.AIR);
        if (drops) for (const [d, c] of getDrops(id, 0, this.random)) this.spawnItem(x + 0.5, y + 0.3, z + 0.5, d, c);
        y++;
        continue;
      }
      if (BLOCKS[id].gravity && !BLOCKS[below].solid) {
        let ty = y - 1;
        while (ty > 0 && !BLOCKS[this.world.getBlock(x, ty - 1, z)].solid) ty--;
        const landed = this.world.getBlock(x, ty, z);
        this.setBlock(x, y, z, BLOCK.AIR);
        if (BLOCKS[landed].needsSupport && drops) {
          for (const [d, c] of getDrops(landed, 0, this.random)) this.spawnItem(x + 0.5, ty + 0.3, z + 0.5, d, c);
        }
        this.setBlock(x, ty, z, id);
        y++;
        continue;
      }
      break;
    }
  }

  // ---------- entities ----------
  spawnItem(x, y, z, id, count = 1, dur, vel) {
    const e = {
      id: this.nextEntityId++, type: 'item', item: id, count, dur,
      x, y, z, halfW: 0.125, height: 0.25,
      vx: vel ? vel[0] : (this.random() - 0.5) * 2, vy: vel ? vel[1] : 3, vz: vel ? vel[2] : (this.random() - 0.5) * 2,
      age: 0, yaw: this.random() * 6.28,
    };
    return this.addEntity(e);
  }

  // Experience orbs, split into Minecraft's orb sizes.
  spawnXP(x, y, z, amount) {
    while (amount > 0) {
      const value = XP_SIZES.find((v) => v <= amount);
      amount -= value;
      this.addEntity({
        id: this.nextEntityId++, type: 'xp', value, x, y, z, halfW: 0.125, height: 0.25,
        vx: (this.random() - 0.5) * 2, vy: 2 + this.random() * 2, vz: (this.random() - 0.5) * 2, age: 0, yaw: 0,
      });
    }
  }

  tickXP(e, dt) {
    if (e.age > ITEM_LIFETIME) { this.entities.delete(e.id); return; }
    // fly towards the nearest living player within 8 blocks
    let best = null, bestD = 8;
    for (const p of this.here()) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - e.x, p.y + 0.9 - e.y, p.z - e.z);
      if (d < bestD) { best = p; bestD = d; }
    }
    if (best && e.age > 0.5) {
      if (bestD < 1.3) {
        this.entities.delete(e.id);
        this.send(best.peerId, { t: 'xp', amount: e.value });
        return;
      }
      const pull = (1 - bestD / 8) ** 2 * 60 * dt;
      e.vx += (best.x - e.x) / bestD * pull;
      e.vy += (best.y + 0.9 - e.y) / bestD * pull;
      e.vz += (best.z - e.z) / bestD * pull;
    }
    e.vy -= 10 * dt;
    const res = moveBody(this.world, e, dt);
    const drag = res.onGround ? 0.85 : 0.98;
    e.vx *= drag; e.vz *= drag;
    if (e.y < -20) this.entities.delete(e.id);
  }

  spawnMob(type, x, y, z) {
    const t = MOB_TYPES[type];
    const e = {
      id: this.nextEntityId++, type, x, y, z, vx: 0, vy: 0, vz: 0, halfW: t.halfW, height: t.height,
      hp: t.hp, yaw: this.random() * 6.28, age: 0, think: 0, walk: 0, panic: 0, attackCooldown: 0, onGround: false,
    };
    return this.addEntity(e);
  }

  onPickup(peerId, p, msg) {
    const e = this.entities.get(msg.e);
    if (!e || e.type !== 'item' || e.dim !== p.dim || e.age < (e.pickupAfter ?? PICKUP_DELAY)) return;
    if (Math.hypot(e.x - p.x, e.y - (p.y + 0.9), e.z - p.z) > 3) return;
    this.entities.delete(e.id);
    const give = { t: 'give', id: e.item, count: e.count };
    if (e.dur !== undefined) give.dur = e.dur;
    this.send(peerId, give);
  }

  onDrop(p, msg) {
    if (!validStack(msg.stack) || !msg.stack) return;
    const s = msg.stack;
    const dir = isNum(msg.yaw) ? msg.yaw : p.yaw;
    const pitch = isNum(msg.pitch) ? msg.pitch : p.pitch;
    const speed = 5;
    const e = this.spawnItem(p.x, p.y + 1.4, p.z, s.id, s.count, s.dur, [
      -Math.sin(dir) * Math.cos(pitch) * speed, Math.sin(pitch) * speed + 1.5, -Math.cos(dir) * Math.cos(pitch) * speed,
    ]);
    e.pickupAfter = 1.5;
  }

  onDied(p, msg) {
    p.dead = true;
    if (Array.isArray(msg.items)) {
      for (const s of msg.items.slice(0, 40)) {
        if (validStack(s) && s) this.spawnItem(p.x, p.y + 0.5, p.z, s.id, s.count, s.dur);
      }
    }
    // like Minecraft: drop 7 points per level (at most 100) and lose the rest
    if (isInt(msg.xp) && msg.xp >= 0 && msg.xp < 1e7) p.xp = msg.xp;
    if (p.mode === 'survival') this.spawnXP(p.x, p.y + 0.5, p.z, Math.min(100, 7 * levelOf(p.xp || 0)));
    p.xp = 0;
    this.sys(`${p.name} ${typeof msg.cause === 'string' ? msg.cause.slice(0, 40) : 'died'}`);
  }

  onAttack(p, msg) {
    const e = this.entities.get(msg.e);
    if (!e || !isMob(e) || e.dim !== p.dim || !p.canBuild()) return;
    if (Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z) > 6) return;
    const tool = toolOf(msg.tool);
    const damage = tool && tool.kind !== 'bow' ? (tool.kind === 'sword' ? tool.damage + 1 : tool.damage - 1) : 1;
    this.hurtMob(e, damage, e.x - p.x, e.z - p.z, p.name);
  }

  // Damage with knockback away from (dx, dz); by: the player's name (angers neutral mobs).
  hurtMob(e, damage, dx, dz, by) {
    e.hp -= damage;
    const len = Math.hypot(dx, dz) || 1;
    e.vx = (dx / len) * 6;
    e.vz = (dz / len) * 6;
    e.vy = 4;
    e.panic = 4;
    e.hurtUntil = this.now() + 400;
    if (by) e.angryAt = by;
    this.broadcast({ t: 'mobhurt', e: e.id });
    if (e.hp <= 0) this.killMob(e);
    else this.onMobHurt(e);
  }

  killMob(e) {
    this.entities.delete(e.id);
    const r = this.random;
    const drops = {
      pig: [[ITEM.RAW_PORKCHOP, 1 + Math.floor(r() * 3)]],
      cow: [[ITEM.RAW_BEEF, 1 + Math.floor(r() * 3)], [ITEM.LEATHER, Math.floor(r() * 3)]],
      sheep: [[ITEM.RAW_MUTTON, 1 + Math.floor(r() * 2)], [BLOCK.WOOL, e.sheared ? 0 : 1]],
      chicken: [[ITEM.RAW_CHICKEN, 1], [ITEM.FEATHER, Math.floor(r() * 3)]],
      zombie: [[ITEM.ROTTEN_FLESH, Math.floor(r() * 3)], [r() < 0.5 ? ITEM.CARROT : ITEM.POTATO, r() < 0.05 ? 1 : 0]],
      skeleton: [[ITEM.BONE, Math.floor(r() * 3)], [ITEM.ARROW, Math.floor(r() * 3)]],
      spider: [[ITEM.STRING, Math.floor(r() * 3)]],
      creeper: [[ITEM.GUNPOWDER, Math.floor(r() * 3)]],
      husk: [[ITEM.ROTTEN_FLESH, Math.floor(r() * 3)]],
      stray: [[ITEM.BONE, Math.floor(r() * 3)], [ITEM.ARROW, Math.floor(r() * 3)]],
      enderman: [[ITEM.ENDER_PEARL, Math.floor(r() * 2)]],
    }[e.type] || [];
    for (const [id, n] of drops) if (n > 0) this.spawnItem(e.x, e.y + 0.5, e.z, id, n);
    this.spawnXP(e.x, e.y + 0.5, e.z, MOB_TYPES[e.type].hostile ? 5 : 1 + Math.floor(r() * 3));
    this.broadcast({ t: 'mobdeath', e: e.id });
  }

  // ---------- chests ----------
  keyOf(msg) {
    return `${msg.x},${msg.y},${msg.z}`;
  }

  chestAt(p, msg) {
    if (!this.validCoords(msg) || this.world.getBlock(msg.x, msg.y, msg.z) !== BLOCK.CHEST) return null;
    if (!this.inReach(p, msg.x, msg.y, msg.z)) return null;
    const key = this.keyOf(msg);
    if (!this.chests.has(key)) this.chests.set(key, { slots: new Array(27).fill(null) });
    return [key, this.chests.get(key)];
  }

  notifyChest(key, c) {
    const [x, y, z] = key.split(',').map(Number);
    for (const peer of this.chestViewers.get(key) || []) this.send(peer, { t: 'chest', x, y, z, slots: c.slots });
  }

  onChestOpen(peerId, p, msg) {
    const found = this.chestAt(p, msg);
    if (!found) return;
    const [key, c] = found;
    if (!this.chestViewers.has(key)) this.chestViewers.set(key, new Set());
    this.chestViewers.get(key).add(peerId);
    this.notifyChest(key, c);
  }

  onChestClick(peerId, p, msg) {
    const found = this.chestAt(p, msg);
    const cursor = validStack(msg.cursor) ? msg.cursor : null;
    if (!found || !isInt(msg.slot) || msg.slot < 0 || msg.slot > 26 || !(msg.button === 0 || msg.button === 2)) {
      return this.send(peerId, { t: 'cursor', stack: cursor });
    }
    const [key, c] = found;
    this.send(peerId, { t: 'cursor', stack: clickSlot(c.slots, msg.slot, cursor, msg.button) });
    this.dirty = true;
    this.notifyChest(key, c);
  }

  // shift-click from the inventory: move a whole stack into the chest
  onChestPut(peerId, p, msg) {
    const found = this.chestAt(p, msg);
    if (!validStack(msg.stack) || !msg.stack) return;
    if (!found) return this.give(peerId, msg.stack);
    const [key, c] = found;
    const left = quickMove(msg.stack, c.slots, [...c.slots.keys()]);
    if (left) this.give(peerId, left);
    this.dirty = true;
    this.notifyChest(key, c);
  }

  // shift-click on a chest slot: move it into the inventory
  onChestTake(peerId, p, msg) {
    const found = this.chestAt(p, msg);
    if (!found || !isInt(msg.slot) || msg.slot < 0 || msg.slot > 26) return;
    const [key, c] = found;
    const s = c.slots[msg.slot];
    if (!s) return;
    c.slots[msg.slot] = null;
    this.give(peerId, s);
    this.dirty = true;
    this.notifyChest(key, c);
  }

  give(peerId, s) {
    const msg = { t: 'give', id: s.id, count: s.count };
    if (s.dur !== undefined) msg.dur = s.dur;
    this.send(peerId, msg);
  }

  // ---------- beds ----------
  onSleep(peerId, p, msg) {
    if (!this.validCoords(msg) || this.world.getBlock(msg.x, msg.y, msg.z) !== BLOCK.BED || !this.inReach(p, msg.x, msg.y, msg.z)) return;
    if (!this.world.hasSky) {
      // beds blow up in the Nether and the End
      this.setBlock(msg.x, msg.y, msg.z, BLOCK.AIR);
      this.explode(msg.x + 0.5, msg.y + 0.5, msg.z + 0.5, 5, 'was killed by [Intentional Game Design]');
      return;
    }
    p.bed = [msg.x, msg.y, msg.z];
    this.storePlayer(p);
    const t = this.time % DAY_TICKS;
    if (t < 12542 || t > 23460) {
      this.send(peerId, { t: 'sys', msg: 'Respawn point set. You can only sleep at night.' });
      return;
    }
    p.sleeping = true;
    this.send(peerId, { t: 'sleeping', at: [msg.x, msg.y, msg.z] });
    const awake = [...this.players.values()].filter((q) => q.dim === 'overworld');
    this.sys(`${p.name} is sleeping (${awake.filter((q) => q.sleeping).length}/${awake.length})`);
  }

  // Respawn at your bed if it's still there, otherwise at world spawn.
  onRespawn(peerId, p) {
    p.dead = false;
    const spot = this.homeOf(p, true);
    if (p.dim !== 'overworld') this.changeDim(p, 'overworld', spot);
    else this.send(peerId, { t: 'teleport', p: spot });
  }

  // Where a player respawns: their bed (in the Overworld) if it's still there, else world spawn.
  homeOf(p, tell = false) {
    if (p.bed) {
      const [bx, by, bz] = p.bed;
      if (this.dims.overworld.world.getBlock(bx, by, bz) === BLOCK.BED) return [bx + 0.5, by + 1, bz + 0.5];
      p.bed = null;
      if (tell) this.send(p.peerId, { t: 'sys', msg: 'Your bed was missing, so you respawned at the world spawn.' });
    }
    return this.save.spawn;
  }

  // ---------- buckets ----------
  onBucket(peerId, p, msg) {
    if (!this.validCoords(msg) || !this.inReach(p, msg.x, msg.y, msg.z) || !p.canBuild()) return;
    const { x, y, z } = msg;
    const current = this.world.getBlock(x, y, z);
    if (msg.fill) {
      if (current !== BLOCK.WATER) return this.correct(peerId, x, y, z);
      this.setBlock(x, y, z, BLOCK.AIR, peerId);
    } else {
      if (!BLOCKS[current].replaceable || current === BLOCK.WATER || y < 1) return this.correct(peerId, x, y, z);
      this.setBlock(x, y, z, BLOCK.WATER, peerId);
    }
  }

  // ---------- using things on blocks ----------
  // Opening doors, tilling soil with a hoe, bone meal on crops.
  onUse(peerId, p, msg) {
    if (!this.validCoords(msg) || !this.inReach(p, msg.x, msg.y, msg.z) || !p.canBuild()) return;
    const { x, y, z } = msg;
    const id = this.world.getBlock(x, y, z);
    const def = BLOCKS[id];
    if (this.redstone.use(x, y, z, msg.item)) return;
    if (msg.item === ITEM.FLINT_AND_STEEL) {
      // flint and steel lights the inside of an obsidian frame (there's no fire, so nothing else happens)
      const f = msg.face;
      if (Array.isArray(f) && f.length === 3 && f.every((v) => v === 0 || v === 1 || v === -1) && Math.abs(f[0]) + Math.abs(f[1]) + Math.abs(f[2]) === 1) {
        const ax = x + f[0], ay = y + f[1], az = z + f[2];
        if (this.world.getBlock(ax, ay, az) === BLOCK.AIR && this.lightPortal(ax, ay, az)) return;
      }
      return;
    }
    if (def.shape === 'door' && msg.item === undefined) {
      const lowerY = def.upper ? y - 1 : y;
      for (const yy of [lowerY, lowerY + 1]) {
        const d = this.world.getBlock(x, yy, z);
        if (BLOCKS[d].shape === 'door') this.setBlock(x, yy, z, BLOCK.OAK_DOOR + ((d - BLOCK.OAK_DOOR) ^ 4), peerId);
      }
      return;
    }
    if (toolOf(msg.item)?.kind === 'hoe' && (id === BLOCK.GRASS || id === BLOCK.DIRT) && this.world.getBlock(x, y + 1, z) === BLOCK.AIR) {
      this.setBlock(x, y, z, BLOCK.FARMLAND, peerId);
      return;
    }
    if (msg.item === ITEM.BONE_MEAL && def.crop && def.crop.stage < def.crop.max) {
      // bone meal: 2-5 growth stages at once, like Minecraft
      const add = def.crop.max === 7 ? 2 + Math.floor(this.random() * 4) : 1 + Math.floor(this.random() * 2);
      const stage = Math.min(def.crop.max, def.crop.stage + add);
      this.setBlock(x, y, z, id - def.crop.stage + stage);
      return;
    }
    this.correct(peerId, x, y, z);
  }

  // Crops grow a stage every so often: faster on farmland with water within 4 blocks,
  // and only near players (like Minecraft's loaded chunks).
  tickCrops(dt) {
    for (const key of this.crops) {
      const [x, y, z] = key.split(',').map(Number);
      const near = this.here().some((p) => Math.abs(p.x - x) < 160 && Math.abs(p.z - z) < 160);
      if (!near) continue;
      const id = this.world.getBlock(x, y, z);
      const def = BLOCKS[id];
      if (!def.crop) { this.crops.delete(key); continue; }
      if (def.crop.stage >= def.crop.max) continue;
      const stageTime = (def.crop.max === 7 ? 1 : 2) * (this.hydrated(x, y - 1, z) ? 40 : 90); // seconds per stage, on average
      if (this.random() < dt / stageTime) this.setBlock(x, y, z, id + 1);
    }
  }

  hydrated(x, y, z) {
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      for (let dy = 0; dy <= 1; dy++) if (this.world.getBlock(x + dx, y + dy, z + dz) === BLOCK.WATER) return true;
    }
    return false;
  }

  // ---------- using items on mobs ----------
  onInteract(p, msg) {
    const e = this.entities.get(msg.e);
    if (!e || e.dim !== p.dim || Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z) > 6) return;
    if (e.type === 'sheep' && msg.tool === ITEM.SHEARS && !e.sheared) {
      e.sheared = true;
      e.regrow = 60 + this.random() * 60;
      this.spawnItem(e.x, e.y + 1, e.z, BLOCK.WOOL, 1 + Math.floor(this.random() * 3));
    }
  }

  // ---------- explosions & arrows ----------
  explode(x, y, z, power, cause = 'was blown up by a Creeper') {
    this.broadcastHere({ t: 'boom', x, y, z });
    const r = Math.ceil(power);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      if (Math.hypot(dx, dy, dz) > power - this.random() * 0.8) continue;
      const bx = Math.floor(x) + dx, by = Math.floor(y) + dy, bz = Math.floor(z) + dz;
      if (by < 1 || by >= HEIGHT) continue;
      const id = this.world.getBlock(bx, by, bz);
      if (id === BLOCK.AIR || BLOCKS[id].liquid || id === BLOCK.BEDROCK || id === BLOCK.OBSIDIAN) continue;
      if (id === BLOCK.TNT) { this.setBlock(bx, by, bz, BLOCK.AIR); this.primeTnt(bx, by, bz, 0.5 + this.random()); continue; } // chain reaction
      // like Minecraft, only some of the blown-up blocks drop (chests and furnaces always spill their contents)
      this.breakBlock(bx, by, bz, this.random() < 1 / power ? ITEM.DIAMOND_PICKAXE : null);
    }
    for (const p of this.here()) {
      const d = Math.hypot(p.x - x, p.y + 0.9 - y, p.z - z);
      if (d < power * 2) this.send(p.peerId, { t: 'hurt', amount: Math.round((1 - d / (power * 2)) * 22), from: [x, z], cause });
    }
    for (const e of [...this.entities.values()]) {
      if (!isMob(e) || e.dim !== this.ctx) continue;
      const d = Math.hypot(e.x - x, e.y - y, e.z - z);
      if (d < power * 2) { e.hp -= Math.round((1 - d / (power * 2)) * 22); if (e.hp <= 0) this.killMob(e); }
    }
  }

  shootArrow(from, target) {
    const sx = from.x, sy = from.y + 1.5, sz = from.z;
    const tx = target.x, ty = target.y + 1.2, tz = target.z;
    const dist = Math.hypot(tx - sx, tz - sz);
    const speed = 16;
    const t = dist / speed;
    const a = {
      id: this.nextEntityId++, type: 'arrow', x: sx, y: sy, z: sz, halfW: 0.05, height: 0.1,
      vx: ((tx - sx) / (dist || 1)) * speed + (this.random() - 0.5) * 1.2,
      vy: (ty - sy) / (t || 1) + 0.5 * 20 * t + (this.random() - 0.5) * 1.2, // aim up to make up for gravity
      vz: ((tz - sz) / (dist || 1)) * speed + (this.random() - 0.5) * 1.2,
      yaw: Math.atan2(-(tx - sx), -(tz - sz)), age: 0, shooter: from.id, cause: `was shot by ${MOB_NAMES[from.type] || 'a Skeleton'}`,
    };
    this.addEntity(a);
  }

  // A player let go of a drawn bow. power 0-1 (Minecraft: full draw after a second).
  onShoot(p, msg) {
    if (p.dead || !isNum(msg.power) || !isNum(msg.yaw) || !isNum(msg.pitch)) return;
    const power = Math.max(0, Math.min(1, msg.power));
    if (power < 0.1) return;
    const speed = power * 50;
    const dir = [-Math.sin(msg.yaw) * Math.cos(msg.pitch), Math.sin(msg.pitch), -Math.cos(msg.yaw) * Math.cos(msg.pitch)];
    const a = {
      id: this.nextEntityId++, type: 'arrow', x: p.x + dir[0] * 0.5, y: p.y + 1.5 + dir[1] * 0.5, z: p.z + dir[2] * 0.5, halfW: 0.05, height: 0.1,
      vx: dir[0] * speed, vy: dir[1] * speed, vz: dir[2] * speed, yaw: msg.yaw, age: 0,
      player: p.name, damage: Math.ceil(power * 6) + (power >= 1 ? Math.floor(this.random() * 4) : 0), // a full draw can crit
    };
    this.addEntity(a);
  }

  tickArrow(a, dt) {
    a.age += dt;
    if (a.age > 5) { this.entities.delete(a.id); return; }
    const steps = Math.max(1, Math.ceil(Math.hypot(a.vx, a.vy, a.vz) * dt / 0.25));
    for (let i = 0; i < steps; i++) {
      a.vy -= 20 * dt / steps;
      a.x += a.vx * dt / steps; a.y += a.vy * dt / steps; a.z += a.vz * dt / steps;
      if (a.player) {
        // a player's arrow hits mobs (not other players)
        for (const e of this.entities.values()) {
          if (!isMob(e) || e.id === a.id || e.dim !== this.ctx) continue;
          const t = MOB_TYPES[e.type];
          if (Math.abs(a.x - e.x) < t.halfW + 0.1 && Math.abs(a.z - e.z) < t.halfW + 0.1 && a.y > e.y && a.y < e.y + t.height) {
            this.hurtMob(e, a.damage, a.vx, a.vz, a.player);
            this.entities.delete(a.id);
            return;
          }
        }
      } else {
        for (const p of this.here()) {
          if (p.mode !== 'survival' || p.dead) continue;
          if (Math.abs(a.x - p.x) < 0.45 && Math.abs(a.z - p.z) < 0.45 && a.y > p.y && a.y < p.y + 1.85) {
            this.send(p.peerId, { t: 'hurt', amount: ARROW_DAMAGE, from: [a.x - a.vx, a.z - a.vz], cause: a.cause || 'was shot by a Skeleton' });
            this.entities.delete(a.id);
            return;
          }
        }
      }
      if (BLOCKS[this.world.getBlock(Math.floor(a.x), Math.floor(a.y), Math.floor(a.z))].solid) {
        // stuck in a block: leave an arrow you can pick up
        this.entities.delete(a.id);
        if (this.random() < 0.5) {
          const item = this.spawnItem(a.x - a.vx * 0.02, a.y + 0.2, a.z - a.vz * 0.02, ITEM.ARROW, 1, undefined, [0, 0, 0]);
          item.age = PICKUP_DELAY;
        }
        return;
      }
    }
  }

  // ---------- chat & commands ----------
  onChat(peerId, p, msg) {
    if (typeof msg.msg !== 'string') return;
    const text = msg.msg.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200);
    if (!text) return;
    if (!p.canChat()) return this.send(peerId, { t: 'sys', msg: 'You are sending messages too fast.' });
    if (text.startsWith('/')) return this.command(peerId, p, text);
    this.onLog(`<${p.name}> ${text}`);
    this.broadcast({ t: 'chat', from: p.name, msg: text });
  }

  command(peerId, p, text) {
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    const reply = (m) => this.send(peerId, { t: 'sys', msg: m });
    const allowed = p.isHost || this.save.cheats;
    const findPlayer = (name) => [...this.players.values()].find((q) => q.name.toLowerCase() === String(name).toLowerCase());
    switch (cmd.toLowerCase()) {
      case 'help':
        return reply('Commands: /list, /seed, /spawn, /gamemode survival|creative [player], /time set day|night, /tp <player>, /kill');
      case 'list':
        return reply(`Online (${this.players.size}): ${[...this.players.values()].map((q) => q.name).join(', ')}`);
      case 'seed':
        return reply(`Seed: ${this.save.seed}`);
      case 'spawn':
        if (p.dim !== 'overworld') return this.changeDim(p, 'overworld', this.save.spawn);
        return this.send(peerId, { t: 'teleport', p: this.save.spawn });
      case 'kill':
        return this.send(peerId, { t: 'hurt', amount: 1000, cause: 'died' });
      case 'gamemode': case 'gm': {
        if (!allowed) return reply('Only the host can change game modes in this world.');
        const mode = { survival: 'survival', s: 'survival', 0: 'survival', creative: 'creative', c: 'creative', 1: 'creative' }[String(args[0]).toLowerCase()];
        if (!mode) return reply('Usage: /gamemode survival|creative [player]');
        const target = args[1] ? findPlayer(args.slice(1).join(' ')) : p;
        if (!target) return reply('No player called ' + args.slice(1).join(' '));
        target.mode = mode;
        this.send(target.peerId, { t: 'mode', mode });
        return this.sys(`${target.name} is now in ${mode} mode`);
      }
      case 'time': {
        if (!allowed) return reply('Only the host can change the time in this world.');
        const values = { day: 1000, noon: 6000, sunset: 12000, night: 14000, midnight: 18000 };
        const v = args[0] === 'set' ? values[args[1]] ?? Number(args[1]) : NaN;
        if (!Number.isFinite(v)) return reply('Usage: /time set day|noon|sunset|night|midnight');
        this.time = v;
        this.broadcast({ t: 'time', time: this.time });
        return this.sys(`Time set to ${args[1]}`);
      }
      case 'tp': {
        if (!allowed) return reply('Only the host can teleport in this world.');
        const target = findPlayer(args.join(' '));
        if (!target) return reply('Usage: /tp <player>');
        if (target.dim !== p.dim) return this.changeDim(p, target.dim, [target.x, target.y, target.z]);
        return this.send(peerId, { t: 'teleport', p: [target.x, target.y, target.z] });
      }
      default:
        return reply(`Unknown command /${cmd}. Try /help`);
    }
  }

  // What others see a player wearing.
  onEquip(p, msg) {
    if (!Array.isArray(msg.armor) || msg.armor.length !== 4) return;
    const ids = msg.armor.map((id, slot) => (armorOf(id)?.slot === slot ? id : 0));
    this.broadcast({ t: 'equip', id: p.id, armor: ids }, p.peerId);
  }

  onSave(p, msg) {
    if (Array.isArray(msg.inv) && msg.inv.length === 36 && msg.inv.every(validStack)) p.inv = msg.inv;
    if (isNum(msg.health)) p.health = Math.max(0, Math.min(20, msg.health));
    if (isNum(msg.food)) p.food = Math.max(0, Math.min(20, msg.food));
    if (isInt(msg.xp) && msg.xp >= 0 && msg.xp < 1e7) p.xp = msg.xp;
    if (validArmor(msg.armor)) p.armor = msg.armor;
    this.storePlayer(p);
  }

  // ---------- furnaces ----------
  furnaceAt(msg) {
    if (!this.validCoords(msg)) return null;
    const key = `${msg.x},${msg.y},${msg.z}`;
    if (this.world.getBlock(msg.x, msg.y, msg.z) !== BLOCK.FURNACE) return null;
    if (!this.furnaces.has(key)) this.furnaces.set(key, { slots: [null, null, null], burn: 0, burnMax: 0, progress: 0 });
    return [key, this.furnaces.get(key)];
  }

  furnaceState(key, f) {
    const [x, y, z] = key.split(',').map(Number);
    return { t: 'furnace', x, y, z, slots: f.slots, burn: f.burn, burnMax: f.burnMax, progress: f.progress / SMELT_SECONDS };
  }

  onFurnaceOpen(peerId, p, msg) {
    const found = this.furnaceAt(msg);
    if (!found || !this.inReach(p, msg.x, msg.y, msg.z)) return;
    const [key, f] = found;
    if (!this.furnaceViewers.has(key)) this.furnaceViewers.set(key, new Set());
    this.furnaceViewers.get(key).add(peerId);
    this.send(peerId, this.furnaceState(key, f));
  }

  onFurnaceClose(peerId, msg) {
    if (!this.validCoords(msg)) return;
    this.furnaceViewers.get(`${msg.x},${msg.y},${msg.z}`)?.delete(peerId);
  }

  onFurnaceClick(peerId, p, msg) {
    const found = this.furnaceAt(msg);
    const cursor = validStack(msg.cursor) ? msg.cursor : null;
    if (!found || !isInt(msg.slot) || msg.slot < 0 || msg.slot > 2 || !(msg.button === 0 || msg.button === 2)) {
      return this.send(peerId, { t: 'cursor', stack: cursor });
    }
    const [key, f] = found;
    let next;
    if (msg.slot === 2) {
      // output: take only
      const out = f.slots[2];
      if (out && (!cursor || (cursor.id === out.id && cursor.dur === undefined && cursor.count + out.count <= maxStack(out.id)))) {
        next = cursor ? { ...cursor, count: cursor.count + out.count } : out;
        f.slots[2] = null;
        // smelting experience is collected when the output is taken
        const xp = Math.floor(f.xp || 0) + (this.random() < (f.xp || 0) % 1 ? 1 : 0);
        f.xp = 0;
        if (xp > 0) this.spawnXP(p.x, p.y + 1, p.z, xp);
      } else {
        next = cursor;
      }
    } else {
      next = clickSlot(f.slots, msg.slot, cursor, msg.button);
    }
    this.dirty = true;
    this.send(peerId, { t: 'cursor', stack: next });
    this.notifyFurnace(key, f);
  }

  notifyFurnace(key, f) {
    const viewers = this.furnaceViewers.get(key);
    if (!viewers) return;
    const state = this.furnaceState(key, f);
    for (const peerId of viewers) this.send(peerId, state);
  }

  tickFurnaces(dt) {
    for (const [key, f] of this.furnaces) {
      const [input, fuel, output] = f.slots;
      const result = input ? SMELTING[input.id] : undefined;
      const canSmelt = result !== undefined && (!output || (output.id === result && output.count < maxStack(result)));
      const before = `${f.burn > 0}|${Math.floor(f.progress)}|${f.slots.map((s) => s && s.count).join()}`;
      if (f.burn <= 0 && canSmelt && fuel && FUEL[fuel.id]) {
        f.burn = f.burnMax = FUEL[fuel.id] * SMELT_SECONDS;
        fuel.count--;
        if (fuel.count <= 0) f.slots[1] = null;
      }
      if (f.burn > 0) {
        f.burn = Math.max(0, f.burn - dt);
        if (canSmelt) {
          f.progress += dt;
          if (f.progress >= SMELT_SECONDS) {
            f.progress = 0;
            input.count--;
            if (input.count <= 0) f.slots[0] = null;
            if (output) output.count++;
            else f.slots[2] = { id: result, count: 1 };
            f.xp = (f.xp || 0) + (SMELT_XP[result] ?? 0.1);
          }
        } else {
          f.progress = 0;
        }
      } else {
        f.progress = 0;
      }
      const after = `${f.burn > 0}|${Math.floor(f.progress)}|${f.slots.map((s) => s && s.count).join()}`;
      if (before !== after) {
        this.dirty = true;
        this.notifyFurnace(key, f);
      }
    }
  }

  // ---------- simulation ----------
  tick(dt) {
    this.time = (this.time + dt * TICKS_PER_SECOND) % DAY_TICKS;
    const crops = this.acc.spawn + dt >= 1;
    for (const dim of DIMENSIONS) {
      this.ctx = dim;
      this.tickFurnaces(dt);
      this.redstone.update(dt);
      if (crops) this.tickCrops(this.acc.spawn + dt);
    }
    this.tickEntities(dt);
    this.tickPortals(dt);
    this.ctx = 'overworld';
    this.tickSleep(dt);

    this.acc.spawn += dt;
    if (this.acc.spawn >= 1) {
      this.acc.spawn = 0;
      this.spawnMobs();
      this.mergeItems();
    }
    this.acc.state += dt;
    if (this.acc.state >= 0.1) {
      this.acc.state = 0;
      this.sendStates();
    }
    this.acc.time += dt;
    if (this.acc.time >= 5) {
      this.acc.time = 0;
      this.broadcast({ t: 'time', time: this.time });
    }
  }

  // Identical dropped items lying close together become one stack (like Minecraft),
  // which keeps the number of things sent to players down.
  mergeItems() {
    const items = [...this.entities.values()].filter((e) => e.type === 'item' && e.dur === undefined);
    // (items in different dimensions never merge)
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (!this.entities.has(a.id)) continue;
      const limit = maxStack(a.item);
      for (let j = i + 1; j < items.length && a.count < limit; j++) {
        const b = items[j];
        if (b.item !== a.item || b.dim !== a.dim || !this.entities.has(b.id)) continue;
        if (Math.abs(a.x - b.x) > 1.2 || Math.abs(a.y - b.y) > 0.8 || Math.abs(a.z - b.z) > 1.2) continue;
        const n = Math.min(limit - a.count, b.count);
        a.count += n;
        b.count -= n;
        a.age = Math.min(a.age, b.age); // the merged stack lasts as long as the newer one
        if (b.count <= 0) this.entities.delete(b.id);
      }
    }
  }

  // When everyone online is in bed for a moment, skip to morning.
  tickSleep(dt) {
    const players = [...this.players.values()].filter((p) => p.dim === 'overworld'); // like Minecraft, other dimensions don't count
    if (players.length && players.every((p) => p.sleeping)) {
      this.sleepTimer += dt;
      if (this.sleepTimer >= 2.5) {
        this.time = 0;
        this.sleepTimer = 0;
        for (const p of players) p.sleeping = false;
        this.broadcast({ t: 'time', time: this.time });
        this.broadcast({ t: 'wake' });
        this.sys('Good morning!');
      }
    } else {
      this.sleepTimer = 0;
    }
  }

  nearestPlayer(e, maxDist, survivalOnly = false) {
    let best = null, bestD = maxDist;
    for (const p of this.players.values()) {
      if (p.dim !== (e.dim ?? this.ctx)) continue;
      if (survivalOnly && (p.mode !== 'survival' || p.dead)) continue;
      const d = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z);
      if (d < bestD) { best = p; bestD = d; }
    }
    return best ? [best, bestD] : null;
  }

  tickEntities(dt) {
    const light = daylight(this.time);
    for (const e of [...this.entities.values()]) {
      if (!this.entities.has(e.id)) continue; // gone already (blown up this tick...)
      this.ctx = e.dim;
      e.age += dt;
      const near = this.nearestPlayer(e, 128);
      if (e.type === 'tnt') { this.tickTnt(e, dt); continue; } // lit TNT always goes off
      if (!near) {
        // nobody around: items keep ageing, mobs vanish
        if (e.type !== 'item' || e.age > ITEM_LIFETIME) this.entities.delete(e.id);
        continue;
      }
      // don't simulate in unloaded areas far from everyone
      if (near[1] > 96) continue;
      if (e.type === 'arrow') { this.tickArrow(e, dt); continue; }
      if (e.type === 'xp') { this.tickXP(e, dt); continue; }

      if (e.type === 'item') {
        if (e.age > ITEM_LIFETIME) { this.entities.delete(e.id); continue; }
        e.vy -= 20 * dt;
        const inside = this.world.getBlock(Math.floor(e.x), Math.floor(e.y + 0.1), Math.floor(e.z));
        if (inside === BLOCK.LAVA) { this.entities.delete(e.id); continue; } // items burn up
        if (inside === BLOCK.WATER) e.vy = Math.max(e.vy, 1);
        const res = moveBody(this.world, e, dt);
        if (res.onGround) { e.vx *= 0.5; e.vz *= 0.5; } else { e.vx *= 0.98; e.vz *= 0.98; }
        if (e.y < -20) this.entities.delete(e.id);
        continue;
      }

      const t = MOB_TYPES[e.type];
      e.attackCooldown = Math.max(0, e.attackCooldown - dt);
      e.panic = Math.max(0, e.panic - dt);
      e.think -= dt;
      let targetSpeed = 0;

      if (e.type === 'sheep' && e.sheared) {
        e.regrow -= dt;
        if (e.regrow <= 0) e.sheared = false;
      }

      // lava burns every mob
      if (this.world.getBlock(Math.floor(e.x), Math.floor(e.y + 0.2), Math.floor(e.z)) === BLOCK.LAVA) {
        e.lava = (e.lava || 0) + dt;
        if (e.lava > 0.5) { e.lava = 0; e.hp -= 4; this.broadcast({ t: 'mobhurt', e: e.id }); }
        if (e.hp <= 0) { this.killMob(e); continue; }
      }

      if (t.hostile) {
        // zombies and skeletons burn in sunlight when nothing is above them
        if (t.burns && this.world.hasSky && light > 0.6 && this.world.topBlockY(Math.floor(e.x), Math.floor(e.z)) < e.y) {
          e.burn = (e.burn || 0) + dt;
          if (e.burn > 1) { e.burn = 0; e.hp -= 2; this.broadcast({ t: 'mobhurt', e: e.id }); }
          if (e.hp <= 0) { this.killMob(e); continue; }
        }
        if (e.type === 'enderman') this.endermanMind(e, dt);
        const target = e.type === 'enderman' && !e.angry ? null : this.nearestPlayer(e, e.type === 'skeleton' || e.type === 'stray' ? 20 : e.type === 'enderman' ? 40 : 24, true);
        if (target) {
          const [p, dist] = target;
          e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z));
          if (e.type === 'creeper') {
            // creepers walk up to you, hiss, and explode unless you run away
            targetSpeed = dist > 2 ? t.speed : 0;
            if (dist < 3) e.fuse = (e.fuse || 0) + dt;
            else if (dist > 6) e.fuse = Math.max(0, (e.fuse || 0) - dt);
            if (e.fuse >= CREEPER_FUSE) {
              this.entities.delete(e.id);
              this.broadcast({ t: 'mobdeath', e: e.id });
              this.explode(e.x, e.y + 0.5, e.z, 3);
              continue;
            }
          } else if (e.type === 'skeleton' || e.type === 'stray') {
            // keep some distance and shoot
            targetSpeed = dist > 12 ? t.speed : dist < 6 ? -t.speed * 0.7 : 0;
            if (e.attackCooldown === 0 && dist < 16) {
              e.attackCooldown = 2 + this.random();
              this.shootArrow(e, p);
            }
          } else {
            targetSpeed = dist > 1.2 ? t.speed : 0;
            if (dist < 1.6 && Math.abs(p.y - e.y) < 1.8 && e.attackCooldown === 0) {
              e.attackCooldown = 1;
              this.send(p.peerId, { t: 'hurt', amount: t.damage, from: [e.x, e.z], cause: `was slain by ${MOB_NAMES[e.type] || 'a Zombie'}` });
            }
          }
        } else if (e.type === 'creeper' && e.fuse) {
          e.fuse = Math.max(0, e.fuse - dt);
        } else if (e.think <= 0) {
          e.think = 2 + this.random() * 4;
          e.walk = this.random() < 0.5 ? 1 : 0;
          e.yaw = this.random() * Math.PI * 2;
        } else {
          targetSpeed = e.walk ? t.speed * 0.4 : 0;
        }
      } else {
        if (e.think <= 0) {
          e.think = 2 + this.random() * 5;
          e.walk = this.random() < 0.6 ? 1 : 0;
          e.yaw = this.random() * Math.PI * 2;
        }
        if (e.panic > 0 && e.think > 1) { e.think = 0.6 + this.random() * 0.5; e.walk = 1; e.yaw = this.random() * Math.PI * 2; }
        targetSpeed = e.walk ? (e.panic > 0 ? t.speed * 2 : t.speed) : 0;
      }

      const ax = -Math.sin(e.yaw) * targetSpeed, az = -Math.cos(e.yaw) * targetSpeed;
      const k = Math.min(1, dt * (e.onGround ? 8 : 2));
      e.vx += (ax - e.vx) * k;
      e.vz += (az - e.vz) * k;
      const headIn = this.world.getBlock(Math.floor(e.x), Math.floor(e.y + e.height * 0.6), Math.floor(e.z));
      if (BLOCKS[headIn].liquid) e.vy = Math.min(e.vy + 25 * dt, 2);
      else e.vy = Math.max(-40, e.vy - 28 * dt);
      const res = moveBody(this.world, e, dt, 0.6);
      e.onGround = res.onGround;
      if (res.hitWall && targetSpeed !== 0) {
        if (e.type === 'spider') e.vy = 5;            // spiders climb walls
        else if (e.onGround) e.vy = 8.2;              // others hop up one block
      }
      if (e.y < -20) this.entities.delete(e.id);
    }
  }

  spawnMobs() {
    const light = daylight(this.time);
    for (const p of this.players.values()) {
      this.ctx = p.dim;
      const counts = { passive: 0, hostile: 0 };
      for (const e of this.entities.values()) {
        if (!isMob(e) || e.dim !== p.dim || Math.hypot(e.x - p.x, e.z - p.z) > 64) continue;
        if (MOB_TYPES[e.type].hostile) counts.hostile++; else counts.passive++;
      }
      if (p.dim !== 'overworld') { this.spawnOther(p, counts); continue; }
      // underground: monsters appear in total darkness, day or night
      if (counts.hostile < 8 && p.y < this.world.seaLevel + 10 && this.random() < 0.5) this.spawnInCave(p);
      const wantHostile = light < 0.3 && counts.hostile < 6;
      const wantPassive = counts.passive < 6 && this.random() < 0.3;
      if (!wantHostile && !wantPassive) continue;
      const angle = this.random() * Math.PI * 2;
      const dist = 24 + this.random() * 24;
      const x = Math.floor(p.x + Math.cos(angle) * dist);
      const z = Math.floor(p.z + Math.sin(angle) * dist);
      const y = this.world.topBlockY(x, z);
      if (y < 1 || y >= HEIGHT - 3) continue;
      const ground = this.world.getBlock(x, y, z);
      if (wantHostile && BLOCKS[ground].solid && !BLOCKS[ground].transparent) {
        this.spawnHostile(x, y + 1, z);
      } else if (wantPassive && ground === BLOCK.GRASS) {
        const type = PASSIVE[Math.floor(this.random() * PASSIVE.length)];
        const herd = 2 + Math.floor(this.random() * 3);
        for (let i = 0; i < herd; i++) {
          const e = this.spawnMob(type, x + 0.5 + (this.random() - 0.5) * 3, y + 1, z + 0.5 + (this.random() - 0.5) * 3);
          if (collides(this.world, e)) this.entities.delete(e.id);
        }
      }
    }
  }

  // A random monster, with the biome's variant: husks in deserts, strays in the snow.
  spawnHostile(x, y, z) {
    let roll = this.random(), type = 'zombie';
    for (const [kind, chance] of HOSTILE) { if (roll < chance) { type = kind; break; } roll -= chance; }
    const biome = this.world.biomeAt(x, z);
    if (type === 'zombie' && DESERT_BIOMES.has(biome) && y > this.world.seaLevel) type = 'husk';
    if (type === 'skeleton' && FROZEN.has(biome) && y > this.world.seaLevel) type = 'stray';
    const e = this.spawnMob(type, x + 0.5, y, z + 0.5);
    if (collides(this.world, e)) { this.entities.delete(e.id); return null; }
    return e;
  }

  // Tries one spot near the player underground: air with room to stand, on a solid
  // floor, with no light at all.
  spawnInCave(p) {
    const angle = this.random() * Math.PI * 2;
    const dist = 12 + this.random() * 20;
    const x = Math.floor(p.x + Math.cos(angle) * dist);
    const z = Math.floor(p.z + Math.sin(angle) * dist);
    const y0 = Math.floor(p.y) + Math.floor(this.random() * 24) - 16;
    for (let y = y0; y < y0 + 8; y++) {
      if (y < 2 || y >= HEIGHT - 3) continue;
      const floor = this.world.getBlock(x, y - 1, z);
      if (!BLOCKS[floor].solid || BLOCKS[floor].transparent) continue;
      if (this.world.getBlock(x, y, z) !== BLOCK.AIR || this.world.getBlock(x, y + 1, z) !== BLOCK.AIR) continue;
      const light = this.lightAt(x, y, z);
      if (light.sky > 0 || light.block > 0) return null;
      return this.spawnHostile(x, y, z);
    }
    return null;
  }

  // Sky and block light (0-15) at a block, computed per chunk and cached until blocks change.
  lightAt(x, y, z) {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    const key = cx + ',' + cz;
    this.lightCache ??= new Map();
    let light = this.lightCache.get(key);
    if (!light) {
      if (this.lightCache.size > 16) this.lightCache.delete(this.lightCache.keys().next().value);
      light = computeLight(gatherRegion(this.world, cx, cz), this.world.hasSky);
      this.lightCache.set(key, light);
    }
    const i = regionIndex(x - cx * 16, y, z - cz * 16);
    return { sky: light.sky[i], block: light.block[i] };
  }

  // Endermen are calm until hit or stared at, then chase you, and teleport when hurt.
  endermanMind(e, dt) {
    if (!e.angry) {
      for (const p of this.here()) {
        if (p.dead || p.mode !== 'survival') continue;
        const ex = e.x - p.x, ey = e.y + 2.55 - (p.y + 1.62), ez = e.z - p.z;
        const dist = Math.hypot(ex, ey, ez);
        if (dist > 64 || dist < 0.5) continue;
        const lx = -Math.sin(p.yaw) * Math.cos(p.pitch), ly = Math.sin(p.pitch), lz = -Math.cos(p.yaw) * Math.cos(p.pitch);
        const dot = (lx * ex + ly * ey + lz * ez) / dist;
        if (dot > 1 - 0.025 / dist && this.canSee(p.x, p.y + 1.62, p.z, e.x, e.y + 2.55, e.z)) {
          e.angry = true;
          e.angryAt = p.name;
          this.broadcast({ t: 'mobhurt', e: e.id }); // a scream (the client plays a sound)
        }
      }
    }
    if (e.angryAt && !e.angry) e.angry = true;
    // now and then an angry enderman teleports closer
    e.teleportTimer = (e.teleportTimer || 0) - dt;
    if (e.angry && e.teleportTimer <= 0) {
      e.teleportTimer = 4 + this.random() * 4;
      const target = this.nearestPlayer(e, 64, true);
      if (target && target[1] > 10) this.teleportMob(e, target[0].x, target[0].z, 6);
    }
  }

  canSee(x0, y0, z0, x1, y1, z1) {
    const d = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    for (let t = 0.5; t < d; t += 0.5) {
      const f = t / d;
      const id = this.world.getBlock(Math.floor(x0 + (x1 - x0) * f), Math.floor(y0 + (y1 - y0) * f), Math.floor(z0 + (z1 - z0) * f));
      if (BLOCKS[id].solid && !BLOCKS[id].transparent) return false;
    }
    return true;
  }

  // Jumps a mob to a random standing spot within `range` blocks of (x, z).
  teleportMob(e, x, z, range) {
    for (let tries = 0; tries < 16; tries++) {
      const tx = Math.floor(x + (this.random() - 0.5) * 2 * range), tz = Math.floor(z + (this.random() - 0.5) * 2 * range);
      for (let y = Math.floor(e.y) + 8; y > Math.floor(e.y) - 8; y--) {
        const floor = this.world.getBlock(tx, y - 1, tz);
        if (!BLOCKS[floor].solid || BLOCKS[floor].liquid) continue;
        const spot = { ...e, x: tx + 0.5, y, z: tz + 0.5 };
        if (collides(this.world, spot) || BLOCKS[this.world.getBlock(tx, y, tz)].liquid) continue;
        e.x = spot.x; e.y = spot.y; e.z = spot.z; e.vx = e.vy = e.vz = 0;
        return true;
      }
    }
    return false;
  }

  onMobHurt(e) {
    if (e.type === 'enderman') { e.angry = true; this.teleportMob(e, e.x, e.z, 16); }
  }


  // ---------- portals & dimensions ----------
  // Fills an obsidian frame around the empty block (x, y, z) with portal, like fire does in Minecraft.
  lightPortal(x, y, z) {
    if (this.ctx === 'end') return false; // Nether portals don't work in the End
    for (const axis of [0, 1]) {
      const cells = this.portalFrame(x, y, z, axis);
      if (!cells) continue;
      this.buildingPortal = true;
      for (const [cx, cy, cz] of cells) this.setBlock(cx, cy, cz, BLOCK.NETHER_PORTAL + axis);
      this.buildingPortal = false;
      const low = cells.reduce((a, c) => (c[1] < a[1] || (c[1] === a[1] && c[0] + c[2] < a[0] + a[2]) ? c : a));
      this.addPortal(low, axis);
      return true;
    }
    return false;
  }

  // The empty blocks inside an obsidian frame, in the plane of `axis` (0: along x, 1: along z),
  // or null if (x, y, z) isn't inside one. Frames are 2-21 wide and 3-21 tall inside; corners don't matter.
  portalFrame(x, y, z, axis) {
    const ax = axis === 0 ? 1 : 0, az = 1 - ax;
    const seen = new Set([`${x},${y},${z}`]);
    const cells = [[x, y, z]];
    for (let i = 0; i < cells.length; i++) {
      const [cx, cy, cz] = cells[i];
      for (const [ox, oy, oz] of [[ax, 0, az], [-ax, 0, -az], [0, 1, 0], [0, -1, 0]]) {
        const nx = cx + ox, ny = cy + oy, nz = cz + oz;
        const k = `${nx},${ny},${nz}`;
        if (seen.has(k)) continue;
        const id = ny < 0 || ny >= HEIGHT ? -1 : this.world.getBlock(nx, ny, nz);
        if (id === BLOCK.OBSIDIAN) continue;
        if (id !== BLOCK.AIR) return null;
        seen.add(k);
        cells.push([nx, ny, nz]);
        if (cells.length > 21 * 21) return null;
      }
    }
    const along = cells.map((c) => c[0] * ax + c[2] * az), ys = cells.map((c) => c[1]);
    const w = Math.max(...along) - Math.min(...along) + 1, h = Math.max(...ys) - Math.min(...ys) + 1;
    if (w < 2 || w > 21 || h < 3 || h > 21 || cells.length !== w * h) return null;
    return cells;
  }

  addPortal([x, y, z], axis) {
    const dim = this.ctx;
    this.portals = this.portals.filter((q) => !(q[0] === dim && Math.abs(q[1] - x) <= 1 && Math.abs(q[2] - y) <= 1 && Math.abs(q[3] - z) <= 1));
    this.portals.push([dim, x, y, z, axis]);
    if (this.portals.length > 256) this.portals.shift();
  }

  // A portal block stays only while it's framed: portal or obsidian above, below and to both sides.
  // Breaking any part of a frame takes the whole portal down, one block after another.
  checkPortals(x, y, z) {
    if (this.buildingPortal) return;
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (ny < 0 || ny >= HEIGHT) continue;
      const id = this.world.getBlock(nx, ny, nz);
      if (BLOCKS[id].shape !== 'portal') continue;
      const ax = id === BLOCK.NETHER_PORTAL ? 1 : 0, az = 1 - ax;
      const framed = [[ax, 0, az], [-ax, 0, -az], [0, 1, 0], [0, -1, 0]].every(([ox, oy, oz]) => {
        const n = this.world.getBlock(nx + ox, ny + oy, nz + oz);
        return n === BLOCK.OBSIDIAN || n === id;
      });
      if (!framed) this.setBlock(nx, ny, nz, BLOCK.AIR);
    }
  }

  // Standing in a Nether portal for 4 seconds (at once in creative) takes you through;
  // an End portal takes you at once. After arriving you have to step out before it works again.
  tickPortals(dt) {
    for (const p of this.players.values()) {
      if (p.dead) continue;
      this.ctx = p.dim;
      const fx = Math.floor(p.x), fz = Math.floor(p.z);
      const feet = this.world.getBlock(fx, Math.floor(p.y + 0.1), fz), head = this.world.getBlock(fx, Math.floor(p.y + 1.2), fz);
      const nether = BLOCKS[feet].shape === 'portal' || BLOCKS[head].shape === 'portal';
      const end = feet === BLOCK.END_PORTAL || this.world.getBlock(fx, Math.floor(p.y - 0.3), fz) === BLOCK.END_PORTAL;
      if (!nether && !end) { p.portalTime = 0; p.portalLock = false; continue; }
      if (p.portalLock) continue;
      if (end) { this.throughEndPortal(p); continue; }
      p.portalTime = (p.portalTime || 0) + dt;
      if (p.portalTime >= (p.mode === 'creative' ? 0.05 : 4)) this.throughNetherPortal(p);
    }
  }

  throughNetherPortal(p) {
    const to = p.dim === 'nether' ? 'overworld' : 'nether';
    const scale = to === 'nether' ? 1 / 8 : 8;
    // heights match the shown y (the Overworld's internal y is shifted in tall worlds)
    const yOff = this.dims.overworld.world.yOffset;
    const ty = Math.floor(p.y) + (to === 'nether' ? -yOff : yOff);
    const tx = Math.floor(p.x * scale), tz = Math.floor(p.z * scale);
    const spot = this.inDim(to, () => this.findPortal(tx, ty, tz) || this.makePortal(tx, ty, tz));
    this.changeDim(p, to, spot);
  }

  throughEndPortal(p) {
    if (p.dim === 'end') return this.changeDim(p, 'overworld', this.homeOf(p));
    this.inDim('end', () => this.buildEndPlatform());
    this.changeDim(p, 'end', [END_PLATFORM[0] + 0.5, END_PLATFORM[1] + 1, END_PLATFORM[2] + 0.5]);
  }

  // Like Minecraft, the arrival platform is rebuilt every time someone comes in.
  buildEndPlatform() {
    const [px, py, pz] = END_PLATFORM;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      for (let dy = 0; dy <= 3; dy++) {
        const want = dy === 0 ? BLOCK.OBSIDIAN : BLOCK.AIR;
        if (this.world.getBlock(px + dx, py + dy, pz + dz) !== want) this.setBlock(px + dx, py + dy, pz + dz, want);
      }
    }
  }

  // Standing spot in the nearest known portal (within 16 blocks in the Nether, 128 in the Overworld).
  findPortal(tx, ty, tz) {
    const r = this.ctx === 'nether' ? 16 : 128;
    let best = null, bestD = Infinity;
    for (const q of [...this.portals]) {
      const [dim, x, y, z, axis] = q;
      if (dim !== this.ctx || Math.abs(x - tx) > r || Math.abs(z - tz) > r) continue;
      if (BLOCKS[this.world.getBlock(x, y, z)].shape !== 'portal') { this.portals.splice(this.portals.indexOf(q), 1); continue; }
      const d = Math.hypot(x - tx, (y - ty) * 0.5, z - tz);
      if (d < bestD) { bestD = d; best = [x, y, z, axis]; }
    }
    if (!best) return null;
    const [x, y, z] = best;
    // stand in the middle of the bottom row: find how far the portal goes along its axis
    const axis = this.world.getBlock(x, y, z) - BLOCK.NETHER_PORTAL;
    const ax = axis === 0 ? 1 : 0, az = 1 - ax;
    let lo = 0, hi = 0;
    while (lo > -21 && this.world.getBlock(x + (lo - 1) * ax, y, z + (lo - 1) * az) === BLOCK.NETHER_PORTAL + axis) lo--;
    while (hi < 21 && this.world.getBlock(x + (hi + 1) * ax, y, z + (hi + 1) * az) === BLOCK.NETHER_PORTAL + axis) hi++;
    const mid = (lo + hi + 1) / 2;
    return [x + (ax ? mid : 0.5), y, z + (az ? mid : 0.5)];
  }

  // Builds a new portal near (tx, ty, tz), on solid ground if there's room within 16 blocks,
  // otherwise floating on a little obsidian platform. Returns where to stand.
  makePortal(tx, ty, tz) {
    const nether = this.ctx === 'nether';
    const yMin = nether ? 6 : 2, yMax = nether ? 118 : HEIGHT - 8;
    const w = this.world;
    const air = (x, y, z) => w.getBlock(x, y, z) === BLOCK.AIR;
    const ground = (x, y, z) => {
      const id = w.getBlock(x, y, z), b = BLOCKS[id];
      return b.solid && b.render === 'cube' && !b.transparent && b.hardness !== Infinity && id !== BLOCK.CHEST && id !== BLOCK.FURNACE;
    };
    let best = null, bestD = Infinity;
    for (let dx = -16; dx <= 16; dx++) for (let dz = -16; dz <= 16; dz++) {
      const x = tx + dx, z = tz + dz;
      for (let y = yMax; y >= yMin; y--) {
        if (!air(x, y, z) || !ground(x, y - 1, z)) continue;
        const d = Math.hypot(dx, y - ty, dz);
        if (d >= bestD) continue;
        for (const axis of [0, 1]) {
          const ax = axis === 0 ? 1 : 0, az = 1 - ax;
          // like Minecraft: solid ground under the portal and on both sides of it, and room to stand
          let ok = true;
          for (let i = 0; ok && i <= 1; i++) for (const k of [-1, 0, 1]) ok = ground(x + i * ax + k * az, y - 1, z + i * az + k * ax);
          for (let i = -1; ok && i <= 2; i++) for (let j = 0; ok && j <= 3; j++) ok = air(x + i * ax, y + j, z + i * az);
          for (let i = 0; ok && i <= 1; i++) for (const k of [-1, 1]) for (let j = 0; ok && j <= 2; j++) ok = air(x + i * ax + k * az, y + j, z + i * az + k * ax);
          if (ok) { bestD = d; best = [x, y, z, axis]; break; }
        }
      }
    }
    // like Minecraft, a floating portal is at least at (shown) y 70
    const [x, y, z, axis] = best || [tx, Math.max(70 + (nether ? 0 : w.yOffset), Math.min(yMax - 4, ty)), tz, 0];
    const ax = axis === 0 ? 1 : 0, az = 1 - ax;
    this.buildingPortal = true;
    if (!best) {
      // floating: a 2 x 3 obsidian platform with air above it
      for (let i = 0; i <= 1; i++) for (const k of [-1, 0, 1]) {
        const bx = x + i * ax + k * az, bz = z + i * az + k * ax;
        this.setBlock(bx, y - 1, bz, BLOCK.OBSIDIAN);
        if (k) for (let j = 0; j <= 2; j++) this.setBlock(bx, y + j, bz, BLOCK.AIR);
      }
    }
    for (let i = -1; i <= 2; i++) for (let j = -1; j <= 3; j++) {
      const edge = i < 0 || i > 1 || j < 0 || j > 2;
      this.setBlock(x + i * ax, y + j, z + i * az, edge ? BLOCK.OBSIDIAN : BLOCK.NETHER_PORTAL + axis);
    }
    this.buildingPortal = false;
    this.addPortal([x, y, z], axis);
    return [x + (ax ? 1 : 0.5), y, z + (az ? 1 : 0.5)];
  }

  // Moves a player to another dimension: they get that dimension's world, and the
  // players on each side see them leave or arrive.
  changeDim(p, dim, pos) {
    const from = p.dim;
    this.closeViewers(p.peerId);
    p.sleeping = false;
    this.inDim(from, () => this.broadcastHere({ t: 'leave', id: p.id }, p.peerId));
    p.dim = dim;
    p.ds++;
    [p.x, p.y, p.z] = pos;
    p.portalLock = true;
    p.portalTime = 0;
    p.moved = true;
    p.sentEntities = true; // so the next entity list clears what they saw before
    this.inDim(dim, () => {
      this.send(p.peerId, {
        t: 'dimension', dim, ds: p.ds, edits: this.world.exportEdits(), pos,
        players: this.here().filter((q) => q !== p).map((q) => this.playerInfo(q)),
      });
      this.broadcastHere({ t: 'join', ...this.playerInfo(p) }, p.peerId);
    });
    this.storePlayer(p);
  }

  // Monsters of the Nether and the End (see spawnMobs).
  spawnOther(_p, _counts) {}

  sendStates() {
    const moved = {}; // dim -> moves
    for (const p of this.players.values()) {
      if (!p.moved) continue;
      p.moved = false;
      (moved[p.dim] ??= []).push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(2), +p.pitch.toFixed(2), p.held || 0]);
    }
    for (const p of this.players.values()) if (moved[p.dim]) this.send(p.peerId, { t: 'state', players: moved[p.dim] });

    for (const [peerId, p] of this.players) {
      const list = [];
      for (const e of this.entities.values()) {
        if (e.dim !== p.dim || Math.abs(e.x - p.x) > VIEW || Math.abs(e.z - p.z) > VIEW) continue;
        // flags: 1 = sheared sheep, 2 = creeper about to explode
        const flags = e.type === 'xp' ? e.value : e.type === 'tnt' ? (Math.floor(e.fuse * 4) % 2 ? 2 : 0) : (e.sheared ? 1 : 0) | (e.fuse > 0.2 ? 2 : 0);
        list.push([e.id, e.type === 'item' ? e.item : e.type, +e.x.toFixed(2), +e.y.toFixed(2), +e.z.toFixed(2), +e.yaw.toFixed(2), flags]);
      }
      // an empty list is still sent once, so the client removes what it was showing
      if (list.length || p.sentEntities) this.send(peerId, { t: 'entities', list });
      p.sentEntities = list.length > 0;
    }
  }

  // Everything needed to resume this world later.
  serialize() {
    for (const p of this.players.values()) this.storePlayer(p);
    const o = this.dims.overworld;
    this.save.edits = o.world.exportEdits();
    this.save.time = this.time;
    this.save.furnaces = Object.fromEntries(o.furnaces);
    this.save.chests = Object.fromEntries(o.chests);
    const dims = this.save.dims || {};
    for (const dim of DIMENSIONS) {
      if (dim === 'overworld') continue;
      const d = this.dims[dim];
      dims[dim] = { ...dims[dim], edits: d.world.exportEdits(), furnaces: Object.fromEntries(d.furnaces), chests: Object.fromEntries(d.chests) };
    }
    this.save.dims = dims;
    this.save.portals = this.portals;
    this.save.lastPlayed = Date.now();
    this.dirty = false;
    return this.save;
  }

  // Server-side chunk memory cap: terrain regenerates on demand, edits are kept.
  trimMemory() {
    // chunks are 64 KB each in tall worlds, so keep at most ~40 MB of terrain
    for (const dim of DIMENSIONS) {
      const world = this.dims[dim].world;
      if (world.chunks.size <= (dim === 'overworld' ? 600 : 200)) continue;
      const near = [...this.players.values()].filter((p) => p.dim === dim).map((p) => [Math.floor(p.x / 16), Math.floor(p.z / 16)]);
      for (const key of [...world.chunks.keys()]) {
        const [cx, cz] = key.split(',').map(Number);
        if (!near.some(([px, pz]) => Math.abs(cx - px) <= 8 && Math.abs(cz - pz) <= 8)) {
          world.chunks.delete(key);
          world.biomes.delete(key);
        }
      }
    }
  }
}
