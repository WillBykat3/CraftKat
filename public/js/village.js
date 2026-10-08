// Villages: a well in the middle, dirt paths leading out, and houses, farms and lamp
// posts along them, built from the local biome's materials (oak in plains, sandstone in
// deserts, acacia in savannas, spruce in taigas and snowy plains). Houses have beds (one
// villager each) and some have a job site block that gives their villager a profession.
// Only worlds made with generator 3 or later have villages (older terrain never changes).

import { CHUNK, BLOCK, FACING } from './blocks.js';
import { BIOME } from './biomes.js';
import { hash2, mulberry32 } from './noise.js';
import { SEA } from './terrain.js';

export const VILLAGE_CELL = 576; // at most one village per 576 x 576 blocks (Minecraft: 34 chunks apart)
const ARM = 30;                  // paths run this far from the well

const STYLES = {
  plains: { floor: BLOCK.COBBLE, wall: BLOCK.PLANKS, post: BLOCK.LOG, roof: BLOCK.OAK_STAIRS, roofFill: BLOCK.PLANKS, path: BLOCK.DIRT_PATH },
  desert: { floor: BLOCK.SANDSTONE, wall: BLOCK.SANDSTONE, post: BLOCK.SANDSTONE, roof: null, roofFill: BLOCK.SANDSTONE, path: BLOCK.DIRT_PATH },
  savanna: { floor: BLOCK.COBBLE, wall: BLOCK.ACACIA_PLANKS, post: BLOCK.ACACIA_LOG, roof: null, roofFill: BLOCK.ACACIA_PLANKS, path: BLOCK.DIRT_PATH },
  taiga: { floor: BLOCK.COBBLE, wall: BLOCK.SPRUCE_PLANKS, post: BLOCK.SPRUCE_LOG, roof: BLOCK.COBBLESTONE_STAIRS, roofFill: BLOCK.COBBLE, path: BLOCK.DIRT_PATH },
};
const BIOME_STYLE = {
  [BIOME.PLAINS]: 'plains', [BIOME.SUNFLOWER_PLAINS]: 'plains', [BIOME.MEADOW]: 'plains',
  [BIOME.DESERT]: 'desert', [BIOME.SAVANNA]: 'savanna', [BIOME.TAIGA]: 'taiga', [BIOME.SNOWY_PLAINS]: 'taiga',
};
const JOBS = [BLOCK.COMPOSTER, BLOCK.LECTERN, BLOCK.BLAST_FURNACE, BLOCK.SMOKER, BLOCK.SMITHING_TABLE, BLOCK.GRINDSTONE,
  BLOCK.FLETCHING_TABLE, BLOCK.LOOM, BLOCK.CARTOGRAPHY_TABLE, BLOCK.STONECUTTER, BLOCK.CAULDRON, BLOCK.BARREL];

// world direction [dx, dz] -> facing index (0 N, 1 E, 2 S, 3 W)
const facingOf = (dx, dz) => FACING.findIndex(([fx, , fz]) => fx === dx && fz === dz);

export class Villages {
  constructor(seed, terrain) {
    this.seed = seed | 0;
    this.terrain = terrain;
    this.cache = new Map(); // cell key -> village or null
  }

  // The village whose cell is (gx, gz), or null. Each village has its centre, the beds
  // (where villagers live, with their job site if any) and its blocks bucketed by chunk.
  inCell(gx, gz) {
    const k = gx + ',' + gz;
    if (this.cache.has(k)) return this.cache.get(k);
    let v = null;
    if (hash2(gx, gz, this.seed + 6001) < 0.55) {
      const m = ARM + 12;
      const x = gx * VILLAGE_CELL + m + Math.floor(hash2(gx, gz, this.seed + 6002) * (VILLAGE_CELL - 2 * m));
      const z = gz * VILLAGE_CELL + m + Math.floor(hash2(gx, gz, this.seed + 6003) * (VILLAGE_CELL - 2 * m));
      const col = this.terrain.column(x, z);
      const style = BIOME_STYLE[col.biome];
      if (style && col.h >= SEA) v = this.build(x, z, col.h, style, mulberry32((this.seed ^ Math.imul(gx, 73856093) ^ Math.imul(gz, 19349663)) >>> 0));
    }
    this.cache.set(k, v);
    return v;
  }

