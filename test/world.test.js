import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../public/js/world.js';
import { buildChunkMesh, FACES } from '../public/js/mesher.js';
import { BLOCK, HEIGHT, CHUNK } from '../public/js/blocks.js';

const uv = () => [0, 0, 1, 1];

test('terrain is deterministic for a seed', () => {
  const a = new World(42);
  const b = new World(42);
  const c = new World(43);
  let diff = 0;
  for (let x = -40; x < 40; x += 3) {
    for (let z = -40; z < 40; z += 3) {
      for (let y = 0; y < HEIGHT; y += 2) {
        assert.equal(a.getBlock(x, y, z), b.getBlock(x, y, z));
        if (a.getBlock(x, y, z) !== c.getBlock(x, y, z)) diff++;
      }
    }
  }
  assert.ok(diff > 0, 'different seeds should give different terrain');
});

test('columns have bedrock at the bottom and a surface block on top', () => {
  const w = new World(7);
  for (let x = -20; x < 20; x += 5) {
    const h = w.heightAt(x, 3);
    assert.equal(w.getBlock(x, 0, 3), BLOCK.BEDROCK);
    assert.ok([BLOCK.GRASS, BLOCK.SAND, BLOCK.SNOW].includes(w.getBlock(x, h, 3)));
    assert.ok(h > 0 && h < HEIGHT);
  }
});

test('trees exist and are identical across chunk borders', () => {
  const w = new World(99);
  let logs = 0;
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
    const data = w.getChunk(cx, cz);
    for (const id of data) if (id === BLOCK.LOG) logs++;
  }
  assert.ok(logs > 20, `expected some trees, found ${logs} log blocks`);
  // generating chunks in a different order must give the same blocks
  const w2 = new World(99);
  for (let cx = 3; cx >= -3; cx--) for (let cz = 3; cz >= -3; cz--) {
    assert.deepEqual(w2.getChunk(cx, cz), w.getChunk(cx, cz));
  }
});

test('edits survive export/import and chunk unloading', () => {
  const w = new World(1);
  w.setBlock(5, 30, -7, BLOCK.BRICK);
  w.setBlock(-17, 2, 33, BLOCK.AIR);
  w.unloadFar(1000, 1000, 1); // drop all chunk data
  assert.equal(w.getBlock(5, 30, -7), BLOCK.BRICK);
  assert.equal(w.getBlock(-17, 2, 33), BLOCK.AIR);

  const copy = new World(1);
  copy.importEdits(w.exportEdits());
  assert.deepEqual(copy.exportEdits().sort(), w.exportEdits().sort());
  assert.equal(copy.getBlock(5, 30, -7), BLOCK.BRICK);
});

test('a lone block produces exactly 6 outward faces', () => {
  const w = new World(1);
  // clear a chunk's worth of space high in the sky and put one block there
  w.setBlock(4, 60, 4, BLOCK.STONE);
  const mesh = buildChunkMesh(w, 0, 0, uv);
  // count faces belonging to y in [60, 61]
  let faces = 0;
  for (let i = 0; i < mesh.positions.length; i += 12) {
    const ys = [mesh.positions[i + 1], mesh.positions[i + 4], mesh.positions[i + 7], mesh.positions[i + 10]];
    if (ys.every((y) => y >= 60 && y <= 61)) faces++;
  }
  assert.equal(faces, 6);
  assert.equal(mesh.indices.length % 6, 0);
});

test('hidden faces between solid blocks are culled', () => {
  const w = new World(1);
  w.setBlock(4, 60, 4, BLOCK.STONE);
  w.setBlock(5, 60, 4, BLOCK.STONE);
  const mesh = buildChunkMesh(w, 0, 0, uv);
  let faces = 0;
  for (let i = 0; i < mesh.positions.length; i += 12) {
    if (mesh.positions[i + 1] >= 60 && mesh.positions[i + 1] <= 61 &&
        mesh.positions[i + 4] >= 60 && mesh.positions[i + 7] >= 60) faces++;
  }
  assert.equal(faces, 10); // 12 faces minus the 2 touching ones
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

test('chunk size constants are sane', () => {
  assert.equal(new World(1).getChunk(0, 0).length, CHUNK * CHUNK * HEIGHT);
});
