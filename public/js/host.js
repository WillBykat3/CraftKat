// The game "server". It runs inside the host player's browser (and in tests),
// owns the authoritative world, and talks to every player, including the host
// themselves, through plain message objects.

import {
  BLOCK, BLOCKS, ITEM, HEIGHT, getDrops, isSupported, armorOf, supportOffset, FACING6, isBlockId, isValidId, maxStack, toolOf,
  SMELTING, FUEL, SMELT_SECONDS, fluidOf, isSource, isFurnace, isContainer, ITEMS, woolOf, maxDurability, isBed, otherBedHalf,
} from './blocks.js';
import { World, LATEST_GEN, DIMENSIONS } from './world.js';
import { moveBody, collides } from './physics.js';
import { clickSlot, quickMove } from './inventory.js';
import { levelOf, XP_SIZES, ORE_XP, SMELT_XP } from './xp.js';
import { BIOME, FROZEN } from './biomes.js';
import { gatherRegion, computeLight, regionIndex } from './lighting.js';
import { RedstoneSim } from './redstone-sim.js';
import { FluidSim, flowAt } from './fluids.js';
import { END_PLATFORM, EndTerrain, FOUNTAIN_Y } from './terrain-end.js';
import { portalCenter } from './stronghold.js';
import { PROFESSION_OF, offersFor, LEVEL_XP, PROFESSIONS } from './trades.js';
import { validEnch, level as enchLevel, rollEnchants, randomBook } from './enchant.js';
import { mobAI, BREED_FOOD, SLIME_SIZES } from './mob-ai.js';
import { hash2 } from './noise.js';
import { isRail, railInfo, railId, computeShape, railConnected, UPHILL } from './rails.js';
import { brewResult, validPotion, BREW_SECONDS, POTIONS, UNDEAD as POTION_UNDEAD, ATTACK_EFFECTS } from './effects.js';

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
  enderman: { hp: 40, halfW: 0.3, height: 2.9, speed: 3.2, hostile: true, damage: 7, neutral: true }, // calm until angered
  // the Nether
  zombified_piglin: { hp: 20, halfW: 0.3, height: 1.95, speed: 2.3, hostile: true, damage: 8, neutral: true, fireproof: true },
  ghast: { hp: 10, halfW: 2, height: 4, speed: 1.6, hostile: true, flies: true, fireproof: true },
  blaze: { hp: 20, halfW: 0.3, height: 1.8, speed: 1.8, hostile: true, flies: true, fireproof: true, damage: 6 },
  wither_skeleton: { hp: 20, halfW: 0.35, height: 2.4, speed: 2.4, hostile: true, damage: 8, fireproof: true },
  // more mobs (see mob-ai.js)
  slime: { hp: 16, halfW: 1.04, height: 2.08, speed: 1.2, hostile: true, custom: 'slimeTick' },
  magma_cube: { hp: 16, halfW: 1.04, height: 2.08, speed: 1.2, hostile: true, fireproof: true, custom: 'slimeTick' },
  witch: { hp: 26, halfW: 0.3, height: 1.95, speed: 1.6, hostile: true, ai: 'witchMind' },
  drowned: { hp: 20, halfW: 0.3, height: 1.95, speed: 2.0, hostile: true, burns: true, ai: 'drownedMind', swims: true, damage: 3 },
  phantom: { hp: 20, halfW: 0.45, height: 0.5, speed: 6, hostile: true, burns: true, custom: 'phantomTick' },
  wolf: { hp: 8, halfW: 0.3, height: 0.85, speed: 2.6, hostile: false, ai: 'wolfMind', damage: 4 },
  rabbit: { hp: 3, halfW: 0.2, height: 0.5, speed: 2.8, hostile: false },
  squid: { hp: 10, halfW: 0.4, height: 0.8, speed: 1.2, hostile: false, custom: 'squidTick', swims: true },
  bat: { hp: 6, halfW: 0.25, height: 0.9, speed: 3, hostile: false, custom: 'batTick' },
  piglin: { hp: 16, halfW: 0.3, height: 1.95, speed: 2.3, hostile: true, ai: 'piglinMind', damage: 5 },
  horse: { hp: 22, halfW: 0.7, height: 1.6, speed: 1.6, hostile: false, ai: 'horseMind' },
  // vehicles: hit them to break them (they drop themselves)
  boat: { hp: 4, halfW: 0.65, height: 0.56, speed: 0, hostile: false, vehicle: true, custom: 'vehicleTick' },
  minecart: { hp: 6, halfW: 0.49, height: 0.7, speed: 0, hostile: false, vehicle: true, custom: 'vehicleTick' },
  // villages
  villager: { hp: 20, halfW: 0.3, height: 1.95, speed: 1.4, hostile: false, villager: true },
  iron_golem: { hp: 100, halfW: 0.7, height: 2.7, speed: 1.5, hostile: false, golem: true },
  // the End
  ender_dragon: { hp: 200, halfW: 3.5, height: 3, speed: 14, hostile: true, boss: true, fireproof: true, damage: 10 },
  end_crystal: { hp: 1, halfW: 1, height: 2, speed: 0, hostile: false, still: true, fireproof: true },
};
const DRAGON_HOME = [0, FOUNTAIN_Y + 22, 0]; // the dragon circles around (and above) the exit fountain
const SOLID_IN_END = new Set([BLOCK.END_STONE, BLOCK.OBSIDIAN, BLOCK.BEDROCK, BLOCK.END_PORTAL, BLOCK.END_PORTAL_FRAME, BLOCK.END_PORTAL_FRAME + 1]);
const MOB_NAMES = {
  drowned: 'a Drowned', witch: 'a Witch', piglin: 'a Piglin', wolf: 'a Wolf',
  zombie: 'a Zombie', husk: 'a Husk', spider: 'a Spider', enderman: 'an Enderman', skeleton: 'a Skeleton', stray: 'a Stray',
  zombified_piglin: 'a Zombified Piglin', blaze: 'a Blaze', wither_skeleton: 'a Wither Skeleton',
};
const PASSIVE = ['pig', 'cow', 'sheep', 'chicken'];
const HORSE_BIOMES = new Set([BIOME.PLAINS, BIOME.SUNFLOWER_PLAINS, BIOME.SAVANNA, BIOME.MEADOW]);
const HOSTILE = [['zombie', 0.36], ['skeleton', 0.24], ['creeper', 0.19], ['spider', 0.14], ['enderman', 0.05], ['witch', 0.02]];
const RABBIT_BIOMES = new Set([BIOME.DESERT, BIOME.SNOWY_PLAINS, BIOME.SNOWY_TAIGA, BIOME.FLOWER_FOREST, BIOME.MEADOW, BIOME.CHERRY_GROVE]);
const WOLF_BIOMES = new Set([BIOME.FOREST, BIOME.TAIGA, BIOME.SNOWY_TAIGA]);
const WATER_BIOMES = new Set([BIOME.OCEAN, BIOME.DEEP_OCEAN, BIOME.WARM_OCEAN, BIOME.FROZEN_OCEAN, BIOME.RIVER, BIOME.FROZEN_RIVER]);
const DRY_BIOMES = new Set([BIOME.DESERT, BIOME.SAVANNA]); // it never rains (or snows) there
const REST_TICKS = 72000;
// what a horse eats: item -> [health, temper]
const HORSE_FOOD = { [ITEM.WHEAT]: [2, 3], [ITEM.SUGAR]: [1, 3], [ITEM.APPLE]: [3, 3], [ITEM.GOLDEN_CARROT]: [4, 5], [ITEM.GOLDEN_APPLE]: [10, 10], [BLOCK.HAY_BALE]: [20, 0] };
const SEAT = { boat: 0.15, horse: 1.05, pig: 0.55, minecart: 0.25 }; // where the rider sits, above the vehicle's feet // three in-game days awake before phantoms come
const DESERT_BIOMES = new Set([BIOME.DESERT]);
const CREEPER_FUSE = 1.5;            // seconds from hissing to boom
const ARROW_DAMAGE = 3;
const isMob = (e) => !!MOB_TYPES[e.type];
const UNDEAD = new Set(['zombie', 'husk', 'skeleton', 'stray', 'wither_skeleton', 'zombified_piglin']);
const ORE_INPUTS = new Set([ITEM.RAW_IRON, ITEM.RAW_GOLD, ITEM.RAW_COPPER, BLOCK.IRON_ORE, BLOCK.GOLD_ORE, BLOCK.COPPER_ORE,
  BLOCK.DEEPSLATE_IRON_ORE, BLOCK.DEEPSLATE_GOLD_ORE, BLOCK.DEEPSLATE_COPPER_ORE, BLOCK.NETHER_GOLD_ORE, BLOCK.NETHER_QUARTZ_ORE]);