  // Villages whose blocks may reach into chunk (cx, cz).
  near(cx, cz) {
    const x = cx * CHUNK, z = cz * CHUNK, out = [];
    for (let gx = Math.floor((x - ARM - 16) / VILLAGE_CELL); gx <= Math.floor((x + CHUNK + ARM + 16) / VILLAGE_CELL); gx++) {
      for (let gz = Math.floor((z - ARM - 16) / VILLAGE_CELL); gz <= Math.floor((z + CHUNK + ARM + 16) / VILLAGE_CELL); gz++) {
        const v = this.inCell(gx, gz);
        if (v) out.push(v);
      }
    }
    return out;
  }

  // The nearest village centre to (x, z) within `range`, or null.
  nearest(x, z, range = 128) {
    let best = null, bestD = range;
    for (let gx = Math.floor((x - range) / VILLAGE_CELL); gx <= Math.floor((x + range) / VILLAGE_CELL); gx++) {
      for (let gz = Math.floor((z - range) / VILLAGE_CELL); gz <= Math.floor((z + range) / VILLAGE_CELL); gz++) {
        const v = this.inCell(gx, gz);
        if (!v) continue;
        const d = Math.hypot(v.x - x, v.z - z);
        if (d < bestD) { bestD = d; best = v; }
      }
    }
    return best;
  }

  // Writes the village blocks that fall in chunk (cx, cz) into its block data.
  apply(data, cx, cz) {
    for (const v of this.near(cx, cz)) {
      const list = v.chunks.get(cx + ',' + cz);
      if (!list) continue;
      for (let i = 0; i < list.length; i += 4) data[(list[i + 1] * CHUNK + list[i + 2]) * CHUNK + list[i]] = list[i + 3];
    }
  }

  build(vx, vz, vy, styleName, rand) {
    const st = STYLES[styleName];
    const blocks = new Map(); // "x,y,z" -> id (later pieces win)
    const set = (x, y, z, id) => blocks.set(`${x},${y},${z}`, id);
    const groundAt = (x, z) => this.terrain.column(x, z).h;
    const v = { x: vx, y: vy + 1, z: vz, style: styleName, beds: [], key: `${vx},${vz}` };

    // clears a box of air above `y`, and fills ground up to y - 1 under a footprint
    const foundation = (x0, z0, x1, z1, y, fill) => {
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const g = groundAt(x, z);
        for (let yy = Math.min(g, y - 1); yy <= y - 1; yy++) if (yy > g - 1 || yy === y - 1) set(x, yy, z, fill);
        for (let yy = y; yy <= y + 9; yy++) set(x, yy, z, BLOCK.AIR);
      }
    };

    // the well
    foundation(vx - 2, vz - 2, vx + 1, vz + 1, vy + 1, BLOCK.COBBLE);
    for (let x = vx - 2; x <= vx + 1; x++) for (let z = vz - 2; z <= vz + 1; z++) {
      const rim = x === vx - 2 || x === vx + 1 || z === vz - 2 || z === vz + 1;
      set(x, vy, z, rim ? BLOCK.COBBLE : BLOCK.WATER);
      set(x, vy - 1, z, rim ? BLOCK.COBBLE : BLOCK.WATER);
      set(x, vy - 2, z, BLOCK.COBBLE);
      if (rim) set(x, vy + 1, z, BLOCK.COBBLESTONE_SLAB);
      const corner = (x === vx - 2 || x === vx + 1) && (z === vz - 2 || z === vz + 1);
      if (corner) { set(x, vy + 1, z, BLOCK.OAK_FENCE); set(x, vy + 2, z, BLOCK.OAK_FENCE); }
      set(x, vy + 3, z, BLOCK.COBBLESTONE_SLAB);
    }
    set(vx + 2, vy + 1, vz, BLOCK.BELL);
    v.bell = [vx + 2, vy + 1, vz];

