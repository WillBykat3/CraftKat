// Turns a chunk of block ids into triangle data with smooth lighting and
// ambient occlusion. Produces two meshes: opaque/cut-out blocks, and water.

import { CHUNK, HEIGHT, BLOCK, BLOCKS, FACING } from './blocks.js';
import { gatherRegion, computeLight, regionIndex, topY, SIZE } from './lighting.js';
import { BIOMES } from './biomes.js';
import { shapeBoxes } from './shapes.js';
import { wireConnections, WIRE_COLORS } from './redstone.js';

// slot: index into a block's tex array ([top, side, bottom, sideX])
// corners [x, y, z, u, v] are ordered so triangles (0,1,2) and (2,1,3) face outwards.
export const FACES = [
  { dir: [-1, 0, 0], slot: 3, shade: 0.8, corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], slot: 3, shade: 0.8, corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], slot: 2, shade: 0.55, corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], slot: 0, shade: 1.0, corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], slot: 1, shade: 0.7, corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], slot: 1, shade: 0.7, corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];

const AO_LEVELS = [0.45, 0.65, 0.82, 1.0];
const WATER_TOP = 0.875;

const OPAQUE = new Uint8Array(256);
for (let id = 0; id < 256; id++) OPAQUE[id] = BLOCKS[id] ? (BLOCKS[id].transparent ? 0 : 1) : 1;
const WHITE = [255, 255, 255];
const LAYER = SIZE * SIZE;
const BLEND = 2; // biome colours are averaged over (2 * BLEND + 1)^2 columns, like Minecraft's default

// Blended grass/foliage/water colours for each column of a chunk.
function columnTints(world, cx, cz) {
  const W = CHUNK + 2 * BLEND;
  const biomes = new Uint8Array(W * W);
  let mixed = false;
  for (let z = 0; z < W; z++) {
    for (let x = 0; x < W; x++) {
      biomes[z * W + x] = world.biomeAt(cx * CHUNK + x - BLEND, cz * CHUNK + z - BLEND);
      if (biomes[z * W + x] !== biomes[0]) mixed = true;
    }
  }
  const out = { grass: [], foliage: [], water: [] };
  const n = (2 * BLEND + 1) ** 2;
  for (let lz = 0; lz < CHUNK; lz++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      if (!mixed) {
        const b = BIOMES[biomes[0]];
        out.grass.push(b.grass); out.foliage.push(b.foliage); out.water.push(b.water);
        continue;
      }
      const sum = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let dz = 0; dz <= 2 * BLEND; dz++) {
        for (let dx = 0; dx <= 2 * BLEND; dx++) {
          const b = BIOMES[biomes[(lz + dz) * W + lx + dx]];
          for (let k = 0; k < 3; k++) { sum[k] += b.grass[k]; sum[3 + k] += b.foliage[k]; sum[6 + k] += b.water[k]; }
        }
      }
      const avg = sum.map((v) => Math.round(v / n));
      out.grass.push(avg.slice(0, 3)); out.foliage.push(avg.slice(3, 6)); out.water.push(avg.slice(6, 9));
    }
  }
  return out;
}

// Vertex data in compact typed arrays (grown as needed):
//   position float x3, uv uint16 x2 (normalized), shade uint8, light uint8 x2 (sky, block), tint uint8 x3
class MeshData {
  constructor() {
    this.count = 0;
    this.cap = 0;
    this.minY = Infinity;
    this.maxY = -Infinity;
    this.indexCount = 0;
    this.grow(1024);
    this.idx = new Uint32Array(1536);
  }

  grow(cap) {
    const copy = (Type, old, n) => { const a = new Type(cap * n); if (old) a.set(old); return a; };
    this.positions = copy(Float32Array, this.positions, 3);
    this.uvs = copy(Uint16Array, this.uvs, 2);
    this.shade = copy(Uint8Array, this.shade, 1);
    this.light = copy(Uint8Array, this.light, 2);
    this.tint = copy(Uint8Array, this.tint, 3);
    this.cap = cap;
  }