// How readily a block catches fire and how fast it burns away ([catch, burn]), like Minecraft, or null.
const FLAMMABLE_CACHE = new Map();
function FLAMMABLE(id) {
  if (FLAMMABLE_CACHE.has(id)) return FLAMMABLE_CACHE.get(id);
  const n = BLOCKS[id]?.name || '';
  let f = null;
  if (id === BLOCK.TNT) f = [15, 100];
  else if (/Leaves|Wool/.test(n)) f = [30, 60];
  else if (/Planks|Oak Fence|Oak Slab|Oak Stairs/.test(n)) f = [5, 20];
  else if (/Log/.test(n)) f = [5, 5];
  else if (/Tall Grass|Fern|Dandelion|Poppy|Dead Bush|Cornflower|Tulip|Daisy|Allium|Orchid|Bluet/.test(n)) f = [60, 100];
  FLAMMABLE_CACHE.set(id, f);
  return f;
}
const STALE_AFTER_TRIP = new Set(['pos', 'set', 'dig', 'use', 'bucket', 'attack', 'interact', 'shoot', 'eye', 'sleep', 'pickup']);
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
    s.count > 0 && s.count <= maxStack(s.id) && (s.dur === undefined || (isInt(s.dur) && s.dur >= 0)) &&
    (s.ench === undefined || (validEnch(s.ench) && s.count === 1)) && (s.rc === undefined || (isInt(s.rc) && s.rc >= 0 && s.rc < 40)) &&
    (s.potion === undefined || (validPotion(s.potion) && (s.id === ITEM.POTION || s.id === ITEM.SPLASH_POTION))));
}
// the enchantments and anvil uses of a stack, to carry along (see inventory.js extras)
const extrasOf = (s) => (s && (s.ench || s.rc || s.potion)
  ? { ...(s.ench ? { ench: s.ench } : {}), ...(s.rc ? { rc: s.rc } : {}), ...(s.potion ? { potion: s.potion } : {}) } : undefined);

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
      for (const [x, y, z, id] of world.exportEdits()) if (BLOCKS[id]?.crop || BLOCKS[id]?.wart !== undefined) crops.add(`${x},${y},${z}`);
      this.dims[dim] = {
        world, crops, lightCache: null,
        furnaces: new Map(Object.entries(data.furnaces || {})), furnaceViewers: new Map(), // key -> Set(peerId)
        chests: new Map(Object.entries(data.chests || {})), chestViewers: new Map(),
        brewers: new Map(Object.entries(data.brewers || {})), brewViewers: new Map(),
      };
      this.dims[dim].redstone = new RedstoneSim(this, world);
      this.dims[dim].fluids = new FluidSim(this, world, dim);
      this.dims[dim].fires = new Set();
    }
    const end = saved.end || {};
    this.endState = { dragonKilled: !!end.dragonKilled, crystalsGone: Array.isArray(end.crystalsGone) ? end.crystalsGone.filter(isInt) : [] };
    this.villagesDone = new Set(Array.isArray(save.villagesDone) ? save.villagesDone : []);
    this.restoreEntities = Array.isArray(save.entities) ? save.entities : [];
    this.portals = Array.isArray(save.portals) ? save.portals.filter((q) => Array.isArray(q) && DIMENSIONS.includes(q[0])) : []; // [dim, x, y, z, axis]
    this.players = new Map();   // peerId -> player
    this.entities = new Map();  // id -> entity
    this.nextPlayerId = 1;
    this.nextEntityId = 1;
    this.time = save.time ?? 1000;
    // weather: clear, rain or thunder, each lasting a while (seconds), like Minecraft's
    this.weather = ['clear', 'rain', 'thunder'].includes(save.weather?.kind) && isNum(save.weather.time)
      ? { kind: save.weather.kind, time: save.weather.time } : { kind: 'clear', time: 600 + this.random() * 6000 };
    // villagers, golems (and later pets) are kept in the save, like Minecraft keeps them in chunks
    for (const saved of this.restoreEntities) {
      if (!saved || !MOB_TYPES[saved.type] || !DIMENSIONS.includes(saved.dim) || ![saved.x, saved.y, saved.z].every(isNum)) continue;
      const e = { ...saved, id: this.nextEntityId++, vx: 0, vy: 0, vz: 0, age: 0, think: 0, walk: 0, panic: 0, attackCooldown: 0, onGround: false, rider: null };
      this.entities.set(e.id, e);
    }
    this.sleepTimer = 0;
    this.dirty = false;
    this.acc = { state: 0, spawn: 0, time: 0, furnace: 0 };
    this.onLog = options.onLog || (() => {});
  }

  // ---------- dimensions ----------
  get world() { return this.dims[this.ctx].world; }
  get crops() { return this.dims[this.ctx].crops; }
  get redstone() { return this.dims[this.ctx].redstone; }
  get fluids() { return this.dims[this.ctx].fluids; }
  get fires() { return this.dims[this.ctx].fires; }
  get furnaces() { return this.dims[this.ctx].furnaces; }
  get furnaceViewers() { return this.dims[this.ctx].furnaceViewers; }
  get chests() { return this.dims[this.ctx].chests; }
  get chestViewers() { return this.dims[this.ctx].chestViewers; }
  get brewers() { return this.dims[this.ctx].brewers; }
  get brewViewers() { return this.dims[this.ctx].brewViewers; }
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
    if (msg.t === 'hurt' && msg.by) {
      // a mob hit a player: their tame wolves go for it
      const p = this.players.get(peerId);
      if (p) this.wolvesDefend(p.name, this.entities.get(msg.by));
    }
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
    this.dismount(p);
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
      for (const viewers of d.brewViewers.values()) viewers.delete(peerId);
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
      enchSeed: p.enchSeed ?? prev.enchSeed,
      offhand: p.offhand !== undefined ? p.offhand : prev.offhand ?? null,
      rest: p.rest ?? prev.rest ?? 0,
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
    // actions in the world sent before the player changed dimension are dropped
    if (msg.ds !== undefined && msg.ds !== p.ds && STALE_AFTER_TRIP.has(msg.t)) return;
    switch (msg.t) {
      case 'pos': return this.onPos(p, msg);
      case 'set': return this.onSet(peerId, p, msg);
      case 'dig': return this.onDig(peerId, p, msg);
      case 'pickup': return this.onPickup(peerId, p, msg);
      case 'drop': return this.onDrop(p, msg);
      case 'died': this.dismount(p); return this.onDied(p, msg);
      case 'mount': return this.onMount(p, msg);
      case 'dismount': return this.dismount(p);
      case 'place_vehicle': return this.onPlaceVehicle(p, msg);
      case 'respawn': return this.onRespawn(peerId, p);
      case 'attack': return this.onAttack(p, msg);
      case 'chat': return this.onChat(peerId, p, msg);
      case 'save': return this.onSave(p, msg);
      case 'equip': return this.onEquip(p, msg);
      case 'furnace_open': return this.onFurnaceOpen(peerId, p, msg);
      case 'furnace_close': return this.onFurnaceClose(peerId, msg);
      case 'furnace_click': return this.onFurnaceClick(peerId, p, msg);
      case 'brew_open': return this.onBrewOpen(peerId, p, msg);
      case 'brew_close': return this.validCoords(msg) && this.brewViewers.get(this.keyOf(msg))?.delete(peerId);
      case 'brew_click': return this.onBrewClick(peerId, p, msg);
      case 'throw': return this.onThrow(p, msg);
      case 'fish': return this.onFish(p, msg);
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
      case 'eye': return this.onEye(p);
      case 'trade': return this.onTrade(p, msg);
      case 'thorns': return this.onThorns(p, msg);
      case 'anvil_used': return this.onAnvilUsed(p, msg);
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
      enchSeed: saved?.enchSeed,
      offhand: saved?.offhand ?? null,
      rest: saved?.rest ?? 0, // ticks since last sleeping (or dying)
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
      weather: this.weather.kind,
      mode: p.mode,
      me: { pos: [p.x, p.y, p.z], rot: [p.yaw, p.pitch], inv: p.inv, health: p.health, food: p.food, bed: p.bed, xp: p.xp, armor: p.armor, enchSeed: p.enchSeed, offhand: p.offhand },
      players: this.here().filter((q) => q !== p).map((q) => this.playerInfo(q)),
    });
    this.broadcastHere({ t: 'join', ...this.playerInfo(p) }, peerId);
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
    p.invisible = msg.inv === 1;
    p.moved = true;
    const v = p.riding ? this.entities.get(p.riding) : null;
    if (v && Array.isArray(msg.v) && msg.v.length === 4 && msg.v.every(isNum) && Math.hypot(msg.v[0] - p.x, msg.v[2] - p.z) < 4) {
      [v.x, v.y, v.z, v.yaw] = msg.v;
      v.vx = v.vy = v.vz = 0;
    }
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
    if (BLOCKS[id].crop || BLOCKS[id].wart !== undefined) this.crops.add(key); else this.crops.delete(key);
    this.redstone?.changed(x, y, z, id);
    this.fluids?.changed(x, y, z);
    if (id === BLOCK.FIRE) this.fires.add(key); else this.fires?.delete(key);
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
    const head = BLOCKS[id].shape === 'bed2' && !BLOCKS[id].head ? otherBedHalf(id, x, y, z) : null;
    if (BLOCKS[id].shape === 'bed2' && (!head || !BLOCKS[this.world.getBlock(...head)].replaceable || !BLOCKS[this.world.getBlock(head[0], head[1] - 1, head[2])].solid)) return this.correct(peerId, x, y, z);
    if (!ok) return this.correct(peerId, x, y, z);
    this.setBlock(x, y, z, id, peerId);
    if (head) this.setBlock(head[0], head[1], head[2], id + 1, peerId);
    if (isRail(id)) this.shapeRails(x, y, z, p.yaw);
    if (isFurnace(id)) this.furnaces.set(`${x},${y},${z}`, { slots: [null, null, null], burn: 0, burnMax: 0, progress: 0 });
    if (isContainer(id)) this.chests.set(`${x},${y},${z}`, { slots: new Array(27).fill(null) });
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
    this.breakBlock(x, y, z, creative ? null : held, peerId, validEnch(msg.ench) ? msg.ench : null);
  }

  // Removes a block (dropping items unless tool === null) and handles what that causes.
  // ench: the tool's enchantments (Silk Touch, Fortune)
  breakBlock(x, y, z, tool, exceptPeer = null, ench = null) {
    const id = this.world.getBlock(x, y, z);
    let dropFrom = id;
    const half = otherBedHalf(id, x, y, z);
    if (half && isBed(this.world.getBlock(...half))) this.setBlock(half[0], half[1], half[2], BLOCK.AIR); // (only one bed drops)
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
    // ice broken with something under it melts into water (water next to a broken block flows in by itself)
    const flood = id === BLOCK.ICE && tool !== null && this.world.getBlock(x, y - 1, z) !== BLOCK.AIR;
    this.setBlock(x, y, z, flood ? BLOCK.WATER : BLOCK.AIR, exceptPeer);
    if (flood && exceptPeer) this.send(exceptPeer, { t: 'set', x, y, z, id: BLOCK.WATER });
    if (tool !== null) {
      const drops = getDrops(dropFrom, tool, this.random, ench);
      for (const [dropId, count] of drops) this.spawnItem(x + 0.5, y + 0.3, z + 0.5, dropId, count);
      if (BLOCKS[id].spawner) this.spawnXP(x + 0.5, y + 0.5, z + 0.5, 15 + Math.floor(this.random() * 29));
      const xp = ORE_XP[id];
      if (xp && drops.length && !(ench?.silk_touch && drops[0][0] === id)) this.spawnXP(x + 0.5, y + 0.5, z + 0.5, xp[0] + Math.floor(this.random() * (xp[1] - xp[0] + 1)));
    }
    if (isFurnace(id)) {
      const key = `${x},${y},${z}`;
      const f = this.furnaces.get(key);
      if (f) for (const s of f.slots) if (s) this.spawnItem(x + 0.5, y + 0.5, z + 0.5, s.id, s.count, s.dur, undefined, extrasOf(s));
      this.furnaces.delete(key);
      this.furnaceViewers.delete(key);
    }
    if (id === BLOCK.BREWING_STAND) {
      const key = `${x},${y},${z}`;
      const b = this.brewers.get(key);
      if (b) for (const s of b.slots) if (s) this.spawnItem(x + 0.5, y + 0.5, z + 0.5, s.id, s.count, s.dur, undefined, extrasOf(s));
      this.brewers.delete(key);
      this.brewViewers.delete(key);
    }
    if (isContainer(id)) {
      const key = `${x},${y},${z}`;
      const c = this.chests.get(key);
      if (c) for (const s of c.slots) if (s) this.spawnItem(x + 0.5, y + 0.5, z + 0.5, s.id, s.count, s.dur, undefined, extrasOf(s));
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
  // extra: {ench, rc} for enchanted items
  spawnItem(x, y, z, id, count = 1, dur, vel, extra) {
    const e = {
      id: this.nextEntityId++, type: 'item', item: id, count, dur, ...extra,
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
    if (t.custom === 'slimeTick') this.setSlimeSize(e, SLIME_SIZES[Math.floor(this.random() * SLIME_SIZES.length)]);
    if (type === 'horse') {
      // like Minecraft, each horse has its own speed, jump and health (averages of random rolls)
      const avg = () => (this.random() + this.random() + this.random()) / 3;
      Object.assign(e, { speed: 4.74 + avg() * 9.49, jump: 0.4 + avg() * 0.6, temper: 0, color: Math.floor(this.random() * 7) });
      e.hp = e.maxHp = 15 + Math.floor(avg() * 15);
    }
    if (type === 'sheep') {
      // like Minecraft: mostly white, some black, grey, light grey or brown, and very rarely pink
      const r = this.random();
      e.color = r < 0.8164 ? 0 : r < 0.8664 ? 15 : r < 0.9164 ? 7 : r < 0.9664 ? 8 : r < 0.9964 ? 12 : 6;
    }
    return this.addEntity(e);
  }

  onPickup(peerId, p, msg) {
    const e = this.entities.get(msg.e);
    if (!e || e.type !== 'item' || e.dim !== p.dim || e.age < (e.pickupAfter ?? PICKUP_DELAY)) return;
    if (Math.hypot(e.x - p.x, e.y - (p.y + 0.9), e.z - p.z) > 3) return;
    this.entities.delete(e.id);
    const give = { t: 'give', id: e.item, count: e.count, ...extrasOf(e) };
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
    ], extrasOf(s));
    e.pickupAfter = 1.5;
  }

  onDied(p, msg) {
    p.dead = true;
    if (Array.isArray(msg.items)) {
      for (const s of msg.items.slice(0, 40)) {
        if (validStack(s) && s) this.spawnItem(p.x, p.y + 0.5, p.z, s.id, s.count, s.dur, undefined, extrasOf(s));
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
    if (e && e.type === 'fireball' && e.dim === p.dim && Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z) < 6) {
      // hitting a ghast's fireball sends it back where you're looking
      const speed = Math.hypot(e.vx, e.vy, e.vz) * 1.2;
      e.vx = -Math.sin(p.yaw) * Math.cos(p.pitch) * speed;
      e.vy = Math.sin(p.pitch) * speed;
      e.vz = -Math.cos(p.yaw) * Math.cos(p.pitch) * speed;
      e.reflected = p.name;
      e.age = 0;
      return;
    }
    if (!e || !isMob(e) || e.dim !== p.dim || !p.canBuild()) return;
    if (Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z) > 6) return;
    const tool = toolOf(msg.tool);
    let damage = tool && tool.kind !== 'bow' ? (tool.kind === 'sword' ? tool.damage + 1 : tool.damage - 1) : 1;
    const ench = validEnch(msg.ench) ? msg.ench : {};
    // Sharpness, Smite (undead) and Bane of Arthropods (spiders), like Minecraft
    // Strength adds 3 per level, Weakness takes 4
    if (isInt(msg.str) && msg.str >= -2 && msg.str <= 2) damage = Math.max(0, damage + (msg.str > 0 ? 3 * msg.str : 4 * msg.str));
    if (ench.sharpness) damage += 0.5 * ench.sharpness + 0.5;
    if (ench.smite && UNDEAD.has(e.type)) damage += 2.5 * ench.smite;
    if (ench.bane_of_arthropods && e.type === 'spider') damage += 2.5 * ench.bane_of_arthropods;
    if (ench.fire_aspect && !MOB_TYPES[e.type].fireproof) e.fireTime = Math.max(e.fireTime || 0, 4 * ench.fire_aspect);
    e.looting = ench.looting || 0;
    this.wolvesDefend(p.name, e);
    this.hurtMob(e, damage, e.x - p.x, e.z - p.z, p.name, 1 + (ench.knockback || 0) * 0.8);
  }

  // Each use of an anvil has a 12% chance to damage it (anvil, chipped, damaged, gone).
  onAnvilUsed(p, msg) {
    if (!this.validCoords(msg) || !this.inReach(p, msg.x, msg.y, msg.z) || p.mode === 'creative') return;
    const id = this.world.getBlock(msg.x, msg.y, msg.z);
    if (id !== BLOCK.ANVIL && id !== BLOCK.CHIPPED_ANVIL && id !== BLOCK.DAMAGED_ANVIL) return;
    const broke = this.random() < 0.12;
    if (broke) this.setBlock(msg.x, msg.y, msg.z, id === BLOCK.DAMAGED_ANVIL ? BLOCK.AIR : id + 1);
    this.broadcastHere({ t: 'sfx', s: broke && id === BLOCK.DAMAGED_ANVIL ? 'anvilBreak' : 'anvil', x: msg.x, y: msg.y, z: msg.z });
  }

  // Thorns on a player's armor hurt the mob that hit them (the client rolls the chance).
  onThorns(p, msg) {
    const e = this.entities.get(msg.e);
    if (!e || !isMob(e) || e.dim !== p.dim || !isInt(msg.amount) || msg.amount < 1 || msg.amount > 4) return;
    if (Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z) > 5) return;
    this.hurtMob(e, msg.amount, e.x - p.x, e.z - p.z, null);
  }

  // Damage with knockback away from (dx, dz); by: the player's name (angers neutral mobs).
  hurtMob(e, damage, dx, dz, by, knock = 1) {
    if (MOB_TYPES[e.type].boss) return this.hurtDragon(e, damage, by);
    e.hp -= damage;
    const len = Math.hypot(dx, dz) || 1;
    e.vx = (dx / len) * 6 * knock;
    e.vz = (dz / len) * 6 * knock;
    e.vy = 4;
    e.panic = 4;
    e.hurtUntil = this.now() + 400;
    if (by) e.angryAt = by;
    this.broadcast({ t: 'mobhurt', e: e.id });
    if (e.hp <= 0) this.killMob(e);
    else this.onMobHurt(e);
  }

  killMob(e) {
    if (e.type === 'ender_dragon') return this.dragonDied(e);
    if (e.type === 'end_crystal') return this.crystalBroken(e);
    this.entities.delete(e.id);
    if (e.type === 'slime' || e.type === 'magma_cube') this.splitSlime(e);
    if (e.baby > 0) { this.broadcastHere({ t: 'mobdeath', e: e.id }); return; } // babies drop nothing
    const r = this.random;
    const drops = {
      pig: [[ITEM.RAW_PORKCHOP, 1 + Math.floor(r() * 3)]],
      cow: [[ITEM.RAW_BEEF, 1 + Math.floor(r() * 3)], [ITEM.LEATHER, Math.floor(r() * 3)]],
      sheep: [[ITEM.RAW_MUTTON, 1 + Math.floor(r() * 2)], [woolOf(e.color || 0), e.sheared ? 0 : 1]],
      chicken: [[ITEM.RAW_CHICKEN, 1], [ITEM.FEATHER, Math.floor(r() * 3)]],
      zombie: [[ITEM.ROTTEN_FLESH, Math.floor(r() * 3)], [r() < 0.5 ? ITEM.CARROT : ITEM.POTATO, r() < 0.05 ? 1 : 0]],
      skeleton: [[ITEM.BONE, Math.floor(r() * 3)], [ITEM.ARROW, Math.floor(r() * 3)]],
      spider: [[ITEM.STRING, Math.floor(r() * 3)], [ITEM.SPIDER_EYE, r() < 1 / 3 ? 1 : 0]],
      creeper: [[ITEM.GUNPOWDER, Math.floor(r() * 3)]],
      husk: [[ITEM.ROTTEN_FLESH, Math.floor(r() * 3)]],
      stray: [[ITEM.BONE, Math.floor(r() * 3)], [ITEM.ARROW, Math.floor(r() * 3)]],
      enderman: [[ITEM.ENDER_PEARL, Math.floor(r() * 2)]],
      slime: [[ITEM.SLIMEBALL, e.size === 1 ? Math.floor(r() * 3) : 0]],
      magma_cube: [[ITEM.MAGMA_CREAM, e.size > 1 && r() < 0.25 ? 1 : 0]],
      witch: Array.from({ length: 1 + Math.floor(r() * 3) }, () => [[ITEM.GLASS_BOTTLE, ITEM.GLOWSTONE_DUST, ITEM.GUNPOWDER, ITEM.REDSTONE, ITEM.SPIDER_EYE, ITEM.SUGAR, ITEM.STICK][Math.floor(r() * 7)], 1 + Math.floor(r() * 2)]),
      drowned: [[ITEM.ROTTEN_FLESH, Math.floor(r() * 3)], [ITEM.COPPER_INGOT, r() < 0.11 ? 1 : 0]],
      phantom: [[ITEM.PHANTOM_MEMBRANE, Math.floor(r() * 2)]],
      rabbit: [[ITEM.RAW_RABBIT, Math.floor(r() * 2)], [ITEM.RABBIT_HIDE, Math.floor(r() * 2)], [ITEM.RABBIT_FOOT, r() < 0.1 ? 1 : 0]],
      squid: [[ITEM.INK_SAC, 1 + Math.floor(r() * 3)]],
      boat: [[ITEM.BOAT, 1]],
      minecart: [[ITEM.MINECART, 1]],
      horse: [[ITEM.LEATHER, Math.floor(r() * 3)], [ITEM.SADDLE, e.saddled ? 1 : 0]],
      iron_golem: [[ITEM.IRON_INGOT, 3 + Math.floor(r() * 3)], [BLOCK.POPPY, Math.floor(r() * 3)]],
      villager: [],
      zombified_piglin: [[ITEM.ROTTEN_FLESH, Math.floor(r() * 2)], [ITEM.GOLD_NUGGET, Math.floor(r() * 2)], [ITEM.GOLD_INGOT, r() < 0.025 ? 1 : 0]],
      ghast: [[ITEM.GHAST_TEAR, Math.floor(r() * 2)], [ITEM.GUNPOWDER, Math.floor(r() * 3)]],
      blaze: [[ITEM.BLAZE_ROD, Math.floor(r() * 2)]],
      wither_skeleton: [[ITEM.COAL, r() < 1 / 3 ? 1 : 0], [ITEM.BONE, Math.floor(r() * 3)]],
    }[e.type] || [];
    // Looting: up to one more of each drop per level
    for (const [id, n] of drops) {
      const extra = e.looting && n >= 0 && id !== BLOCK.WOOL ? Math.floor(this.random() * (e.looting + 1)) : 0;
      if (n + extra > 0) this.spawnItem(e.x, e.y + 0.5, e.z, id, n + extra);
    }
    if (e.type !== 'villager' && e.type !== 'iron_golem' && !MOB_TYPES[e.type].vehicle) this.spawnXP(e.x, e.y + 0.5, e.z, e.type === 'blaze' ? 10 : MOB_TYPES[e.type].hostile ? 5 : 1 + Math.floor(r() * 3));
    if (e.type === 'villager') this.sys(`Villager died${e.angryAt ? ` (killed by ${e.angryAt})` : ''}`);
    this.broadcast({ t: 'mobdeath', e: e.id });
  }

  // ---------- chests ----------
  keyOf(msg) {
    return `${msg.x},${msg.y},${msg.z}`;
  }

  chestAt(p, msg) {
    if (!this.validCoords(msg) || !isContainer(this.world.getBlock(msg.x, msg.y, msg.z))) return null;
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
    const msg = { t: 'give', id: s.id, count: s.count, ...extrasOf(s) };
    if (s.dur !== undefined) msg.dur = s.dur;
    this.send(peerId, msg);
  }

  // ---------- beds ----------
  onSleep(peerId, p, msg) {
    if (!this.validCoords(msg) || !isBed(this.world.getBlock(msg.x, msg.y, msg.z)) || !this.inReach(p, msg.x, msg.y, msg.z)) return;
    if (!this.world.hasSky) {
      // beds blow up in the Nether and the End
      this.setBlock(msg.x, msg.y, msg.z, BLOCK.AIR);
      this.explode(msg.x + 0.5, msg.y + 0.5, msg.z + 0.5, 5, 'was killed by [Intentional Game Design]', true);
      return;
    }
    p.bed = [msg.x, msg.y, msg.z];
    this.storePlayer(p);
    const t = this.time % DAY_TICKS;
    if ((t < 12542 || t > 23460) && this.weather.kind !== 'thunder') {
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
    p.rest = 0;
    const spot = this.homeOf(p, true);
    if (p.dim !== 'overworld') this.changeDim(p, 'overworld', spot);
    else this.send(peerId, { t: 'teleport', p: spot });
  }

  // Where a player respawns: their bed (in the Overworld) if it's still there, else world spawn.
  homeOf(p, tell = false) {
    if (p.bed) {
      const [bx, by, bz] = p.bed;
      if (isBed(this.dims.overworld.world.getBlock(bx, by, bz))) return [bx + 0.5, by + 1, bz + 0.5];
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
      // only a source block fills a bucket (with water or lava)
      if (!isSource(current)) return this.correct(peerId, x, y, z);
      this.setBlock(x, y, z, BLOCK.AIR, peerId);
    } else {
      const kind = msg.lava ? 'lava' : 'water';
      if (!BLOCKS[current].replaceable || current === (msg.lava ? BLOCK.LAVA : BLOCK.WATER) || y < 1) return this.correct(peerId, x, y, z);
      if (kind === 'water' && this.ctx === 'nether') return this.correct(peerId, x, y, z); // water boils away in the Nether
      // water poured on lava hardens it (the fluid simulation does the same for water next to lava)
      if (kind === 'water' && fluidOf(current) === 'lava') return this.setBlock(x, y, z, isSource(current) ? BLOCK.OBSIDIAN : BLOCK.COBBLE);
      this.setBlock(x, y, z, msg.lava ? BLOCK.LAVA : BLOCK.WATER, peerId);
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
    if (msg.item === ITEM.EYE_OF_ENDER && id === BLOCK.END_PORTAL_FRAME) {
      // an eye in every frame around the 3 x 3 opens the portal
      this.setBlock(x, y, z, BLOCK.END_PORTAL_FRAME + 1);
      this.checkEndPortal(x, y, z);
      return;
    }
    if (msg.item === ITEM.FLINT_AND_STEEL) {
      // flint and steel lights the inside of an obsidian frame (there's no fire, so nothing else happens)
      const f = msg.face;
      if (Array.isArray(f) && f.length === 3 && f.every((v) => v === 0 || v === 1 || v === -1) && Math.abs(f[0]) + Math.abs(f[1]) + Math.abs(f[2]) === 1) {
        const ax = x + f[0], ay = y + f[1], az = z + f[2];
        if (this.world.getBlock(ax, ay, az) !== BLOCK.AIR || this.lightPortal(ax, ay, az)) return;
        this.setBlock(ax, ay, az, BLOCK.FIRE); // otherwise it starts a fire
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
      if (def.wart !== undefined) {
        // nether wart grows slowly, without water or light
        if (def.wart < 3 && this.random() < dt / 60) this.setBlock(x, y, z, id + 1);
        continue;
      }
      if (!def.crop) { this.crops.delete(key); continue; }
      if (def.crop.stage >= def.crop.max) continue;
      const stageTime = (def.crop.max === 7 ? 1 : 2) * (this.hydrated(x, y - 1, z) ? 40 : 90); // seconds per stage, on average
      if (this.random() < dt / stageTime) this.setBlock(x, y, z, id + 1);
    }
  }

  hydrated(x, y, z) {
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
      for (let dy = 0; dy <= 1; dy++) if (fluidOf(this.world.getBlock(x + dx, y + dy, z + dz)) === 'water') return true;
    }
    return false;
  }

  // ---------- using items on mobs ----------
  onInteract(p, msg) {
    const e = this.entities.get(msg.e);
    if (!e || e.dim !== p.dim || Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z) > 6) return;
    if (e.type === 'villager') {
      if (!e.offers?.length) return this.send(p.peerId, { t: 'sfx', s: 'villagerNo', x: e.x, y: e.y, z: e.z });
      e.trading = this.now() + 5000;
      return this.sendTrades(p, e);
    }
    if ((e.type === 'horse' && e.tamed || e.type === 'pig') && msg.tool === ITEM.SADDLE && !e.saddled && !(e.baby > 0)) {
      Object.assign(e, { saddled: true, persist: true });
      return this.send(p.peerId, { t: 'consume' });
    }
    if (e.type === 'horse' && HORSE_FOOD[msg.tool] && !(e.baby > 0 && msg.tool === ITEM.GOLDEN_CARROT && e.tamed)) {
      // feeding a horse heals it and makes a wild one trust you more (tame ones breed on golden food)
      const [heal, temper] = HORSE_FOOD[msg.tool];
      if (e.tamed && (msg.tool === ITEM.GOLDEN_CARROT || msg.tool === ITEM.GOLDEN_APPLE) && e.hp >= (e.maxHp || 22) && this.feedAnimal(p, e, msg.tool)) return this.send(p.peerId, { t: 'consume' });
      if (e.hp >= (e.maxHp || 22) && (e.tamed || e.temper >= 100)) return;
      e.hp = Math.min(e.maxHp || 22, e.hp + heal);
      if (!e.tamed) e.temper = Math.min(100, (e.temper || 0) + temper);
      return this.send(p.peerId, { t: 'consume' });
    }
    if ((BREED_FOOD[e.type] || e.type === 'wolf') && isValidId(msg.tool) && msg.tool !== ITEM.SHEARS && ITEMS[msg.tool]?.dye === undefined) {
      if (this.feedAnimal(p, e, msg.tool)) this.send(p.peerId, { t: 'consume' });
      return;
    }
    if (e.type === 'wolf' && e.tamed && e.owner === p.name) { e.sitting = !e.sitting; return; }
    if (e.type === 'sheep' && msg.tool === ITEM.SHEARS && !e.sheared) {
      e.sheared = true;
      e.regrow = 60 + this.random() * 60;
      this.spawnItem(e.x, e.y + 1, e.z, woolOf(e.color || 0), 1 + Math.floor(this.random() * 3));
    }
    // dyeing a sheep
    const dye = ITEMS[msg.tool]?.dye;
    if (e.type === 'sheep' && dye !== undefined && (e.color || 0) !== dye) {
      e.color = dye;
      this.send(p.peerId, { t: 'consume' });
    }
  }

  // ---------- explosions & arrows ----------
  // fire: ghast fireballs and beds leave fires behind
  explode(x, y, z, power, cause = 'was blown up by a Creeper', fire = false) {
    this.broadcastHere({ t: 'boom', x, y, z });
    const r = Math.ceil(power);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      if (Math.hypot(dx, dy, dz) > power - this.random() * 0.8) continue;
      const bx = Math.floor(x) + dx, by = Math.floor(y) + dy, bz = Math.floor(z) + dz;
      if (by < 1 || by >= HEIGHT) continue;
      const id = this.world.getBlock(bx, by, bz);
      // bedrock, obsidian, End portals and their frames survive (Nether portals don't, like Minecraft)
      if (id === BLOCK.AIR || BLOCKS[id].liquid || id === BLOCK.OBSIDIAN || (!Number.isFinite(BLOCKS[id].hardness) && BLOCKS[id].shape !== 'portal')) continue;
      if (id === BLOCK.TNT) { this.setBlock(bx, by, bz, BLOCK.AIR); this.primeTnt(bx, by, bz, 0.5 + this.random()); continue; } // chain reaction
      // like Minecraft, only some of the blown-up blocks drop (chests and furnaces always spill their contents)
      this.breakBlock(bx, by, bz, this.random() < 1 / power ? ITEM.DIAMOND_PICKAXE : null);
    }
    if (fire) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        const bx = Math.floor(x) + dx, by = Math.floor(y) + dy, bz = Math.floor(z) + dz;
        if (this.random() < 1 / 3 && this.world.getBlock(bx, by, bz) === BLOCK.AIR && BLOCKS[this.world.getBlock(bx, by - 1, bz)].solid) this.setBlock(bx, by, bz, BLOCK.FIRE);
      }
    }
    for (const p of this.here()) {
      const d = Math.hypot(p.x - x, p.y + 0.9 - y, p.z - z);
      if (d < power * 2) this.send(p.peerId, { t: 'hurt', amount: Math.round((1 - d / (power * 2)) * 22), from: [x, z], cause });
    }
    for (const e of [...this.entities.values()]) {
      if (!isMob(e) || e.dim !== this.ctx || !this.entities.has(e.id)) continue; // (a crystal's blast may have got it)
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
    // Power adds 25% per level (+25%), Punch knocks back further, Flame sets the target alight
    const ench = validEnch(msg.ench) ? msg.ench : {};
    if (ench.power) a.damage = Math.ceil(a.damage * (1 + 0.25 * (ench.power + 1)));
    a.punch = ench.punch || 0;
    a.flame = !!ench.flame;
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
          if (Math.abs(a.x - e.x) < e.halfW + 0.1 && Math.abs(a.z - e.z) < e.halfW + 0.1 && a.y > e.y && a.y < e.y + e.height) {
            if (a.flame && !MOB_TYPES[e.type].fireproof) e.fireTime = Math.max(e.fireTime || 0, 5);
            this.hurtMob(e, a.damage, a.vx, a.vz, a.player, 1 + (a.punch || 0));
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
        return reply('Commands: /list, /seed, /spawn, /gamemode survival|creative [player], /time set day|night, /weather clear|rain|thunder, /tp <player>, /locate stronghold, /kill');
      case 'list':
        return reply(`Online (${this.players.size}): ${[...this.players.values()].map((q) => q.name).join(', ')}`);
      case 'seed':
        return reply(`Seed: ${this.save.seed}`);
      case 'spawn':
        if (p.dim !== 'overworld') return this.changeDim(p, 'overworld', this.save.spawn);
        return this.send(peerId, { t: 'teleport', p: this.save.spawn });
      case 'locate': {
        if (!allowed) return reply('Only the host can use /locate in this world.');
        if (String(args[0]).toLowerCase().replace('minecraft:', '') !== 'stronghold') return reply('Usage: /locate stronghold');
        const c = p.dim === 'overworld' && this.nearestStronghold(p.x, p.z);
        if (!c) return reply(p.dim === 'overworld' ? 'This world has no strongholds (it was made before they existed).' : 'Strongholds are in the Overworld.');
        return reply(`The nearest stronghold is at ${c[0]}, ${c[1] - this.world.yOffset}, ${c[2]} (${Math.round(Math.hypot(c[0] - p.x, c[2] - p.z))} blocks away)`);
      }
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
      case 'weather': {
        if (!allowed) return reply('Only the host can change the weather in this world.');
        if (!['clear', 'rain', 'thunder'].includes(args[0])) return reply('Usage: /weather clear|rain|thunder');
        this.setWeather(args[0], Number(args[1]) > 0 ? Number(args[1]) : undefined);
        return this.sys(`Weather set to ${args[0]}`);
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
    if (isInt(msg.enchSeed)) p.enchSeed = msg.enchSeed;
    if (msg.offhand !== undefined && (msg.offhand === null || validStack(msg.offhand))) p.offhand = msg.offhand;
    this.storePlayer(p);
  }

  // ---------- riding ----------
  // Boats and minecarts take anyone; a horse takes anyone but bucks off riders it doesn't
  // trust yet; a pig needs a saddle. The rider's game moves the vehicle (see onPos).
  onMount(p, msg) {
    const e = this.entities.get(msg.e);
    if (!e || e.dim !== p.dim || p.dead || p.riding || e.rider || e.baby > 0) return;
    if (Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z) > 5) return;
    if (!(MOB_TYPES[e.type]?.vehicle || e.type === 'horse' || (e.type === 'pig' && e.saddled))) return;
    e.rider = p.id;
    e.persist = e.persist || e.type !== 'pig';
    p.riding = e.id;
    if (e.type === 'horse' && !e.tamed) e.buckAt = this.now() + 1500 + this.random() * 2500;
    this.send(p.peerId, { t: 'mounted', e: e.id, kind: e.type, x: e.x, y: e.y, z: e.z, yaw: e.yaw, seat: SEAT[e.type] ?? 0.5,
      speed: e.speed, jump: e.jump, tamed: !!e.tamed, saddled: !!e.saddled });
  }

  dismount(p, thrown = false) {
    const e = p.riding ? this.entities.get(p.riding) : null;
    p.riding = null;
    if (!e) return;
    e.rider = null;
    if (thrown) this.send(p.peerId, { t: 'dismounted', thrown: true });
  }

  // Each tick for something being ridden: an untamed horse decides whether to keep its rider.
  riddenTick(e, dt) {
    const rider = [...this.players.values()].find((q) => q.id === e.rider);
    if (!rider || rider.riding !== e.id || rider.dim !== e.dim) { e.rider = null; return; }
    if (e.type === 'horse' && !e.tamed && this.now() >= (e.buckAt ?? 0)) {
      if (this.random() * 100 < (e.temper || 0)) {
        Object.assign(e, { tamed: true, owner: rider.name, persist: true });
        this.broadcastHere({ t: 'sfx', s: 'love', x: e.x, y: e.y, z: e.z });
      } else {
        e.temper = Math.min(100, (e.temper || 0) + 5); // it'll trust you a bit more next time
        this.broadcastHere({ t: 'sfx', s: 'horseAngry', x: e.x, y: e.y, z: e.z });
        this.dismount(rider, true);
      }
    }
  }

  // Unridden vehicles: boats float and drift to a stop.
  vehicleTick(e, t, dt) {
    const inWater = fluidOf(this.world.getBlock(Math.floor(e.x), Math.floor(e.y + 0.3), Math.floor(e.z))) === 'water';
    const drag = Math.exp(-(inWater ? 1.5 : 6) * dt);
    e.vx *= drag; e.vz *= drag;
    if (inWater) e.vy = Math.min(e.vy + 25 * dt, 1.5);
    else e.vy = Math.max(-30, e.vy - 28 * dt);
    if (inWater) e.vy *= Math.exp(-3 * dt);
    const res = moveBody(this.world, e, dt, 0);
    e.onGround = res.onGround;
    if (e.y < -20) this.entities.delete(e.id);
  }

  horseMind(e, t, dt) {
    return this.animalMind(e, t, dt); // in love: find a mate; otherwise wander (riders move them)
  }

  // A new rail takes the shape that joins it to the rails around it, and turns neighbours
  // with a loose end towards it (straight into curves and slopes), like Minecraft's.
  shapeRails(x, y, z, yaw) {
    const get = (a, b, c) => this.world.getBlock(a, b, c);
    const fix = (bx, by, bz, yawHint) => {
      const info = railInfo(get(bx, by, bz));
      if (!info) return;
      const shape = computeShape(get, bx, by, bz, info.powered, yawHint);
      if (info.powered && shape >= 6) return; // powered rails don't curve
      const id = railId({ ...info, shape });
      if (id !== get(bx, by, bz)) this.setBlock(bx, by, bz, id);
    };
    fix(x, y, z, yaw);
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      for (const dy of [-1, 0, 1]) {
        const info = railInfo(get(x + dx, y + dy, z + dz));
        if (!info) continue;
        // a loose end turns towards the new rail; a rail next to one placed a block higher slopes up to it
        const slope = UPHILL[computeShape(get, x + dx, y + dy, z + dz, info.powered, yaw)];
        if (!railConnected(get, x + dx, y + dy, z + dz, info.shape) || (slope && slope !== UPHILL[info.shape])) fix(x + dx, y + dy, z + dz, yaw);
      }
    }
  }

  // Putting a boat on water, or a minecart on a rail.
  onPlaceVehicle(p, msg) {
    if (!['boat', 'minecart'].includes(msg.kind) || ![msg.x, msg.y, msg.z].every(isNum) || Math.hypot(msg.x - p.x, msg.z - p.z) > 6) return;
    if (msg.kind === 'minecart' && !isRail(this.world.getBlock(Math.floor(msg.x), Math.floor(msg.y), Math.floor(msg.z)))) return;
    const e = this.spawnMob(msg.kind, msg.x, msg.y, msg.z);
    e.yaw = isNum(msg.yaw) ? msg.yaw : 0;
    e.persist = true;
  }

  // ---------- weather ----------
  // Clear spells last 10 minutes to 2.5 hours, rain 10-20 minutes; a quarter of rains are
  // thunderstorms, with lightning striking near players.
  tickWeather(dt) {
    const w = this.weather;
    w.time -= dt;
    if (w.time <= 0) {
      if (w.kind === 'clear') this.setWeather(this.random() < 0.25 ? 'thunder' : 'rain');
      else this.setWeather('clear');
    }
    if (w.kind !== 'thunder') return;
    for (const p of this.players.values()) {
      if (p.dim !== 'overworld' || this.random() > dt / 8) continue; // about one strike every 8 seconds near each player
      const a = this.random() * Math.PI * 2, d = this.random() * 64;
      this.inDim('overworld', () => this.lightning(Math.floor(p.x + Math.cos(a) * d), Math.floor(p.z + Math.sin(a) * d)));
    }
  }

  setWeather(kind, seconds) {
    const w = this.weather;
    w.kind = kind;
    w.time = seconds ?? (kind === 'clear' ? 600 + this.random() * 8400 : 600 + this.random() * 600);
    this.broadcast({ t: 'weather', w: kind });
    this.dirty = true;
  }

  // Whether rain falls on this spot right now: raining, in a biome where it rains (not snows),
  // with nothing overhead.
  rainsAt(x, y, z) {
    if (this.weather.kind === 'clear' || !this.world.hasSky || this.ctx !== 'overworld') return false;
    const bx = Math.floor(x), bz = Math.floor(z);
    const biome = this.world.biomeAt(bx, bz);
    if (DRY_BIOMES.has(biome) || FROZEN.has(biome)) return false;
    return this.world.topBlockY(bx, bz) < y;
  }

  // A bolt of lightning at the top of this column: it sets fire to the ground, hurts and burns
  // whatever is close, and changes some mobs (charged creepers, pigs into zombified piglins,
  // villagers into witches).
  lightning(x, z) {
    const y = this.world.topBlockY(x, z);
    if (y < 1 || y >= HEIGHT - 2) return;
    const biome = this.world.biomeAt(x, z);
    if (DRY_BIOMES.has(biome)) return;
    this.broadcastHere({ t: 'lightning', x: x + 0.5, y: y + 1, z: z + 0.5 });
    const ground = this.world.getBlock(x, y, z);
    if (BLOCKS[ground].solid && !BLOCKS[ground].liquid && this.world.getBlock(x, y + 1, z) === BLOCK.AIR) this.setBlock(x, y + 1, z, BLOCK.FIRE);
    const near = (q) => Math.hypot(q.x - (x + 0.5), q.z - (z + 0.5)) < 3 && Math.abs(q.y - (y + 1)) < 4;
    for (const p of this.here()) {
      if (!near(p) || p.dead) continue;
      this.send(p.peerId, { t: 'hurt', amount: 5, cause: 'was struck by lightning', fire: 8 });
    }
    for (const e of [...this.entities.values()]) {
      if (e.dim !== this.ctx || !near(e) || !isMob(e)) continue;
      if (e.type === 'creeper') { e.charged = true; e.persist = true; continue; }
      if (e.type === 'pig' || e.type === 'villager') {
        this.entities.delete(e.id);
        this.broadcastHere({ t: 'mobdeath', e: e.id });
        this.spawnMob(e.type === 'pig' ? 'zombified_piglin' : 'witch', e.x, e.y, e.z);
        continue;
      }
      e.fireTime = Math.max(e.fireTime || 0, 8);
      this.hurtMob(e, 5, 0, 0, null, 0);
    }
  }

  // ---------- fishing ----------
  // Right-click with a rod casts the bobber; right-click again reels it in. A fish bites after
  // 5-30 seconds (5 less per level of Lure) and has to be reeled in within a second or two.
  onFish(p, msg) {
    const old = [...this.entities.values()].find((e) => e.type === 'bobber' && e.owner === p.id);
    if (old) return this.reelIn(p, old);
    if (!isNum(msg.yaw) || !isNum(msg.pitch) || p.dead) return;
    const lvl = (n) => (isInt(n) && n >= 0 && n <= 3 ? n : 0);
    p.held = ITEM.FISHING_ROD;
    const dx = -Math.sin(msg.yaw) * Math.cos(msg.pitch), dy = Math.sin(msg.pitch), dz = -Math.cos(msg.yaw) * Math.cos(msg.pitch);
    const speed = 11;
    this.addEntity({
      id: this.nextEntityId++, type: 'bobber', owner: p.id, x: p.x + dx * 0.6, y: p.y + 1.5 + dy * 0.6, z: p.z + dz * 0.6,
      vx: dx * speed, vy: dy * speed + 2, vz: dz * speed, halfW: 0.125, height: 0.25, yaw: msg.yaw, age: 0,
      lure: lvl(msg.lure), luck: lvl(msg.luck), wait: null, bite: 0,
    });
    this.broadcastHere({ t: 'sfx', s: 'cast', x: p.x, y: p.y, z: p.z });
  }

  tickBobber(e, dt) {
    const owner = [...this.players.values()].find((q) => q.id === e.owner);
    if (!owner || owner.dead || owner.dim !== e.dim || owner.held !== ITEM.FISHING_ROD || Math.hypot(owner.x - e.x, owner.y - e.y, owner.z - e.z) > 32) {
      this.entities.delete(e.id);
      return;
    }
    const inWater = fluidOf(this.world.getBlock(Math.floor(e.x), Math.floor(e.y + 0.1), Math.floor(e.z))) === 'water';
    if (inWater) {
      // float at the surface, and wait for a bite
      const under = fluidOf(this.world.getBlock(Math.floor(e.x), Math.floor(e.y + 0.3), Math.floor(e.z))) === 'water';
      e.vy = under ? Math.min(e.vy + 20 * dt, 1.5) : Math.max(e.vy - 10 * dt, -1);
      const drag = Math.exp(-4 * dt);
      e.vx *= drag; e.vz *= drag;
      if (e.wait === null) e.wait = Math.max(1, (5 + this.random() * 25 - 5 * e.lure) * (this.rainsAt(e.x, e.y, e.z) ? 0.8 : 1));
      if (e.bite > 0) {
        e.bite -= dt;
        if (e.bite <= 0) e.wait = null; // it got away
      } else if ((e.wait -= dt) <= 0) {
        e.bite = 1 + this.random();
        e.vy = -3; // the bobber dips under
        this.broadcastHere({ t: 'sfx', s: 'splash', x: e.x, y: e.y, z: e.z });
      }
    } else {
      e.vy = Math.max(-30, e.vy - 18 * dt);
      e.wait = null;
      e.bite = 0;
    }
    const res = moveBody(this.world, e, dt, 0);
    if (res.onGround) { e.vx *= 0.5; e.vz *= 0.5; }
    if (e.y < -20) this.entities.delete(e.id);
  }

  reelIn(p, e) {
    this.entities.delete(e.id);
    if (!(e.bite > 0)) return this.send(p.peerId, { t: 'reeled', caught: false });
    const [id, count, extra] = this.fishLoot(e.luck);
    // the catch flies out of the water to the player
    const dx = p.x - e.x, dy = p.y + 1 - e.y, dz = p.z - e.z;
    const { dur, ...rest } = extra;
    this.spawnItem(e.x, e.y + 0.3, e.z, id, count, dur, [dx, dy + 10, dz], rest);
    this.spawnXP(p.x, p.y + 0.5, p.z, 1 + Math.floor(this.random() * 6));
    this.send(p.peerId, { t: 'reeled', caught: true });
  }

  // Minecraft's fishing loot: fish, junk or treasure (Luck of the Sea makes treasure likelier).
  // Returns [id, count, {dur?, ench?, potion?}].
  fishLoot(luck = 0) {
    const r = this.random;
    const pick = (table) => {
      let total = 0;
      for (const row of table) total += row[1];
      let x = r() * total;
      for (const row of table) { x -= row[1]; if (x <= 0) return row[0]; }
      return table[0][0];
    };
    const kind = pick([['fish', 85 - luck], ['junk', 10 - 2 * luck], ['treasure', 5 + 2 * luck]]);
    const worn = (id) => ({ dur: Math.max(1, Math.floor(maxDurability(id) * (0.1 + r() * 0.8))) });
    if (kind === 'fish') return [pick([[ITEM.RAW_COD, 60], [ITEM.RAW_SALMON, 25], [ITEM.TROPICAL_FISH, 2], [ITEM.PUFFERFISH, 13]]), 1, {}];
    if (kind === 'junk') {
      const id = pick([[ITEM.LEATHER_BOOTS, 10], [ITEM.LEATHER, 10], [ITEM.BONE, 10], [ITEM.POTION, 10], [ITEM.STRING, 5],
        [ITEM.FISHING_ROD, 2], [ITEM.STICK, 5], [ITEM.INK_SAC, 1], [ITEM.ROTTEN_FLESH, 10]]);
      if (id === ITEM.POTION) return [id, 1, { potion: 'water' }];
      if (id === ITEM.LEATHER_BOOTS || id === ITEM.FISHING_ROD) return [id, 1, worn(id)];
      return [id, id === ITEM.INK_SAC ? 10 : 1, {}];
    }
    const id = pick([[ITEM.BOW, 1], [ITEM.ENCHANTED_BOOK, 1], [ITEM.FISHING_ROD, 1], [ITEM.NAME_TAG, 1], [ITEM.SADDLE, 1]]);
    if (id === ITEM.ENCHANTED_BOOK) return [id, 1, { ench: randomBook(r) }];
    if (id === ITEM.BOW || id === ITEM.FISHING_ROD) return [id, 1, { ...worn(id), ench: rollEnchants(id, 30, r) }];
    return [id, 1, {}];
  }

  // ---------- brewing stands ----------
  // slots: 0-2 bottles, 3 ingredient, 4 fuel (blaze powder: 20 brews)
  brewerAt(p, msg) {
    if (!this.validCoords(msg) || this.world.getBlock(msg.x, msg.y, msg.z) !== BLOCK.BREWING_STAND || !this.inReach(p, msg.x, msg.y, msg.z)) return null;
    const key = this.keyOf(msg);
    if (!this.brewers.has(key)) this.brewers.set(key, { slots: [null, null, null, null, null], fuel: 0, progress: 0 });
    return [key, this.brewers.get(key)];
  }

  brewState(key, b) {
    const [x, y, z] = key.split(',').map(Number);
    return { t: 'brewing', x, y, z, slots: b.slots, fuel: b.fuel, progress: b.progress / BREW_SECONDS };
  }

  notifyBrewer(key, b) {
    const state = this.brewState(key, b);
    for (const peer of this.brewViewers.get(key) || []) this.send(peer, state);
  }

  onBrewOpen(peerId, p, msg) {
    const found = this.brewerAt(p, msg);
    if (!found) return;
    const [key, b] = found;
    if (!this.brewViewers.has(key)) this.brewViewers.set(key, new Set());
    this.brewViewers.get(key).add(peerId);
    this.send(peerId, this.brewState(key, b));
  }

  onBrewClick(peerId, p, msg) {
    const found = this.brewerAt(p, msg);
    const cursor = validStack(msg.cursor) ? msg.cursor : null;
    if (!found || !isInt(msg.slot) || msg.slot < 0 || msg.slot > 4 || !(msg.button === 0 || msg.button === 2)) return this.send(peerId, { t: 'cursor', stack: cursor });
    const [key, b] = found;
    // bottles only go in the bottle slots, blaze powder in the fuel slot
    const fits = !cursor || (msg.slot < 3 ? (cursor.id === ITEM.POTION || cursor.id === ITEM.SPLASH_POTION || cursor.id === ITEM.GLASS_BOTTLE) : msg.slot === 4 ? cursor.id === ITEM.BLAZE_POWDER : true);
    if (!fits) return this.send(peerId, { t: 'cursor', stack: cursor });
    this.send(peerId, { t: 'cursor', stack: clickSlot(b.slots, msg.slot, cursor, msg.button) });
    this.dirty = true;
    this.notifyBrewer(key, b);
  }

  tickBrewers(dt) {
    for (const [key, b] of this.brewers) {
      const ing = b.slots[3];
      const canBrew = ing && [0, 1, 2].some((i) => brewResult(b.slots[i], ing.id));
      if (canBrew && b.fuel <= 0 && b.slots[4]?.id === ITEM.BLAZE_POWDER) {
        b.fuel = 20;
        b.slots[4].count--;
        if (b.slots[4].count <= 0) b.slots[4] = null;
      }
      const before = Math.floor(b.progress);
      if (canBrew && b.fuel > 0) {
        b.progress += dt;
        if (b.progress >= BREW_SECONDS) {
          b.progress = 0;
          b.fuel--;
          for (let i = 0; i < 3; i++) { const r = brewResult(b.slots[i], ing.id); if (r) b.slots[i] = r; }
          ing.count--;
          if (ing.count <= 0) b.slots[3] = null;
          this.dirty = true;
          const [x, y, z] = key.split(',').map(Number);
          this.broadcastHere({ t: 'sfx', s: 'brew', x, y, z });
          this.notifyBrewer(key, b);
          continue;
        }
      } else b.progress = 0;
      if (Math.floor(b.progress) !== before) this.notifyBrewer(key, b);
    }
  }

  // ---------- thrown potions ----------
  // Splash potions and bottles o' enchanting fly like arrows and break where they land.
  onThrow(p, msg) {
    if (p.dead || !isNum(msg.yaw) || !isNum(msg.pitch)) return;
    const kind = msg.kind === 'xp' ? 'xp_bottle' : msg.kind === 'egg' ? 'egg' : msg.kind === 'pearl' ? 'pearl' : msg.kind === 'splash' && validPotion(msg.potion) ? 'potion' : null;
    if (!kind) return;
    const dir = [-Math.sin(msg.yaw) * Math.cos(msg.pitch), Math.sin(msg.pitch) + 0.15, -Math.cos(msg.yaw) * Math.cos(msg.pitch)];
    this.addEntity({
      id: this.nextEntityId++, type: kind, potion: msg.potion, x: p.x + dir[0] * 0.6, y: p.y + 1.5, z: p.z + dir[2] * 0.6,
      halfW: 0.12, height: 0.25, vx: dir[0] * 14, vy: dir[1] * 14, vz: dir[2] * 14, yaw: msg.yaw, age: 0, thrower: p.name,
      ...(kind === 'pearl' ? { vx: dir[0] * 24, vy: dir[1] * 24, vz: dir[2] * 24, gravity: 12 } : {}), // pearls fly further
    });
  }

  tickThrown(e, dt) {
    e.age += dt;
    e.vy -= (e.gravity ?? 20) * dt;
    const steps = Math.max(1, Math.ceil(Math.hypot(e.vx, e.vy, e.vz) * dt / 0.25));
    for (let i = 0; i < steps; i++) {
      e.x += e.vx * dt / steps; e.y += e.vy * dt / steps; e.z += e.vz * dt / steps;
      const hitBlock = BLOCKS[this.world.getBlock(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z))].solid;
      const hitMob = e.age > 0.15 && [...this.entities.values()].some((m) => isMob(m) && m.dim === e.dim && Math.abs(m.x - e.x) < m.halfW + 0.2 && Math.abs(m.z - e.z) < m.halfW + 0.2 && e.y > m.y && e.y < m.y + m.height);
      if (!hitBlock && !hitMob && e.y > -20 && e.age < 10) continue;
      this.entities.delete(e.id);
      if (e.type === 'pearl') return this.pearlLands(e, e.x - e.vx * dt / steps, e.y - e.vy * dt / steps, e.z - e.vz * dt / steps);
      this.broadcastHere({ t: 'sfx', s: 'shatter', x: e.x, y: e.y, z: e.z });
      if (e.type === 'xp_bottle') this.spawnXP(e.x, e.y + 0.3, e.z, 3 + Math.floor(this.random() * 9));
      else if (e.type === 'egg') this.hatchEgg(e.x - e.vx * 0.03, e.y + 0.2, e.z - e.vz * 0.03);
      else this.splash(e);
      return;
    }
  }

  // An ender pearl lands: whoever threw it is teleported there and takes 5 damage.
  pearlLands(e, x, y, z) {
    this.broadcastHere({ t: 'sfx', s: 'portal', x, y, z });
    const p = [...this.players.values()].find((q) => q.name === e.thrower);
    if (!p || p.dead || p.dim !== e.dim || y < -10) return;
    this.dismount(p);
    // land standing on the block it hit (or where it was, if that's open)
    let ty = y;
    for (let k = 0; k < 3 && this.world.getBlock(Math.floor(x), Math.floor(ty), Math.floor(z)) !== BLOCK.AIR && BLOCKS[this.world.getBlock(Math.floor(x), Math.floor(ty), Math.floor(z))].solid; k++) ty = Math.floor(ty) + 1;
    this.send(p.peerId, { t: 'teleport', p: [x, ty, z] });
    [p.x, p.y, p.z] = [x, ty, z];
    if (p.mode === 'survival') this.send(p.peerId, { t: 'hurt', amount: 5, cause: 'fell from a high place', pearl: true });
  }

  // A splash potion breaks: everyone within 4 blocks gets its effects, less further away.
  splash(e) {
    const effects = POTIONS[e.potion]?.effects || [];
    for (const p of this.here()) {
      const d = Math.hypot(p.x - e.x, p.y + 0.9 - e.y, p.z - e.z);
      if (d < 4) this.send(p.peerId, { t: 'effect', potion: e.potion, scale: 1 - d / 4 });
    }
    for (const m of [...this.entities.values()]) {
      if (!isMob(m) || m.dim !== e.dim) continue;
      const d = Math.hypot(m.x - e.x, m.y + m.height / 2 - e.y, m.z - e.z);
      if (d >= 4) continue;
      const scale = 1 - d / 4;
      for (const [name, amp, seconds] of effects) this.mobEffect(m, name, amp, seconds * scale, scale, e.thrower);
    }
  }

  // Potion effects on mobs: instant health and harming (reversed for the undead), poison,
  // regeneration, slowness, speed, weakness, fire resistance, invisibility.
  mobEffect(m, name, amp, seconds, scale = 1, by = null) {
    const undead = POTION_UNDEAD.has(m.type);
    const heal = (n) => { m.hp = Math.min(MOB_TYPES[m.type].hp, m.hp + n); };
    if (name === 'instant_health' || name === 'instant_damage') {
      const amount = (name === 'instant_health' ? 4 : 6) * 2 ** amp * scale;
      if ((name === 'instant_health') !== undead) heal(amount);
      else this.hurtMob(m, amount, 0, 0, by, 0);
      return;
    }
    m.effects ??= {};
    m.effects[name] = { amp, time: Math.max(seconds, m.effects[name]?.time || 0) };
  }

  tickMobEffects(e, dt) {
    if (!e.effects) return;
    for (const [name, ef] of Object.entries(e.effects)) {
      ef.time -= dt;
      ef.acc = (ef.acc || 0) + dt;
      const every = 1.25 / 2 ** ef.amp;
      if ((name === 'poison' || name === 'wither') && ef.acc >= every && !POTION_UNDEAD.has(e.type)) { ef.acc = 0; if (e.hp > 1 || name === 'wither') { e.hp -= 1; this.broadcastHere({ t: 'mobhurt', e: e.id }); } }
      if (name === 'regeneration' && ef.acc >= every * 2 && !POTION_UNDEAD.has(e.type)) { ef.acc = 0; e.hp = Math.min(MOB_TYPES[e.type].hp, e.hp + 1); }
      if (ef.time <= 0) delete e.effects[name];
    }
    if (e.hp <= 0) this.killMob(e);
  }

  // ---------- furnaces ----------
  furnaceAt(msg) {
    if (!this.validCoords(msg)) return null;
    const key = `${msg.x},${msg.y},${msg.z}`;
    if (!isFurnace(this.world.getBlock(msg.x, msg.y, msg.z))) return null;
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
      // the smoker only cooks food and the blast furnace only smelts ores, both twice as fast
      const [bx, by, bz] = key.split(',').map(Number);
      const kind = BLOCKS[this.world.getBlock(bx, by, bz)]?.furnace;
      const fits = kind === 'food' ? !!ITEMS[result]?.food : kind === 'ore' ? ORE_INPUTS.has(input?.id) : true;
      const canSmelt = result !== undefined && fits && (!output || (output.id === result && output.count < maxStack(result)));
      const speed = kind ? 2 : 1;
      const step = dt * speed;
      const before = `${f.burn > 0}|${Math.floor(f.progress)}|${f.slots.map((s) => s && s.count).join()}`;
      if (f.burn <= 0 && canSmelt && fuel && FUEL[fuel.id]) {
        f.burn = f.burnMax = FUEL[fuel.id] * SMELT_SECONDS;
        fuel.count--;
        if (fuel.count <= 0) f.slots[1] = null;
      }
      if (f.burn > 0) {
        f.burn = Math.max(0, f.burn - step);
        if (canSmelt) {
          f.progress += step;
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
    const timeBefore = this.time;
    this.time = (this.time + dt * TICKS_PER_SECOND) % DAY_TICKS;
    this.restockVillagers(timeBefore, this.time);
    const crops = this.acc.spawn + dt >= 1;
    for (const dim of DIMENSIONS) {
      this.ctx = dim;
      this.tickFurnaces(dt);
      this.tickBrewers(dt);
      this.redstone.update(dt);
      this.fluids.update(dt);
      this.tickFires(dt);
      if (crops) this.tickCrops(this.acc.spawn + dt);
    }
    this.tickEntities(dt);
    this.tickPortals(dt);
    this.tickEndFight();
    this.ctx = 'overworld';
    this.tickSleep(dt);
    this.tickWeather(dt);

    this.acc.spawn += dt;
    if (this.acc.spawn >= 1) {
      this.acc.spawn = 0;
      this.spawnMobs();
      this.tickSpawners(1);
      this.mergeItems();
      this.populateVillages();
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
    const items = [...this.entities.values()].filter((e) => e.type === 'item' && e.dur === undefined && !e.ench);
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
    for (const p of this.players.values()) if (p.mode === 'survival' && !p.dead && !p.sleeping) p.rest = (p.rest || 0) + dt * 20;
    const players = [...this.players.values()].filter((p) => p.dim === 'overworld'); // like Minecraft, other dimensions don't count
    if (players.length && players.every((p) => p.sleeping)) {
      this.sleepTimer += dt;
      if (this.sleepTimer >= 2.5) {
        this.time = 0;
        this.sleepTimer = 0;
        for (const p of players) { p.sleeping = false; p.rest = 0; }
        if (this.weather.kind !== 'clear') this.setWeather('clear');
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
      if (survivalOnly && p.invisible && Math.hypot(p.x - e.x, p.z - e.z) > 2.5) continue; // invisible players go unnoticed
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
      if (e.type === 'end_crystal') continue;                  // crystals just sit there
      if (e.type === 'ender_dragon') { if (this.here().length) this.tickDragon(e, dt); continue; } // waits for you to come back
      if (!near && e.persist) continue; // villagers and golems wait for someone to come back
      if (!near) {
        // nobody around: items keep ageing, mobs vanish
        if (e.type !== 'item' || e.age > ITEM_LIFETIME) this.entities.delete(e.id);
        continue;
      }
      // don't simulate in unloaded areas far from everyone
      if (near[1] > 96) continue;
      if (e.type === 'arrow') { this.tickArrow(e, dt); continue; }
      if (e.type === 'fireball' || e.type === 'small_fireball' || e.type === 'dragon_fireball') { this.tickFireball(e, dt); continue; }
      if (e.type === 'breath') { this.tickBreath(e, dt); continue; }
      if (e.type === 'eye') { this.tickEye(e, dt); continue; }
      if (e.type === 'potion' || e.type === 'xp_bottle' || e.type === 'egg' || e.type === 'pearl') { this.tickThrown(e, dt); continue; }
      if (e.type === 'bobber') { this.tickBobber(e, dt); continue; }
      if (e.type === 'xp') { this.tickXP(e, dt); continue; }

      if (e.type === 'item') {
        if (e.age > ITEM_LIFETIME) { this.entities.delete(e.id); continue; }
        e.vy -= 20 * dt;
        const inside = this.world.getBlock(Math.floor(e.x), Math.floor(e.y + 0.1), Math.floor(e.z));
        if (fluidOf(inside) === 'lava' || inside === BLOCK.FIRE) { this.entities.delete(e.id); continue; } // items burn up
        if (fluidOf(inside) === 'water') {
          e.vy = Math.max(e.vy, 1);
          const [fx, fz] = flowAt(this.world, Math.floor(e.x), Math.floor(e.y + 0.1), Math.floor(e.z));
          e.vx += fx * 12 * dt; e.vz += fz * 12 * dt; // carried along by the current
        }
        const res = moveBody(this.world, e, dt);
        if (res.onGround) { e.vx *= 0.5; e.vz *= 0.5; } else { e.vx *= 0.98; e.vz *= 0.98; }
        if (e.y < -20) this.entities.delete(e.id);
        continue;
      }

      const t = MOB_TYPES[e.type];
      this.tickMobEffects(e, dt);
      if (!this.entities.has(e.id)) continue;
      if (e.rider) { this.riddenTick(e, dt); continue; } // the rider moves it
      e.attackCooldown = Math.max(0, e.attackCooldown - dt);
      e.panic = Math.max(0, e.panic - dt);
      e.think -= dt;
      let targetSpeed = 0;

      if (e.type === 'sheep' && e.sheared) {
        e.regrow -= dt;
        if (e.regrow <= 0) e.sheared = false;
      }

      // lava and fire burn every mob that isn't from the Nether, and set it alight for a while
      if (!t.fireproof) {
        const inside = this.world.getBlock(Math.floor(e.x), Math.floor(e.y + 0.2), Math.floor(e.z));
        if (fluidOf(inside) === 'lava') {
          e.fireTime = 15;
          e.lava = (e.lava || 0) + dt;
          if (e.lava > 0.5) { e.lava = 0; e.hp -= 4; this.broadcastHere({ t: 'mobhurt', e: e.id }); }
        } else if (inside === BLOCK.FIRE) e.fireTime = Math.max(e.fireTime || 0, 8);
        else if (fluidOf(inside) === 'water') e.fireTime = 0;
        if (e.fireTime > 0) {
          e.fireTime -= dt;
          e.burnTick = (e.burnTick || 0) + dt;
          if (e.burnTick >= 1) { e.burnTick = 0; e.hp -= 1; this.broadcastHere({ t: 'mobhurt', e: e.id }); }
        }
        if (e.hp <= 0) { this.killMob(e); continue; }
      }

      if (t.custom) { this[t.custom](e, t, dt); continue; }
      if (t.flies) { this.tickFlyer(e, t, dt); continue; }
      if (t.neutral && e.angerTime !== undefined) {
        // zombified piglins calm down after a while
        e.angerTime -= dt;
        if (e.angerTime <= 0) { e.angry = false; e.angryAt = null; e.angerTime = undefined; }
      }

      // zombies and skeletons burn in sunlight when nothing is above them
      if (e.fireTime > 0 && this.rainsAt(e.x, e.y, e.z)) e.fireTime = 0; // the rain puts it out
      if (t.burns && this.world.hasSky && light > 0.6 && !this.rainsAt(e.x, e.y, e.z) && this.world.topBlockY(Math.floor(e.x), Math.floor(e.z)) < e.y &&
        fluidOf(this.world.getBlock(Math.floor(e.x), Math.floor(e.y + 0.2), Math.floor(e.z))) !== 'water') {
        e.fireTime = Math.max(e.fireTime || 0, 2); // catches fire (see above)
      }
      const aiSpeed = t.ai ? this[t.ai](e, t, dt, light) : null;
      if (!this.entities.has(e.id)) continue;
      if (aiSpeed !== null && aiSpeed !== undefined) {
        targetSpeed = aiSpeed;
      } else if (t.ai) {
        // nothing to do: wander
        if (e.think <= 0) { e.think = 2 + this.random() * 5; e.walk = this.random() < 0.5 ? 1 : 0; e.yaw = this.random() * Math.PI * 2; }
        targetSpeed = e.walk ? t.speed * 0.5 : 0;
      } else if (t.hostile) {
        if (e.type === 'enderman') this.endermanMind(e, dt);
        const target = t.neutral && !e.angry ? null : this.nearestPlayer(e, e.type === 'skeleton' || e.type === 'stray' ? 20 : t.neutral ? 40 : 24, true);
        // zombies go after villagers too
        const prey = (e.type === 'zombie' || e.type === 'husk') && this.nearestOf(e, 'villager', target ? target[1] : 24);
        if (prey) {
          const [v, dist] = prey;
          e.yaw = Math.atan2(-(v.x - e.x), -(v.z - e.z));
          targetSpeed = dist > 1.2 ? t.speed : 0;
          if (dist < 1.6 && e.attackCooldown === 0) { e.attackCooldown = 1; this.hurtMob(v, t.damage, v.x - e.x, v.z - e.z, null); }
        } else if (target) {
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
              this.explode(e.x, e.y + 0.5, e.z, e.charged ? 6 : 3); // a charged creeper's blast is twice as big
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
              this.send(p.peerId, { t: 'hurt', amount: t.damage * (e.effects?.weakness ? 0.5 : 1), from: [e.x, e.z], cause: `was slain by ${MOB_NAMES[e.type] || 'a Zombie'}`, by: e.id, effects: ATTACK_EFFECTS[e.type] });
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
      } else if (t.villager) {
        targetSpeed = this.villagerMind(e, t, dt, light);
      } else if (t.golem) {
        targetSpeed = this.golemMind(e, t, dt);
      } else {
        const love = BREED_FOOD[e.type] ? this.animalMind(e, t, dt) : null;
        if (e.think <= 0) {
          e.think = 2 + this.random() * 5;
          e.walk = this.random() < 0.6 ? 1 : 0;
          e.yaw = this.random() * Math.PI * 2;
        }
        if (e.panic > 0 && e.think > 1) { e.think = 0.6 + this.random() * 0.5; e.walk = 1; e.yaw = this.random() * Math.PI * 2; }
        targetSpeed = love ?? (e.walk ? (e.panic > 0 ? t.speed * 2 : t.speed) : 0);
        if (e.type === 'rabbit' && e.onGround && targetSpeed > 0) e.vy = 5; // rabbits hop
      }

      if (e.effects?.slowness) targetSpeed *= Math.max(0, 1 - 0.15 * (e.effects.slowness.amp + 1));
      if (e.effects?.speed) targetSpeed *= 1 + 0.2 * (e.effects.speed.amp + 1);
      const ax = -Math.sin(e.yaw) * targetSpeed, az = -Math.cos(e.yaw) * targetSpeed;
      const k = Math.min(1, dt * (e.onGround ? 8 : 2));
      e.vx += (ax - e.vx) * k;
      e.vz += (az - e.vz) * k;
      const headIn = this.world.getBlock(Math.floor(e.x), Math.floor(e.y + e.height * 0.6), Math.floor(e.z));
      if (t.swims && BLOCKS[headIn].liquid) e.vy = Math.max(-2, Math.min(e.vy - 2 * dt, 3)); // the drowned sink and swim
      else if (BLOCKS[headIn].liquid) e.vy = Math.min(e.vy + 25 * dt, 2);
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
    const light = daylight(this.time) * (this.weather.kind === 'thunder' ? 0.25 : this.weather.kind === 'rain' ? 0.8 : 1);
    for (const p of this.players.values()) {
      this.ctx = p.dim;
      const counts = { passive: 0, hostile: 0, squid: 0, bat: 0 };
      for (const e of this.entities.values()) {
        if (!isMob(e) || e.dim !== p.dim || Math.hypot(e.x - p.x, e.z - p.z) > 64) continue;
        if (MOB_TYPES[e.type].vehicle) continue;
        if (e.type === 'squid' || e.type === 'bat') counts[e.type]++; // water and cave creatures have their own limits
        else if (MOB_TYPES[e.type].hostile) counts.hostile++; else counts.passive++;
      }
      if (p.dim !== 'overworld') { this.spawnOther(p, counts); continue; }
      // underground: monsters appear in total darkness, day or night
      if (counts.hostile < 8 && p.y < this.world.seaLevel + 10 && this.random() < 0.5) this.spawnInCave(p);
      if (light < 0.3) this.spawnPhantoms(p);
      const wantHostile = light < 0.3 && counts.hostile < 6;
      const wantPassive = counts.passive < 6 && this.random() < 0.3;
      if (!wantHostile && !wantPassive) continue;
      const angle = this.random() * Math.PI * 2;
      const dist = 24 + this.random() * 24;
      const x = Math.floor(p.x + Math.cos(angle) * dist);
      const z = Math.floor(p.z + Math.sin(angle) * dist);
      let y = this.world.topBlockY(x, z);
      while (y > 1 && !BLOCKS[this.world.getBlock(x, y, z)].solid && !BLOCKS[this.world.getBlock(x, y, z)].liquid) y--; // through plants and snow
      if (y < 1 || y >= HEIGHT - 3) continue;
      const ground = this.world.getBlock(x, y, z);
      const biome = this.world.biomeAt(x, z);
      if (fluidOf(ground) === 'water') {
        // oceans and rivers: squid by day, drowned by night
        let depth = 0;
        while (depth < 12 && fluidOf(this.world.getBlock(x, y - depth - 1, z)) === 'water') depth++;
        if (!WATER_BIOMES.has(biome) || depth < 3) continue;
        if (wantHostile && this.random() < 0.4) this.spawnGroup('drowned', x, y - depth, z, 1);
        else if (wantPassive && counts.squid < 4) this.spawnGroup('squid', x, y - 1 - Math.floor(this.random() * (depth - 1)), z, 2 + Math.floor(this.random() * 3));
      } else if (wantHostile && BLOCKS[ground].solid && !BLOCKS[ground].transparent) {
        if (biome === BIOME.SWAMP && this.random() < 0.3) this.spawnGroup('slime', x, y + 1, z, 1);
        else this.spawnHostile(x, y + 1, z);
      } else if (wantPassive) {
        if (RABBIT_BIOMES.has(biome) && this.random() < 0.5 && BLOCKS[ground].solid) this.spawnGroup('rabbit', x, y + 1, z, 2 + Math.floor(this.random() * 2));
        else if (WOLF_BIOMES.has(biome) && this.random() < 0.2 && (ground === BLOCK.GRASS || ground === BLOCK.SNOWY_GRASS)) this.spawnGroup('wolf', x, y + 1, z, biome === BIOME.FOREST ? 1 : 4);
        else if (HORSE_BIOMES.has(biome) && this.random() < 0.15 && ground === BLOCK.GRASS) this.spawnGroup('horse', x, y + 1, z, 2 + Math.floor(this.random() * 5));
        else if (ground === BLOCK.GRASS) this.spawnGroup(PASSIVE[Math.floor(this.random() * PASSIVE.length)], x, y + 1, z, 2 + Math.floor(this.random() * 3));
      }
    }
  }

  // Spawns up to n mobs around a block, skipping any that would be stuck in a wall.
  spawnGroup(type, x, y, z, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const e = this.spawnMob(type, x + 0.5 + (i ? (this.random() - 0.5) * 3 : 0), y, z + 0.5 + (i ? (this.random() - 0.5) * 3 : 0));
      if (collides(this.world, e)) this.entities.delete(e.id); else out.push(e);
    }
    return out;
  }

  // Phantoms come for players who haven't slept for three days, at night, under the open sky.
  spawnPhantoms(p) {
    if (p.mode !== 'survival' || p.dead || (p.rest || 0) < REST_TICKS || p.y < this.world.seaLevel) return;
    if (this.world.topBlockY(Math.floor(p.x), Math.floor(p.z)) > p.y + 1) return;
    // the longer you've been awake, the likelier (checked about once a second)
    if (this.random() > Math.min(0.05, (p.rest - REST_TICKS) / 72000 * 0.05 + 0.01)) return;
    let near = 0;
    for (const e of this.entities.values()) if (e.type === 'phantom' && e.dim === p.dim && Math.hypot(e.x - p.x, e.z - p.z) < 64) near++;
    if (near >= 4) return;
    const n = 1 + Math.floor(this.random() * 2);
    for (let i = 0; i < n; i++) {
      const y = Math.min(HEIGHT - 4, p.y + 20 + this.random() * 14);
      const e = this.spawnMob('phantom', p.x + (this.random() - 0.5) * 20, y, p.z + (this.random() - 0.5) * 20);
      if (collides(this.world, e)) this.entities.delete(e.id);
    }
  }

  // Slime chunks: one chunk in ten has slimes deep underground, whatever the light.
  isSlimeChunk(cx, cz) {
    return hash2(cx, cz, (this.save.seed | 0) + 7000) < 0.1;
  }

  // Monster spawners: within 16 blocks of a player, every 10-40 seconds one spawns up to four
  // of its mob around it (not if six are already close), like Minecraft's.
  tickSpawners(dt) {
    this.spawnerDelay ??= new Map();
    const seen = new Set();
    for (const p of this.players.values()) {
      if (p.dead) continue;
      this.ctx = p.dim;
      const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
      for (let y = Math.max(1, py - 8); y <= Math.min(HEIGHT - 2, py + 8); y++) {
        for (let z = pz - 16; z <= pz + 16; z++) for (let x = px - 16; x <= px + 16; x++) {
          const mob = BLOCKS[this.world.getBlock(x, y, z)].spawner;
          if (!mob) continue;
          const key = `${p.dim},${x},${y},${z}`;
          if (seen.has(key) || Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y, z + 0.5 - p.z) > 16) continue;
          seen.add(key);
          let left = this.spawnerDelay.get(key) ?? 1 + this.random() * 2;
          left -= dt;
          if (left <= 0) {
            left = 10 + this.random() * 30;
            let near = 0;
            for (const e of this.entities.values()) if (e.type === mob && e.dim === p.dim && Math.abs(e.x - x) < 9 && Math.abs(e.y - y) < 5 && Math.abs(e.z - z) < 9) near++;
            for (let i = 0; i < 4 && near < 6; i++) {
              const sx = x + 0.5 + (this.random() * 2 - 1) * 4, sy = y + Math.floor(this.random() * 3) - 1, sz = z + 0.5 + (this.random() * 2 - 1) * 4;
              const e = this.spawnMob(mob, sx, sy, sz);
              if (collides(this.world, e) || !BLOCKS[this.world.getBlock(Math.floor(sx), sy - 1, Math.floor(sz))].solid && mob !== 'blaze') { this.entities.delete(e.id); continue; }
              near++;
              this.broadcastHere({ t: 'sfx', s: 'smoke', x: sx, y: sy, z: sz });
            }
          }
          this.spawnerDelay.set(key, left);
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
      if (y < this.world.seaLevel - 24 && this.isSlimeChunk(Math.floor(x / 16), Math.floor(z / 16)) && this.random() < 0.3) {
        return this.spawnGroup('slime', x, y, z, 1)[0] ?? null;
      }
      const light = this.lightAt(x, y, z);
      if (light.sky > 0 || light.block > 0) return null;
      if (this.random() < 0.15) {
        let bats = 0;
        for (const e of this.entities.values()) if (e.type === 'bat' && e.dim === p.dim && Math.hypot(e.x - p.x, e.z - p.z) < 64) bats++;
        return bats < 4 ? this.spawnGroup('bat', x, y + 0.5, z, 1)[0] ?? null : null;
      }
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

  // The nearest mob of a type in the same dimension within maxDist: [mob, distance], or null.
  nearestOf(e, type, maxDist) {
    let best = null, bestD = maxDist;
    for (const o of this.entities.values()) {
      if (o.type !== type || o.dim !== e.dim || o === e) continue;
      const d = Math.hypot(o.x - e.x, o.y - e.y, o.z - e.z);
      if (d < bestD) { best = o; bestD = d; }
    }
    return best ? [best, bestD] : null;
  }

  // ---------- villages ----------
  // The first time a player comes near a village, its villagers and iron golem appear:
  // one villager per bed, with the profession of the job site in their house.
  populateVillages() {
    const villages = this.dims.overworld.world.villages;
    if (!villages) return;
    for (const p of this.players.values()) {
      if (p.dim !== 'overworld') continue;
      const v = villages.nearest(p.x, p.z, 96);
      if (!v || this.villagesDone.has(v.key)) continue;
      this.villagesDone.add(v.key);
      this.dirty = true;
      this.inDim('overworld', () => {
        for (const bed of v.beds) {
          const e = this.spawnMob('villager', bed.x + 0.5, bed.y, bed.z + 0.5);
          const profession = PROFESSION_OF[bed.job] || (this.random() < 0.2 ? 'nitwit' : 'unemployed');
          Object.assign(e, { persist: true, profession, level: 0, vxp: 0, home: [v.x, v.z], bed: [bed.x, bed.y, bed.z] });
          e.offers = offersFor(profession, 0, this.random);
        }
        const g = this.spawnMob('iron_golem', v.x + 3.5, v.y, v.z + 3.5);
        Object.assign(g, { persist: true, home: [v.x, v.z] });
      });
    }
  }

  // Villagers wander near home, run from monsters, and stay by their bed at night.
  // Returns the speed to walk at (e.yaw is the direction).
  villagerMind(e, t, dt, light) {
    const threat = this.nearestHostile(e, 8);
    if (threat) {
      e.yaw = Math.atan2(threat.x - e.x, threat.z - e.z); // away
      return t.speed * 1.8;
    }
    if (e.trading && this.now() < e.trading) return 0; // stands still while someone trades
    const goTo = (x, z, near) => {
      const d = Math.hypot(x - e.x, z - e.z);
      if (d < near) return 0;
      e.yaw = Math.atan2(-(x - e.x), -(z - e.z));
      return t.speed;
    };
    if (light < 0.3 && e.bed) return goTo(e.bed[0] + 0.5, e.bed[2] + 0.5, 0.8);
    if (e.home && Math.hypot(e.home[0] - e.x, e.home[1] - e.z) > 24) return goTo(e.home[0], e.home[1], 4);
    if (e.think <= 0) {
      e.think = 2 + this.random() * 6;
      e.walk = this.random() < 0.5 ? 1 : 0;
      e.yaw = this.random() * Math.PI * 2;
    }
    if (e.panic > 0) return t.speed * 2;
    return e.walk ? t.speed * 0.6 : 0;
  }

  nearestHostile(e, range) {
    let best = null, bestD = range;
    for (const o of this.entities.values()) {
      if (o.dim !== e.dim || !isMob(o) || !MOB_TYPES[o.type].hostile || o.type === 'creeper' || MOB_TYPES[o.type].boss) continue;
      if (MOB_TYPES[o.type].neutral && !o.angry) continue;
      const d = Math.hypot(o.x - e.x, o.y - e.y, o.z - e.z);
      if (d < bestD) { best = o; bestD = d; }
    }
    return best;
  }

  // Iron golems guard the village: they fight monsters nearby, and anyone who hurt them or a villager.
  golemMind(e, t, dt) {
    let target = this.nearestHostile(e, 16);
    let player = null;
    if (!target && e.angryAt) {
      player = [...this.here()].find((q) => q.name === e.angryAt && !q.dead && q.mode === 'survival');
      if (player && Math.hypot(player.x - e.x, player.z - e.z) > 32) { player = null; e.angryAt = null; }
    }
    const foe = target || player;
    if (foe) {
      const d = Math.hypot(foe.x - e.x, foe.z - e.z);
      e.yaw = Math.atan2(-(foe.x - e.x), -(foe.z - e.z));
      if (d < 2.4 && Math.abs(foe.y - e.y) < 2.5 && e.attackCooldown === 0) {
        e.attackCooldown = 1.25;
        e.swing = this.now() + 400;
        const dmg = 7 + Math.floor(this.random() * 15); // Minecraft: 7 to 21
        if (target) { this.hurtMob(target, dmg, target.x - e.x, target.z - e.z, null); target.vy = 9; }
        else this.send(player.peerId, { t: 'hurt', amount: dmg, from: [e.x, e.z], cause: 'was slain by Iron Golem', up: true });
      }
      return d > 1.8 ? t.speed * 1.4 : 0;
    }
    if (e.home && Math.hypot(e.home[0] - e.x, e.home[1] - e.z) > 20) {
      e.yaw = Math.atan2(-(e.home[0] - e.x), -(e.home[1] - e.z));
      return t.speed;
    }
    if (e.think <= 0) {
      e.think = 4 + this.random() * 8;
      e.walk = this.random() < 0.4 ? 1 : 0;
      e.yaw = this.random() * Math.PI * 2;
    }
    return e.walk ? t.speed * 0.5 : 0;
  }

  // ---------- trading ----------
  // Right-clicking a villager with a profession shows its offers.
  sendTrades(p, e) {
    this.send(p.peerId, {
      t: 'trades', e: e.id, profession: e.profession, level: e.level, xp: e.vxp,
      next: LEVEL_XP[e.level + 1] ?? null, prev: LEVEL_XP[e.level], offers: e.offers,
    });
  }

  // The client has checked the player can pay; the host checks the offer isn't used up,
  // and the villager gains experience (and new offers at each level).
  onTrade(p, msg) {
    const e = this.entities.get(msg.e);
    if (!e || e.type !== 'villager' || e.dim !== p.dim || !isInt(msg.i) || Math.hypot(e.x - p.x, e.z - p.z) > 8) return;
    const o = e.offers?.[msg.i];
    if (!o || o.uses >= o.max) return this.send(p.peerId, { t: 'traded', e: e.id, i: msg.i, ok: false });
    o.uses++;
    e.vxp += o.xp;
    e.trading = this.now() + 5000;
    this.send(p.peerId, { t: 'traded', e: e.id, i: msg.i, ok: true });
    this.spawnXP(p.x, p.y + 0.5, p.z, 3 + Math.floor(this.random() * 4));
    while (e.level < 4 && e.vxp >= LEVEL_XP[e.level + 1]) {
      e.level++;
      e.offers.push(...offersFor(e.profession, e.level, this.random));
      this.broadcastHere({ t: 'sfx', s: 'levelUp', x: e.x, y: e.y, z: e.z });
    }
    this.dirty = true;
    this.sendTrades(p, e);
  }

  // Villagers restock twice a day (in the morning and at noon), like working at their job sites.
  restockVillagers(before, after) {
    const crossed = (t) => (before < t && after >= t) || (before > after && (after >= t || before < t));
    if (!crossed(1000) && !crossed(6000)) return;
    for (const e of this.entities.values()) if (e.type === 'villager') for (const o of e.offers || []) o.uses = 0;
  }

  onMobHurt(e) {
    if ((e.type === 'wolf' && !e.tamed) || e.type === 'piglin') {
      // the whole pack (or group of piglins) turns on whoever hurt one of them
      if (e.angryAt) for (const o of this.entities.values()) if (o.type === e.type && !o.tamed && o.dim === e.dim && Math.hypot(o.x - e.x, o.z - e.z) < 16) o.angryAt = e.angryAt;
    }
    if (e.type === 'wolf' && e.tamed) e.sitting = false;
    if ((e.type === 'villager' || e.type === 'iron_golem') && e.angryAt) {
      // hurting a villager or a golem makes the village's golems come for you
      for (const g of this.entities.values()) if (g.type === 'iron_golem' && g.dim === e.dim && Math.hypot(g.x - e.x, g.z - e.z) < 32) g.angryAt = e.angryAt;
    }
    if (e.type === 'enderman') { e.angry = true; this.teleportMob(e, e.x, e.z, 16); }
    if (e.type === 'zombified_piglin' && e.angryAt) {
      // hurting one angers every zombified piglin nearby, for 20-40 seconds
      for (const o of this.entities.values()) {
        if (o.type !== 'zombified_piglin' || o.dim !== e.dim || Math.hypot(o.x - e.x, o.y - e.y, o.z - e.z) > 32) continue;
        o.angry = true;
        o.angryAt = e.angryAt;
        o.angerTime = 20 + this.random() * 20;
      }
    }
  }

  // ---------- flying Nether mobs ----------
  // Ghasts drift around and spit explosive fireballs; blazes hover and shoot bursts of three.
  tickFlyer(e, t, dt) {
    const target = this.nearestPlayer(e, e.type === 'ghast' ? 64 : 48, true);
    const see = target && this.canSee(e.x, e.y + e.height * 0.6, e.z, target[0].x, target[0].y + 1.5, target[0].z);
    let gx, gy, gz, speed = t.speed;
    if (e.type === 'ghast') {
      if (e.think <= 0 || !e.goal) {
        e.think = 3 + this.random() * 4;
        e.goal = [e.x + (this.random() - 0.5) * 32, Math.max(12, Math.min(112, e.y + (this.random() - 0.5) * 16)), e.z + (this.random() - 0.5) * 32];
      }
      [gx, gy, gz] = e.goal;
      if (see) {
        e.yaw = Math.atan2(-(target[0].x - e.x), -(target[0].z - e.z));
        e.charge = (e.charge || 0) + dt;
        if (e.charge >= 2) {
          e.charge = -1.5; // cooldown
          this.broadcastHere({ t: 'sfx', s: 'ghast', x: e.x, y: e.y, z: e.z });
          this.shootFireball(e, target[0], true);
        }
      } else {
        e.charge = Math.max(0, (e.charge || 0) - dt);
        if (Math.hypot(e.vx, e.vz) > 0.1) e.yaw = Math.atan2(-e.vx, -e.vz);
      }
    } else {
      // blaze: hover a couple of blocks over the ground, or level with its target
      let ground = Math.floor(e.y);
      for (let k = 0; k < 8 && !BLOCKS[this.world.getBlock(Math.floor(e.x), ground - 1, Math.floor(e.z))].solid; k++) ground--;
      gy = ground + 1.5 + Math.sin(e.age * 1.3) * 0.5;
      if (target) {
        const [p, dist] = target;
        e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z));
        gy = Math.max(gy, p.y + 0.5);
        if (dist > 6 || !see) { gx = p.x; gz = p.z; } else { gx = e.x; gz = e.z; }
        if (dist < 1.8 && e.attackCooldown === 0) {
          e.attackCooldown = 1;
          this.send(p.peerId, { t: 'hurt', amount: t.damage, from: [e.x, e.z], cause: 'was slain by a Blaze' });
        }
        if (see && dist < 48) {
          // after charging up, three fireballs a third of a second apart, then a rest
          e.charge = (e.charge || 0) + dt;
          e.shots ??= 0;
          if (e.charge >= 3 + e.shots * 0.3) {
            this.shootFireball(e, p, false);
            e.shots++;
            if (e.shots >= 3) { e.charge = -2 - this.random() * 2; e.shots = 0; }
          }
        }
      } else {
        e.charge = 0;
        if (e.think <= 0) { e.think = 2 + this.random() * 4; e.goal = [e.x + (this.random() - 0.5) * 10, 0, e.z + (this.random() - 0.5) * 10]; }
        gx = e.goal?.[0] ?? e.x; gz = e.goal?.[2] ?? e.z;
        speed *= 0.5;
      }
    }
    const dx = gx - e.x, dy = gy - (e.y + (e.type === 'ghast' ? 2 : 0.9)), dz = gz - e.z;
    const len = Math.hypot(dx, dy, dz);
    const k = Math.min(1, dt * 2);
    if (len > 0.5) {
      e.vx += (dx / len * speed - e.vx) * k;
      e.vy += (dy / len * speed - e.vy) * k;
      e.vz += (dz / len * speed - e.vz) * k;
    } else { e.vx *= 0.9; e.vy *= 0.9; e.vz *= 0.9; }
    const res = moveBody(this.world, e, dt, 0);
    if (res.hitWall) e.think = 0;
    if (e.y < -20 || e.y > 140) this.entities.delete(e.id);
  }

  shootFireball(from, target, big) {
    const sy = from.y + (big ? 2 : 1.2);
    let dx = target.x - from.x, dy = target.y + 1 - sy, dz = target.z - from.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const spread = big ? 0.02 : 0.08;
    const speed = big ? 14 : 18;
    const out = big ? 2.5 : 0.6; // start outside the shooter
    const f = {
      id: this.nextEntityId++, type: big ? 'fireball' : 'small_fireball',
      x: from.x + dx * out, y: sy + dy * out, z: from.z + dz * out, halfW: big ? 0.5 : 0.16, height: big ? 1 : 0.32,
      vx: (dx + (this.random() - 0.5) * spread) * speed, vy: (dy + (this.random() - 0.5) * spread) * speed, vz: (dz + (this.random() - 0.5) * spread) * speed,
      yaw: 0, age: 0, shooter: from.id, cause: big ? 'was fireballed by a Ghast' : 'was fireballed by a Blaze',
    };
    this.addEntity(f);
    return f;
  }

  tickFireball(f, dt) {
    f.age += dt;
    if (f.age > 10) { this.entities.delete(f.id); return; }
    const big = f.type !== 'small_fireball';
    const breath = f.type === 'dragon_fireball';
    const steps = Math.max(1, Math.ceil(Math.hypot(f.vx, f.vy, f.vz) * dt / 0.25));
    const hit = (by) => {
      this.entities.delete(f.id);
      if (breath) {
        // leaves a cloud of dragon's breath on the ground
        let y = Math.floor(f.y);
        while (y > 1 && !BLOCKS[this.world.getBlock(Math.floor(f.x), y - 1, Math.floor(f.z))].solid && y > f.y - 8) y--;
        this.addEntity({ id: this.nextEntityId++, type: 'breath', x: f.x, y, z: f.z, halfW: 3, height: 1, vx: 0, vy: 0, vz: 0, yaw: 0, age: 0 });
      } else if (big) this.explode(f.x, f.y + 0.5, f.z, 1, f.cause, true);
      else {
        // a blaze's fireball lights the block it hits
        const px = Math.floor(f.x - f.vx * 0.02), py = Math.floor(f.y - f.vy * 0.02), pz = Math.floor(f.z - f.vz * 0.02);
        if (this.world.getBlock(px, py, pz) === BLOCK.AIR) this.setBlock(px, py, pz, BLOCK.FIRE);
      }
      return by;
    };
    for (let i = 0; i < steps; i++) {
      f.x += f.vx * dt / steps; f.y += f.vy * dt / steps; f.z += f.vz * dt / steps;
      const r = f.halfW;
      if (f.reflected) {
        // hit back by a player: now it hurts mobs (a ghast hit by its own fireball dies)
        for (const e of this.entities.values()) {
          if (!isMob(e) || e.dim !== this.ctx) continue;
          if (Math.abs(f.x - e.x) < e.halfW + r && Math.abs(f.z - e.z) < e.halfW + r && f.y + r > e.y && f.y - r < e.y + e.height) {
            this.hurtMob(e, e.type === 'ghast' ? 1000 : 6, f.vx, f.vz, f.reflected);
            return hit();
          }
        }
      } else {
        for (const p of this.here()) {
          if (p.mode !== 'survival' || p.dead) continue;
          if (Math.abs(f.x - p.x) < 0.3 + r && Math.abs(f.z - p.z) < 0.3 + r && f.y + r > p.y && f.y - r < p.y + 1.8) {
            this.send(p.peerId, { t: 'hurt', amount: big ? 6 : 5, from: [f.x - f.vx, f.z - f.vz], cause: f.cause, fire: big ? 0 : 5 });
            return hit();
          }
        }
      }
      if (BLOCKS[this.world.getBlock(Math.floor(f.x), Math.floor(f.y), Math.floor(f.z))].solid) return hit();
    }
  }


  // ---------- fire ----------
  // Every second or two each fire may burn up a neighbouring block (TNT goes off), spread
  // to nearby air next to something flammable, or go out. It burns forever on netherrack.
  tickFires(dt) {
    const fires = this.fires;
    if (!fires.size) return;
    const d = this.dims[this.ctx];
    d.fireAcc = (d.fireAcc || 0) + dt;
    if (d.fireAcc < 0.5) return;
    d.fireAcc = 0;
    d.fireAge ??= new Map();
    const players = this.here();
    for (const k of [...fires]) {
      if (this.random() > 1 / 3) continue;
      const [x, y, z] = k.split(',').map(Number);
      if (this.world.getBlock(x, y, z) !== BLOCK.FIRE) { fires.delete(k); d.fireAge.delete(k); continue; }
      if (!players.some((p) => Math.abs(p.x - x) < 128 && Math.abs(p.z - z) < 128)) continue;
      if (this.rainsAt(x + 0.5, y, z + 0.5) && this.random() < 0.6) { this.setBlock(x, y, z, BLOCK.AIR); continue; } // rain puts fires out
      const below = this.world.getBlock(x, y - 1, z);
      const eternal = below === BLOCK.NETHERRACK || below === BLOCK.MAGMA_BLOCK || (this.ctx === 'end' && below === BLOCK.BEDROCK);
      const age = Math.min(15, (d.fireAge.get(k) || 0) + Math.floor(this.random() * 3));
      d.fireAge.set(k, age);
      const near = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      const fuel = near.some(([dx, dy, dz]) => FLAMMABLE(this.world.getBlock(x + dx, y + dy, z + dz)));
      if (!eternal) {
        if (!fuel && (!BLOCKS[below].solid || age > 3)) { this.setBlock(x, y, z, BLOCK.AIR); continue; }
        if (!FLAMMABLE(below) && age === 15 && this.random() < 0.25) { this.setBlock(x, y, z, BLOCK.AIR); continue; }
      }
      // burn up neighbours
      for (const [dx, dy, dz] of near) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        const id = this.world.getBlock(nx, ny, nz);
        const f = FLAMMABLE(id);
        if (!f || this.random() * (dy ? 250 : 300) >= f[1]) continue;
        if (id === BLOCK.TNT) { this.setBlock(nx, ny, nz, BLOCK.AIR); this.primeTnt(nx, ny, nz, 4); continue; }
        this.setBlock(nx, ny, nz, this.random() * (age + 10) < 5 ? BLOCK.FIRE : BLOCK.AIR);
        this.popAttached(nx, ny, nz, false);
      }
      // spread
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 4; dy++) {
        if (!dx && !dy && !dz) continue;
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (this.world.getBlock(nx, ny, nz) !== BLOCK.AIR) continue;
        let catchy = 0;
        for (const [ex, ey, ez] of near) catchy = Math.max(catchy, FLAMMABLE(this.world.getBlock(nx + ex, ny + ey, nz + ez))?.[0] || 0);
        if (!catchy) continue;
        const chance = (catchy + 40) / (age + 30);
        if (this.random() * (100 + (dy > 1 ? (dy - 1) * 100 : 0)) <= chance) this.setBlock(nx, ny, nz, BLOCK.FIRE);
      }
    }
  }

  fizz(x, y, z) {
    this.broadcastHere({ t: 'sfx', s: 'fizz', x, y, z });
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
      return b.solid && b.render === 'cube' && !b.transparent && b.hardness !== Infinity && !isContainer(id) && !isFurnace(id);
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
    this.dismount(p);
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
      p.bossSent = false;
      this.send(p.peerId, {
        t: 'dimension', dim, ds: p.ds, edits: this.world.exportEdits(), pos,
        players: this.here().filter((q) => q !== p).map((q) => this.playerInfo(q)),
      });
      this.broadcastHere({ t: 'join', ...this.playerInfo(p) }, p.peerId);
    });
    this.storePlayer(p);
  }

  // ---------- strongholds & the End portal ----------
  // A thrown eye of ender flies towards the nearest stronghold, then drops (or, one time in five, breaks).
  onEye(p) {
    if (p.dead || p.dim !== 'overworld') return;
    const target = this.nearestStronghold(p.x, p.z);
    if (!target) return;
    const [tx, ty, tz] = target;
    const d = Math.hypot(tx - p.x, tz - p.z);
    // more than 12 blocks away: fly 12 blocks that way and up; closer: towards the portal room
    const goal = d > 12 ? [p.x + (tx - p.x) / d * 12, p.y + 8, p.z + (tz - p.z) / d * 12] : [tx + 0.5, Math.min(p.y + 8, ty + 1), tz + 0.5];
    this.addEntity({
      id: this.nextEntityId++, type: 'eye', x: p.x, y: p.y + 1.5, z: p.z, halfW: 0.125, height: 0.25,
      vx: 0, vy: 0, vz: 0, yaw: 0, age: 0, goal, start: [p.x, p.y + 1.5, p.z],
    });
    this.broadcastHere({ t: 'sfx', s: 'eye', x: p.x, y: p.y, z: p.z });
  }

  tickEye(e, dt) {
    const T = 2; // seconds of flight, then it hovers a moment
    const f = Math.min(1, e.age / T);
    const ease = 1 - (1 - f) * (1 - f);
    e.x = e.start[0] + (e.goal[0] - e.start[0]) * ease;
    e.y = e.start[1] + (e.goal[1] - e.start[1]) * ease + Math.sin(e.age * 6) * 0.05;
    e.z = e.start[2] + (e.goal[2] - e.start[2]) * ease;
    if (e.age < T + 0.8) return;
    this.entities.delete(e.id);
    if (this.random() < 0.8) {
      const item = this.spawnItem(e.x, e.y, e.z, ITEM.EYE_OF_ENDER, 1, undefined, [0, 0, 0]);
      item.age = 0;
    } else {
      this.broadcastHere({ t: 'sfx', s: 'shatter', x: e.x, y: e.y, z: e.z });
    }
  }

  // The middle of the nearest stronghold's portal, or null (worlds older than generator 3 have none).
  nearestStronghold(x, z) {
    let best = null, bestD = Infinity;
    for (const spot of this.dims.overworld.world.strongholds()) {
      const c = portalCenter(spot);
      const d = Math.hypot(c[0] - x, c[2] - z);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  // After an eye goes into the frame at (x, y, z): if all 12 frames around a 3 x 3 opening
  // have eyes, the opening becomes an End portal.
  checkEndPortal(x, y, z) {
    for (let cx = x - 2; cx <= x + 2; cx++) for (let cz = z - 2; cz <= z + 2; cz++) {
      let ok = true;
      for (let i = -1; ok && i <= 1; i++) {
        for (const [fx, fz] of [[cx + i, cz - 2], [cx + i, cz + 2], [cx - 2, cz + i], [cx + 2, cz + i]]) {
          if (this.world.getBlock(fx, y, fz) !== BLOCK.END_PORTAL_FRAME + 1) { ok = false; break; }
        }
      }
      if (!ok) continue;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) this.setBlock(cx + dx, y, cz + dz, BLOCK.END_PORTAL);
      this.broadcast({ t: 'sfx', s: 'endPortal', x: cx, y, z: cz, everywhere: true });
      return true;
    }
    return false;
  }

  // ---------- the End fight ----------
  // When someone is in the End and the dragon is still alive, it's there, with an
  // end crystal on top of every obsidian pillar (until they're broken).
  tickEndFight() {
    this.ctx = 'end';
    const here = this.here();
    const dragon = [...this.entities.values()].find((e) => e.type === 'ender_dragon');
    if (!here.length || this.endState.dragonKilled) return;
    if (!dragon) {
      const d = this.spawnMob('ender_dragon', DRAGON_HOME[0] + 40, DRAGON_HOME[1], DRAGON_HOME[2]);
      d.phase = 'circle'; d.phaseTime = 0; d.angle = 0;
      this.dims.end.world.other.pillars.forEach((pl, i) => {
        if (this.endState.crystalsGone.includes(i)) return;
        const c = this.spawnMob('end_crystal', pl.x + 0.5, pl.top + 2, pl.z + 0.5);
        c.pillar = i;
        c.yaw = 0;
      });
      return;
    }
    // the boss bar, for everyone in the End
    const hp = Math.max(0, Math.round(dragon.hp));
    const changed = hp !== this.bossHp;
    this.bossHp = hp;
    // everyone in the End sees it, including players who just arrived or joined
    for (const p of here) {
      if (!changed && p.bossSent) continue;
      p.bossSent = true;
      this.send(p.peerId, { t: 'boss', name: 'Ender Dragon', hp, max: MOB_TYPES.ender_dragon.hp });
    }
  }

  // The dragon circles the island, now and then dives at a player or swoops down to
  // perch on the exit fountain (that's when it's easiest to hit), and smashes through
  // anything but end stone and obsidian.
  tickDragon(e, dt) {
    const t = MOB_TYPES.ender_dragon;
    e.phaseTime += dt;
    const target = this.nearestPlayer(e, 150, true);
    let goal, speed = t.speed;
    if (e.phase === 'circle') {
      e.angle += dt * 0.28;
      goal = [DRAGON_HOME[0] + Math.cos(e.angle) * 50, DRAGON_HOME[1] + Math.sin(e.angle * 2) * 6, DRAGON_HOME[2] + Math.sin(e.angle) * 50];
      if (e.phaseTime > 12) {
        // like Minecraft, it lands more often as its crystals are destroyed (and with no one to
        // attack, it only perches)
        const crystals = [...this.entities.values()].filter((c) => c.type === 'end_crystal' && c.dim === e.dim).length;
        const perch = 0.25 + 0.5 * (1 - Math.min(10, crystals) / 10);
        const r = this.random();
        e.phase = !target ? (r < 0.5 ? 'perch' : 'circle') : r < perch ? 'perch' : r < perch + (1 - perch) * 0.6 ? 'charge' : 'strafe';
        e.phaseTime = 0;
      }
    } else if (e.phase === 'charge') {
      if (!target || e.phaseTime > 6) { e.phase = 'circle'; e.phaseTime = 0; }
      else goal = [target[0].x, target[0].y + 1, target[0].z];
      speed *= 1.3;
    } else if (e.phase === 'strafe') {
      // fly past and spit a fireball of dragon's breath
      if (!target || e.phaseTime > 8) { e.phase = 'circle'; e.phaseTime = 0; }
      else {
        const [p, dist] = target;
        goal = [p.x, p.y + 18, p.z];
        if (dist < 48 && !e.shot && this.canSee(e.x, e.y + 1.5, e.z, p.x, p.y + 1.5, p.z)) {
          e.shot = true;
          const f = this.shootFireball(e, p, true);
          f.type = 'dragon_fireball';
          f.cause = "was killed by dragon's breath";
          this.broadcastHere({ t: 'sfx', s: 'dragonGrowl', x: e.x, y: e.y, z: e.z });
        }
        if (dist < 20 && e.shot) { e.phase = 'circle'; e.phaseTime = 0; e.shot = false; }
      }
    } else if (e.phase === 'perch') {
      goal = [0.5, FOUNTAIN_Y + 4, 0.5];
      const d = Math.hypot(e.x - goal[0], e.y - goal[1], e.z - goal[2]);
      if ((d < 2 || (d < 6 && e.phaseTime > 15)) && !e.perched) { e.perched = true; e.phaseTime = 0; e.x = goal[0]; e.y = goal[1]; e.z = goal[2]; e.vx = e.vy = e.vz = 0; }
      if (e.perched) {
        goal = [e.x, e.y, e.z];
        if (target) e.yaw = Math.atan2(-(target[0].x - e.x), -(target[0].z - e.z));
        if (e.phaseTime > 9) { e.perched = false; e.phase = 'circle'; e.phaseTime = 0; e.angle = Math.atan2(e.z, e.x); }
      }
      speed *= 0.7;
    }
    if (goal) {
      const dx = goal[0] - e.x, dy = goal[1] - e.y, dz = goal[2] - e.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const k = Math.min(1, dt * 1.5);
      const want = Math.min(speed, len * 2);
      e.vx += (dx / len * want - e.vx) * k;
      e.vy += (dy / len * want - e.vy) * k;
      e.vz += (dz / len * want - e.vz) * k;
      e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
      if (!e.perched && Math.hypot(e.vx, e.vz) > 0.5) e.yaw = Math.atan2(-e.vx, -e.vz);
    }
    // crystals heal it
    e.healTimer = (e.healTimer || 0) + dt;
    let healer = null, hd = 32;
    for (const c of this.entities.values()) {
      if (c.type !== 'end_crystal') continue;
      const d = Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z);
      c.charge = 0;
      if (d < hd) { hd = d; healer = c; }
    }
    e.healer = healer?.id ?? null;
    if (healer) {
      healer.charge = 2; // the beam shows
      if (e.healTimer >= 0.5) { e.healTimer = 0; e.hp = Math.min(t.hp, e.hp + 1); }
    }
    // running into it hurts and throws you back
    for (const p of this.here()) {
      if (p.dead || p.mode !== 'survival') continue;
      const dx = p.x - e.x, dz = p.z - e.z;
      if (Math.hypot(dx, dz) < t.halfW + 0.5 && p.y + 1.8 > e.y - 0.5 && p.y < e.y + t.height) {
        if ((p.dragonHit || 0) > this.now()) continue;
        p.dragonHit = this.now() + 1000;
        this.send(p.peerId, { t: 'hurt', amount: t.damage, from: [e.x, e.z], cause: 'was slain by Ender Dragon', knock: 3 });
      }
    }
    // smash blocks it flies through
    e.smash = (e.smash || 0) + dt;
    if (e.smash >= 0.25) {
      e.smash = 0;
      const bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
      for (let dx = -2; dx <= 2; dx++) for (let dy = 0; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
        const id = this.world.getBlock(bx + dx, by + dy, bz + dz);
        if (id !== BLOCK.AIR && !BLOCKS[id].liquid && !SOLID_IN_END.has(id)) this.setBlock(bx + dx, by + dy, bz + dz, BLOCK.AIR);
      }
    }
  }

  // Hits on the dragon: full damage while it's perched, otherwise like hitting its body (a quarter, plus 1).
  hurtDragon(e, damage, by) {
    if (e.hp <= 0) return;
    e.hp -= e.perched || damage >= 100 ? damage : damage / 4 + 1;
    if (by) e.angryAt = by;
    this.broadcastHere({ t: 'mobhurt', e: e.id });
    if (e.hp <= 0) this.killMob(e);
  }

  crystalBroken(e) {
    this.entities.delete(e.id);
    this.broadcastHere({ t: 'mobdeath', e: e.id });
    if (Number.isInteger(e.pillar) && !this.endState.crystalsGone.includes(e.pillar)) this.endState.crystalsGone.push(e.pillar);
    this.dirty = true;
    // a dragon being healed by it gets hurt
    const dragon = [...this.entities.values()].find((d) => d.type === 'ender_dragon');
    if (dragon && dragon.healer === e.id) this.hurtDragon(dragon, 10, null);
    this.explode(e.x, e.y, e.z, 6, 'was blown up by an End Crystal');
  }

  // The dragon is dead: experience rains down, the exit portal opens and the egg appears on top.
  dragonDied(e) {
    this.entities.delete(e.id);
    this.broadcastHere({ t: 'mobdeath', e: e.id });
    const first = !this.endState.dragonKilled;
    this.endState.dragonKilled = true;
    this.dirty = true;
    this.inDim('end', () => {
      this.broadcastHere({ t: 'boss', hp: 0 });
      this.broadcastHere({ t: 'sfx', s: 'dragonDeath', x: e.x, y: e.y, z: e.z });
      this.spawnXP(0.5, FOUNTAIN_Y + 6, 0.5, first ? 12000 : 500);
      for (const [x, y, z] of EndTerrain.portalCells()) this.setBlock(x, y, z, BLOCK.END_PORTAL);
      if (first) this.setBlock(0, FOUNTAIN_Y + 4, 0, BLOCK.DRAGON_EGG);
    });
    this.sys(`${e.angryAt ? `${e.angryAt} defeated the Ender Dragon!` : 'The Ender Dragon is dead!'} The way home is open.`);
  }

  // Dragon's breath: a lingering purple cloud where a dragon fireball lands.
  tickBreath(e, dt) {
    e.age += dt;
    if (e.age > 5) { this.entities.delete(e.id); return; }
    e.tick = (e.tick || 0) + dt;
    if (e.tick < 0.5) return;
    e.tick = 0;
    for (const p of this.here()) {
      if (p.dead || p.mode !== 'survival') continue;
      if (Math.hypot(p.x - e.x, p.z - e.z) < 3 && p.y >= e.y - 1 && p.y < e.y + 2) {
        this.send(p.peerId, { t: 'hurt', amount: 3, cause: "was killed by dragon's breath" });
      }
    }
  }

  // Monsters of the Nether and the End (see spawnMobs). Nether mobs don't care about light;
  // blazes and wither skeletons only spawn in fortresses. The End is full of endermen.
  spawnOther(p, counts) {
    if (p.dim === 'end') {
      if (counts.hostile >= 10 || this.random() < 0.5) return;
      const a = this.random() * Math.PI * 2, dist = 16 + this.random() * 32;
      const x = Math.floor(p.x + Math.cos(a) * dist), z = Math.floor(p.z + Math.sin(a) * dist);
      const y = this.world.topBlockY(x, z);
      if (y > 0 && this.world.getBlock(x, y, z) === BLOCK.END_STONE) {
        const e = this.spawnMob('enderman', x + 0.5, y + 1, z + 0.5);
        if (collides(this.world, e)) this.entities.delete(e.id);
      }
      return;
    }
    if (p.dim !== 'nether' || counts.hostile >= 12 || this.random() < 0.4) return;
    const angle = this.random() * Math.PI * 2;
    const dist = 20 + this.random() * 28;
    let x = Math.floor(p.x + Math.cos(angle) * dist), z = Math.floor(p.z + Math.sin(angle) * dist);
    const startY = Math.max(8, Math.min(118, Math.floor(p.y) + Math.floor(this.random() * 40) - 20));
    let y = -1;
    for (let yy = startY; yy > startY - 24 && yy > 5; yy--) {
      const floor = this.world.getBlock(x, yy - 1, z);
      if (BLOCKS[floor].solid && !BLOCKS[floor].transparent && this.world.getBlock(x, yy, z) === BLOCK.AIR && this.world.getBlock(x, yy + 1, z) === BLOCK.AIR) { y = yy; break; }
    }
    // near a fortress, half the tries are on its walkways (where blazes and wither skeletons live)
    const fort = this.random() < 0.5 ? this.world.other?.fortressSpot?.(p.x, p.z, this.random) : null;
    if (fort && this.world.getBlock(fort[0], fort[1] - 1, fort[2]) === BLOCK.NETHER_BRICKS &&
      this.world.getBlock(fort[0], fort[1], fort[2]) === BLOCK.AIR && this.world.getBlock(fort[0], fort[1] + 1, fort[2]) === BLOCK.AIR &&
      Math.hypot(fort[0] - p.x, fort[2] - p.z) > 12 && Math.hypot(fort[0] - p.x, fort[2] - p.z) < 64) {
      [x, y, z] = fort;
    }
    if (y < 0) return;
    const floor = this.world.getBlock(x, y - 1, z);
    const roll = this.random();
    let type, group = 1;
    if (floor === BLOCK.NETHER_BRICKS) type = roll < 0.4 ? 'blaze' : roll < 0.7 ? 'wither_skeleton' : roll < 0.8 ? 'magma_cube' : roll < 0.9 ? 'skeleton' : 'zombified_piglin';
    else {
      const biome = this.world.netherBiome(x, z);
      if (biome === 1) type = roll < 0.25 ? 'ghast' : roll < 0.85 ? 'skeleton' : 'enderman'; // soul sand valley
      else if (biome === 2) type = roll < 0.3 ? 'ghast' : 'magma_cube';                    // basalt deltas
      else if (roll < 0.12) type = 'ghast';
      else if (roll < 0.15) type = 'enderman';
      else if (roll < 0.19) type = 'magma_cube';
      else if (roll < 0.4) { type = 'piglin'; group = 1 + Math.floor(this.random() * 3); }
      else { type = 'zombified_piglin'; group = 2 + Math.floor(this.random() * 3); }
    }
    if (type === 'ghast') {
      // ghasts need lots of room
      y += 2;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy < 5; dy++) {
        if (this.world.getBlock(x + dx, y + dy, z + dz) !== BLOCK.AIR) return;
      }
    }
    for (let i = 0; i < group; i++) {
      const e = this.spawnMob(type, x + 0.5 + (i ? (this.random() - 0.5) * 3 : 0), y, z + 0.5 + (i ? (this.random() - 0.5) * 3 : 0));
      if (collides(this.world, e)) this.entities.delete(e.id);
    }
  }

  sendStates() {
    const moved = {}; // dim -> moves
    for (const p of this.players.values()) {
      if (!p.moved) continue;
      p.moved = false;
      (moved[p.dim] ??= []).push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(2), +p.pitch.toFixed(2), p.held || 0, (p.invisible ? 1 : 0) | (p.riding ? 2 : 0)]);
    }
    for (const p of this.players.values()) if (moved[p.dim]) this.send(p.peerId, { t: 'state', players: moved[p.dim] });

    for (const [peerId, p] of this.players) {
      const list = [];
      for (const e of this.entities.values()) {
        if (e.dim !== p.dim || Math.abs(e.x - p.x) > VIEW || Math.abs(e.z - p.z) > VIEW) continue;
        // flags: 1 = sheared sheep, 2 = creeper about to explode
        // (and for ghasts and blazes, 2 = about to shoot)
        const flags = e.type === 'xp' ? e.value : e.type === 'tnt' ? (Math.floor(e.fuse * 4) % 2 ? 2 : 0)
          : e.type === 'bobber' ? (e.owner << 2) | (e.bite > 0 ? 2 : 0)
          : (e.sheared || e.saddled ? 1 : 0) | (e.fuse > 0.2 || e.charge > 1 || e.swing > this.now() ? 2 : 0) | (e.fireTime > 0 ? 4 : 0) |
            (e.profession ? PROFESSIONS.indexOf(e.profession) << 4 : 0) | (e.baby > 0 ? 256 : 0) |
            (e.size ? SLIME_SIZES.indexOf(e.size) << 9 : 0) | (e.sitting || e.charged ? 2048 : 0) | (e.tamed ? 4096 : 0) | (e.type === 'wolf' && (e.angryAt || e.target) ? 8192 : 0) | ((e.color || 0) << 14);
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
    this.save.weather = { ...this.weather };
    this.save.furnaces = Object.fromEntries(o.furnaces);
    this.save.chests = Object.fromEntries(o.chests);
    this.save.brewers = Object.fromEntries(o.brewers);
    const dims = this.save.dims || {};
    for (const dim of DIMENSIONS) {
      if (dim === 'overworld') continue;
      const d = this.dims[dim];
      dims[dim] = { ...dims[dim], edits: d.world.exportEdits(), furnaces: Object.fromEntries(d.furnaces), chests: Object.fromEntries(d.chests), brewers: Object.fromEntries(d.brewers) };
    }
    Object.assign(dims.end, this.endState);
    this.save.dims = dims;
    this.save.portals = this.portals;
    this.save.villagesDone = [...this.villagesDone];
    this.save.entities = [...this.entities.values()].filter((e) => e.persist).map((e) => {
      const { id, vx, vy, vz, think, walk, panic, attackCooldown, onGround, hurtUntil, ...keep } = e;
      return structuredClone(keep);
    });
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

// more mobs' behaviour lives in mob-ai.js
Object.assign(GameHost.prototype, mobAI);
