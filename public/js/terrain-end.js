// The End: a floating island of end stone in the void, ringed by obsidian
// pillars (each with an end crystal on top while the dragon lives), the exit
// fountain in the middle, an obsidian platform where players arrive, and
// smaller islands far out.

import { CHUNK, HEIGHT, BLOCK } from './blocks.js';
import { makeNoise2D, hash2 } from './noise.js';

export const END_SURFACE = 60;               // main island top, roughly
export const END_PLATFORM = [100, 48, 0];    // obsidian platform players arrive on
export const FOUNTAIN_Y = 61;                // exit portal level

const idx = (lx, y, lz) => (y * CHUNK + lz) * CHUNK + lx;

export class EndTerrain {
  constructor(seed) {
    this.seed = seed | 0;
    this.edge = makeNoise2D((this.seed + 4001) | 0);
    this.bump = makeNoise2D((this.seed + 4002) | 0);
    this.outer = makeNoise2D((this.seed + 4003) | 0);
    // ten obsidian pillars in a circle, with shuffled heights like Minecraft's
    this.pillars = [];
    const order = [...Array(10).keys()].sort((a, b) => hash2(a, 0, this.seed + 4010) - hash2(b, 0, this.seed + 4010));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const k = order[i];
      this.pillars.push({ x: Math.round(Math.cos(a) * 42), z: Math.round(Math.sin(a) * 42), r: 2 + (k % 4), top: 76 + k * 3 });
    }
  }

  // The main island's top and bottom at a column, or null over the void.
  island(x, z) {
    const r = Math.hypot(x, z);
    const angle = Math.atan2(z, x);
    const R = 78 + this.edge(Math.cos(angle) * 2.2, Math.sin(angle) * 2.2) * 14;
    if (r < R) {
      const t = r / R;
      const top = END_SURFACE + Math.round(this.bump(x / 30, z / 30) * 2 * (1 - t));
      // the underside hangs down in ragged points, deepest in the middle
      const rag = 0.55 + 0.45 * Math.abs(this.outer(x / 9, z / 9));
      const depth = Math.round((1 - t * t) * 40 * rag) + 2;
      return [top - depth, top];
    }
    if (r > 900) {
      // outer islands
      const n = this.outer(x / 90, z / 90);
      if (n > 0.55) {
        const k = (n - 0.55) / 0.45;
        const top = 58 + Math.round(this.bump(x / 25, z / 25) * 3);
        return [top - Math.round(k * 22) - 1, top];
      }
    }
    return null;
  }

  generate(cx, cz) {
    const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const biomes = new Uint8Array(CHUNK * CHUNK);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const isl = this.island(x, z);
        if (isl) for (let y = Math.max(1, isl[0]); y <= isl[1]; y++) data[idx(lx, y, lz)] = BLOCK.END_STONE;
        // pillars
        for (const p of this.pillars) {
          if ((x - p.x) ** 2 + (z - p.z) ** 2 > p.r * p.r + p.r) continue;
          for (let y = END_SURFACE - 12; y <= p.top; y++) data[idx(lx, y, lz)] = BLOCK.OBSIDIAN;
          if (x === p.x && z === p.z) data[idx(lx, p.top + 1, lz)] = BLOCK.BEDROCK;
        }
        // exit fountain: a bedrock bowl with a pillar in the middle (the portal opens when the dragon dies)
        const fr = Math.hypot(x, z);
        if (fr <= 3.5) {
          for (let y = FOUNTAIN_Y; y < FOUNTAIN_Y + 8; y++) data[idx(lx, y, lz)] = BLOCK.AIR;
          data[idx(lx, FOUNTAIN_Y - 1, lz)] = BLOCK.BEDROCK;
          if (fr > 2.5) data[idx(lx, FOUNTAIN_Y, lz)] = BLOCK.BEDROCK;
          if (x === 0 && z === 0) for (let y = FOUNTAIN_Y; y <= FOUNTAIN_Y + 3; y++) data[idx(lx, y, lz)] = BLOCK.BEDROCK;
        }
        // arrival platform
        const [px, py, pz] = END_PLATFORM;
        if (Math.abs(x - px) <= 2 && Math.abs(z - pz) <= 2) {
          data[idx(lx, py, lz)] = BLOCK.OBSIDIAN;
          for (let y = py + 1; y <= py + 3; y++) data[idx(lx, y, lz)] = BLOCK.AIR;
        }
      }
    }
    return { data, biomes };
  }

  // Cells inside the fountain bowl where the exit portal appears.
  static portalCells() {
    const out = [];
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
      const r = Math.hypot(x, z);
      if (r <= 2.5 && !(x === 0 && z === 0)) out.push([x, FOUNTAIN_Y, z]);
    }
    return out;
  }
}