  vertex(x, y, z, u, v, shade, sky, block, tint) {
    if (this.count === this.cap) this.grow(this.cap * 2);
    const i = this.count++;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
    this.positions[i * 3] = x; this.positions[i * 3 + 1] = y; this.positions[i * 3 + 2] = z;
    this.uvs[i * 2] = Math.round(u * 65535); this.uvs[i * 2 + 1] = Math.round(v * 65535);
    this.shade[i] = Math.round(shade * 255);
    this.light[i * 2] = Math.round(sky * 17); this.light[i * 2 + 1] = Math.round(block * 17); // 0-15 -> 0-255
    this.tint[i * 3] = tint[0]; this.tint[i * 3 + 1] = tint[1]; this.tint[i * 3 + 2] = tint[2];
  }

  // a quad from the last 4 vertices: triangles (a, b, c) and (d, e, f) as offsets 0-3
  quad(a, b, c, d, e, f) {
    if (this.indexCount + 6 > this.idx.length) { const n = new Uint32Array(this.idx.length * 2); n.set(this.idx); this.idx = n; }
    const base = this.count - 4;
    const o = this.indexCount;
    this.idx[o] = base + a; this.idx[o + 1] = base + b; this.idx[o + 2] = base + c;
    this.idx[o + 3] = base + d; this.idx[o + 4] = base + e; this.idx[o + 5] = base + f;
    this.indexCount += 6;
  }

  finish() {
    if (this.indexCount === 0) return null;
    const n = this.count;
    return {
      minY: this.minY,
      maxY: this.maxY,
      positions: this.positions.slice(0, n * 3),
      uvs: this.uvs.slice(0, n * 2),
      shade: this.shade.slice(0, n),
      light: this.light.slice(0, n * 2),
      tint: this.tint.slice(0, n * 3),
      indices: n > 65535 ? this.idx.slice(0, this.indexCount) : Uint16Array.from(this.idx.subarray(0, this.indexCount)),
    };
  }
}

