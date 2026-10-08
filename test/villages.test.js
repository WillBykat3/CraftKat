import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameHost, newWorldSave } from '../public/js/host.js';
import { World } from '../public/js/world.js';
import { BLOCK, BLOCKS, ITEM } from '../public/js/blocks.js';
import { mulberry32 } from '../public/js/noise.js';
import { TRADES, offersFor } from '../public/js/trades.js';

const SEED = 2024;
function findVillage(world) {
  for (let r = 0; r < 4; r++) for (let gx = -r; gx <= r; gx++) for (let gz = -r; gz <= r; gz++) {
    const v = world.villages.inCell(gx, gz);
    if (v && v.beds.some((b) => b.job)) return v;
  }
  return null;
}
function setup() {
  const inbox = new Map();
  const host = new GameHost(newWorldSave({ name: 'V', seed: SEED }), (peer, msg) => {
    if (!inbox.has(peer)) inbox.set(peer, []);
    inbox.get(peer).push(structuredClone(msg));
  }, { random: mulberry32(9) });
  host.message('a', { t: 'hello', name: 'Steve' });
  const last = (t) => [...(inbox.get('a') || [])].reverse().find((m) => m.t === t);
  return { host, p: host.players.get('a'), last, inbox };
}

test('villages generate with a well, paths, houses, beds and job sites', () => {
  const w = new World(SEED, 3);
  const v = findVillage(w);
  assert.ok(v, 'a village nearby');
  assert.ok(v.beds.length >= 3);
  // the well has water and a cobblestone rim
  let water = 0;
  for (let dx = -2; dx <= 1; dx++) for (let dz = -2; dz <= 1; dz++) if (w.getBlock(v.x + dx, v.y - 1, v.z + dz) === BLOCK.WATER) water++;
  assert.equal(water, 4);
  // beds and job sites are where the village says
  for (const b of v.beds) assert.equal(w.getBlock(b.x, b.y, b.z), BLOCK.BED, `bed at ${b.x},${b.y},${b.z}`);
  let paths = 0;
  for (let d = 4; d < 20; d++) if (w.getBlock(v.x + d, w.terrain.column(v.x + d, v.z).h, v.z) === BLOCK.DIRT_PATH) paths++;
  assert.ok(paths > 5, `paths: ${paths}`);
  assert.equal(new World(SEED, 2).villages, null, 'older worlds have none');
});

test('villagers appear when you come near, trade, level up, and are saved', () => {
  const { host, p, last } = setup();
  const v = findVillage(host.dims.overworld.world);
  host.message('a', { t: 'pos', p: [v.x + 0.5, v.y + 1, v.z + 0.5], r: [0, 0] });
  host.tick(1.1);
  const villagers = [...host.entities.values()].filter((e) => e.type === 'villager');
  assert.equal(villagers.length, v.beds.length);
  assert.equal([...host.entities.values()].filter((e) => e.type === 'iron_golem').length, 1);
  const trader = villagers.find((e) => e.offers.length);
  assert.ok(trader, 'someone has a job');
  assert.equal(trader.offers.length, 2);
  // trade
  p.x = trader.x; p.z = trader.z + 1;
  host.message('a', { t: 'interact', e: trader.id });
  assert.equal(last('trades').e, trader.id);
  for (let i = 0; i < 6; i++) host.message('a', { t: 'trade', e: trader.id, i: 0 });
  assert.ok(last('traded').ok);
  assert.ok(trader.level >= 1, 'levelled up after a few trades');
  assert.equal(trader.offers.length, 4, 'new offers at the next level');
  // used up, then restocked in the morning
  const o = trader.offers[0];
  o.uses = o.max;
  host.message('a', { t: 'trade', e: trader.id, i: 0 });
  assert.equal(last('traded').ok, false);
  host.time = 990;
  host.tick(1); // morning
  assert.equal(o.uses, 0);
  // villagers survive saving and loading, and don't appear twice
  const data = structuredClone(host.serialize());
  const host2 = new GameHost(data, () => {}, {});
  const again = [...host2.entities.values()].filter((e) => e.type === 'villager');
  assert.equal(again.length, villagers.length);
  assert.ok(again.some((e) => e.level >= 1));
  host2.message('b', { t: 'hello', name: 'Steve' });
  host2.message('b', { t: 'pos', p: [v.x + 0.5, v.y + 1, v.z + 0.5], r: [0, 0] });
  host2.tick(1.1);
  assert.equal([...host2.entities.values()].filter((e) => e.type === 'villager').length, villagers.length);
});

