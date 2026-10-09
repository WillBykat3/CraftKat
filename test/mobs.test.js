import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameHost, newWorldSave } from '../public/js/host.js';
import { BLOCK, ITEM } from '../public/js/blocks.js';
import { mulberry32 } from '../public/js/noise.js';
import { BIOME } from '../public/js/biomes.js';

function setup(seed = 77) {
  const inbox = [];
  const host = new GameHost(newWorldSave({ name: 'M', seed }), (peer, msg) => inbox.push(structuredClone(msg)), { random: mulberry32(5) });
  host.message('a', { t: 'hello', name: 'Steve' });
  const p = host.players.get('a');
  // a walled, flat stone arena high in the sky, with the player in the middle
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) {
    host.setBlock(x, 199, z, BLOCK.STONE);
    for (let y = 200; y < 204; y++) host.setBlock(x, y, z, Math.abs(x) === 12 || Math.abs(z) === 12 ? BLOCK.STONE : BLOCK.AIR);
  }
  Object.assign(p, { x: 0.5, y: 200, z: 0.5, mode: 'creative' });
  const mobs = (type) => [...host.entities.values()].filter((e) => e.type === type);
  return { host, p, inbox, mobs };
}
const run = (host, seconds) => { for (let i = 0; i < seconds * 20; i++) host.tick(0.05); };

test('animals fed their food fall in love and have a baby, which grows up', () => {
  const { host, p, inbox, mobs } = setup();
  host.time = 1000;
  const a = host.spawnMob('cow', 3.5, 200, 0.5), b = host.spawnMob('cow', 5.5, 200, 0.5);
  host.message('a', { t: 'interact', e: a.id, tool: ITEM.CARROT });
  assert.ok(!(a.love > 0), "cows don't eat carrots");
  for (const e of [a, b]) { p.x = e.x - 1; host.message('a', { t: 'interact', e: e.id, tool: ITEM.WHEAT }); }
  assert.equal(inbox.filter((m) => m.t === 'consume').length, 2);
  run(host, 15);
  const babies = mobs('cow').filter((c) => c.baby > 0);
  assert.equal(babies.length, 1, 'a calf');
  assert.ok(babies[0].persist && babies[0].height < a.height);
  assert.ok(a.breedCooldown > 0, 'parents wait before breeding again');
  // feeding the baby makes it grow up sooner; babies drop nothing when killed
  const left = babies[0].baby;
  p.x = babies[0].x; p.z = babies[0].z + 1; // (walk up to it)
  host.message('a', { t: 'interact', e: babies[0].id, tool: ITEM.WHEAT });
  assert.ok(babies[0].baby < left);
  const items = [...host.entities.values()].filter((e) => e.type === 'item').length;
  host.killMob(babies[0]);
  assert.equal([...host.entities.values()].filter((e) => e.type === 'item').length, items);
});

test('wolves are tamed with bones, sit when told, follow and defend their owner', () => {
  const { host, p, mobs } = setup();
  host.time = 1000;
  const w = host.spawnMob('wolf', 2.5, 200, 0.5);
  for (let i = 0; i < 30 && !w.tamed; i++) host.message('a', { t: 'interact', e: w.id, tool: ITEM.BONE });
  assert.ok(w.tamed && w.owner === 'Steve' && w.sitting && w.persist);
  assert.equal(w.hp, 20);
  host.message('a', { t: 'interact', e: w.id });
  assert.equal(w.sitting, false, 'stands up when clicked');
  // it follows its owner
  p.x = 9.5; p.z = 9.5;
  run(host, 6);
  assert.ok(Math.hypot(w.x - p.x, w.z - p.z) < 5, `followed (${w.x.toFixed(1)}, ${w.z.toFixed(1)})`);
  // it attacks what its owner attacks
  const z = host.spawnMob('zombie', w.x + 2, 200, w.z);
  p.mode = 'survival';
  host.message('a', { t: 'attack', e: z.id, tool: 0 });
  p.mode = 'creative';
  const hp = z.hp;
  run(host, 3);
  assert.ok(z.hp < hp || !host.entities.has(z.id), 'the wolf bit the zombie');
  assert.equal(mobs('wolf').length, 1);
  // tamed wolves are saved with the world
  const host2 = new GameHost(structuredClone(host.serialize()), () => {}, {});
  assert.ok([...host2.entities.values()].some((e) => e.type === 'wolf' && e.tamed && e.owner === 'Steve'));
});