// uvOf(textureName) -> [u0, v0, u1, v1]
export function buildChunkMesh(world, cx, cz, uvOf) {
  const ids = gatherRegion(world, cx, cz);
  const { sky, block: blockLight } = computeLight(ids, world.hasSky);
  const get = (x, y, z) => (y < 0 ? BLOCK.BEDROCK : y >= HEIGHT ? BLOCK.AIR : ids[regionIndex(x, y, z)]);
  const skyAt = (x, y, z) => (y >= HEIGHT ? 15 : y < 0 ? 0 : sky[regionIndex(x, y, z)]);
  const blockAt = (x, y, z) => (y < 0 || y >= HEIGHT ? 0 : blockLight[regionIndex(x, y, z)]);
  const tints = columnTints(world, cx, cz);
  const tintOf = (def, x, z) => (def.tint === 'redstone' ? WIRE_COLORS[def.power] : def.tint ? tints[def.tint][z * CHUNK + x] : WHITE);

  const solid = new MeshData();
  const water = new MeshData();
  const p = [0, 0, 0];
  const ao = [0, 0, 0, 0];
  const vs = [0, 0, 0, 0];
  const vb = [0, 0, 0, 0];

  const maxY = topY(ids); // nothing to draw above the highest block in the area
  for (let y = 0; y <= maxY; y++) {
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const ri = regionIndex(x, y, z);
        const id = ids[ri];
        if (id === BLOCK.AIR) continue;
        // fast path: a block buried on all six sides has nothing to draw
        if (OPAQUE[id] && y > 0 && y < HEIGHT - 1 && OPAQUE[ids[ri - 1]] && OPAQUE[ids[ri + 1]] && OPAQUE[ids[ri - SIZE]] &&
            OPAQUE[ids[ri + SIZE]] && OPAQUE[ids[ri - LAYER]] && OPAQUE[ids[ri + LAYER]]) continue;
        const def = BLOCKS[id];

        const tint = tintOf(def, x, z);
        if (def.render === 'cross') {
          addCross(solid, x, y, z, uvOf(def.tex[0]), skyAt(x, y, z), blockAt(x, y, z), tint);
          continue;
        }

        if (def.render === 'water') {
          // liquids: water is see-through, lava is drawn with the solid blocks
          const out = def.liquid === 'lava' ? solid : water;
          const topLowered = get(x, y + 1, z) !== id;
          for (const face of FACES) {
            const [dx, dy, dz] = face.dir;
            const nid = get(x + dx, y + dy, z + dz);
            if (nid === id || OPAQUE[nid] || (id === BLOCK.WATER && nid === BLOCK.ICE)) continue;
            const [u0, v0, u1, v1] = uvOf(def.tex[face.slot]);
            const ls = skyAt(x + dx, y + dy, z + dz);
            const lb = blockAt(x + dx, y + dy, z + dz);
            for (const c of face.corners) {
              const cy = c[1] === 1 && topLowered ? WATER_TOP : c[1];
              out.vertex(x + c[0], y + cy, z + c[2], c[3] ? u1 : u0, c[4] ? v1 : v0, face.shade, ls, lb, tint);
            }
            out.quad(0, 1, 2, 2, 1, 3);
          }
          continue;
        }

        if (def.render === 'shape') {
          addShape(def.translucent ? water : solid, def, id, x, y, z, get, skyAt, blockAt, uvOf, tint);
          continue;
        }
        if (def.render === 'wire') {
          addWire(solid, x, y, z, get, uvOf, skyAt(x, y, z), blockAt(x, y, z), tint);
          continue;
        }
        if (def.render === 'torch') {
          // a wall torch leans on the block behind it
          const [fx, , fz] = def.attach ? FACING[def.attach - 1] : [0, 0, 0];
          addCross(solid, x - fx * 0.3, y + (def.attach ? 0.2 : 0), z - fz * 0.3, uvOf(def.tex[0]), skyAt(x, y, z), blockAt(x, y, z), tint);
          continue;
        }
        if (def.render === 'crop') {
          addPlanes(solid, CROP_PLANES, x, y - 1 / 16, z, uvOf(def.tex[0]), skyAt(x, y, z), blockAt(x, y, z), tint);
          continue;
        }

        const mesh = def.translucent ? water : solid;

        const h = def.height || 1; // partial blocks (beds) are shorter
        for (const face of FACES) {
          const [dx, dy, dz] = face.dir;
          const nid = get(x + dx, y + dy, z + dz);
          if (OPAQUE[nid] && !(dy === 1 && h < 1)) continue;
          if (nid === id && def.cullSame) continue;

          const axisN = dx !== 0 ? 0 : dy !== 0 ? 1 : 2;
          const axisU = axisN === 0 ? 1 : 0;
          const axisV = axisN === 2 ? 1 : 2;
          const fx = x + dx, fy = y + dy, fz = z + dz;

          for (let i = 0; i < 4; i++) {
            const c = face.corners[i];
            const du = c[axisU] ? 1 : -1;
            const dv = c[axisV] ? 1 : -1;
            p[0] = 0; p[1] = 0; p[2] = 0;
            p[axisU] = du;
            const s1x = fx + p[0], s1y = fy + p[1], s1z = fz + p[2];
            p[axisU] = 0; p[axisV] = dv;
            const s2x = fx + p[0], s2y = fy + p[1], s2z = fz + p[2];
            p[axisU] = du;
            const ccx = fx + p[0], ccy = fy + p[1], ccz = fz + p[2];
            const o1 = OPAQUE[get(s1x, s1y, s1z)];
            const o2 = OPAQUE[get(s2x, s2y, s2z)];
            const oc = OPAQUE[get(ccx, ccy, ccz)];
            ao[i] = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);

            // smooth light: average the open cells touching this corner
            let ls = skyAt(fx, fy, fz), lb = blockAt(fx, fy, fz), n = 1;
            if (!o1) { ls += skyAt(s1x, s1y, s1z); lb += blockAt(s1x, s1y, s1z); n++; }
            if (!o2) { ls += skyAt(s2x, s2y, s2z); lb += blockAt(s2x, s2y, s2z); n++; }
            if (!oc && !(o1 && o2)) { ls += skyAt(ccx, ccy, ccz); lb += blockAt(ccx, ccy, ccz); n++; }
            vs[i] = ls / n;
            vb[i] = lb / n;
          }

          const [u0, v0, u1, v1] = uvOf(def.tex[face.slot]);
          for (let i = 0; i < 4; i++) {
            const c = face.corners[i];
            // side faces of short blocks show only the bottom part of the texture
            const v = c[4] ? (dy === 0 ? v0 + (v1 - v0) * h : v1) : v0;
            mesh.vertex(x + c[0], y + (c[1] ? h : 0), z + c[2], c[3] ? u1 : u0, v,
              face.shade * AO_LEVELS[ao[i]], vs[i], vb[i], tint);
          }
          // split the quad along the diagonal that hides interpolation artefacts
          const b0 = ao[0] + vs[0] / 15, b1 = ao[1] + vs[1] / 15, b2 = ao[2] + vs[2] / 15, b3 = ao[3] + vs[3] / 15;
          if (b0 + b3 > b1 + b2) {
            mesh.quad(0, 1, 3, 0, 3, 2);
          } else {
            mesh.quad(0, 1, 2, 2, 1, 3);
          }
        }
      }
    }
  }

  return { solid: solid.finish(), water: water.finish() };
}

