// Strongholds: deep underground stone brick corridors leading to the portal room,
// where 12 End portal frames sit around a pool of lava. Like Minecraft's first ring,
// there are three per world, 1280 to 2816 blocks from the origin. Only worlds made with
// generator version 3 or later have them (older terrain never changes).

import { CHUNK, BLOCK } from './blocks.js';
import { hash2 } from './noise.js';

export const SH_FLOOR = 40;   // internal y of the portal room floor (shown as y -24)
const ROOM = { x: 5, z0: -8, z1: 7, h: 7 };
const CORRIDOR_END = -36;     // the main corridor runs from the room's door to here
const CROSS_Z = -38, CROSS_X = 30;

const idx = (lx, y, lz) => (y * CHUNK + lz) * CHUNK + lx;

// Where the three strongholds are: [x, z] of each portal room's middle.
export function strongholdSpots(seed) {
  const s = seed | 0;
  const a0 = hash2(1, 2, s + 5001) * Math.PI * 2;
  const out = [];
  for (let i = 0; i < 3; i++) {
    const a = a0 + (i * Math.PI * 2) / 3;
    const d = 1280 + hash2(i, 7, s + 5002) * 1536;
    out.push([Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d)]);
  }
  return out;
}

// The 3 x 3 portal inside the frames: its middle block (x, y, z).
export function portalCenter([sx, sz]) {
  return [sx, SH_FLOOR + 3, sz + 1];
}

// Stone bricks, now and then mossy or cracked.
function bricks(x, y, z, s) {
  const r = hash2(x * 7 + y, z, s + 5003);
  return r < 0.2 ? BLOCK.MOSSY_STONE_BRICKS : r < 0.35 ? BLOCK.CRACKED_STONE_BRICKS : BLOCK.STONE_BRICKS;
}

// The block at local position (lx, ly, lz) from the room's middle, or undefined (leave the terrain).
function strongholdBlock(lx, ly, lz, x, y, z, s) {
  if (ly < 0 || ly > ROOM.h) return undefined;
  const ax = Math.abs(lx);
  // the portal room
  if (ax <= ROOM.x && lz >= ROOM.z0 && lz <= ROOM.z1) {
    if (lz === ROOM.z0 && ax <= 1 && ly >= 1 && ly <= 3) return BLOCK.AIR; // the door
    if (ax === ROOM.x || lz === ROOM.z0 || lz === ROOM.z1 || ly === 0 || ly === ROOM.h) return bricks(x, y, z, s);
    const inPortal = ax <= 1 && lz >= 0 && lz <= 2;
    if (inPortal && ly <= 2) return BLOCK.LAVA;
    if (ax <= 3 && lz >= -2 && lz <= 4 && ly <= 2) return BLOCK.STONE_BRICKS;            // the dais
    if (ax <= 1 && lz === -3 && ly === 1) return BLOCK.STONE_BRICKS;                      // a step up to it
    if (ly === 3) {
      const ringZ = (lz === -1 || lz === 3) && ax <= 1;
      const ringX = ax === 2 && lz >= 0 && lz <= 2;
      if (ringZ || ringX) return BLOCK.END_PORTAL_FRAME + (hash2(x, z, s + 5004) < 0.1 ? 1 : 0); // a few already have eyes
      if (ax === 3 && (lz === -2 || lz === 4)) return BLOCK.TORCH;
    }
    return BLOCK.AIR;
  }
  if (ly > 4) return undefined;
  // the corridor from the door
  if (ax <= 2 && lz < ROOM.z0 && lz > CORRIDOR_END) {
    if (ax === 2 || ly === 0 || ly === 4) return bricks(x, y, z, s);
    if (lx === 1 && ly === 1 && lz % 8 === 0) return BLOCK.TORCH;
    return BLOCK.AIR;
  }
  // a long cross corridor at the end
  if (Math.abs(lz - CROSS_Z) <= 2 && ax <= CROSS_X) {
    if (lz === CROSS_Z + 2 && ax <= 1 && ly >= 1 && ly <= 3) return BLOCK.AIR; // joins the main corridor
    if (ax === CROSS_X || Math.abs(lz - CROSS_Z) === 2 || ly === 0 || ly === 4) return bricks(x, y, z, s);
    if (lz === CROSS_Z - 1 && ly === 1 && lx % 8 === 4) return BLOCK.TORCH;
    return BLOCK.AIR;
  }
  return undefined;
}

// Carves any strongholds that reach into chunk (cx, cz) into its block data.
export function applyStrongholds(data, cx, cz, seed, spots = strongholdSpots(seed)) {
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  for (const [sx, sz] of spots) {
    if (x0 + CHUNK <= sx - CROSS_X || x0 > sx + CROSS_X || z0 + CHUNK <= sz + CROSS_Z - 2 || z0 > sz + ROOM.z1) continue;
    for (let lz = 0; lz < CHUNK; lz++) for (let lx = 0; lx < CHUNK; lx++) {
      const x = x0 + lx, z = z0 + lz;
      for (let ly = 0; ly <= ROOM.h; ly++) {
        const id = strongholdBlock(x - sx, ly, z - sz, x, SH_FLOOR + ly, z, seed | 0);
        if (id !== undefined) data[idx(lx, SH_FLOOR + ly, lz)] = id;
      }
    }
  }
}