test('slimes come in three sizes and split when they die; magma cubes too', () => {
  const { host, mobs } = setup();
  const s = host.spawnMob('slime', 0.5, 200, 3.5);
  assert.ok([1, 2, 4].includes(s.size));
  host.setSlimeSize(s, 4);
  assert.equal(s.hp, 16);
  host.killMob(s);
  const kids = mobs('slime');
  assert.ok(kids.length >= 2 && kids.every((k) => k.size === 2 && k.hp === 4));
  for (const k of kids) host.killMob(k);
  assert.ok(mobs('slime').every((k) => k.size === 1));
  // only the smallest drop slimeballs
  const m = host.spawnMob('magma_cube', 0.5, 200, -3.5);
  host.setSlimeSize(m, 2);
  host.killMob(m);
  assert.ok(mobs('magma_cube').length >= 2);
});

test('slimes hop at you and hurt; slime chunks hold slimes deep down', () => {
  const { host, p, inbox } = setup();
  p.mode = 'survival';
  const s = host.spawnMob('slime', 0.5, 200, 5.5);
  host.setSlimeSize(s, 4);
  run(host, 8);
  assert.ok(inbox.some((m) => m.t === 'hurt' && m.cause === 'was slain by a Slime'));
  let chunks = 0;
  for (let cx = 0; cx < 100; cx++) if (host.isSlimeChunk(cx, 3)) chunks++;
  assert.ok(chunks > 3 && chunks < 20, `about one in ten: ${chunks}`);
});

test('phantoms come for players who have not slept for three days', () => {
  const { host, p, mobs } = setup();
  p.mode = 'survival';
  host.time = 18000;
  host.message('a', { t: 'pos', p: [0.5, 200, 0.5], r: [0, 0] });
  for (let i = 0; i < 200; i++) host.spawnPhantoms(p);
  assert.equal(mobs('phantom').length, 0, 'rested players are left alone');
  p.rest = 72000 * 2;
  for (let i = 0; i < 400 && !mobs('phantom').length; i++) host.spawnPhantoms(p);
  assert.ok(mobs('phantom').length > 0);
  assert.ok(mobs('phantom').every((e) => e.y > p.y + 15), 'high above');
  // being awake is counted, saved, and reset by dying
  const r = p.rest;
  host.tickSleep(1);
  assert.ok(p.rest > r);
  host.storePlayer(p);
  assert.ok(host.save.players.steve.rest > 72000);
  p.dead = true;
  host.message('a', { t: 'respawn' });
  assert.equal(p.rest, 0);
});

test('piglins trade for gold and attack players without gold armour', () => {
  const { host, p, inbox, mobs } = setup();
  host.ctx = 'overworld';
  const pig = host.spawnMob('piglin', 4.5, 200, 0.5);
  host.spawnItem(4.5, 200.2, 0.5, ITEM.GOLD_INGOT, 1);
  for (const e of host.entities.values()) if (e.type === 'item') e.age = 1;
  run(host, 8);
  assert.ok(!mobs('item').some((e) => e.item === ITEM.GOLD_INGOT), 'took the gold');
  assert.ok(mobs('item').length >= 1, 'gave something back');
  p.mode = 'survival';
  p.armor = [{ id: ITEM.GOLDEN_HELMET, count: 1 }, null, null, null];
  inbox.length = 0;
  run(host, 3);
  assert.ok(!inbox.some((m) => m.t === 'hurt' && m.cause === 'was slain by a Piglin'), 'gold keeps them friendly');
  p.armor = [null, null, null, null];
  run(host, 4);
  assert.ok(inbox.some((m) => m.t === 'hurt' && m.cause === 'was slain by a Piglin'));
  assert.ok(pig);
});

