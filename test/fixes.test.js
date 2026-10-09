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

test('mobs forget their grudge when the player dies; saturation is saved', () => {
  const { host, p } = setup();
  const piglin = host.spawnMob('zombified_piglin', 3.5, 200, 0.5);
  piglin.angryAt = 'Steve'; piglin.angry = true;
  const wolf = host.spawnMob('wolf', -3.5, 200, 0.5);
  wolf.angryAt = 'Steve';
  host.message('a', { t: 'died', items: [], cause: 'was slain by Zombified Piglin', xp: 0 });
  assert.equal(piglin.angryAt, null);
  assert.equal(piglin.angry, false);
  assert.equal(wolf.angryAt, null);
  host.message('a', { t: 'save', saturation: 3.5, food: 18 });
  host.storePlayer(p);
  assert.equal(host.save.players.steve.saturation, 3.5);
});

test('you can build up to y 319 and mountains are no longer cut flat', async () => {
  const { HEIGHT } = await import('../public/js/blocks.js');
  const w = new World(2024, 3);
  assert.equal(HEIGHT - w.yOffset, 320);
  let max = 0;
  for (let x = -4000; x <= 4000; x += 41) for (let z = -4000; z <= 4000; z += 41) max = Math.max(max, w.terrain.column(x, z).h - w.yOffset);
  assert.ok(max > 182, `peaks reach ${max}`);
});

test('dungeons: mossy rooms underground with a spawner and loot chests', async () => {
  const { dungeonIn } = await import('../public/js/dungeons.js');
  const w = new World(2024, 3);
  let d = null;
  for (let gx = 0; gx < 20 && !d; gx++) for (let gz = 0; gz < 20 && !d; gz++) {
    const c = dungeonIn(gx, gz, w.seed);
    if (c && w.terrain.column(c.x, c.z).h >= c.y + 10) d = c;
  }
  assert.ok(d, 'a dungeon');
  assert.equal(w.getBlock(d.x, d.y + 1, d.z), BLOCK.SPAWNER + d.mob);
  assert.ok([BLOCK.COBBLE, BLOCK.MOSSY_COBBLESTONE].includes(w.getBlock(d.x, d.y, d.z)));
  const [cx, cz] = d.chests[0];
  assert.equal(w.getBlock(cx, d.y + 1, cz), BLOCK.CHEST);
  // the host fills it with loot the first time it's opened
  const { host, p } = setup(2024);
  host.dims.overworld.world.getBlock(cx, d.y + 1, cz);
  Object.assign(p, { x: cx + 0.5, y: d.y + 1, z: cz + 1.5 });
  const [, chest] = host.chestAt(p, { x: cx, y: d.y + 1, z: cz });
  const items = chest.slots.filter(Boolean);
  assert.ok(items.length >= 5, `${items.length} stacks`);
  assert.ok(items.some((s) => [ITEM.BONE, ITEM.GUNPOWDER, ITEM.ROTTEN_FLESH, ITEM.STRING].includes(s.id)));
});
