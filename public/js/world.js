// Deterministic terrain generation plus player edits.
// The same seed always produces the same terrain, so only the blocks players
// change ("edits") need to be sent over the network and saved.

import { CHUNK, HEIGHT, SEA_LEVEL, BLOCK } from './blocks.js';
import { makeNoise2D, makeNoise3D, hash2, mulberry32 } from './noise.js';

const TREE_CELL = 6;   // at most one tree per TREE_CELL x TREE_CELL area
const SNOW_LEVEL = 64;

export function chunkKey(cx, cz) {
  return cx + ',' + cz;
}

export function blockIndex(lx, y, lz) {
  return (y * CHUNK + lz) * CHUNK + lx;
}

// Generator versions: worlds remember which one created them, so updating the
// game never reshapes terrain in worlds that already exist.
//   1: original terrain
//   2: adds deepslate, copper, granite/diorite/andesite and cherry trees
export const LATEST_GEN = 2;

export class World {
  constructor(seed, gen = 1) {
    this.seed = seed | 0;
    this.gen = gen;
    this.chunks = new Map(); // chunkKey -> Uint8Array
    this.edits = new Map();  // chunkKey -> Map(blockIndex -> block id)
    this.noiseA = makeNoise2D(this.seed);
    this.noiseB = makeNoise2D(this.seed + 1);
    this.noiseC = makeNoise2D(this.seed + 2);
    this.noiseM = makeNoise2D(this.seed + 3);
    this.noiseT = makeNoise2D(this.seed + 4); // temperature: deserts and snow
    this.noiseF = makeNoise2D(this.seed + 5); // forest type
    this.cave1 = makeNoise3D(this.seed + 6);
    this.cave2 = makeNoise3D(this.seed + 7);
    this.cavern = makeNoise3D(this.seed + 8);
  }

  // Ground height (y of the top solid block) for a column.
  heightAt(x, z) {
    const n =
      this.noiseA(x / 220, z / 220) * 0.6 +
      this.noiseB(x / 70, z / 70) * 0.3 +
      this.noiseC(x / 24, z / 24) * 0.1;
    const m = (this.noiseM(x / 500, z / 500) + 1) / 2; // 0 = flat, 1 = mountains
    const h = SEA_LEVEL + 3 + n * (9 + m * m * 40);
    return Math.max(5, Math.min(HEIGHT - 20, Math.floor(h)));
  }

  temperature(x, z) {
    return this.noiseT(x / 400, z / 400);
  }

  // Caves: winding tunnels where two noise fields are both near zero, plus
  // occasional big caverns deeper down (kept below the surface so hills don't collapse).
  isCave(x, y, z, h) {
    if (y < 2 || y > h) return false;
    if (h <= SEA_LEVEL + 1 && y > h - 5) return false; // keep the sea floor sealed
    if (y < h - 10 && y > 4 && this.cavern(x / 60, y / 28, z / 60) > 0.7) return true;
    const a = this.cave1(x / 28, y / 20, z / 28);
    if (Math.abs(a) > 0.11) return false;
    const b = this.cave2(x / 28, y / 20, z / 28);
    return Math.abs(b) < 0.11;
  }

  getChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    let data = this.chunks.get(key);
    if (!data) {
      data = this.generate(cx, cz);
      this.chunks.set(key, data);
    }
    return data;
  }

  hasChunk(cx, cz) {
    return this.chunks.has(chunkKey(cx, cz));
  }

  getBlock(x, y, z) {
    if (y < 0) return BLOCK.BEDROCK;
    if (y >= HEIGHT) return BLOCK.AIR;
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const data = this.getChunk(cx, cz);
    return data[blockIndex(x - cx * CHUNK, y, z - cz * CHUNK)];
  }

  // Changes a block and remembers it as an edit. Returns false if out of range.
  setBlock(x, y, z, id) {
    if (y < 0 || y >= HEIGHT) return false;
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    const key = chunkKey(cx, cz);
    const idx = blockIndex(x - cx * CHUNK, y, z - cz * CHUNK);
    let chunkEdits = this.edits.get(key);
    if (!chunkEdits) {
      chunkEdits = new Map();
      this.edits.set(key, chunkEdits);
    }
    chunkEdits.set(idx, id);
    const data = this.chunks.get(key);
    if (data) data[idx] = id;
    return true;
  }

  // Highest non-air block in a column (after edits), or -1.
  topBlockY(x, z) {
    for (let y = HEIGHT - 1; y >= 0; y--) if (this.getBlock(x, y, z) !== BLOCK.AIR) return y;
    return -1;
  }

  // Edits as a flat list of [x, y, z, id] for sending/saving.
  exportEdits() {
    const out = [];
    for (const [key, chunkEdits] of this.edits) {
      const [cx, cz] = key.split(',').map(Number);
      for (const [idx, id] of chunkEdits) {
        const lx = idx % CHUNK;
        const lz = Math.floor(idx / CHUNK) % CHUNK;
        const y = Math.floor(idx / (CHUNK * CHUNK));
        out.push([cx * CHUNK + lx, y, cz * CHUNK + lz, id]);
      }
    }
    return out;
  }

  importEdits(list) {
    for (const [x, y, z, id] of list) this.setBlock(x, y, z, id);
  }

  // Frees terrain data far from (pcx, pcz). Edits are kept, so it regenerates identically.
  unloadFar(pcx, pcz, radius) {
    for (const key of this.chunks.keys()) {
      const comma = key.indexOf(',');
      const cx = +key.slice(0, comma);
      const cz = +key.slice(comma + 1);
      if (Math.abs(cx - pcx) > radius || Math.abs(cz - pcz) > radius) this.chunks.delete(key);
    }
  }

  // What kind of tree (if any) grows in a tree cell. Returns null or {x, z, h, birch, trunk}.
  treeInCell(gx, gz) {
    const s = this.seed;
    const tx = gx * TREE_CELL + 1 + Math.floor(hash2(gx, gz, s + 101) * (TREE_CELL - 2));
    const tz = gz * TREE_CELL + 1 + Math.floor(hash2(gx, gz, s + 102) * (TREE_CELL - 2));
    const forest = this.noiseF(tx / 150, tz / 150);
    const density = forest > 0.25 ? 0.75 : forest > -0.2 ? 0.35 : 0.08;
    if (hash2(gx, gz, s + 100) > density) return null;
    const h = this.heightAt(tx, tz);
    if (h <= SEA_LEVEL || h >= SNOW_LEVEL - 4 || this.temperature(tx, tz) > 0.45) return null;
    if (this.isCave(tx, h, tz, h)) return null;
    const birch = forest > 0.4 || hash2(gx, gz, s + 105) < 0.15;
    const temp = this.temperature(tx, tz);
    const cherry = this.gen >= 2 && !birch && forest > -0.1 && forest < 0.3 && temp > 0.12 && temp < 0.4;
    const trunk = 4 + Math.floor(hash2(tx, tz, s + 103) * 3);
    return { x: tx, z: tz, h, birch, cherry, trunk };
  }

  generate(cx, cz) {
    const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;
    const s = this.seed;
    const heights = new Int16Array(CHUNK * CHUNK);

    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx;
        const z = z0 + lz;
        const h = this.heightAt(x, z);
        heights[lz * CHUNK + lx] = h;
        const temp = this.temperature(x, z);
        const desert = temp > 0.45;
        const underwater = h < SEA_LEVEL;
        let top, filler;
        if (underwater) {
          const r = hash2(x, z, s + 20);
          top = r < 0.12 ? BLOCK.CLAY : r < 0.35 ? BLOCK.GRAVEL : BLOCK.SAND;
          filler = top === BLOCK.CLAY ? BLOCK.DIRT : top;
        } else if (h <= SEA_LEVEL + 1 || desert) {
          top = BLOCK.SAND; filler = BLOCK.SAND;
        } else if (h >= SNOW_LEVEL || (temp < -0.55 && h > SEA_LEVEL + 6)) {
          top = BLOCK.SNOWY_GRASS; filler = BLOCK.DIRT;
        } else {
          top = BLOCK.GRASS; filler = BLOCK.DIRT;
        }

        data[blockIndex(lx, 0, lz)] = BLOCK.BEDROCK;
        for (let y = 1; y <= h; y++) {
          let id;
          if (y <= 2 && hash2(x * 31 + y, z, s + 21) < 0.5) id = BLOCK.BEDROCK;
          else if (y === h) id = top;
          else if (y >= h - 3) id = filler;
          else if (desert && y >= h - 7) id = BLOCK.SANDSTONE;
          else if (this.gen >= 2 && y < 10 + Math.floor(hash2(x, z * 7 + y, s + 22) * 3)) id = BLOCK.DEEPSLATE;
          else id = BLOCK.STONE;
          if (id !== BLOCK.BEDROCK && this.isCave(x, y, z, h)) id = BLOCK.AIR;
          data[blockIndex(lx, y, lz)] = id;
        }
        for (let y = h + 1; y <= SEA_LEVEL; y++) data[blockIndex(lx, y, lz)] = BLOCK.WATER;
      }
    }

    this.placeOres(data, cx, cz);

    // Trees: check every cell whose tree could reach into this chunk.
    const minGX = Math.floor((x0 - 3) / TREE_CELL);
    const maxGX = Math.floor((x0 + CHUNK + 3) / TREE_CELL);
    const minGZ = Math.floor((z0 - 3) / TREE_CELL);
    const maxGZ = Math.floor((z0 + CHUNK + 3) / TREE_CELL);
    for (let gz = minGZ; gz <= maxGZ; gz++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        const t = this.treeInCell(gx, gz);
        if (t) this.placeTree(data, x0, z0, t);
      }
    }

    // Flowers and tall grass on grass blocks
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const h = heights[lz * CHUNK + lx];
        if (h + 1 >= HEIGHT) continue;
        if (data[blockIndex(lx, h, lz)] !== BLOCK.GRASS || data[blockIndex(lx, h + 1, lz)] !== BLOCK.AIR) continue;
        const r = hash2(x0 + lx, z0 + lz, s + 30);
        let plant = 0;
        if (r < 0.1) plant = BLOCK.TALL_GRASS;
        else if (r < 0.112) plant = BLOCK.DANDELION;
        else if (r < 0.122) plant = BLOCK.POPPY;
        if (plant) data[blockIndex(lx, h + 1, lz)] = plant;
      }
    }

    const chunkEdits = this.edits.get(chunkKey(cx, cz));
    if (chunkEdits) for (const [idx, id] of chunkEdits) data[idx] = id;
    return data;
  }

  // Ore veins: small random-walk blobs, kept inside the chunk so generation stays order-independent.
  placeOres(data, cx, cz) {
    const rand = mulberry32((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ this.seed) >>> 0);
    const kinds = [
      [BLOCK.COAL_ORE, 20, 80, 10, 8],    // id, veins per chunk, max y, vein size, min y
      [BLOCK.IRON_ORE, 10, 56, 6, 4],
      [BLOCK.GOLD_ORE, 3, 30, 5, 4],
      [BLOCK.DIAMOND_ORE, 1, 16, 5, 3],
    ];
    if (this.gen >= 2) {
      // stone variants first (big patches), then copper; ores replace them like stone
      kinds.unshift([BLOCK.GRANITE, 1, 70, 30, 4], [BLOCK.DIORITE, 1, 70, 30, 4], [BLOCK.ANDESITE, 1, 70, 30, 4]);
      kinds.push([BLOCK.COPPER_ORE, 6, 60, 8, 4]);
    }
    const deep = { [BLOCK.COAL_ORE]: BLOCK.DEEPSLATE_COAL_ORE, [BLOCK.IRON_ORE]: BLOCK.DEEPSLATE_IRON_ORE,
      [BLOCK.GOLD_ORE]: BLOCK.DEEPSLATE_GOLD_ORE, [BLOCK.DIAMOND_ORE]: BLOCK.DEEPSLATE_DIAMOND_ORE,
      [BLOCK.COPPER_ORE]: BLOCK.DEEPSLATE_COPPER_ORE };
    const isOreHost = (b) => b === BLOCK.STONE || b === BLOCK.GRANITE || b === BLOCK.DIORITE || b === BLOCK.ANDESITE;
    for (const [id, veins, maxY, size, minY] of kinds) {
      for (let v = 0; v < veins; v++) {
        let x = Math.floor(rand() * CHUNK);
        let y = minY + Math.floor(rand() * (maxY - minY));
        let z = Math.floor(rand() * CHUNK);
        const n = 2 + Math.floor(rand() * size);
        for (let i = 0; i < n; i++) {
          if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK && y > 0 && y < HEIGHT) {
            const idx = blockIndex(x, y, z);
            if (data[idx] === BLOCK.STONE || (deep[id] === undefined ? false : isOreHost(data[idx]))) data[idx] = id;
            else if (data[idx] === BLOCK.DEEPSLATE && deep[id]) data[idx] = deep[id];
          }
          const d = Math.floor(rand() * 6);
          if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++;
          else if (d === 3) y--; else if (d === 4) z++; else z--;
        }
      }
    }
  }

  placeTree(data, x0, z0, t) {
    const put = (x, y, z, id, onlyAir) => {
      const lx = x - x0;
      const lz = z - z0;
      if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 0 || y >= HEIGHT) return;
      const idx = blockIndex(lx, y, lz);
      if (onlyAir && data[idx] !== BLOCK.AIR && data[idx] !== BLOCK.TALL_GRASS) return;
      data[idx] = id;
    };
    const log = t.cherry ? BLOCK.CHERRY_LOG : t.birch ? BLOCK.BIRCH_LOG : BLOCK.LOG;
    const leaves = t.cherry ? BLOCK.CHERRY_LEAVES : t.birch ? BLOCK.BIRCH_LEAVES : BLOCK.LEAVES;
    const ty = t.h + 1;
    const top = ty + t.trunk - 1;
    for (let y = top - 2; y <= top + 1; y++) {
      const r = y <= top - 1 ? 2 : 1;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const corner = Math.abs(dx) === r && Math.abs(dz) === r;
          if (corner && (y >= top || hash2(t.x + dx * 7 + y, t.z + dz * 13, this.seed + 104) < 0.5)) continue;
          put(t.x + dx, y, t.z + dz, leaves, true);
        }
      }
    }
    for (let y = ty; y <= top; y++) put(t.x, y, t.z, log, false);
    put(t.x, t.h, t.z, BLOCK.DIRT, false); // grass under a trunk becomes dirt
  }
}
