// Terrain generator version 3: a taller world (internal y 0-255, shown as
// -64 to 191 like Minecraft), oceans, rivers, mountains and biomes with their
// own trees and plants, deepslate, ores at Minecraft's heights and lava deep down.
//
// Everything is a pure function of the seed and the block position, so any
// chunk can be generated on its own and always comes out the same.

import { CHUNK, HEIGHT, BLOCK, MAX_BLOCK } from './blocks.js';
import { makeNoise2D, makeNoise3D, hash2, mulberry32 } from './noise.js';
import { BIOME, FROZEN } from './biomes.js';

export const Y_OFFSET = 64;            // shown y = internal y - 64
export const SEA = 63 + Y_OFFSET;      // sea level (shown as 63)
const LAVA_LEVEL = -54 + Y_OFFSET;     // caves below this fill with lava
const DEEPSLATE_TOP = 0 + Y_OFFSET;    // deepslate below shown y 0 (blending up to 8)
const TREE_CELL = 5;
const TREE_REACH = 7;                  // how far a tree can stick out from its trunk

const idx = (lx, y, lz) => (y * CHUNK + lz) * CHUNK + lx;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function spline(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

// continentalness -> base height (shown y): deep ocean, ocean, coast, inland
const CONTINENT = [[-1, 24], [-0.5, 33], [-0.32, 42], [-0.2, 52], [-0.12, 59], [-0.05, 63.5], [0.05, 66], [0.35, 72], [1, 80]];

// Ground plants per biome: [tall grass, fern, flower chance, flowers]
const D = BLOCK.DANDELION, P = BLOCK.POPPY, CF = BLOCK.CORNFLOWER;
const PLANTS = {
  [BIOME.PLAINS]: [0.22, 0, 0.025, [D, P, CF]],
  [BIOME.SUNFLOWER_PLAINS]: [0.25, 0, 0.06, [D, D, P]],
  [BIOME.FOREST]: [0.1, 0, 0.012, [D, P]],
  [BIOME.FLOWER_FOREST]: [0.08, 0, 0.22, [D, P, CF]],
  [BIOME.BIRCH_FOREST]: [0.1, 0, 0.012, [D, P]],
  [BIOME.DARK_FOREST]: [0.08, 0, 0.004, [P]],
  [BIOME.TAIGA]: [0.08, 0.15, 0, []],
  [BIOME.SAVANNA]: [0.3, 0, 0.003, [D]],
  [BIOME.JUNGLE]: [0.3, 0.12, 0.004, [P]],
  [BIOME.SWAMP]: [0.08, 0, 0.003, [P]],
  [BIOME.MEADOW]: [0.4, 0, 0.08, [D, P, CF]],
  [BIOME.CHERRY_GROVE]: [0.15, 0, 0.02, [D, P]],
  [BIOME.RIVER]: [0.15, 0, 0.005, [D]],
  [BIOME.BEACH]: [0, 0, 0, []],
  [BIOME.STONY_PEAKS]: [0.02, 0, 0, []],
};

// Tree density (chance per 5x5 cell) per biome
const TREE_DENSITY = {
  [BIOME.FOREST]: 0.72, [BIOME.FLOWER_FOREST]: 0.4, [BIOME.BIRCH_FOREST]: 0.72, [BIOME.DARK_FOREST]: 0.97,
  [BIOME.TAIGA]: 0.62, [BIOME.SNOWY_TAIGA]: 0.45, [BIOME.SNOWY_PLAINS]: 0.02, [BIOME.PLAINS]: 0.04,
  [BIOME.SUNFLOWER_PLAINS]: 0.03, [BIOME.SAVANNA]: 0.14, [BIOME.JUNGLE]: 0.97, [BIOME.SWAMP]: 0.3,
  [BIOME.CHERRY_GROVE]: 0.3, [BIOME.MEADOW]: 0.025, [BIOME.SNOWY_SLOPES]: 0.02, [BIOME.RIVER]: 0.02,
};

export class Terrain3 {
  constructor(seed) {
    this.seed = seed | 0;
    const n2 = (k) => makeNoise2D((this.seed + 1000 + k * 7919) | 0);
    this.cont = [n2(0), n2(1)];
    this.ero = [n2(2), n2(3)];
    this.ridge = n2(4);
    this.hill = [n2(5), n2(6), n2(7)];
    this.temp = [n2(8), n2(9)];
    this.humid = [n2(10), n2(11)];
    this.weird = n2(12);
    this.river = [n2(13), n2(14)];
    this.warp = [n2(15), n2(16)];
    this.surface = n2(17);
    this.cave1 = makeNoise3D((this.seed + 2001) | 0);
    this.cave2 = makeNoise3D((this.seed + 2002) | 0);
    this.cheese = makeNoise3D((this.seed + 2003) | 0);
  }

  // Height (internal y of the top solid block) and biome of a column.
  column(x, z) {
    const wx = x + this.warp[0](x / 300, z / 300) * 45;
    const wz = z + this.warp[1](x / 300, z / 300) * 45;
    const c = this.cont[0](wx / 1700, wz / 1700) * 0.85 + this.cont[1](wx / 380, wz / 380) * 0.15 + 0.2; // + 0.2: about a third ocean
    const e = this.ero[0](x / 950, z / 950) * 0.85 + this.ero[1](x / 230, z / 230) * 0.15;
    const t = this.temp[0](x / 1400, z / 1400) * 0.9 + this.temp[1](x / 130, z / 130) * 0.1;
    const hu = this.humid[0](x / 1100, z / 1100) * 0.9 + this.humid[1](x / 120, z / 120) * 0.1;
    const w = this.weird(x / 650, z / 650);
    const detail = this.hill[2](x / 26, z / 26);

    const inland = smooth(-0.12, 0.04, c);
    let h = spline(CONTINENT, c);
    // mountains: where erosion is low, away from the coast; ridges make the peaks
    const mf = smooth(0.0, -0.5, e) * smooth(-0.04, 0.2, c);
    const ridge = 1 - Math.abs(this.ridge(wx / 420, wz / 420));
    h += mf * (ridge * ridge * ridge * 95 + 16 + detail * 6);
    // rolling hills elsewhere; flatter where erosion is high
    const hills = this.hill[0](x / 120, z / 120) * 0.7 + this.hill[1](x / 46, z / 46) * 0.3;
    h += inland * (1 - mf) * hills * lerp(10, 3, smooth(-0.2, 0.6, e)) + detail * 1.3 * inland;

    // swamps: flat, wet lowland in warm humid places
    const swamp = t > -0.15 && t < 0.45 ? smooth(0.36, 0.46, hu) * smooth(0.15, 0.3, e) * smooth(-0.02, 0.06, c) * (1 - smooth(0.05, 0.2, mf)) : 0;
    if (swamp > 0) h = lerp(h, 62.6 + detail * 1.6, swamp);

    // rivers: narrow valleys along a noise contour, cut below sea level
    const r = Math.abs(this.river[0](wx / 750, wz / 750) + this.river[1](x / 170, z / 170) * 0.12);
    let river = 0;
    if (r < 0.055) river = (1 - r / 0.055) * inland * (1 - smooth(0.2, 0.55, mf));
    if (river > 0) h = lerp(h, 58.5, smooth(0, 0.5, river));

    const shown = Math.max(-58, Math.min(HEIGHT - Y_OFFSET - 10, Math.round(h)));
    return {
      h: shown + Y_OFFSET,
      biome: this.pickBiome(shown, c, mf, t, hu, w, river, swamp),
    };
  }

  pickBiome(h, c, mf, t, hu, w, river, swamp) {
    if (h < 63) {
      if (river > 0.25 && c > -0.12) return t < -0.45 ? BIOME.FROZEN_RIVER : BIOME.RIVER;
      if (swamp > 0.5) return BIOME.SWAMP;
      if (t < -0.45) return BIOME.FROZEN_OCEAN;
      if (c < -0.45) return BIOME.DEEP_OCEAN;
      return t > 0.4 ? BIOME.WARM_OCEAN : BIOME.OCEAN;
    }
    if (h >= 160 || (h >= 128 + w * 6 && t < -0.1)) return h >= 150 ? BIOME.FROZEN_PEAKS : BIOME.SNOWY_SLOPES;
    if (h >= 128 + w * 6) return BIOME.STONY_PEAKS;
    if (c < 0.02 && h <= 66 && river < 0.25 && swamp < 0.5) {
      if (mf > 0.15) return BIOME.STONY_SHORE;
      return t < -0.45 ? BIOME.SNOWY_BEACH : t > 0.45 && hu < -0.05 ? BIOME.DESERT : BIOME.BEACH;
    }
    if (river > 0.55 && h <= 64) return t < -0.45 ? BIOME.FROZEN_RIVER : BIOME.RIVER;
    if (swamp > 0.5) return BIOME.SWAMP;
    if (h >= 96 && mf > 0.3 && t > -0.45 && t < 0.45) return w > 0.25 ? BIOME.CHERRY_GROVE : BIOME.MEADOW;
    if (t < -0.45) return hu > 0 ? BIOME.SNOWY_TAIGA : BIOME.SNOWY_PLAINS;
    if (t < -0.15) return BIOME.TAIGA;
    if (t > 0.45) return hu < -0.05 ? BIOME.DESERT : hu < 0.3 ? BIOME.SAVANNA : BIOME.JUNGLE;
    if (hu < -0.25) return w > 0.6 ? BIOME.SUNFLOWER_PLAINS : BIOME.PLAINS;
    if (hu < 0.12) return w < -0.55 ? BIOME.FLOWER_FOREST : BIOME.FOREST;
    if (hu < 0.3) return BIOME.BIRCH_FOREST;
    return BIOME.DARK_FOREST;
  }

  // ---------- caves ----------
  // Cave noise is sampled every 4 blocks and interpolated, which is much
  // faster than sampling every block and gives smooth tunnels.
  caveSample(x, y, z) {
    return [
      this.cave1(x / 44, y / 26, z / 44),
      this.cave2(x / 44, y / 26, z / 44),
      this.cheese(x / 90, y / 46, z / 90),
    ];
  }

  // Whether a cell is carved, from the 3 interpolated noise values.
  static carved(a, b, k, y, h, underwater) {
    if (y < 1 || y > h) return false;
    if (underwater && y > h - 6) return false;
    if (k > 0.58 && y < h - 14) return true; // big caverns
    const width = 0.075 + (y < 60 ? 0.025 : 0);
    return Math.abs(a) < width && Math.abs(b) < width;
  }

  // Interpolated cave values at any block (same arithmetic as generate()).
  caveAt(x, y, z) {
    const gx = Math.floor(x / 4) * 4, gy = Math.floor(y / 4) * 4, gz = Math.floor(z / 4) * 4;
    const fx = (x - gx) / 4, fy = (y - gy) / 4, fz = (z - gz) / 4;
    const s = [];
    // Math.fround: generate() keeps the samples in a Float32Array
    for (let k = 0; k < 8; k++) s.push(this.caveSample(gx + (k & 1) * 4, gy + ((k >> 1) & 1) * 4, gz + ((k >> 2) & 1) * 4).map(Math.fround));
    return [0, 1, 2].map((ch) => trilerp(s[0][ch], s[1][ch], s[2][ch], s[3][ch], s[4][ch], s[5][ch], s[6][ch], s[7][ch], fx, fy, fz));
  }

  // ---------- chunks ----------
  generate(cx, cz) {
    const data = new Uint16Array(CHUNK * CHUNK * HEIGHT);
    const biomes = new Uint8Array(CHUNK * CHUNK);
    const heights = new Int16Array(CHUNK * CHUNK);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const s = this.seed;

    // heights with a 1-block border (for slopes)
    const W = CHUNK + 2;
    const hb = new Int16Array(W * W);
    for (let z = 0; z < W; z++) {
      for (let x = 0; x < W; x++) {
        const col = this.column(x0 + x - 1, z0 + z - 1);
        hb[z * W + x] = col.h;
        if (x > 0 && z > 0 && x <= CHUNK && z <= CHUNK) biomes[(z - 1) * CHUNK + (x - 1)] = col.biome;
      }
    }

    // cave noise grid: 5 x (HEIGHT/4 + 1) x 5 points
    const GY = HEIGHT / 4 + 1;
    const grid = [new Float32Array(25 * GY), new Float32Array(25 * GY), new Float32Array(25 * GY)];
    let maxH = 0;
    for (let i = 0; i < hb.length; i++) if (hb[i] > maxH) maxH = hb[i];
    const gyMax = Math.min(GY - 1, Math.floor(maxH / 4) + 1);
    for (let gy = 0; gy <= gyMax; gy++) {
      for (let gz = 0; gz < 5; gz++) {
        for (let gx = 0; gx < 5; gx++) {
          const v = this.caveSample(x0 + gx * 4, gy * 4, z0 + gz * 4);
          const i = (gy * 5 + gz) * 5 + gx;
          grid[0][i] = v[0]; grid[1][i] = v[1]; grid[2][i] = v[2];
        }
      }
    }
    const caveVal = (ch, lx, y, lz) => {
      const g = grid[ch];
      const gx = lx >> 2, gy = y >> 2, gz = lz >> 2;
      const fx = (lx & 3) / 4, fy = (y & 3) / 4, fz = (lz & 3) / 4;
      const at = (dx, dy, dz) => g[((gy + dy) * 5 + gz + dz) * 5 + gx + dx];
      return trilerp(at(0, 0, 0), at(1, 0, 0), at(0, 1, 0), at(1, 1, 0), at(0, 0, 1), at(1, 0, 1), at(0, 1, 1), at(1, 1, 1), fx, fy, fz);
    };

    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const h = hb[(lz + 1) * W + lx + 1];
        heights[lz * CHUNK + lx] = h;
        const biome = biomes[lz * CHUNK + lx];
        const slope = Math.max(
          Math.abs(hb[(lz + 1) * W + lx + 2] - hb[(lz + 1) * W + lx]),
          Math.abs(hb[(lz + 2) * W + lx + 1] - hb[lz * W + lx + 1]));
        const [top, filler, depth, under, underDepth] = this.surfaceFor(biome, h, slope, x, z);
        const underwater = h < SEA;

        for (let y = 0; y <= h; y++) {
          let id;
          if (y === 0 || (y <= 4 && hash2(x * 31 + y, z, s + 21) < (5 - y) / 5)) { data[idx(lx, y, lz)] = BLOCK.BEDROCK; continue; }
          if (y === h) id = top;
          else if (y > h - depth) id = filler;
          else if (y > h - depth - underDepth) id = under;
          else if (y < DEEPSLATE_TOP || (y < DEEPSLATE_TOP + 8 && hash2(x, z * 7 + y, s + 22) < (DEEPSLATE_TOP + 8 - y) / 8)) id = BLOCK.DEEPSLATE;
          else id = BLOCK.STONE;
          const a = caveVal(0, lx, y, lz), b = caveVal(1, lx, y, lz), k = caveVal(2, lx, y, lz);
          if (Terrain3.carved(a, b, k, y, h, underwater)) id = y <= LAVA_LEVEL ? BLOCK.LAVA : BLOCK.AIR;
          data[idx(lx, y, lz)] = id;
        }
        const frozen = FROZEN.has(biome);
        for (let y = h + 1; y <= SEA; y++) data[idx(lx, y, lz)] = y === SEA && frozen ? BLOCK.ICE : BLOCK.WATER;
      }
    }

    this.placeOres(data, cx, cz, heights);

    // trees from every cell that could reach into this chunk
    const minGX = Math.floor((x0 - TREE_REACH) / TREE_CELL), maxGX = Math.floor((x0 + CHUNK + TREE_REACH) / TREE_CELL);
    const minGZ = Math.floor((z0 - TREE_REACH) / TREE_CELL), maxGZ = Math.floor((z0 + CHUNK + TREE_REACH) / TREE_CELL);
    for (let gz = minGZ; gz <= maxGZ; gz++) {
      for (let gx = minGX; gx <= maxGX; gx++) {
        const t = this.treeInCell(gx, gz);
        if (t) this.placeTree(data, x0, z0, t);
      }
    }

    this.placePlants(data, x0, z0, heights, biomes);
    return { data, biomes };
  }

  // [top, filler, filler depth, under, under depth]
  surfaceFor(biome, h, slope, x, z) {
    const s = this.seed;
    const r = hash2(x, z, s + 20);
    const depth = 3 + (r < 0.5 ? 0 : 1);
    if (h < SEA) {
      const n = this.surface(x / 18, z / 18);
      if (biome === BIOME.RIVER || biome === BIOME.FROZEN_RIVER || biome === BIOME.SWAMP) {
        const t = biome === BIOME.SWAMP ? (n > 0.3 ? BLOCK.CLAY : BLOCK.DIRT) : n > 0.45 ? BLOCK.CLAY : n < -0.35 ? BLOCK.GRAVEL : BLOCK.SAND;
        return [t, t === BLOCK.CLAY ? BLOCK.DIRT : t, depth, BLOCK.STONE, 0];
      }
      if (biome === BIOME.DEEP_OCEAN || biome === BIOME.FROZEN_OCEAN || h < SEA - 18) return [BLOCK.GRAVEL, BLOCK.GRAVEL, depth, BLOCK.STONE, 0];
      if (n > 0.55) return [BLOCK.CLAY, BLOCK.DIRT, depth, BLOCK.STONE, 0];
      if (n < -0.3) return [BLOCK.GRAVEL, BLOCK.GRAVEL, depth, BLOCK.STONE, 0];
      return [BLOCK.SAND, BLOCK.SAND, depth, BLOCK.SANDSTONE, 2];
    }
    switch (biome) {
      case BIOME.DESERT: return [BLOCK.SAND, BLOCK.SAND, depth + 1, BLOCK.SANDSTONE, 4];
      case BIOME.BEACH: case BIOME.SNOWY_BEACH:
        return [BLOCK.SAND, BLOCK.SAND, depth, BLOCK.SANDSTONE, 2];
      case BIOME.STONY_SHORE: case BIOME.STONY_PEAKS:
        return [BLOCK.STONE, BLOCK.STONE, 1, BLOCK.STONE, 0];
      case BIOME.SNOWY_SLOPES: case BIOME.FROZEN_PEAKS:
        if (slope >= 5) return [BLOCK.STONE, BLOCK.STONE, 1, BLOCK.STONE, 0];
        return [BLOCK.SNOW, BLOCK.SNOW, 2 + (r < 0.5 ? 1 : 0), BLOCK.STONE, 0];
      case BIOME.RIVER: case BIOME.FROZEN_RIVER:
        if (h <= SEA + 1) return [BLOCK.SAND, BLOCK.SAND, depth, BLOCK.STONE, 0];
        break;
      default: break;
    }
    if (slope >= 4 && h >= SEA + 20) return [BLOCK.STONE, BLOCK.STONE, 1, BLOCK.STONE, 0]; // cliffs
    if (FROZEN.has(biome)) return [BLOCK.SNOWY_GRASS, BLOCK.DIRT, depth, BLOCK.STONE, 0];
    if (h <= SEA && biome !== BIOME.SWAMP) return [BLOCK.SAND, BLOCK.SAND, depth, BLOCK.STONE, 0]; // shoreline
    return [BLOCK.GRASS, BLOCK.DIRT, depth, BLOCK.STONE, 0];
  }

  // Ore veins: small random walks that stay inside the chunk.
  placeOres(data, cx, cz, heights) {
    const rand = mulberry32((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ this.seed ^ 0x3c6ef372) >>> 0);
    const Y = (shown) => shown + Y_OFFSET;
    let mountain = 0;
    for (let i = 0; i < heights.length; i++) mountain = Math.max(mountain, heights[i]);
    // [id, veins, min y, max y (shown), vein size, triangular?]
    const kinds = [
      [BLOCK.GRANITE, 2, 0, 128, 32, false], [BLOCK.DIORITE, 2, 0, 128, 32, false], [BLOCK.ANDESITE, 2, 0, 128, 32, false],
      [BLOCK.DIRT, 3, 0, 160, 28, false], [BLOCK.GRAVEL, 3, -64, 160, 28, false],
      [BLOCK.COAL_ORE, 22, 0, 192, 14, true],
      [BLOCK.IRON_ORE, 10, -24, 56, 9, true], [BLOCK.IRON_ORE, 6, 80, 191, 9, false],
      [BLOCK.COPPER_ORE, 9, -16, 112, 10, true],
      [BLOCK.GOLD_ORE, 4, -64, 32, 8, true],
      [BLOCK.REDSTONE_ORE, 6, -64, 15, 7, false],
      [BLOCK.LAPIS_ORE, 2, -64, 64, 6, true],
      [BLOCK.DIAMOND_ORE, 3, -64, 16, 6, false], [BLOCK.DIAMOND_ORE, 2, -64, -44, 6, false],
    ];
    if (mountain >= Y(100)) kinds.push([BLOCK.EMERALD_ORE, 5, -16, 191, 1, false]);
    const deep = {
      [BLOCK.COAL_ORE]: BLOCK.DEEPSLATE_COAL_ORE, [BLOCK.IRON_ORE]: BLOCK.DEEPSLATE_IRON_ORE,
      [BLOCK.GOLD_ORE]: BLOCK.DEEPSLATE_GOLD_ORE, [BLOCK.DIAMOND_ORE]: BLOCK.DEEPSLATE_DIAMOND_ORE,
      [BLOCK.COPPER_ORE]: BLOCK.DEEPSLATE_COPPER_ORE, [BLOCK.REDSTONE_ORE]: BLOCK.DEEPSLATE_REDSTONE_ORE,
      [BLOCK.LAPIS_ORE]: BLOCK.DEEPSLATE_LAPIS_ORE,
    };
    const ORE_HOST = new Uint8Array(MAX_BLOCK);
    for (const b of [BLOCK.STONE, BLOCK.GRANITE, BLOCK.DIORITE, BLOCK.ANDESITE]) ORE_HOST[b] = 1;
    for (const [id, veins, minS, maxS, size, tri] of kinds) {
      const isOre = id !== BLOCK.GRANITE && id !== BLOCK.DIORITE && id !== BLOCK.ANDESITE && id !== BLOCK.DIRT && id !== BLOCK.GRAVEL;
      for (let v = 0; v < veins; v++) {
        let x = Math.floor(rand() * CHUNK);
        const f = tri ? (rand() + rand()) / 2 : rand();
        let y = Y(minS) + Math.floor(f * (maxS - minS));
        let z = Math.floor(rand() * CHUNK);
        const n = size === 1 ? 1 : 2 + Math.floor(rand() * size);
        for (let i = 0; i < n; i++) {
          if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK && y > 0 && y < HEIGHT) {
            const j = idx(x, y, z);
            const cur = data[j];
            if (isOre ? ORE_HOST[cur] : cur === BLOCK.STONE) data[j] = id;
            else if (cur === BLOCK.DEEPSLATE && (deep[id] || id === BLOCK.GRAVEL)) data[j] = deep[id] || id;
          }
          const d = Math.floor(rand() * 6);
          if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++;
          else if (d === 3) y--; else if (d === 4) z++; else z--;
        }
      }
    }
  }

  // ---------- trees ----------
  treeInCell(gx, gz) {
    const s = this.seed;
    const tx = gx * TREE_CELL + Math.floor(hash2(gx, gz, s + 101) * (TREE_CELL - 1));
    const tz = gz * TREE_CELL + Math.floor(hash2(gx, gz, s + 102) * (TREE_CELL - 1));
    const col = this.column(tx, tz);
    const density = TREE_DENSITY[col.biome] || 0;
    if (density === 0 || hash2(gx, gz, s + 100) > density) return null;
    const h = col.h;
    if (h < SEA) return null;
    // no trees on cliffs or in cave openings
    const ex = this.column(tx + 1, tz).h, wx = this.column(tx - 1, tz).h;
    const sz = this.column(tx, tz + 1).h, nz = this.column(tx, tz - 1).h;
    if (Math.max(Math.abs(ex - wx), Math.abs(sz - nz)) >= 4) return null;
    if (h <= SEA && col.biome !== BIOME.SWAMP) return null; // shoreline sand
    const [a, b, k] = this.caveAt(tx, h, tz);
    if (Terrain3.carved(a, b, k, h, h, false)) return null;

    const r = hash2(tx, tz, s + 105);
    const r2 = hash2(tx, tz, s + 103);
    let kind = 'oak';
    switch (col.biome) {
      case BIOME.FOREST: kind = r < 0.2 ? 'birch' : 'oak'; break;
      case BIOME.FLOWER_FOREST: kind = r < 0.5 ? 'birch' : 'oak'; break;
      case BIOME.BIRCH_FOREST: kind = 'birch'; break;
      case BIOME.DARK_FOREST: kind = r < 0.85 ? 'dark_oak' : 'oak'; break;
      case BIOME.TAIGA: case BIOME.SNOWY_TAIGA: case BIOME.SNOWY_PLAINS: case BIOME.SNOWY_SLOPES: kind = 'spruce'; break;
      case BIOME.SAVANNA: kind = r < 0.8 ? 'acacia' : 'oak'; break;
      case BIOME.JUNGLE: kind = r < 0.6 ? 'jungle' : 'jungle_bush'; break;
      case BIOME.SWAMP: kind = 'swamp_oak'; break;
      case BIOME.CHERRY_GROVE: kind = 'cherry'; break;
      case BIOME.MEADOW: kind = r < 0.5 ? 'birch' : 'oak'; break;
      default: kind = 'oak';
    }
    const trunk = {
      oak: 4 + Math.floor(r2 * 3), birch: 5 + Math.floor(r2 * 3), spruce: 7 + Math.floor(r2 * 4),
      dark_oak: 6 + Math.floor(r2 * 3), acacia: 5 + Math.floor(r2 * 2), jungle: 8 + Math.floor(r2 * 6),
      jungle_bush: 1, swamp_oak: 5 + Math.floor(r2 * 2), cherry: 5 + Math.floor(r2 * 2),
    }[kind];
    const t = { x: tx, z: tz, h, kind, trunk, dir: Math.floor(hash2(tx, tz, s + 106) * 4) };
    if (kind === 'dark_oak') {
      // the 2x2 trunk reaches down to the ground under each of its logs
      t.ground = [h, this.column(tx + 1, tz).h, this.column(tx, tz + 1).h, this.column(tx + 1, tz + 1).h];
      if (Math.max(...t.ground) - Math.min(...t.ground) > 2 || Math.min(...t.ground) < SEA) return null;
    }
    return t;
  }

  placeTree(data, x0, z0, t) {
    const s = this.seed;
    const put = (x, y, z, id, onlyAir) => {
      const lx = x - x0, lz = z - z0;
      if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 1 || y >= HEIGHT) return;
      const j = idx(lx, y, lz);
      const cur = data[j];
      if (onlyAir && cur !== BLOCK.AIR && cur !== BLOCK.TALL_GRASS && cur !== BLOCK.FERN) return;
      data[j] = id;
    };
    const blob = (cx, y, cz, r, leaves, trim) => {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const corner = Math.abs(dx) === r && Math.abs(dz) === r;
          if (corner && (trim === 'all' || hash2(cx + dx * 7 + y, cz + dz * 13, s + 104) < 0.5)) continue;
          if (trim === 'round' && dx * dx + dz * dz > r * r + 1) continue;
          put(cx + dx, y, cz + dz, leaves, true);
        }
      }
    };
    const ty = t.h + 1;
    const top = ty + t.trunk - 1;
    const column = (x, z, from, to, log) => { for (let y = from; y <= to; y++) put(x, y, z, log, false); };
    switch (t.kind) {
      case 'oak': case 'birch': {
        const log = t.kind === 'birch' ? BLOCK.BIRCH_LOG : BLOCK.LOG;
        const leaves = t.kind === 'birch' ? BLOCK.BIRCH_LEAVES : BLOCK.LEAVES;
        for (let y = top - 2; y <= top + 1; y++) blob(t.x, y, t.z, y <= top - 1 ? 2 : 1, leaves, y >= top ? 'all' : null);
        column(t.x, t.z, ty, top, log);
        break;
      }
      case 'swamp_oak': {
        for (let y = top - 3; y <= top + 1; y++) blob(t.x, y, t.z, y <= top - 2 ? 3 : y <= top ? 2 : 1, BLOCK.LEAVES, 'round');
        column(t.x, t.z, ty, top, BLOCK.LOG);
        break;
      }
      case 'spruce': {
        put(t.x, top + 1, t.z, BLOCK.SPRUCE_LEAVES, true);
        const maxR = t.trunk >= 9 ? 3 : 2;
        let i = 0;
        for (let y = top; y >= ty + 2; y--, i++) {
          const r = Math.min(maxR, Math.floor((i + 1) / 2)) - (i > 2 && i % 2 === 1 ? 1 : 0);
          if (r <= 0) { put(t.x + 1, y, t.z, BLOCK.SPRUCE_LEAVES, true); put(t.x - 1, y, t.z, BLOCK.SPRUCE_LEAVES, true); put(t.x, y, t.z + 1, BLOCK.SPRUCE_LEAVES, true); put(t.x, y, t.z - 1, BLOCK.SPRUCE_LEAVES, true); continue; }
          for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) + Math.abs(dz) > r + (r >= 2 ? 1 : 0)) continue;
            put(t.x + dx, y, t.z + dz, BLOCK.SPRUCE_LEAVES, true);
          }
        }
        column(t.x, t.z, ty, top, BLOCK.SPRUCE_LOG);
        break;
      }
      case 'dark_oak': {
        const cx = t.x, cz = t.z;
        for (let y = top - 2; y <= top + 1; y++) {
          const r = y <= top ? 3 : 2;
          for (let dz = -r; dz <= r + 1; dz++) for (let dx = -r; dx <= r + 1; dx++) {
            const ex = dx <= 0 ? -dx : dx - 1, ez = dz <= 0 ? -dz : dz - 1; // distance from the 2x2 trunk
            if (ex + ez > r + (y === top - 1 ? 1 : 0)) continue;
            if (y === top - 2 && ex + ez > r - 1) continue;
            put(cx + dx, y, cz + dz, BLOCK.DARK_OAK_LEAVES, true);
          }
        }
        const [g0, g1, g2, g3] = t.ground;
        column(cx, cz, g0 + 1, top, BLOCK.DARK_OAK_LOG);
        column(cx + 1, cz, g1 + 1, top, BLOCK.DARK_OAK_LOG);
        column(cx, cz + 1, g2 + 1, top, BLOCK.DARK_OAK_LOG);
        column(cx + 1, cz + 1, g3 + 1, top, BLOCK.DARK_OAK_LOG);
        put(cx, g0, cz, BLOCK.DIRT, false); put(cx + 1, g1, cz, BLOCK.DIRT, false);
        put(cx, g2, cz + 1, BLOCK.DIRT, false); put(cx + 1, g3, cz + 1, BLOCK.DIRT, false);
        return;
      }
      case 'acacia': {
        const [ddx, ddz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][t.dir];
        const straight = 2 + (t.trunk & 1);
        let x = t.x, z = t.z, y = ty;
        for (let i = 0; i < t.trunk; i++, y++) {
          if (i >= straight) { x += ddx; z += ddz; }
          put(x, y, z, BLOCK.ACACIA_LOG, false);
        }
        const cy = y; // canopy just above the last log
        for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
          if (Math.abs(dx) + Math.abs(dz) > 4) continue;
          put(x + dx, cy - 1, z + dz, BLOCK.ACACIA_LEAVES, true);
        }
        blob(x, cy, z, 1, BLOCK.ACACIA_LEAVES, null);
        put(x + 1, cy, z + 1, BLOCK.AIR, false);
        break;
      }
      case 'jungle': {
        for (let y = top - 2; y <= top + 1; y++) blob(t.x, y, t.z, y <= top - 1 ? 3 : y === top ? 2 : 1, BLOCK.JUNGLE_LEAVES, 'round');
        column(t.x, t.z, ty, top, BLOCK.JUNGLE_LOG);
        break;
      }
      case 'jungle_bush': {
        for (let y = ty; y <= ty + 2; y++) blob(t.x, y, t.z, y === ty ? 2 : 1, BLOCK.LEAVES, 'round');
        put(t.x, ty, t.z, BLOCK.JUNGLE_LOG, false);
        break;
      }
      case 'cherry': {
        for (let y = top - 1; y <= top + 2; y++) {
          const r = y <= top ? 3 : y === top + 1 ? 2 : 1;
          for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dz * dz > r * r + (r === 3 ? 0 : 1)) continue;
            put(t.x + dx, y, t.z + dz, BLOCK.CHERRY_LEAVES, true);
          }
        }
        // a few hanging leaves under the edge of the canopy
        for (let k = 0; k < 6; k++) {
          const a = hash2(t.x + k, t.z - k, s + 107) * Math.PI * 2;
          put(t.x + Math.round(Math.cos(a) * 2.6), top - 2, t.z + Math.round(Math.sin(a) * 2.6), BLOCK.CHERRY_LEAVES, true);
        }
        column(t.x, t.z, ty, top, BLOCK.CHERRY_LOG);
        break;
      }
      default: break;
    }
    put(t.x, t.h, t.z, BLOCK.DIRT, false); // grass under a trunk becomes dirt
  }

  // ---------- plants ----------
  placePlants(data, x0, z0, heights, biomes) {
    const s = this.seed;
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const h = heights[lz * CHUNK + lx];
        if (h + 3 >= HEIGHT || h < SEA) continue;
        const ground = data[idx(lx, h, lz)];
        if (data[idx(lx, h + 1, lz)] !== BLOCK.AIR) continue;
        const x = x0 + lx, z = z0 + lz;
        const biome = biomes[lz * CHUNK + lx];
        const r = hash2(x, z, s + 30);
        const r2 = hash2(x, z, s + 31);
        const inside = lx > 0 && lz > 0 && lx < CHUNK - 1 && lz < CHUNK - 1;

        // sugar cane on the shore next to water
        if (h === SEA && inside && (ground === BLOCK.GRASS || ground === BLOCK.SAND || ground === BLOCK.DIRT) && r < 0.12 &&
            [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => data[idx(lx + dx, h, lz + dz)] === BLOCK.WATER)) {
          const tall = 1 + Math.floor(r2 * 3);
          for (let k = 1; k <= tall; k++) data[idx(lx, h + k, lz)] = BLOCK.SUGAR_CANE;
          continue;
        }
        if (ground === BLOCK.SAND && biome === BIOME.DESERT) {
          if (r < 0.006 && inside && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => data[idx(lx + dx, h + 1, lz + dz)] === BLOCK.AIR)) {
            const tall = 1 + Math.floor(r2 * 3);
            for (let k = 1; k <= tall; k++) data[idx(lx, h + k, lz)] = BLOCK.CACTUS;
          } else if (r > 0.99) {
            data[idx(lx, h + 1, lz)] = BLOCK.DEAD_BUSH;
          }
          continue;
        }
        if (ground !== BLOCK.GRASS) continue;
        // melons in jungles; mushrooms in shady forests and swamps
        const r3 = hash2(x, z, s + 32);
        if (biome === BIOME.JUNGLE && r3 < 0.006) { data[idx(lx, h + 1, lz)] = BLOCK.MELON; continue; }
        if ((biome === BIOME.DARK_FOREST || biome === BIOME.SWAMP || biome === BIOME.TAIGA || biome === BIOME.SNOWY_TAIGA) && r3 < 0.004) {
          data[idx(lx, h + 1, lz)] = r3 < 0.002 ? BLOCK.BROWN_MUSHROOM : BLOCK.RED_MUSHROOM;
          continue;
        }
        const p = PLANTS[biome];
        if (!p) continue;
        const [grass, fern, flowerChance, flowers] = p;
        let plant = 0;
        if (r < flowerChance && flowers.length) plant = flowers[Math.floor(r2 * flowers.length)];
        else if (r < flowerChance + fern) plant = BLOCK.FERN;
        else if (r < flowerChance + fern + grass) plant = BLOCK.TALL_GRASS;
        if (plant) data[idx(lx, h + 1, lz)] = plant;
      }
    }
  }
}

function trilerp(c000, c100, c010, c110, c001, c101, c011, c111, fx, fy, fz) {
  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}