    // paths in four directions, and things along them
    const arms = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const pieces = [];
    for (const [ax, az] of arms) {
      for (let d = 3; d <= ARM; d++) {
        for (let w = -1; w <= 1; w++) {
          const x = vx + ax * d + (az ? w : 0), z = vz + az * d + (ax ? w : 0);
          const g = groundAt(x, z);
          if (g < SEA || Math.abs(g - vy) > 6) continue;
          set(x, g, z, st.path);
          for (let yy = g + 1; yy <= g + 4; yy++) set(x, yy, z, BLOCK.AIR);
        }
      }
      // buildings every 10 blocks, alternating sides
      // (starting 14 out, so buildings by different paths don't overlap near the well)
      for (let i = 0, d = 14; d <= ARM - 2; d += 10, i++) {
        for (const side of [1, -1]) {
          const r = rand();
          const kind = r < 0.5 ? 'house' : r < 0.7 ? 'bighouse' : r < 0.88 ? 'farm' : 'lamp';
          pieces.push({ ax, az, d, side, kind, job: rand() < 0.75 ? JOBS[Math.floor(rand() * JOBS.length)] : 0, crop: Math.floor(rand() * 3) });
        }
      }
    }
    pieces.push({ ax: 1, az: 0, d: 4, side: 1, kind: 'lamp', job: 0 }, { ax: -1, az: 0, d: 4, side: -1, kind: 'lamp', job: 0 });
    for (const pc of pieces) this.piece(v, pc, st, set, groundAt, foundation);

