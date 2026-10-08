// The game "server". It runs inside the host player's browser (and in tests),
// owns the authoritative world, and talks to every player, including the host
// themselves, through plain message objects.

import {
  BLOCK, BLOCKS, ITEM, HEIGHT, getDrops, isSupported, armorOf, isBlockId, isValidId, maxStack, toolOf,
  SMELTING, FUEL, SMELT_SECONDS,
} from './blocks.js';
import { World, LATEST_GEN } from './world.js';
import { moveBody, collides } from './physics.js';
import { clickSlot, quickMove } from './inventory.js';
import { levelOf, XP_SIZES, ORE_XP, SMELT_XP } from './xp.js';
import { BIOME, FROZEN } from './biomes.js';
import { gatherRegion, computeLight, regionIndex } from './lighting.js';

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
    this.world = new World(save.seed, this.gen);
    this.world.importEdits(save.edits || []);
    // growing crops (only ever planted by players, so they're all in the edits)
    this.crops = new Set();
    for (const [x, y, z, id] of this.world.exportEdits()) if (BLOCKS[id]?.crop) this.crops.add(`${x},${y},${z}`);
    this.players = new Map();   // peerId -> player
    this.entities = new Map();  // id -> entity
    this.nextPlayerId = 1;
    this.nextEntityId = 1;
    this.time = save.time ?? 1000;
    this.furnaces = new Map(Object.entries(save.furnaces || {}));
    this.furnaceViewers = new Map(); // key -> Set(peerId)
    this.chests = new Map(Object.entries(save.chests || {}));
    this.chestViewers = new Map();   // key -> Set(peerId)
    this.sleepTimer = 0;
    this.dirty = false;
    this.acc = { state: 0, spawn: 0, time: 0, furnace: 0 };
    this.onLog = options.onLog || (() => {});
  }

  // ---------- messaging ----------
  send(peerId, msg) {
    this.sendRaw(peerId, msg);
  }

  broadcast(msg, exceptPeer = null) {
    for (const peerId of this.players.keys()) if (peerId !== exceptPeer) this.sendRaw(peerId, msg);
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
    for (const viewers of this.furnaceViewers.values()) viewers.delete(peerId);
    for (const viewers of this.chestViewers.values()) viewers.delete(peerId);
    this.broadcast({ t: 'leave', id: p.id });
    this.sys(`${p.name} left the game`);
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
    const pos = saved?.pos ?? this.save.spawn;
    const p = {
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
    this.send(peerId, {
      t: 'welcome',
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
      players: [...this.players.values()].filter((q) => q !== p).map((q) => this.playerInfo(q)),
    });
    this.broadcast({ t: 'join', ...this.playerInfo(p) }, peerId);
    this.sys(`${name} joined the game`);
  }

  playerInfo(p) {
    return { id: p.id, name: p.name, p: [p.x, p.y, p.z], r: [p.yaw, p.pitch], armor: (p.armor || []).map((s) => s?.id ?? 0) };
  }

  onPos(p, msg) {
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
    if (this.lightCache) {
      const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.lightCache.delete((cx + dx) + ',' + (cz + dz));
    }
    this.dirty = true;
    this.broadcast({ t: 'set', x, y, z, id }, exceptPeer);
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
    for (const e of this.entities.values()) if (isMob(e) && box(e)) return true;
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
    this.entities.set(e.id, e);
    return e;
  }

  // Experience orbs, split into Minecraft's orb sizes.
  spawnXP(x, y, z, amount) {
    while (amount > 0) {
      const value = XP_SIZES.find((v) => v <= amount);
      amount -= value;
      this.entities.set(this.nextEntityId, {
        id: this.nextEntityId++, type: 'xp', value, x, y, z, halfW: 0.125, height: 0.25,
        vx: (this.random() - 0.5) * 2, vy: 2 + this.random() * 2, vz: (this.random() - 0.5) * 2, age: 0, yaw: 0,
      });
    }
  }

  tickXP(e, dt) {
    if (e.age > ITEM_LIFETIME) { this.entities.delete(e.id); return; }
    // fly towards the nearest living player within 8 blocks
    let best = null, bestD = 8;
    for (const p of this.players.values()) {
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
    this.entities.set(e.id, e);
    return e;
  }

  onPickup(peerId, p, msg) {
    const e = this.entities.get(msg.e);
    if (!e || e.type !== 'item' || e.age < (e.pickupAfter ?? PICKUP_DELAY)) return;
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
    if (!e || !isMob(e) || !p.canBuild()) return;
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
    p.bed = [msg.x, msg.y, msg.z];
    this.storePlayer(p);
    const t = this.time % DAY_TICKS;
    if (t < 12542 || t > 23460) {
      this.send(peerId, { t: 'sys', msg: 'Respawn point set. You can only sleep at night.' });
      return;
    }
    p.sleeping = true;
    this.send(peerId, { t: 'sleeping', at: [msg.x, msg.y, msg.z] });
    const sleepers = [...this.players.values()].filter((q) => q.sleeping).length;
    this.sys(`${p.name} is sleeping (${sleepers}/${this.players.size})`);
  }

  // Respawn at your bed if it's still there, otherwise at world spawn.
  onRespawn(peerId, p) {
    p.dead = false;
    let spot = this.save.spawn;
    if (p.bed) {
      const [bx, by, bz] = p.bed;
      if (this.world.getBlock(bx, by, bz) === BLOCK.BED) spot = [bx + 0.5, by + 1, bz + 0.5];
      else {
        p.bed = null;
        this.send(peerId, { t: 'sys', msg: 'Your bed was missing, so you respawned at the world spawn.' });
      }
    }
    this.send(peerId, { t: 'teleport', p: spot });
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
      const near = [...this.players.values()].some((p) => Math.abs(p.x - x) < 160 && Math.abs(p.z - z) < 160);
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
    if (!e || Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z) > 6) return;
    if (e.type === 'sheep' && msg.tool === ITEM.SHEARS && !e.sheared) {
      e.sheared = true;
      e.regrow = 60 + this.random() * 60;
      this.spawnItem(e.x, e.y + 1, e.z, BLOCK.WOOL, 1 + Math.floor(this.random() * 3));
    }
  }

  // ---------- explosions & arrows ----------
  explode(x, y, z, power) {
    this.broadcast({ t: 'boom', x, y, z });
    const r = Math.ceil(power);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      if (Math.hypot(dx, dy, dz) > power - this.random() * 0.8) continue;
      const bx = Math.floor(x) + dx, by = Math.floor(y) + dy, bz = Math.floor(z) + dz;
      if (by < 1 || by >= HEIGHT) continue;
      const id = this.world.getBlock(bx, by, bz);
      if (id === BLOCK.AIR || BLOCKS[id].liquid || id === BLOCK.BEDROCK || id === BLOCK.OBSIDIAN) continue;
      // like Minecraft, only some of the blown-up blocks drop (chests and furnaces always spill their contents)
      this.breakBlock(bx, by, bz, this.random() < 1 / power ? ITEM.DIAMOND_PICKAXE : null);
    }
    for (const p of this.players.values()) {
      const d = Math.hypot(p.x - x, p.y + 0.9 - y, p.z - z);
      if (d < power * 2) this.send(p.peerId, { t: 'hurt', amount: Math.round((1 - d / (power * 2)) * 22), from: [x, z], cause: 'was blown up by a Creeper' });
    }
    for (const e of this.entities.values()) {
      if (!isMob(e)) continue;
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
    this.entities.set(a.id, a);
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
    this.entities.set(a.id, a);
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
          if (!isMob(e) || e.id === a.id) continue;
          const t = MOB_TYPES[e.type];
          if (Math.abs(a.x - e.x) < t.halfW + 0.1 && Math.abs(a.z - e.z) < t.halfW + 0.1 && a.y > e.y && a.y < e.y + t.height) {
            this.hurtMob(e, a.damage, a.vx, a.vz, a.player);
            this.entities.delete(a.id);
            return;
          }
        }
      } else {
        for (const p of this.players.values()) {
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
    this.tickFurnaces(dt);
    this.tickEntities(dt);
    this.tickSleep(dt);

    this.acc.spawn += dt;
    if (this.acc.spawn >= 1) {
      this.tickCrops(this.acc.spawn);
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
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (!this.entities.has(a.id)) continue;
      const limit = maxStack(a.item);
      for (let j = i + 1; j < items.length && a.count < limit; j++) {
        const b = items[j];
        if (b.item !== a.item || !this.entities.has(b.id)) continue;
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
    const players = [...this.players.values()];
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
      if (survivalOnly && (p.mode !== 'survival' || p.dead)) continue;
      const d = Math.hypot(p.x - e.x, p.y - e.y, p.z - e.z);
      if (d < bestD) { best = p; bestD = d; }
    }
    return best ? [best, bestD] : null;
  }

  tickEntities(dt) {
    const light = daylight(this.time);
    for (const e of [...this.entities.values()]) {
      e.age += dt;
      const near = this.nearestPlayer(e, 128);
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
        if (t.burns && light > 0.6 && this.world.topBlockY(Math.floor(e.x), Math.floor(e.z)) < e.y) {
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
      const counts = { passive: 0, hostile: 0 };
      for (const e of this.entities.values()) {
        if (!isMob(e) || Math.hypot(e.x - p.x, e.z - p.z) > 64) continue;
        if (MOB_TYPES[e.type].hostile) counts.hostile++; else counts.passive++;
      }
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
      light = computeLight(gatherRegion(this.world, cx, cz));
      this.lightCache.set(key, light);
    }
    const i = regionIndex(x - cx * 16, y, z - cz * 16);
    return { sky: light.sky[i], block: light.block[i] };
  }

  // Endermen are calm until hit or stared at, then chase you, and teleport when hurt.
  endermanMind(e, dt) {
    if (!e.angry) {
      for (const p of this.players.values()) {
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


  sendStates() {
    const moved = [];
    for (const p of this.players.values()) {
      if (!p.moved) continue;
      p.moved = false;
      moved.push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(2), +p.pitch.toFixed(2), p.held || 0]);
    }
    if (moved.length) this.broadcast({ t: 'state', players: moved });

    for (const [peerId, p] of this.players) {
      const list = [];
      for (const e of this.entities.values()) {
        if (Math.abs(e.x - p.x) > VIEW || Math.abs(e.z - p.z) > VIEW) continue;
        // flags: 1 = sheared sheep, 2 = creeper about to explode
        const flags = e.type === 'xp' ? e.value : (e.sheared ? 1 : 0) | (e.fuse > 0.2 ? 2 : 0);
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
    this.save.edits = this.world.exportEdits();
    this.save.time = this.time;
    this.save.furnaces = Object.fromEntries(this.furnaces);
    this.save.chests = Object.fromEntries(this.chests);
    this.save.lastPlayed = Date.now();
    this.dirty = false;
    return this.save;
  }

  // Server-side chunk memory cap: terrain regenerates on demand, edits are kept.
  trimMemory() {
    // chunks are 64 KB each in tall worlds, so keep at most ~40 MB of terrain
    if (this.world.chunks.size <= 600) return;
    const near = [...this.players.values()].map((p) => [Math.floor(p.x / 16), Math.floor(p.z / 16)]);
    for (const key of [...this.world.chunks.keys()]) {
      const [cx, cz] = key.split(',').map(Number);
      if (!near.some(([px, pz]) => Math.abs(cx - px) <= 8 && Math.abs(cz - pz) <= 8)) {
        this.world.chunks.delete(key);
        this.world.biomes.delete(key);
      }
    }
  }
}