// For each face: the axis it faces along, and which axes (and directions) its texture u and v follow.
const FACE_AXES = FACES.map((face) => {
  const n = face.dir.findIndex((d) => d !== 0);
  const others = [0, 1, 2].filter((a) => a !== n);
  const find = (k) => {
    for (const a of others) {
      if (face.corners.every((c) => c[a] === c[k])) return [a, 1];
      if (face.corners.every((c) => c[a] === 1 - c[k])) return [a, -1];
    }
    return [others[0], 1];
  };
  const [u, su] = find(3), [v, sv] = find(4);
  return { n, u, su, v, sv, positive: face.dir[n] > 0 };
});

// A shaped block: each of its boxes is drawn with the texture cropped to the box,
// like Minecraft's block models. Faces against an opaque neighbour are left out.
function addShape(mesh, def, id, x, y, z, get, skyAt, blockAt, uvOf, tint) {
  const boxes = shapeBoxes(id, (dx, dy, dz) => get(x + dx, y + dy, z + dz), false);
  const ownSky = skyAt(x, y, z), ownBlock = blockAt(x, y, z);
  const p = [0, 0, 0];
  for (const box of boxes) {
    for (let f = 0; f < 6; f++) {
      const face = FACES[f];
      const ax = FACE_AXES[f];
      const [dx, dy, dz] = face.dir;
      const onEdge = ax.positive ? box[ax.n + 3] >= 1 : box[ax.n] <= 0;
      let ls = ownSky, lb = ownBlock;
      if (onEdge) {
        if (OPAQUE[get(x + dx, y + dy, z + dz)]) continue;
        ls = skyAt(x + dx, y + dy, z + dz);
        lb = blockAt(x + dx, y + dy, z + dz);
      }
      const texName = box[6] === undefined ? def.tex[face.slot] : Array.isArray(box[6]) ? box[6][f] : box[6];
      const [u0, v0, u1, v1] = uvOf(texName);
      for (const c of face.corners) {
        p[0] = c[0] ? box[3] : box[0];
        p[1] = c[1] ? box[4] : box[1];
        p[2] = c[2] ? box[5] : box[2];
        const uf = ax.su > 0 ? p[ax.u] : 1 - p[ax.u];
        const vf = ax.sv > 0 ? p[ax.v] : 1 - p[ax.v];
        mesh.vertex(x + p[0], y + p[1], z + p[2], u0 + (u1 - u0) * uf, v0 + (v1 - v0) * vf, face.shade, ls, lb, tint);
      }
      mesh.quad(0, 1, 2, 2, 1, 3);
    }
  }
}