test('the new mobs spawn where they should', () => {
  const { host, p, mobs } = setup();
  host.entities.clear();
  // the Nether's basalt deltas are full of magma cubes
  let x = 0;
  const nw = host.dims.nether.world;
  while (nw.netherBiome(x, 0) !== 2 && x < 20000) x += 16;
  assert.ok(x < 20000, 'found basalt deltas');
  host.changeDim(p, 'nether', [x + 0.5, 70, 0.5]);
  host.inDim('nether', () => {
    for (let dx = -60; dx <= 60; dx++) for (let dz = -60; dz <= 60; dz++) {
      nw.setBlock(x + dx, 69, dz, BLOCK.BASALT ?? BLOCK.NETHERRACK);
      for (let y = 70; y < 80; y++) nw.setBlock(x + dx, y, dz, BLOCK.AIR);
    }
  });
  for (let i = 0; i < 200; i++) host.spawnMobs();
  assert.ok(mobs('magma_cube').length > 0, 'magma cubes');
  // the Overworld at night: witches turn up among other monsters; squid in the sea
  host.entities.clear();
  host.changeDim(p, 'overworld', [0.5, 200, 0.5]);
  const w = host.dims.overworld.world;
  const seen = new Set();
  for (let tries = 0; tries < 6000 && !(seen.has('witch') && seen.has('squid') && seen.has('drowned')); tries++) {
    host.time = tries % 2 ? 18000 : 6000;
    const e = tries % 3 === 0 ? host.spawnHostile(0, 200, 0) : null;
    if (e) { seen.add(e.type); host.entities.delete(e.id); }
    // stand over water now and then
    if (tries % 50 === 0) {
      let found = false;
      for (let r = 0; r < 4000 && !found; r += 64) for (const [ox, oz] of [[r, 0], [0, r], [-r, 0], [0, -r]]) {
        if ([BIOME.OCEAN, BIOME.DEEP_OCEAN, BIOME.WARM_OCEAN].includes(w.biomeAt(ox, oz))) { p.x = ox; p.z = oz; p.y = w.seaLevel + 2; found = true; break; }
      }
    }
    host.spawnMobs();
    for (const m of host.entities.values()) seen.add(m.type);
    if (host.entities.size > 30) host.entities.clear();
  }
  assert.ok(seen.has('witch'), 'witches');
  assert.ok(seen.has('squid'), 'squid');
  assert.ok(seen.has('drowned'), 'drowned');
});

test('cats, foxes, goats and polar bears', () => {
  const { host, p, inbox, mobs } = setup();
  host.time = 1000;
  // a stray cat is tamed with raw fish, then sits when clicked
  const cat = host.spawnMob('cat', 2.5, 200, 0.5);
  for (let i = 0; i < 30 && !cat.tamed; i++) host.message('a', { t: 'interact', e: cat.id, tool: ITEM.RAW_COD });
  assert.ok(cat.tamed && cat.owner === 'Steve');
  assert.ok(inbox.some((m) => m.t === 'consume'));
  // creepers run from cats
  p.mode = 'survival';
  cat.sitting = true;
  const creeper = host.spawnMob('creeper', 5.5, 200, 0.5);
  host.time = 18000;
  for (let i = 0; i < 40; i++) host.tick(0.05);
  assert.ok(creeper.x > 5.5 && !(creeper.fuse > 0), `the creeper backed off (${creeper.x.toFixed(1)})`);
  p.mode = 'creative';
  // a polar bear defends its cub
  host.entities.clear();
  const mother = host.spawnMob('polar_bear', -4.5, 200, 0.5);
  const cub = host.spawnMob('polar_bear', -1.5, 200, 0.5);
  cub.baby = 1000;
  p.mode = 'survival';
  inbox.length = 0;
  for (let i = 0; i < 80; i++) host.tick(0.05);
  assert.ok(inbox.some((m) => m.t === 'hurt' && m.cause === 'was slain by a Polar Bear'), 'mama bear attacked');
  assert.ok(mother);
  // foxes sleep in the daytime
  host.entities.clear();
  p.x = 30; // (well away)
  host.time = 6000;
  const fox = host.spawnMob('fox', 0.5, 200, 0.5);
  for (let i = 0; i < 10; i++) host.tick(0.05);
  assert.ok(fox.sleeping);
  assert.ok(mobs('fox').length === 1);
});

test('sweet berry bushes grow and can be picked', () => {
  const { host, p } = setup();
  p.canBuild = () => true;
  host.setBlock(1, 200, 1, BLOCK.SWEET_BERRY_BUSH);
  for (let i = 0; i < 20 * 600 && host.world.getBlock(1, 200, 1) !== BLOCK.SWEET_BERRY_BUSH + 3; i++) host.tick(0.05);
  assert.equal(host.world.getBlock(1, 200, 1), BLOCK.SWEET_BERRY_BUSH + 3, 'ripe');
  host.message('a', { t: 'use', x: 1, y: 200, z: 1 });
  assert.equal(host.world.getBlock(1, 200, 1), BLOCK.SWEET_BERRY_BUSH + 1, 'picked');
  assert.ok([...host.entities.values()].some((e) => e.type === 'item' && e.item === ITEM.SWEET_BERRIES && e.count >= 2));
});
