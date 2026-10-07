// Turns a chunk of block ids into triangle data. Only faces next to a
// transparent block are emitted, and each vertex gets ambient occlusion.

import { CHUNK, HEIGHT, BLOCK, BLOCKS } from './blocks.js';
import { blockIndex } from './world.js';

// slot: index into a block's tex array ([top, side, bottom])
// corners are ordered so triangles (0,1,2) and (2,1,3) face outwards (counter-clockwise).
export const FACES = [
  { dir: [-1, 0, 0], slot: 1, shade: 0.8, corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [1, 0, 0], slot: 1, shade: 0.8, corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [0, -1, 0], slot: 2, shade: 0.5, corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 1, 0], slot: 0, shade: 1.0, corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, 0, -1], slot: 1, shade: 0.65, corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
  { dir: [0, 0, 1], slot: 1, shade: 0.65, corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
];

const AO_LEVELS = [0.5, 0.68, 0.84, 1.0];

// uvOf(textureName) -> [u0, v0, u1, v1]
export function buildChunkMesh(world, cx, cz, uvOf) {
  const nb = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) nb.push(world.getChunk(cx + dx, cz + dz));
  const data = nb[4];

  // block lookup in chunk-local coordinates (may reach into neighbouring chunks)
  const get = (x, y, z) => {
    if (y < 0) return BLOCK.BEDROCK;
    if (y >= HEIGHT) return BLOCK.AIR;
    const ix = x < 0 ? 0 : x >= CHUNK ? 2 : 1;
    const iz = z < 0 ? 0 : z >= CHUNK ? 2 : 1;
    return nb[iz * 3 + ix][blockIndex(x - (ix - 1) * CHUNK, y, z - (iz - 1) * CHUNK)];
  };
  const occludes = (x, y, z) => (BLOCKS[get(x, y, z)].transparent ? 0 : 1);

  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const ao = [0, 0, 0, 0];
  const p = [0, 0, 0];

  for (let y = 0; y < HEIGHT; y++) {
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const id = data[blockIndex(x, y, z)];
        if (id === BLOCK.AIR) continue;
        const def = BLOCKS[id];

        for (const face of FACES) {
          const [dx, dy, dz] = face.dir;
          const nid = get(x + dx, y + dy, z + dz);
          if (!BLOCKS[nid].transparent) continue;
          if (nid === id && def.cullSame) continue;

          // the two axes lying in the face plane
          const axisN = dx !== 0 ? 0 : dy !== 0 ? 1 : 2;
          const axisU = axisN === 0 ? 1 : 0;
          const axisV = axisN === 2 ? 1 : 2;
          const bx = x + dx;
          const by = y + dy;
          const bz = z + dz;

          for (let i = 0; i < 4; i++) {
            const c = face.corners[i];
            p[0] = 0; p[1] = 0; p[2] = 0;
            p[axisU] = c[axisU] ? 1 : -1;
            const s1 = occludes(bx + p[0], by + p[1], bz + p[2]);
            p[axisU] = 0;
            p[axisV] = c[axisV] ? 1 : -1;
            const s2 = occludes(bx + p[0], by + p[1], bz + p[2]);
            p[axisU] = c[axisU] ? 1 : -1;
            const corner = occludes(bx + p[0], by + p[1], bz + p[2]);
            ao[i] = s1 && s2 ? 0 : 3 - (s1 + s2 + corner);
          }

          const [u0, v0, u1, v1] = uvOf(def.tex[face.slot]);
          const base = positions.length / 3;
          for (let i = 0; i < 4; i++) {
            const c = face.corners[i];
            positions.push(x + c[0], y + c[1], z + c[2]);
            uvs.push(c[3] ? u1 : u0, c[4] ? v1 : v0);
            const light = face.shade * AO_LEVELS[ao[i]];
            colors.push(light, light, light);
          }
          // split the quad along the diagonal that hides AO interpolation artefacts
          if (ao[0] + ao[3] > ao[1] + ao[2]) {
            indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
          } else {
            indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
          }
        }
      }
    }
  }

  if (indices.length === 0) return null;
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    indices: positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
  };
}
