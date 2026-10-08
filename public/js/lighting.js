// Minecraft-style light: sky light (0-15) that shines straight down and
// spreads sideways, and block light from torches. Light drops by 1 per block,
// so everything affecting a chunk lies within 15 blocks of it. We therefore
// compute light over the chunk plus its 8 neighbours (16 blocks of padding),
// which gives exact values for the chunk and the ring of cells around it.

import { CHUNK, HEIGHT, BLOCKS } from './blocks.js';
import { blockIndex } from './world.js';

export const PAD = CHUNK;             // padding on each side
export const SIZE = CHUNK + 2 * PAD;  // region width (48)
const LAYER = SIZE * SIZE;

// Region index for chunk-local coords (x and z may be -16..31).
export function regionIndex(x, y, z) {
  return y * LAYER + (z + PAD) * SIZE + (x + PAD);
}

// Fills a SIZE x HEIGHT x SIZE array of block ids for the 3x3 chunks around (cx, cz).
export function gatherRegion(world, cx, cz) {
  const ids = new Uint8Array(LAYER * HEIGHT);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const data = world.getChunk(cx + dx, cz + dz);
      const ox = (dx + 1) * CHUNK;
      const oz = (dz + 1) * CHUNK;
      for (let y = 0; y < HEIGHT; y++) {
        for (let z = 0; z < CHUNK; z++) {
          const src = blockIndex(0, y, z);
          const dst = y * LAYER + (oz + z) * SIZE + ox;
          ids.set(data.subarray(src, src + CHUNK), dst);
        }
      }
    }
  }
  return ids;
}

const OPAQUE = new Uint8Array(256);
const FILTER = new Uint8Array(256);
const EMIT = new Uint8Array(256);
for (let id = 0; id < 256; id++) {
  const b = BLOCKS[id];
  OPAQUE[id] = b ? (b.transparent ? 0 : 1) : 1;
  FILTER[id] = b ? b.lightFilter : 0;
  EMIT[id] = b ? b.emit : 0;
}

// Breadth-first flood fill. `queue` is a ring buffer and `queued` makes sure a
// cell is waiting at most once, so the buffer (one slot per cell) never overflows.
function spread(light, ids, queue, queued, seeded) {
  const maxIndex = LAYER * HEIGHT;
  const cap = queue.length;
  let head = 0;
  let count = seeded;
  let tail = seeded % cap;
  while (count > 0) {
    const i = queue[head];
    head = head + 1 === cap ? 0 : head + 1;
    count--;
    queued[i] = 0;
    const l = light[i];
    if (l <= 1) continue;
    const x = i % SIZE;
    const z = Math.floor(i / SIZE) % SIZE;
    // 6 neighbours: -x +x -z +z -y +y
    for (let n = 0; n < 6; n++) {
      let j;
      if (n === 0) { if (x === 0) continue; j = i - 1; }
      else if (n === 1) { if (x === SIZE - 1) continue; j = i + 1; }
      else if (n === 2) { if (z === 0) continue; j = i - SIZE; }
      else if (n === 3) { if (z === SIZE - 1) continue; j = i + SIZE; }
      else if (n === 4) { j = i - LAYER; if (j < 0) continue; }
      else { j = i + LAYER; if (j >= maxIndex) continue; }
      const id = ids[j];
      if (OPAQUE[id]) continue;
      const nl = l - 1 - FILTER[id];
      if (nl > light[j]) {
        light[j] = nl;
        if (!queued[j]) {
          queued[j] = 1;
          queue[tail] = j;
          tail = tail + 1 === cap ? 0 : tail + 1;
          count++;
        }
      }
    }
  }
}

// Highest y containing a non-air block in the region (-1 if empty).
export function topY(ids) {
  for (let y = HEIGHT - 1; y >= 0; y--) {
    const start = y * LAYER;
    for (let i = start; i < start + LAYER; i++) if (ids[i] !== 0) return y;
  }
  return -1;
}

// Returns {sky, block} light arrays covering the region (see regionIndex).
// hasSky: false in the Nether and the End, which have no sunlight at all.
export function computeLight(ids, hasSky = true) {
  const total = LAYER * HEIGHT;
  const sky = new Uint8Array(total);
  const block = new Uint8Array(total);
  const queue = new Int32Array(total);
  const queued = new Uint8Array(total);

  // Sky light: straight down each column, losing light through leaves/water.
  let tail = 0;
  for (let c = 0; c < (hasSky ? LAYER : 0); c++) {
    let l = 15;
    for (let y = HEIGHT - 1; y >= 0 && l > 0; y--) {
      const i = y * LAYER + c;
      const id = ids[i];
      if (OPAQUE[id]) break;
      l -= FILTER[id];
      if (l <= 0) break;
      sky[i] = l;
    }
  }
  // Seed the flood fill only with lit cells next to a darker open cell.
  // Above the highest block everything is full daylight, so there is nothing to seed there.
  const seedEnd = Math.min(total, (topY(ids) + 2) * LAYER);
  for (let i = 0; i < seedEnd; i++) {
    const l = sky[i];
    if (l <= 1) continue;
    const x = i % SIZE;
    const z = Math.floor(i / SIZE) % SIZE;
    if ((x > 0 && sky[i - 1] < l - 1 && !OPAQUE[ids[i - 1]]) ||
        (x < SIZE - 1 && sky[i + 1] < l - 1 && !OPAQUE[ids[i + 1]]) ||
        (z > 0 && sky[i - SIZE] < l - 1 && !OPAQUE[ids[i - SIZE]]) ||
        (z < SIZE - 1 && sky[i + SIZE] < l - 1 && !OPAQUE[ids[i + SIZE]]) ||
        (i >= LAYER && sky[i - LAYER] < l - 1 && !OPAQUE[ids[i - LAYER]])) {
      queue[tail++] = i;
      queued[i] = 1;
    }
  }
  spread(sky, ids, queue, queued, tail);

  tail = 0;
  for (let i = 0; i < total; i++) {
    const e = EMIT[ids[i]];
    if (e) {
      block[i] = e;
      queue[tail++] = i;
      queued[i] = 1;
    }
  }
  spread(block, ids, queue, queued, tail);

  return { sky, block };
}
