// The Nether: a huge cave between a bedrock floor (y 0-4) and roof (y 123-127),
// a lava sea up to y 31, netherrack everywhere, soul sand valleys and basalt
// deltas, glowstone hanging from the ceilings, quartz and gold ores, and
// nether brick fortresses with blazes.

import { CHUNK, HEIGHT, BLOCK } from './blocks.js';
import { makeNoise2D, makeNoise3D, hash2, mulberry32 } from './noise.js';

export const NETHER_LAVA = 31;
export const NETHER_ROOF = 127;
export const NETHER_BIOME = { WASTES: 0, SOUL_SAND_VALLEY: 1, BASALT_DELTAS: 2 };
export const NETHER_FOG = [[0x33, 0x08, 0x08], [0x1b, 0x47, 0x45], [0x68, 0x5f, 0x70]];

const idx = (lx, y, lz) => (y * CHUNK + lz) * CHUNK + lx;
const FORT_CELL = 320;  // at most one fortress per 320 x 320 blocks
const FORT_Y = 64;      // walkway floor
const FORT_ARM = 56;    // bridge length each way from the centre

function trilerp(c000, c100, c010, c110, c001, c101, c011, c111, fx, fy, fz) {
  const x00 = c000 + (c100 - c000) * fx, x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx, x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

export class NetherTerrain {
  constructor(seed) {
    this.seed = seed | 0;
    this.d1 = makeNoise3D((this.seed + 3001) | 0);
    this.d2 = makeNoise3D((this.seed + 3002) | 0);
    this.d3 = makeNoise3D((this.seed + 3003) | 0);
    this.biomeNoise = makeNoise2D((this.seed + 3004) | 0);
    this.biomeNoise2 = makeNoise2D((this.seed + 3005) | 0);
  }

  biome(x, z) {
    const a = this.biomeNoise(x / 260, z / 260), b = this.biomeNoise2(x / 300, z / 300);
    if (a > 0.35) return NETHER_BIOME.SOUL_SAND_VALLEY;
    if (b > 0.4) return NETHER_BIOME.BASALT_DELTAS;
    return NETHER_BIOME.WASTES;
  }

  // Solid where density > 0: big caverns, more solid near the floor and the roof.
  density(x, y, z) {
    const n = this.d1(x / 90, y / 46, z / 90) * 0.6 + this.d2(x / 34, y / 22, z / 34) * 0.3 + this.d3(x / 14, y / 11, z / 14) * 0.1;
    const floor = Math.max(0, (34 - y) / 34) * 1.3;
    const roof = Math.max(0, (y - 92) / 30) * 1.4;
    return n + floor + roof - 0.18;
  }

  // Fortress centre in a grid cell, or null.
  fortressIn(gx, gz) {
    if (hash2(gx, gz, this.seed + 3100) > 0.55) return null;
    const m = FORT_ARM + 16;
    return [gx * FORT_CELL + m + Math.floor(hash2(gx, gz, this.seed + 3101) * (FORT_CELL - 2 * m)),
      gz * FORT_CELL + m + Math.floor(hash2(gx, gz, this.seed + 3102) * (FORT_CELL - 2 * m))];
  }

  // The fortress block at (x, y, z), or undefined if no fortress is there.
  // Each fortress is a cross of nether brick bridges with railings, a hall in the
  // middle and pillars down into the lava.
  fortressBlock(x, y, z) {
    const gx = Math.floor(x / FORT_CELL), gz = Math.floor(z / FORT_CELL);
    const c = this.fortressIn(gx, gz);
    if (!c) return undefined;
    const dx = x - c[0], dz = z - c[1];
    const ax = Math.abs(dx), az = Math.abs(dz);
    const hall = ax <= 7 && az <= 7;
    const onX = az <= 2 && ax <= FORT_ARM, onZ = ax <= 2 && az <= FORT_ARM;
    if (!hall && !onX && !onZ) return undefined;
    const ry = y - FORT_Y;
    if (hall) {
      // nether wart grows on soul sand in the hall's corners
      const wart = ax >= 4 && ax <= 5 && az >= 4 && az <= 5;
      if (ry === 0) return wart ? BLOCK.SOUL_SAND : BLOCK.NETHER_BRICKS;
      if (ry === 1 && wart) return BLOCK.NETHER_WART + 3;
      if (ry === 6) return BLOCK.NETHER_BRICKS;
      if (ry > 0 && ry < 6) {
        const wall = ax === 7 || az === 7;
        const door = (ax <= 1 || az <= 1) && ry <= 3;
        if (wall && !door) return ry === 3 && (ax + az) % 3 === 0 ? BLOCK.NETHER_BRICK_FENCE : BLOCK.NETHER_BRICKS;
        return BLOCK.AIR;
      }
      if (ry < 0 && ax === 7 && az === 7) return y > 4 ? BLOCK.NETHER_BRICKS : undefined; // corner pillars
      return undefined;
    }
    // bridges
    const across = onX ? az : ax;
    const along = onX ? ax : az;
    if (ry === 0) return BLOCK.NETHER_BRICKS;
    if (ry === -1 && across <= 1) return BLOCK.NETHER_BRICKS;
    if (ry === 1 && across === 2) return BLOCK.NETHER_BRICKS;
    if (ry === 2 && across === 2 && along % 4 === 0) return BLOCK.NETHER_BRICK_FENCE;
    if (ry > 0 && ry <= 3 && across < 2) return BLOCK.AIR; // keep the walkway open through netherrack
    if (ry < -1 && across <= 1 && along % 12 === 6 && y > 4) return BLOCK.NETHER_BRICKS; // pillars
    return undefined;
  }

  generate(cx, cz) {
    const data = new Uint16Array(CHUNK * CHUNK * HEIGHT);
    const biomes = new Uint8Array(CHUNK * CHUNK);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const s = this.seed;
    // density sampled every 4 blocks (8 vertically) and interpolated
    const GY = 128 / 8 + 1;
    const grid = new Float32Array(25 * GY);
    for (let gy = 0; gy < GY; gy++) for (let gz = 0; gz < 5; gz++) for (let gx = 0; gx < 5; gx++) {
      grid[(gy * 5 + gz) * 5 + gx] = this.density(x0 + gx * 4, gy * 8, z0 + gz * 4);
    }
    const dens = (lx, y, lz) => {
      const gx = lx >> 2, gy = y >> 3, gz = lz >> 2;
      const at = (a, b, c) => grid[((gy + b) * 5 + gz + c) * 5 + gx + a];
      return trilerp(at(0, 0, 0), at(1, 0, 0), at(0, 1, 0), at(1, 1, 0), at(0, 0, 1), at(1, 0, 1), at(0, 1, 1), at(1, 1, 1), (lx & 3) / 4, (y & 7) / 8, (lz & 3) / 4);
    };
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const biome = this.biome(x, z);
        biomes[lz * CHUNK + lx] = biome;
        for (let y = 0; y <= NETHER_ROOF; y++) {
          let id;
          if (y === 0 || y === NETHER_ROOF) id = BLOCK.BEDROCK;
          else if (y <= 4 && hash2(x * 31 + y, z, s + 3200) < (5 - y) / 5) id = BLOCK.BEDROCK;
          else if (y >= NETHER_ROOF - 4 && hash2(x * 37 + y, z, s + 3201) < (y - (NETHER_ROOF - 5)) / 5) id = BLOCK.BEDROCK;
          else if (y < 120 && dens(lx, y, lz) > 0) id = BLOCK.NETHERRACK;
          else if (y >= 120) id = BLOCK.NETHERRACK;
          else id = y <= NETHER_LAVA ? BLOCK.LAVA : BLOCK.AIR;
          data[idx(lx, y, lz)] = id;
        }
        // biome floors: soul sand in the valleys, basalt in the deltas
        if (biome !== NETHER_BIOME.WASTES) {
          for (let y = 5; y < 120; y++) {
            const i = idx(lx, y, lz);
            if (data[i] !== BLOCK.NETHERRACK) continue;
            const above = data[idx(lx, y + 1, lz)];
            if (above !== BLOCK.AIR && above !== BLOCK.LAVA) continue;
            if (biome === NETHER_BIOME.SOUL_SAND_VALLEY) {
              data[i] = BLOCK.SOUL_SAND;
              if (data[idx(lx, y - 1, lz)] === BLOCK.NETHERRACK) data[idx(lx, y - 1, lz)] = BLOCK.SOUL_SAND;
            } else {
              data[i] = BLOCK.BASALT;
              if (hash2(x, z, s + 3202 + y) < 0.06 && above === BLOCK.AIR) { // basalt spikes
                for (let k = 1; k <= 3 && data[idx(lx, y + k, lz)] === BLOCK.AIR; k++) data[idx(lx, y + k, lz)] = BLOCK.BASALT;
              }
            }
          }
        }
      }
    }
    // the odd mushroom on the cavern floors
    for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
      const x = x0 + lx, z = z0 + lz;
      if (hash2(x, z, s + 3300) > 0.012) continue;
      for (let y = 34; y < 118; y++) {
        const i = idx(lx, y, lz);
        if ((data[i] === BLOCK.NETHERRACK || data[i] === BLOCK.SOUL_SAND) && data[idx(lx, y + 1, lz)] === BLOCK.AIR && hash2(x, y, z + s) < 0.3) {
          data[idx(lx, y + 1, lz)] = hash2(z, x, s + 3301) < 0.5 ? BLOCK.BROWN_MUSHROOM : BLOCK.RED_MUSHROOM;
          break;
        }
      }
    }
    this.placeOres(data, cx, cz);
    this.placeGlowstone(data, cx, cz);
    // fortresses
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx, z = z0 + lz;
        if (!this.fortressIn(Math.floor(x / FORT_CELL), Math.floor(z / FORT_CELL))) continue;
        for (let y = 5; y < FORT_Y + 8; y++) {
          const b = this.fortressBlock(x, y, z);
          if (b !== undefined) data[idx(lx, y, lz)] = b;
        }
      }
    }
    return { data, biomes };
  }

  placeOres(data, cx, cz) {
    const rand = mulberry32((Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ this.seed ^ 0x51ed270b) >>> 0);
    const kinds = [
      [BLOCK.NETHER_QUARTZ_ORE, 16, 10, 117, 12], [BLOCK.NETHER_GOLD_ORE, 10, 10, 117, 9],
      [BLOCK.MAGMA_BLOCK, 4, 26, 36, 14], [BLOCK.GRAVEL, 2, 28, 36, 30], [BLOCK.SOUL_SAND, 2, 28, 36, 30],
    ];
    for (const [id, veins, minY, maxY, size] of kinds) {
      for (let v = 0; v < veins; v++) {
        let x = Math.floor(rand() * CHUNK), y = minY + Math.floor(rand() * (maxY - minY)), z = Math.floor(rand() * CHUNK);
        const n = 2 + Math.floor(rand() * size);
        for (let i = 0; i < n; i++) {
          if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK && y > 0 && y < 127) {
            const j = idx(x, y, z);
            if (data[j] === BLOCK.NETHERRACK) data[j] = id;
          }
          const d = Math.floor(rand() * 6);
          if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++;
          else if (d === 3) y--; else if (d === 4) z++; else z--;
        }
      }
    }
  }

  // Clumps of glowstone hanging under netherrack ceilings.
  placeGlowstone(data, cx, cz) {
    const rand = mulberry32((Math.imul(cx, 2654435761) ^ Math.imul(cz, 40503) ^ this.seed ^ 0x1234567) >>> 0);
    for (let c = 0; c < 6; c++) {
      const lx = 2 + Math.floor(rand() * 12), lz = 2 + Math.floor(rand() * 12);
      let y = 40 + Math.floor(rand() * 80);
      // find a ceiling: netherrack with air below
      for (; y > 35; y--) if (data[idx(lx, y, lz)] === BLOCK.NETHERRACK && data[idx(lx, y - 1, lz)] === BLOCK.AIR) break;
      if (y <= 35) continue;
      // like Minecraft: grow downwards, only next to exactly one glowstone block, so
      // the clump hangs in branches from the ceiling
      data[idx(lx, y - 1, lz)] = BLOCK.GLOWSTONE;
      for (let i = 0; i < 220; i++) {
        const x = lx + Math.floor(rand() * 7) - 3, z = lz + Math.floor(rand() * 7) - 3, yy = y - 1 - Math.floor(rand() * 8);
        if (x < 0 || x >= CHUNK || z < 0 || z >= CHUNK || yy < 6 || data[idx(x, yy, z)] !== BLOCK.AIR) continue;
        let n = 0;
        if (x > 0 && data[idx(x - 1, yy, z)] === BLOCK.GLOWSTONE) n++;
        if (x < CHUNK - 1 && data[idx(x + 1, yy, z)] === BLOCK.GLOWSTONE) n++;
        if (z > 0 && data[idx(x, yy, z - 1)] === BLOCK.GLOWSTONE) n++;
        if (z < CHUNK - 1 && data[idx(x, yy, z + 1)] === BLOCK.GLOWSTONE) n++;
        if (data[idx(x, yy + 1, z)] === BLOCK.GLOWSTONE) n++;
        if (n === 1) data[idx(x, yy, z)] = BLOCK.GLOWSTONE;
      }
    }
  }
}
