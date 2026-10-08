import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../public/js/world.js';
import { buildChunkMesh, FACES } from '../public/js/mesher.js';
import { BLOCK, HEIGHT } from '../public/js/blocks.js';

const uv = () => [0, 0, 1, 1];

// Faces whose 4 vertices all lie within the given box.
function facesIn(mesh, [x0, y0, z0], [x1, y1, z1]) {
  let n = 0;
  for (let i = 0; i < mesh.positions.length; i += 12) {
    let inside = true;
    for (let v = 0; v < 4; v++) {
      const x = mesh.positions[i + v * 3], y = mesh.positions[i + v * 3 + 1], z = mesh.positions[i + v * 3 + 2];
      if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) inside = false;
    }
    if (inside) n++;
  }
  return n;
}

test('a lone block in the sky has 6 faces, fully lit by the sky', () => {
  const w = new World(1);
  w.setBlock(4, HEIGHT - 5, 4, BLOCK.STONE);
  const { solid } = buildChunkMesh(w, 0, 0, uv);
  const y = HEIGHT - 5;
  assert.equal(facesIn(solid, [4, y, 4], [5, y + 1, 5]), 6);
  // light attribute of the top face should be full sky light
  for (let i = 0; i < solid.positions.length / 3; i++) {
    if (solid.positions[i * 3 + 1] === y + 1 && solid.positions[i * 3] >= 4 && solid.positions[i * 3] <= 5 &&
        solid.positions[i * 3 + 2] >= 4 && solid.positions[i * 3 + 2] <= 5) {
      assert.equal(solid.light[i * 2], 255);
    }
  }
});

test('touching blocks hide their shared faces', () => {
  const w = new World(1);
  const y = HEIGHT - 5;
  w.setBlock(4, y, 4, BLOCK.STONE);
  w.setBlock(5, y, 4, BLOCK.STONE);
  const { solid } = buildChunkMesh(w, 0, 0, uv);
  assert.equal(facesIn(solid, [4, y, 4], [6, y + 1, 5]), 10);
});

test('plants become crossed quads and water goes in its own mesh', () => {
  const w = new World(1);
  const y = HEIGHT - 5;
  w.setBlock(8, y, 8, BLOCK.POPPY);
  w.setBlock(2, y, 2, BLOCK.WATER);
  const { solid, water } = buildChunkMesh(w, 0, 0, uv);
  assert.equal(facesIn(solid, [8, y, 8], [9, y + 1, 9]), 4);
  assert.equal(facesIn(water, [2, y, 2], [3, y + 1, 3]), 6);
});

test('a torch in a sealed room lights it with block light', () => {
  const w = new World(1);
  const y = HEIGHT - 10;
  for (let x = 2; x <= 8; x++) for (let z = 2; z <= 8; z++) for (let yy = y - 1; yy <= y + 3; yy++) {
    const wall = x === 2 || x === 8 || z === 2 || z === 8 || yy === y - 1 || yy === y + 3;
    w.setBlock(x, yy, z, wall ? BLOCK.STONE : BLOCK.AIR);
  }
  w.setBlock(5, y, 5, BLOCK.TORCH);
  const { solid } = buildChunkMesh(w, 0, 0, uv);
  let maxBlock = 0, maxSkyInside = 0;
  for (let i = 0; i < solid.positions.length / 3; i++) {
    const x = solid.positions[i * 3], yy = solid.positions[i * 3 + 1], z = solid.positions[i * 3 + 2];
    if (x > 3 && x < 8 && z > 3 && z < 8 && yy === y) { // floor of the room
      maxBlock = Math.max(maxBlock, solid.light[i * 2 + 1]);
      maxSkyInside = Math.max(maxSkyInside, solid.light[i * 2]);
    }
  }
  assert.ok(maxBlock > 0.7, 'floor near the torch is lit: ' + maxBlock);
  assert.equal(maxSkyInside, 0, 'no sky light gets into a sealed room');
});

test('every face triangle winds outwards', () => {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (const face of FACES) {
    const c = face.corners;
    for (const [i, j, k] of [[0, 1, 2], [2, 1, 3], [0, 1, 3], [0, 3, 2]]) {
      assert.deepEqual(cross(sub(c[j], c[i]), sub(c[k], c[i])).map((v) => v + 0), face.dir);
    }
  }
});
