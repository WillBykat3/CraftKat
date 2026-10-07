// Deterministic terrain generation plus player edits.
// The same seed always produces the same terrain, so only the blocks players
// change ("edits") need to be sent over the network and saved to disk.

import { CHUNK, HEIGHT, BLOCK } from './blocks.js';
import { makeNoise2D, hash2 } from './noise.js';

const TREE_CELL = 6; // at most one tree per TREE_CELL x TREE_CELL area
const SAND_LEVEL = 21;
const SNOW_LEVEL = 42;

export function chunkKey(cx, cz) {
  return cx + ',' + cz;
}

export function blockIndex(lx, y, lz) {
  return (y * CHUNK + lz) * CHUNK + lx;
}

export class World {
  constructor(seed) {
    this.seed = seed | 0;
    this.chunks = new Map(); // chunkKey -> Uint8Array
    this.edits = new Map();  // chunkKey -> Map(blockIndex -> block id)
    this.noiseA = makeNoise2D(this.seed);
    this.noiseB = makeNoise2D(this.seed + 1);
    this.noiseC = makeNoise2D(this.seed + 2);
    this.noiseM = makeNoise2D(this.seed + 3);
  }

  // Ground height (y of the top solid block) for a column.
  heightAt(x, z) {
    const n =
      this.noiseA(x / 180, z / 180) * 0.6 +
      this.noiseB(x / 60, z / 60) * 0.3 +
      this.noiseC(x / 20, z / 20) * 0.1;
    const m = (this.noiseM(x / 400, z / 400) + 1) / 2; // 0 = flat, 1 = mountains
    const h = 25 + n * (6 + m * m * 26);
    return Math.max(4, Math.min(HEIGHT - 12, Math.floor(h)));
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
      const [cx, cz] = key.split(',').map(Number);
      if (Math.abs(cx - pcx) > radius || Math.abs(cz - pcz) > radius) this.chunks.delete(key);
    }
  }

  generate(cx, cz) {
    const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const x0 = cx * CHUNK;
    const z0 = cz * CHUNK;

    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const h = this.heightAt(x0 + lx, z0 + lz);
        let top, filler;
        if (h <= SAND_LEVEL) { top = BLOCK.SAND; filler = BLOCK.SAND; }
        else if (h >= SNOW_LEVEL) { top = BLOCK.SNOW; filler = BLOCK.STONE; }
        else { top = BLOCK.GRASS; filler = BLOCK.DIRT; }

        data[blockIndex(lx, 0, lz)] = BLOCK.BEDROCK;
        for (let y = 1; y <= h; y++) {
          let id;
          if (y === h) id = top;
          else if (y >= h - 3) id = filler;
          else id = BLOCK.STONE;
          data[blockIndex(lx, y, lz)] = id;
        }
      }
    }

    // Trees: one candidate per cell; check every cell whose tree could reach this chunk.
    const minCell = Math.floor((x0 - 2) / TREE_CELL);
    const maxCell = Math.floor((x0 + CHUNK + 2) / TREE_CELL);
    const minCellZ = Math.floor((z0 - 2) / TREE_CELL);
    const maxCellZ = Math.floor((z0 + CHUNK + 2) / TREE_CELL);
    for (let gz = minCellZ; gz <= maxCellZ; gz++) {
      for (let gx = minCell; gx <= maxCell; gx++) {
        if (hash2(gx, gz, this.seed + 100) > 0.45) continue;
        // keep trunks off cell edges so neighbouring trees don't merge
        const tx = gx * TREE_CELL + 1 + Math.floor(hash2(gx, gz, this.seed + 101) * (TREE_CELL - 2));
        const tz = gz * TREE_CELL + 1 + Math.floor(hash2(gx, gz, this.seed + 102) * (TREE_CELL - 2));
        const h = this.heightAt(tx, tz);
        if (h <= SAND_LEVEL || h >= SNOW_LEVEL - 4) continue;
        const trunk = 4 + Math.floor(hash2(tx, tz, this.seed + 103) * 2);
        this.placeTree(data, x0, z0, tx, h + 1, tz, trunk);
      }
    }

    const chunkEdits = this.edits.get(chunkKey(cx, cz));
    if (chunkEdits) for (const [idx, id] of chunkEdits) data[idx] = id;
    return data;
  }

  placeTree(data, x0, z0, tx, ty, tz, trunk) {
    const put = (x, y, z, id, onlyAir) => {
      const lx = x - x0;
      const lz = z - z0;
      if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 0 || y >= HEIGHT) return;
      const idx = blockIndex(lx, y, lz);
      if (onlyAir && data[idx] !== BLOCK.AIR) return;
      data[idx] = id;
    };
    const top = ty + trunk - 1;
    // two wide layers, then two narrow ones (the classic blob shape)
    for (let y = top - 1; y <= top + 2; y++) {
      const r = y <= top ? 2 : 1;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const corner = Math.abs(dx) === r && Math.abs(dz) === r;
          if (corner && (y === top + 2 || hash2(tx + dx * 7 + y, tz + dz * 13, this.seed + 104) < 0.5)) continue;
          put(tx + dx, y, tz + dz, BLOCK.LEAVES, true);
        }
      }
    }
    for (let y = ty; y <= top; y++) put(tx, y, tz, BLOCK.LOG, false);
  }
}
