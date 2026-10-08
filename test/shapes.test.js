import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../public/js/world.js';
import { BLOCK, BLOCKS, getDrops, ITEM, isSupported, blockItem } from '../public/js/blocks.js';
import { moveBody, collides } from '../public/js/physics.js';
import { shapeBoxes, selectionBoxes, rayBox, facingFromYaw } from '../public/js/shapes.js';
import { buildChunkMesh } from '../public/js/mesher.js';
import { uvOf } from '../public/js/atlas-layout.js';
import { findRecipe } from '../public/js/inventory.js';

// A flat stone floor high in the sky, so the terrain doesn't matter.
function floorWorld() {
  const w = new World(1, 3);
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) w.setBlock(x, 200, z, BLOCK.STONE);
  return w;
}
const body = (x, y, z) => ({ x, y, z, vx: 0, vy: 0, vz: 0, halfW: 0.3, height: 1.8, onGround: true });

function walk(w, b, vx, vz, seconds, step = 0.6) {
  b.maxY = b.y;
  for (let t = 0; t < seconds; t += 0.05) {
    b.vx = vx; b.vz = vz; b.vy -= 32 * 0.05;
    const r = moveBody(w, b, 0.05, step);
    b.onGround = r.onGround;
    b.maxY = Math.max(b.maxY, b.y);
  }
  return b;
}

test('players walk up slabs and stairs, but not up full blocks', () => {
  const w = floorWorld();
  w.setBlock(2, 201, 0, BLOCK.OAK_SLAB);
  const a = walk(w, body(0.5, 201, 0.5), 4, 0, 0.55);
  assert.ok(a.x > 2 && Math.abs(a.y - 201.5) < 0.01, `onto the slab: ${a.x.toFixed(2)}, ${a.y.toFixed(3)}`);

  const w2 = floorWorld();
  w2.setBlock(2, 201, 0, BLOCK.OAK_STAIRS + 3); // tall half on the west, i.e. facing -x... climb from the east side
  w2.setBlock(-2, 201, 0, BLOCK.OAK_STAIRS + 1); // facing east: walking east climbs it
  w2.setBlock(-1, 202, 0, BLOCK.STONE);
  const b = walk(w2, body(-3.5, 201, 0.5), 3, 0, 0.9);
  assert.ok(b.maxY > 201.9, `climbed the stairs: y ${b.maxY.toFixed(3)}`);

  const w3 = floorWorld();
  w3.setBlock(2, 201, 0, BLOCK.STONE);
  const c = walk(w3, body(0.5, 201, 0.5), 4, 0, 1.5);
  assert.ok(c.x < 1.71 && Math.abs(c.y - 201) < 0.01, 'a full block stops you');
});

test('fences are too tall to step or jump onto, closed doors block, open doors let you through', () => {
  const w = floorWorld();
  w.setBlock(2, 201, 0, BLOCK.OAK_FENCE);
  const b = body(0.5, 201, 0.5);
  b.vy = 8.2; // a jump
  for (let t = 0; t < 1.5; t += 0.05) { b.vx = 4; b.vy -= 32 * 0.05; b.onGround = moveBody(w, b, 0.05, 0.6).onGround; }
  assert.ok(b.x < 2.4, `stopped by the fence at x ${b.x.toFixed(2)}`);

  const d = floorWorld();
  // a door across the path (facing east, so the closed panel is on the block's west side)
  d.setBlock(2, 201, 0, BLOCK.OAK_DOOR + 1);
  d.setBlock(2, 202, 0, BLOCK.OAK_DOOR + 8 + 1);
  const p = walk(d, body(0.5, 201, 0.5), 4, 0, 1.5);
  assert.ok(p.x < 2, `closed door stops you: ${p.x.toFixed(2)}`);
  d.setBlock(2, 201, 0, BLOCK.OAK_DOOR + 4 + 1);
  d.setBlock(2, 202, 0, BLOCK.OAK_DOOR + 8 + 4 + 1);
  const q = walk(d, body(0.5, 201, 0.5), 4, 0, 1.5);
  assert.ok(q.x > 3, `open door lets you through: ${q.x.toFixed(2)}`);
});