    // bucket by chunk: flat arrays of lx, y, lz, id
    v.chunks = new Map();
    for (const [k, id] of blocks) {
      const [x, y, z] = k.split(',').map(Number);
      const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
      const ck = cx + ',' + cz;
      if (!v.chunks.has(ck)) v.chunks.set(ck, []);
      v.chunks.get(ck).push(x - cx * CHUNK, y, z - cz * CHUNK, id);
    }
    return v;
  }

  // One building beside a path. Local coordinates: lx across (0 = left), lz away from the
  // path (0 = the front wall, which has the door), turned to face the path.
  piece(v, pc, st, set, groundAt, foundation) {
    const { ax, az, d, side } = pc;
    // the direction from the path to the building, and along the path
    const ox = az ? side : 0, oz = ax ? side : 0;   // away from the path
    const px = ax, pz = az;                         // along the path
    const size = pc.kind === 'bighouse' ? [7, 7] : pc.kind === 'farm' ? [7, 9] : pc.kind === 'lamp' ? [1, 1] : [5, 5];
    const [W, D] = size;
    const start = 3; // gap between the path's middle and the front wall
    const at = (lx, lz) => [v.x + ax * d + px * (lx - (W >> 1)) + ox * (start + lz), v.z + az * d + pz * (lx - (W >> 1)) + oz * (start + lz)];
    const [mx, mz] = at(W >> 1, D >> 1);
    const g = groundAt(mx, mz);
    if (g < SEA || Math.abs(g - v.y) > 7) return;
    const y = g + 1; // floor level (standing height)
    const corners = [at(0, 0), at(W - 1, D - 1)];
    const x0 = Math.min(corners[0][0], corners[1][0]), x1 = Math.max(corners[0][0], corners[1][0]);
    const z0 = Math.min(corners[0][1], corners[1][1]), z1 = Math.max(corners[0][1], corners[1][1]);
    const put = (lx, ly, lz, id) => { const [x, z] = at(lx, lz); set(x, y + ly, z, id); };
    const inward = facingOf(ox, oz); // facing from the path into the building

    if (pc.kind === 'lamp') {
      const [x, z] = at(0, 0);
      const gg = groundAt(x, z);
      for (let k = 1; k <= 3; k++) set(x, gg + k, z, BLOCK.OAK_FENCE);
      set(x, gg + 4, z, BLOCK.GLOWSTONE);
      return;
    }
    foundation(x0, z0, x1, z1, y, pc.kind === 'farm' ? BLOCK.DIRT : st.floor);

    if (pc.kind === 'farm') {
      // logs around farmland, with a water channel down the middle
      const crop = [BLOCK.WHEAT + 7, BLOCK.CARROTS + 3, BLOCK.POTATOES + 3][pc.crop];
      for (let lx = 0; lx < W; lx++) for (let lz = 0; lz < D; lz++) {
        const edge = lx === 0 || lx === W - 1 || lz === 0 || lz === D - 1;
        if (edge) { put(lx, -1, lz, st.post === BLOCK.SANDSTONE ? BLOCK.SANDSTONE : st.post); continue; }
        if (lx === W >> 1) { put(lx, -1, lz, BLOCK.WATER); continue; }
        put(lx, -1, lz, BLOCK.FARMLAND);
        put(lx, 0, lz, crop - Math.floor(((lx * 7 + lz * 3) % 5) / 2)); // not all fully grown
      }
      return;
    }

    // a house: floor, walls with posts at the corners, windows, a door facing the path, a roof
    const H = 4; // wall height
    for (let lx = 0; lx < W; lx++) for (let lz = 0; lz < D; lz++) {
      put(lx, -1, lz, st.floor);
      const edgeX = lx === 0 || lx === W - 1, edgeZ = lz === 0 || lz === D - 1;
      if (!edgeX && !edgeZ) continue;
      for (let ly = 0; ly < H; ly++) {
        let id = edgeX && edgeZ ? st.post : st.wall;
        if (ly === 1 && !(edgeX && edgeZ) && ((edgeZ && lx % 2 === 0 && lx > 0 && lx < W - 1) || (edgeX && lz % 2 === 0 && lz > 0 && lz < D - 1))) id = BLOCK.GLASS;
        put(lx, ly, lz, id);
      }
    }
    const door = W >> 1;
    put(door, 0, 0, BLOCK.OAK_DOOR + inward);
    put(door, 1, 0, BLOCK.OAK_DOOR + 8 + inward);
    put(door, -1, -1, st.floor); // a step outside the door
    // roof: stairs sloping down to the sides, or a flat top with a rim
    const roofY = H;
    if (st.roof) {
      // sides along lx (left/right walls) get the slope
      const left = facingOf(-px, -pz), right = facingOf(px, pz);
      for (let k = 0; k <= W >> 1; k++) {
        for (let lz = -1; lz <= D; lz++) {
          const a = k, b = W - 1 - k;
          if (a > b) continue;
          if (a === b) { put(a, roofY + k, lz, st.roofFill); continue; }
          put(a, roofY + k, lz, st.roof + right); // high side towards the middle
          put(b, roofY + k, lz, st.roof + left);
          if (lz === -1 || lz === D) continue;
          for (let lx = a + 1; lx < b; lx++) if (k === 0 || lz === 0 || lz === D - 1) put(lx, roofY + k, lz, st.roofFill);
        }
      }
    } else {
      for (let lx = -1; lx <= W; lx++) for (let lz = -1; lz <= D; lz++) {
        const rim = lx === -1 || lx === W || lz === -1 || lz === D;
        put(lx, roofY, lz, rim ? BLOCK.OAK_SLAB : st.roofFill);
      }
    }
    // inside: beds, a torch, and maybe a job site block
    const beds = pc.kind === 'bighouse' ? [[1, D - 2], [W - 2, D - 2]] : [[1, D - 2]];
    for (const [lx, lz] of beds) {
      put(lx, 0, lz, BLOCK.BED);
      const [bx, bz] = at(lx, lz);
      v.beds.push({ x: bx, y, z: bz, job: 0 });
    }
    put(W - 2, 0, 1, BLOCK.TORCH);
    if (pc.job) {
      put(1, 0, 1, pc.job);
      v.beds[v.beds.length - 1].job = pc.job;
    }
  }
}
