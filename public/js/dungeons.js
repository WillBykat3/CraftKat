// Dungeons: small mossy cobblestone rooms deep underground with a monster spawner (zombie,
// skeleton or spider) and a chest or two of loot, like Minecraft's.

import { CHUNK, BLOCK, ITEM } from './blocks.js';
import { hash2, mulberry32 } from './noise.js';

const CELL = 48; // at most one dungeon per 48 x 48 columns
const idx = (lx, y, lz) => (y * CHUNK + lz) * CHUNK + lx;

// The dungeon in grid cell (gx, gz), or null: its centre, half sizes, spawner mob and chests.
export function dungeonIn(gx, gz, seed) {
  if (hash2(gx, gz, seed + 8100) > 0.4) return null;
  const h = (k) => hash2(gx, gz, seed + 8101 + k);
  const x = gx * CELL + 8 + Math.floor(h(0) * (CELL - 16)), z = gz * CELL + 8 + Math.floor(h(1) * (CELL - 16));
  const y = 14 + Math.floor(h(2) * 86); // shown y -50 to 35
  const hx = h(3) < 0.5 ? 3 : 4, hz = h(4) < 0.5 ? 3 : 4;
  const mob = h(5) < 0.5 ? 1 : h(5) < 0.75 ? 2 : 3; // SPAWNER + 1 zombie, 2 skeleton, 3 spider
  const chests = [[x - hx + 1, z], [x + hx - 1, z + 1]].slice(0, h(6) < 0.5 ? 1 : 2);
  return { x, y, z, hx, hz, mob, chests };
}

function dungeonBlock(d, x, y, z, seed) {
  const dx = x - d.x, dz = z - d.z, dy = y - d.y;
  if (Math.abs(dx) > d.hx || Math.abs(dz) > d.hz || dy < 0 || dy > 4) return undefined;
  const wall = Math.abs(dx) === d.hx || Math.abs(dz) === d.hz || dy === 0 || dy === 4;
  if (wall) return dy === 0 && hash2(x * 7 + y, z, seed + 8200) < 0.5 ? BLOCK.MOSSY_COBBLESTONE : dy === 0 ? BLOCK.COBBLE : hash2(x, z * 13 + y, seed + 8201) < 0.3 ? BLOCK.MOSSY_COBBLESTONE : BLOCK.COBBLE;
  if (dy === 1 && dx === 0 && dz === 0) return BLOCK.SPAWNER + d.mob;
  if (dy === 1 && d.chests.some(([cx, cz]) => cx === x && cz === z)) return BLOCK.CHEST;
  return BLOCK.AIR;
}

// Writes the dungeons reaching into chunk (cx, cz); heightAt(x, z) is the ground height
// (dungeons only go well under it).
export function applyDungeons(data, cx, cz, seed, heightAt) {
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  for (let gx = Math.floor((x0 - 8) / CELL); gx <= Math.floor((x0 + CHUNK + 8) / CELL); gx++) {
    for (let gz = Math.floor((z0 - 8) / CELL); gz <= Math.floor((z0 + CHUNK + 8) / CELL); gz++) {
      const d = dungeonIn(gx, gz, seed);
      if (!d || heightAt(d.x, d.z) < d.y + 10) continue;
      for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
        for (let dy = 0; dy <= 4; dy++) {
          const id = dungeonBlock(d, x0 + lx, d.y + dy, z0 + lz, seed);
          if (id !== undefined) data[idx(lx, d.y + dy, lz)] = id;
        }
      }
    }
  }
}

// Whether (x, y, z) holds a dungeon's chest (when the world made it).
export function isDungeonChest(x, y, z, seed, heightAt) {
  const d = dungeonIn(Math.floor(x / CELL), Math.floor(z / CELL), seed);
  return !!d && d.y + 1 === y && heightAt(d.x, d.z) >= d.y + 10 && d.chests.some(([cx, cz]) => cx === x && cz === z);
}

// Minecraft's dungeon chest loot: 1-3 rolls of rare things, 4 rolls of common ones.
const RARE = [[ITEM.SADDLE, 1, 1, 20], [ITEM.GOLDEN_APPLE, 1, 1, 15], [ITEM.NAME_TAG, 1, 1, 20], [ITEM.ENCHANTED_BOOK, 1, 1, 10],
  [ITEM.IRON_INGOT, 1, 4, 10], [ITEM.BREAD, 1, 1, 20], [ITEM.WHEAT, 1, 4, 20], [ITEM.BUCKET, 1, 1, 10], [ITEM.REDSTONE, 1, 4, 15],
  [ITEM.COAL, 1, 4, 15], [ITEM.GOLD_INGOT, 1, 4, 5], [ITEM.DIAMOND, 1, 1, 2]];
const COMMON = [[ITEM.BONE, 1, 8, 10], [ITEM.GUNPOWDER, 1, 8, 10], [ITEM.ROTTEN_FLESH, 1, 8, 10], [ITEM.STRING, 1, 8, 10]];
export function dungeonLoot(x, y, z, seed, randomBook) {
  const rand = mulberry32((seed ^ Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0);
  const pick = (table) => {
    let total = 0;
    for (const t of table) total += t[3];
    let r = rand() * total;
    for (const t of table) { r -= t[3]; if (r <= 0) return t; }
    return table[0];
  };
  const out = [];
  const add = ([id, min, max]) => {
    const s = { id, count: min + Math.floor(rand() * (max - min + 1)) };
    if (id === ITEM.ENCHANTED_BOOK) s.ench = randomBook(rand);
    out.push(s);
  };
  const rare = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < rare; i++) add(pick(RARE));
  for (let i = 0; i < 4; i++) add(pick(COMMON));
  // scattered through the chest's 27 slots
  const slots = new Array(27).fill(null);
  for (const s of out) {
    let i = Math.floor(rand() * 27);
    while (slots[i]) i = (i + 1) % 27;
    slots[i] = s;
  }
  return slots;
}