test('shapes: aiming hits only the real box, facings and drops are right', () => {
  const slab = selectionBoxes(BLOCK.OAK_SLAB);
  assert.equal(rayBox([0.5, 0.9, -1], [0, 0, 1], slab[0]), null, 'a ray above a slab misses it');
  const hit = rayBox([0.5, 0.25, -1], [0, 0, 1], slab[0]);
  assert.ok(hit && Math.abs(hit.t - 1) < 1e-9 && hit.normal[2] === -1);
  assert.equal(facingFromYaw(0), 0);            // looking north
  assert.equal(facingFromYaw(-Math.PI / 2), 1); // looking east
  assert.equal(facingFromYaw(Math.PI), 2);
  assert.equal(facingFromYaw(Math.PI / 2), 3);
  // fences connect to fences and solid blocks
  assert.equal(shapeBoxes(BLOCK.OAK_FENCE, () => BLOCK.AIR).length, 1);
  assert.equal(shapeBoxes(BLOCK.OAK_FENCE, (dx) => (dx === 1 ? BLOCK.OAK_FENCE : BLOCK.AIR)).length, 3);
  // drops
  assert.deepEqual(getDrops(BLOCK.OAK_DOOR + 8, 0), []);
  assert.deepEqual(getDrops(BLOCK.OAK_DOOR + 2, 0), [[ITEM.OAK_DOOR, 1]]);
  assert.deepEqual(getDrops(BLOCK.LADDER + 3, 0), [[BLOCK.LADDER, 1]]);
  assert.deepEqual(getDrops(BLOCK.OAK_STAIRS + 2, 0), [[BLOCK.OAK_STAIRS, 1]]);
  assert.equal(blockItem(BLOCK.OAK_DOOR + 9), ITEM.OAK_DOOR);
  assert.deepEqual(getDrops(BLOCK.FARMLAND, 0), [[BLOCK.DIRT, 1]]);
  // doors need a floor, the top half needs the bottom half
  assert.ok(isSupported(BLOCK.OAK_DOOR, BLOCK.STONE));
  assert.ok(!isSupported(BLOCK.OAK_DOOR, BLOCK.AIR));
  assert.ok(isSupported(BLOCK.OAK_DOOR + 8, BLOCK.OAK_DOOR));
  assert.ok(!isSupported(BLOCK.OAK_DOOR + 8, BLOCK.STONE));
  assert.ok(isSupported(BLOCK.WHEAT, BLOCK.FARMLAND) && !isSupported(BLOCK.WHEAT, BLOCK.DIRT));
});

test('shaped blocks and crops are drawn', () => {
  const w = floorWorld();
  w.setBlock(1, 201, 1, BLOCK.OAK_SLAB);
  w.setBlock(3, 201, 1, BLOCK.OAK_FENCE);
  w.setBlock(4, 201, 1, BLOCK.OAK_FENCE);
  w.setBlock(5, 200, 1, BLOCK.FARMLAND);
  w.setBlock(5, 201, 1, BLOCK.WHEAT + 7);
  const { solid } = buildChunkMesh(w, 0, 0, uvOf);
  const at = (x0, x1, y0, y1) => {
    let n = 0;
    for (let i = 0; i < solid.positions.length; i += 3) {
      const x = solid.positions[i], y = solid.positions[i + 1], z = solid.positions[i + 2];
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= 1 && z <= 2) n++;
    }
    return n;
  };
  // slab: top at y 201.5, nothing drawn above it
  assert.ok(at(1, 2, 201.5, 201.5) >= 4);
  assert.equal(at(1, 2, 201.51, 202), 0);
  assert.ok(at(3, 5, 201, 202) > 24, 'fences with rails between them');
  assert.ok(at(5, 6, 201, 202) >= 32, 'wheat planes');
});

test('recipes for the new blocks and items', () => {
  const grid = (rows) => rows.join('').split('').map((c) => (c === '.' ? null : { id: Number({ P: BLOCK.PLANKS, S: ITEM.STICK, C: BLOCK.COBBLE, W: ITEM.WHEAT, I: ITEM.IRON_INGOT, T: ITEM.STRING, L: ITEM.LEATHER }[c]), count: 1 }));
  const r = (rows) => { const st = findRecipe(grid(rows), 3); return st && [st.id, st.count]; };
  assert.deepEqual(r(['PP.', 'PP.', 'PP.']), [ITEM.OAK_DOOR, 3]);
  assert.deepEqual(r(['S.S', 'SSS', 'S.S']), [BLOCK.LADDER, 3]);
  assert.deepEqual(r(['PSP', 'PSP', '...']), [BLOCK.OAK_FENCE, 3]);
  assert.deepEqual(r(['...', '...', 'PPP']), [BLOCK.OAK_SLAB, 6]);
  assert.deepEqual(r(['C..', 'CC.', 'CCC']), [BLOCK.COBBLESTONE_STAIRS, 4]);
  assert.deepEqual(r(['WWW', '...', '...']), [ITEM.BREAD, 1]);
  assert.deepEqual(r(['III', 'I.I', '...']), [ITEM.IRON_HELMET, 1]);
  assert.deepEqual(r(['L.L', 'LLL', 'LLL']), [ITEM.LEATHER_CHESTPLATE, 1]);
  assert.deepEqual(r(['.ST', 'S.T', '.ST']), [ITEM.BOW, 1]);
  assert.deepEqual(r(['PP.', '.S.', '.S.']), [ITEM.WOODEN_HOE, 1]);
});

test('a body inside nothing does not collide; standing on a slab does not count as inside it', () => {
  const w = floorWorld();
  w.setBlock(0, 201, 0, BLOCK.OAK_SLAB);
  assert.ok(!collides(w, body(0.5, 201.5001, 0.5)));
  assert.ok(collides(w, body(0.5, 201.3, 0.5)));
  assert.equal(BLOCKS[BLOCK.OAK_SLAB].render, 'shape');
});
