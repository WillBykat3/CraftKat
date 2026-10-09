import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameHost, newWorldSave } from '../public/js/host.js';
import { BLOCK } from '../public/js/blocks.js';
import { mulberry32 } from '../public/js/noise.js';
import { BIOME } from '../public/js/biomes.js';

function setup() {
  const inbox = [];
  const host = new GameHost(newWorldSave({ name: 'W', seed: 2024 }), (peer, msg) => inbox.push(structuredClone(msg)), { random: mulberry32(3) });
  host.message('a', { t: 'hello', name: 'Steve', isHost: true });
  const p = host.players.get('a');
  // a stone floor in the sky over a biome where it rains
  let ox = 0;
  while ([BIOME.DESERT, BIOME.SAVANNA].includes(host.world.biomeAt(ox, 0)) || host.world.biomeAt(ox, 0) === undefined) ox += 64;
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) {
    host.setBlock(ox + x, 199, z, BLOCK.STONE);
    for (let y = 200; y < 256; y++) host.setBlock(ox + x, y, z, BLOCK.AIR);
  }
  Object.assign(p, { x: ox + 0.5, y: 200, z: 0.5 });
  return { host, p, inbox, ox };
}

test('the weather changes, is saved, and can be set with /weather', () => {
  const { host, inbox } = setup();
  assert.ok(['clear', 'rain', 'thunder'].includes(host.weather.kind));
  host.weather.time = 0.01;
  const before = host.weather.kind;
  host.tick(0.05);
  if (before === 'clear') assert.notEqual(host.weather.kind, 'clear'); else assert.equal(host.weather.kind, 'clear');
  assert.ok(inbox.some((m) => m.t === 'weather'));
  host.message('a', { t: 'chat', msg: '/weather thunder' });
  assert.equal(host.weather.kind, 'thunder');
  const host2 = new GameHost(structuredClone(host.serialize()), () => {}, {});
  assert.equal(host2.weather.kind, 'thunder');
  const sent = [];
  const host3 = new GameHost(structuredClone(host.serialize()), (peer, m) => sent.push(m), {});
  host3.message('b', { t: 'hello', name: 'Alex' });
  assert.equal(sent.find((m) => m.t === 'welcome').weather, 'thunder');
});

test('rain puts out fires and burning mobs, and keeps zombies from burning', () => {
  const { host, p, ox } = setup();
  host.time = 6000;
  host.setWeather('rain');
  host.setBlock(ox + 2, 200, 2, BLOCK.FIRE);
  for (let i = 0; i < 200 && host.world.getBlock(ox + 2, 200, 2) === BLOCK.FIRE; i++) host.tick(0.1);
  assert.equal(host.world.getBlock(ox + 2, 200, 2), BLOCK.AIR, 'the fire went out');
  p.mode = 'creative';
  const z = host.spawnMob('zombie', ox + 3.5, 200, 3.5);
  for (let i = 0; i < 40; i++) host.tick(0.05);
  assert.ok(!(z.fireTime > 0), "zombies don't burn in the rain");
  host.setWeather('clear');
  for (let i = 0; i < 40; i++) host.tick(0.05);
  assert.ok(z.fireTime > 0 || !host.entities.has(z.id), 'but do in the sun');
});

test('lightning sets fires, hurts players, charges creepers and turns pigs and villagers', () => {
  const { host, p, inbox, ox } = setup();
  const creeper = host.spawnMob('creeper', ox + 3.5, 200, -3.5);
  const pig = host.spawnMob('pig', ox + 3.5, 200, -2.5);
  p.x = ox + 4; p.z = -3;
  host.lightning(ox + 3, -4);
  assert.ok(creeper.charged, 'a charged creeper');
  assert.ok(!host.entities.has(pig.id), 'the pig is gone');
  assert.ok([...host.entities.values()].some((e) => e.type === 'zombified_piglin'));
  assert.equal(host.world.getBlock(ox + 3, 200, -4), BLOCK.FIRE);
  assert.ok(inbox.some((m) => m.t === 'hurt' && m.cause === 'was struck by lightning' && m.fire > 0));
  assert.ok(inbox.some((m) => m.t === 'lightning'));
});

test('you can sleep in a thunderstorm, and sleeping clears the weather', () => {
  const { host, p, ox } = setup();
  host.time = 6000;
  host.setWeather('thunder');
  host.setBlock(ox + 1, 200, 1, BLOCK.BED);
  host.message('a', { t: 'sleep', x: ox + 1, y: 200, z: 1 });
  assert.ok(p.sleeping, 'asleep during the day because of the storm');
  for (let i = 0; i < 60; i++) host.tick(0.05);
  assert.equal(host.weather.kind, 'clear');
});