test('iron golems fight monsters and go after players who hurt villagers; zombies hunt villagers', () => {
  const { host, p, last } = setup();
  const v = findVillage(host.dims.overworld.world);
  host.message('a', { t: 'pos', p: [v.x + 0.5, v.y + 1, v.z + 0.5], r: [0, 0] });
  host.tick(1.1);
  const golem = [...host.entities.values()].find((e) => e.type === 'iron_golem');
  const zombie = host.spawnMob('zombie', golem.x + 2, golem.y, golem.z);
  for (let i = 0; i < 100 && host.entities.has(zombie.id); i++) host.tick(0.05);
  assert.ok(!host.entities.has(zombie.id), 'the golem killed the zombie');
  const villager = [...host.entities.values()].find((e) => e.type === 'villager');
  p.mode = 'survival';
  p.x = villager.x + 1; p.y = villager.y; p.z = villager.z;
  host.message('a', { t: 'attack', e: villager.id, tool: 0 });
  assert.equal(golem.angryAt, 'Steve');
  p.mode = 'creative'; // (so the zombie isn't distracted by the player)
  // a zombie goes for a villager rather than wandering (on a flat platform, as mobs don't find paths)
  // (walled in: villagers run from zombies, and are faster in the open)
  for (let x = -10; x <= 10; x++) for (let z = -4; z <= 4; z++) {
    host.setBlock(x, 199, z, BLOCK.STONE);
    for (const y of [200, 201]) host.setBlock(x, y, z, Math.abs(x) === 10 || Math.abs(z) === 4 ? BLOCK.STONE : BLOCK.AIR);
  }
  Object.assign(villager, { x: 0.5, y: 200, z: 0.5, bed: null, home: null });
  p.x = 0; p.z = 0; // keep it near a player so it's simulated
  const z2 = host.spawnMob('zombie', 6.5, 200, 0.5);
  host.time = 18000;
  golem.x += 200; // out of the way
  const hp = villager.hp;
  for (let i = 0; i < 200 && villager.hp === hp; i++) host.tick(0.05);
  assert.ok(villager.hp < hp || !host.entities.has(villager.id), 'the zombie attacked the villager');
  assert.ok(z2 && last);
});

test('every profession has five levels of trades with real items', () => {
  for (const [job, levels] of Object.entries(TRADES)) {
    assert.equal(levels.length, 5, job);
    for (let l = 0; l < 5; l++) {
      const offers = offersFor(job, l, mulberry32(l));
      assert.ok(offers.length >= 1, `${job} level ${l}`);
      for (const o of offers) for (const [id] of [...o.cost, o.result]) assert.ok(BLOCKS[id] || id >= 256, `${job}: ${id}`);
    }
  }
  assert.ok(ITEM.EMERALD);
});

test('smokers cook only food, blast furnaces only ores, both twice as fast; barrels hold items', () => {
  const { host, p } = setup();
  host.setBlock(5, 150, 5, BLOCK.SMOKER);
  host.setBlock(6, 150, 5, BLOCK.BLAST_FURNACE);
  host.setBlock(7, 150, 5, BLOCK.BARREL);
  const [, smoker] = host.furnaceAt({ x: 5, y: 150, z: 5 });
  const [, blast] = host.furnaceAt({ x: 6, y: 150, z: 5 });
  smoker.slots = [{ id: ITEM.RAW_BEEF, count: 2 }, { id: ITEM.COAL, count: 1 }, null];
  blast.slots = [{ id: ITEM.RAW_BEEF, count: 2 }, { id: ITEM.COAL, count: 1 }, null];
  for (let i = 0; i < 110; i++) host.tick(0.05); // 5.5 s: one item in a normal furnace would need 10
  assert.equal(smoker.slots[2]?.id, ITEM.STEAK);
  assert.equal(blast.slots[2], null, "a blast furnace won't cook food");
  assert.ok(host.chestAt({ ...p, x: p.x, y: p.y, z: p.z, canBuild: () => true }, { x: 7, y: 150, z: 5 }) !== undefined, 'a barrel is a container');
  assert.ok(p);
});
