// Turns a chunk of block ids into triangle data with smooth lighting and
// ambient occlusion. Produces two meshes: opaque/cut-out blocks, and water.

import { CHUNK, HEIGHT, BLOCK, BLOCKS } from './blocks.js';
import { gatherRegion, computeLight, regionIndex, topY } from './lighting.js';

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

class MeshData {
  constructor() {
    this.positions = [];
    this.uvs = [];
    this.shade = [];
    this.light = [];
    this.indices = [];
  }

  vertex(x, y, z, u, v, shade, sky, block) {
    this.positions.push(x, y, z);
    this.uvs.push(u, v);
    this.shade.push(shade);
    this.light.push(sky / 15, block / 15);
  }

  finish() {
    if (this.indices.length === 0) return null;
    const vertices = this.positions.length / 3;
    return {
      positions: new Float32Array(this.positions),
      uvs: new Float32Array(this.uvs),
      shade: new Float32Array(this.shade),
      light: new Float32Array(this.light),
      indices: vertices > 65535 ? new Uint32Array(this.indices) : new Uint16Array(this.indices),
    };
  }
}

// uvOf(textureName) -> [u0, v0, u1, v1]
export function buildChunkMesh(world, cx, cz, uvOf) {
  const ids = gatherRegion(world, cx, cz);
  const { sky, block: blockLight } = computeLight(ids);
  const get = (x, y, z) => (y < 0 ? BLOCK.BEDROCK : y >= HEIGHT ? BLOCK.AIR : ids[regionIndex(x, y, z)]);
  const skyAt = (x, y, z) => (y >= HEIGHT ? 15 : y < 0 ? 0 : sky[regionIndex(x, y, z)]);
  const blockAt = (x, y, z) => (y < 0 || y >= HEIGHT ? 0 : blockLight[regionIndex(x, y, z)]);

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
        const id = ids[regionIndex(x, y, z)];
        if (id === BLOCK.AIR) continue;
        const def = BLOCKS[id];

        if (def.render === 'cross') {
          addCross(solid, x, y, z, uvOf(def.tex[0]), skyAt(x, y, z), blockAt(x, y, z));
          continue;
        }

        if (def.render === 'water') {
          const topLowered = get(x, y + 1, z) !== BLOCK.WATER;
          for (const face of FACES) {
            const [dx, dy, dz] = face.dir;
            const nid = get(x + dx, y + dy, z + dz);
            if (nid === BLOCK.WATER || OPAQUE[nid]) continue;
            const [u0, v0, u1, v1] = uvOf(def.tex[face.slot]);
            const base = water.positions.length / 3;
            const ls = skyAt(x + dx, y + dy, z + dz);
            const lb = blockAt(x + dx, y + dy, z + dz);
            for (const c of face.corners) {
              const cy = c[1] === 1 && topLowered ? WATER_TOP : c[1];
              water.vertex(x + c[0], y + cy, z + c[2], c[3] ? u1 : u0, c[4] ? v1 : v0, face.shade, ls, lb);
            }
            water.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
          }
          continue;
        }

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
          const base = solid.positions.length / 3;
          for (let i = 0; i < 4; i++) {
            const c = face.corners[i];
            // side faces of short blocks show only the bottom part of the texture
            const v = c[4] ? (dy === 0 ? v0 + (v1 - v0) * h : v1) : v0;
            solid.vertex(x + c[0], y + (c[1] ? h : 0), z + c[2], c[3] ? u1 : u0, v,
              face.shade * AO_LEVELS[ao[i]], vs[i], vb[i]);
          }
          // split the quad along the diagonal that hides interpolation artefacts
          const b0 = ao[0] + vs[0] / 15, b1 = ao[1] + vs[1] / 15, b2 = ao[2] + vs[2] / 15, b3 = ao[3] + vs[3] / 15;
          if (b0 + b3 > b1 + b2) {
            solid.indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
          } else {
            solid.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
          }
        }
      }
    }
  }

  return { solid: solid.finish(), water: water.finish() };
}

// Two crossed quads (each drawn from both sides) for plants and torches.
function addCross(mesh, x, y, z, uv, sky, block) {
  const [u0, v0, u1, v1] = uv;
  const a = 0.15, b = 0.85;
  const quads = [
    [[x + a, z + a], [x + b, z + b]],
    [[x + b, z + b], [x + a, z + a]],
    [[x + a, z + b], [x + b, z + a]],
    [[x + b, z + a], [x + a, z + b]],
  ];
  for (const [[sx, sz], [ex, ez]] of quads) {
    const base = mesh.positions.length / 3;
    mesh.vertex(sx, y + 1, sz, u0, v1, 0.9, sky, block);
    mesh.vertex(sx, y, sz, u0, v0, 0.9, sky, block);
    mesh.vertex(ex, y + 1, ez, u1, v1, 0.9, sky, block);
    mesh.vertex(ex, y, ez, u1, v0, 0.9, sky, block);
    mesh.indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }
}
