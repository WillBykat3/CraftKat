import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameHost, newWorldSave } from '../public/js/host.js';
import { World } from '../public/js/world.js';
import { BLOCK, BLOCKS, ITEM, isBed } from '../public/js/blocks.js';
import { mulberry32 } from '../public/js/noise.js';

function setup(seed = 3) {
  const inbox = [];
  const host = new GameHost(newWorldSave({ name: 'X', seed }), (peer, msg) => inbox.push(structuredClone(msg)), { random: mulberry32(6) });
  host.message('a', { t: 'hello', name: 'Steve' });
  const p = host.players.get('a');
  for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) { host.setBlock(x, 199, z, BLOCK.STONE); for (let y = 200; y < 206; y++) host.setBlock(x, y, z, BLOCK.AIR); }
  Object.assign(p, { x: 0.5, y: 200, z: 0.5, mode: 'survival' });
  return { host, p, inbox };
}

test('ender pearls teleport you where they land, for 5 damage', () => {
  const { host, p, inbox } = setup();
  host.message('a', { t: 'throw', kind: 'pearl', yaw: Math.PI, pitch: -0.4 }); // forwards (south) and down
  for (let i = 0; i < 60 && [...host.entities.values()].some((e) => e.type === 'pearl'); i++) host.tick(0.05);
  const tp = inbox.find((m) => m.t === 'teleport');
  assert.ok(tp && tp.p[2] > 3, `teleported south (${tp && tp.p.map((v) => v.toFixed(1))})`);
  assert.ok(Math.abs(tp.p[1] - 200) < 1.1, 'standing on the floor');
  assert.ok(inbox.some((m) => m.t === 'hurt' && m.amount === 5));
});

test('blaze spawners in nether fortresses spawn blazes when someone is near', () => {
  const { host, p } = setup(11);
  const nt = host.dims.nether.world.other;
  let c = null;
  for (let gx = -3; gx <= 3 && !c; gx++) for (let gz = -3; gz <= 3 && !c; gz++) c = nt.fortressIn(gx, gz);
  host.changeDim(p, 'nether', [c[0] + 48 + 0.5, 65, c[1] + 0.5]);
  p.mode = 'creative';
  assert.equal(host.dims.nether.world.getBlock(c[0] + 48, 65, c[1]), BLOCK.SPAWNER);
  for (let i = 0; i < 20 * 45; i++) host.tick(0.05);
  assert.ok([...host.entities.values()].some((e) => e.type === 'blaze'), 'blazes');
  // breaking a spawner gives experience but no block
  host.inDim('nether', () => host.breakBlock(c[0] + 48, 65, c[1], ITEM.DIAMOND_PICKAXE));
  const near = [...host.entities.values()].filter((e) => Math.hypot(e.x - (c[0] + 48), e.z - c[1]) < 2);
  assert.ok(near.some((e) => e.type === 'xp'));
  assert.ok(!near.some((e) => e.type === 'item' && e.item === BLOCK.SPAWNER));
});

test('the ender dragon perches on the fountain, even with no one to attack', () => {
  const { host, p } = setup(7);
  p.mode = 'creative';
  host.changeDim(p, 'end', [0.5, 80, 30.5]);
  let perched = 0;
  for (let i = 0; i < 20 * 240; i++) {
    host.tick(0.05);
    if ([...host.entities.values()].find((e) => e.type === 'ender_dragon')?.perched) perched++;
  }
  assert.ok(perched > 20 * 9, `perched for ${perched / 20} s`);
});

test('beds are two blocks long and break together', () => {
  const { host, p } = setup();
  p.canBuild = () => true;
  host.message('a', { t: 'set', x: 2, y: 200, z: 0, id: BLOCK.BED_FOOT + 1 * 2 }); // facing east
  assert.equal(host.world.getBlock(2, 200, 0), BLOCK.BED_FOOT + 2);
  assert.equal(host.world.getBlock(3, 200, 0), BLOCK.BED_FOOT + 3, 'the head');
  host.breakBlock(3, 200, 0, 0);
  assert.equal(host.world.getBlock(2, 200, 0), BLOCK.AIR);
  assert.equal([...host.entities.values()].filter((e) => e.type === 'item' && e.item === BLOCK.BED).length, 1, 'one bed back');
  // no room for the head: not placed
  host.setBlock(4, 200, 2, BLOCK.STONE);
  host.message('a', { t: 'set', x: 3, y: 200, z: 2, id: BLOCK.BED_FOOT + 2 });
  assert.equal(host.world.getBlock(3, 200, 2), BLOCK.AIR);
  assert.ok(isBed(BLOCK.BED) && isBed(BLOCK.BED_FOOT + 7) && !isBed(BLOCK.STONE));
});

test("trees don't grow inside villages", () => {
  const w = new World(2024, 3);
  let v = null;
  for (let r = 0; r < 4 && !v; r++) for (let gx = -r; gx <= r && !v; gx++) for (let gz = -r; gz <= r && !v; gz++) v = w.villages.inCell(gx, gz);
  let leaves = 0;
  for (let x = v.x - 30; x <= v.x + 30; x++) for (let z = v.z - 30; z <= v.z + 30; z++) for (let y = v.y; y < v.y + 20; y++) if (/Leaves/.test(BLOCKS[w.getBlock(x, y, z)].name)) leaves++;
  assert.equal(leaves, 0);
});