// Redstone dust: flat on the ground, a dot in the middle and lines to whatever it
// connects to (a straight line through the block if it connects one way only),
// climbing up the side of a block to dust on top of it.
function addWire(mesh, x, y, z, get, uvOf, sky, block, tint) {
  const conn = wireConnections(get, x, y, z);
  const n = conn.side.filter(Boolean).length;
  const arms = n === 1 ? (() => { const d = conn.side.indexOf(true); const a = [false, false, false, false]; a[d] = a[(d + 2) % 4] = true; return a; })() : conn.side;
  const h = y + 1 / 64;
  const dot = uvOf('redstone_dust_dot');
  const line = uvOf('redstone_dust_line');
  const flat = (x0, z0, x1, z1, uv, rotate) => {
    const [u0, v0, u1, v1] = uv;
    // texture coordinates follow x and z (or z and x when rotated)
    const U = (fx, fz) => u0 + (u1 - u0) * (rotate ? fz : fx);
    const V = (fx, fz) => v0 + (v1 - v0) * (rotate ? fx : fz);
    mesh.vertex(x + x0, h, z + z1, U(x0, z1), V(x0, z1), 1, sky, block, tint);
    mesh.vertex(x + x1, h, z + z1, U(x1, z1), V(x1, z1), 1, sky, block, tint);
    mesh.vertex(x + x0, h, z + z0, U(x0, z0), V(x0, z0), 1, sky, block, tint);
    mesh.vertex(x + x1, h, z + z0, U(x1, z0), V(x1, z0), 1, sky, block, tint);
    mesh.quad(0, 1, 2, 2, 1, 3);
  };
  flat(0.25, 0.25, 0.75, 0.75, dot, false);
  if (arms[0]) flat(0, 0, 1, 0.5, line, false);
  if (arms[2]) flat(0, 0.5, 1, 1, line, false);
  if (arms[1]) flat(0.5, 0, 1, 1, line, true);
  if (arms[3]) flat(0, 0, 0.5, 1, line, true);
  // up the side of the neighbouring block
  for (let d = 0; d < 4; d++) {
    if (!conn.up[d]) continue;
    const [dx, , dz] = FACING[d];
    const [u0, v0, u1, v1] = line;
    const px = x + 0.5 + dx * (0.5 - 1 / 64), pz = z + 0.5 + dz * (0.5 - 1 / 64);
    const ax = dz !== 0 ? 0.5 : 0, az = dx !== 0 ? 0.5 : 0; // half-width along the wall
    for (const [sx, sz, ex, ez] of [[px - ax, pz - az, px + ax, pz + az], [px + ax, pz + az, px - ax, pz - az]]) {
      mesh.vertex(sx, y + 1, sz, u0, v1, 0.9, sky, block, tint);
      mesh.vertex(sx, y, sz, u0, v0, 0.9, sky, block, tint);
      mesh.vertex(ex, y + 1, ez, u1, v1, 0.9, sky, block, tint);
      mesh.vertex(ex, y, ez, u1, v0, 0.9, sky, block, tint);
      mesh.quad(0, 1, 2, 2, 1, 3);
    }
  }
}

// Crops: four upright planes in a # pattern, like Minecraft's wheat.
const CROP_PLANES = [
  [[0.25, 0], [0.25, 1]], [[0.75, 0], [0.75, 1]], [[0, 0.25], [1, 0.25]], [[0, 0.75], [1, 0.75]],
];
function addPlanes(mesh, planes, x, y, z, uv, sky, block, tint) {
  const [u0, v0, u1, v1] = uv;
  for (const [[ax, az], [bx, bz]] of planes) {
    for (const [[sx, sz], [ex, ez]] of [[[ax, az], [bx, bz]], [[bx, bz], [ax, az]]]) {
      mesh.vertex(x + sx, y + 1, z + sz, u0, v1, 0.9, sky, block, tint);
      mesh.vertex(x + sx, y, z + sz, u0, v0, 0.9, sky, block, tint);
      mesh.vertex(x + ex, y + 1, z + ez, u1, v1, 0.9, sky, block, tint);
      mesh.vertex(x + ex, y, z + ez, u1, v0, 0.9, sky, block, tint);
      mesh.quad(0, 1, 2, 2, 1, 3);
    }
  }
}

// Two crossed quads (each drawn from both sides) for plants and torches.
function addCross(mesh, x, y, z, uv, sky, block, tint) {
  const [u0, v0, u1, v1] = uv;
  const a = 0.15, b = 0.85;
  const quads = [
    [[x + a, z + a], [x + b, z + b]],
    [[x + b, z + b], [x + a, z + a]],
    [[x + a, z + b], [x + b, z + a]],
    [[x + b, z + a], [x + a, z + b]],
  ];
  for (const [[sx, sz], [ex, ez]] of quads) {
    mesh.vertex(sx, y + 1, sz, u0, v1, 0.9, sky, block, tint);
    mesh.vertex(sx, y, sz, u0, v0, 0.9, sky, block, tint);
    mesh.vertex(ex, y + 1, ez, u1, v1, 0.9, sky, block, tint);
    mesh.vertex(ex, y, ez, u1, v0, 0.9, sky, block, tint);
    mesh.quad(0, 1, 2, 2, 1, 3);
  }
}
