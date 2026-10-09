import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameHost, newWorldSave } from '../public/js/host.js';
import { BLOCK, ITEM } from '../public/js/blocks.js';
import { mulberry32 } from '../public/js/noise.js';
import { stepVehicle } from '../public/js/riding.js';
import { World } from '../public/js/world.js';

function setup() {
  const inbox = [];
  const host = new GameHost(newWorldSave({ name: 'R', seed: 5 }), (peer, msg) => inbox.push(structuredClone(msg)), { random: mulberry32(8) });
  host.message('a', { t: 'hello', name: 'Steve' });
  const p = host.players.get('a');
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) { host.setBlock(x, 199, z, BLOCK.STONE); for (let y = 200; y < 204; y++) host.setBlock(x, y, z, BLOCK.AIR); }
  Object.assign(p, { x: 0.5, y: 200, z: 0.5 });
  const last = (t) => [...inbox].reverse().find((m) => m.t === t);
  return { host, p, inbox, last };
}

test('boats: put one down, get in, steer it (the host follows), get out, break it', () => {
  const { host, p, last } = setup();
  host.message('a', { t: 'place_vehicle', kind: 'boat', x: 2.5, y: 200, z: 0.5, yaw: 0 });
  const boat = [...host.entities.values()].find((e) => e.type === 'boat');
  assert.ok(boat && boat.persist);
  host.message('a', { t: 'mount', e: boat.id });
  assert.equal(boat.rider, p.id);
  assert.equal(last('mounted').kind, 'boat');
  host.message('a', { t: 'pos', p: [3.5, 200.15, 0.5], r: [0, 0], v: [3.5, 200, 0.5, 1] });
  assert.deepEqual([boat.x, boat.z, boat.yaw], [3.5, 0.5, 1]);
  host.message('a', { t: 'pos', p: [3.5, 200.15, 0.5], r: [0, 0], v: [60, 200, 0.5, 1] }); // too far from the rider: ignored
  assert.equal(boat.x, 3.5);
  // someone else can't get in
  host.message('b', { t: 'hello', name: 'Alex' });
  Object.assign(host.players.get('b'), { x: 3, y: 200, z: 1 });
  host.message('b', { t: 'mount', e: boat.id });
  assert.equal(boat.rider, p.id);
  host.message('a', { t: 'dismount' });
  assert.equal(boat.rider, null);
  assert.equal(p.riding, null);
  // a boat comes back from a save without its rider
  host.message('a', { t: 'mount', e: boat.id });
  const host2 = new GameHost(structuredClone(host.serialize()), () => {}, {});
  assert.ok([...host2.entities.values()].some((e) => e.type === 'boat' && !e.rider));
  // breaking it gives the boat back (and no experience)
  host.message('a', { t: 'dismount' });
  host.killMob(boat);
  const drops = [...host.entities.values()];
  assert.ok(drops.some((e) => e.type === 'item' && e.item === ITEM.BOAT));
  assert.ok(!drops.some((e) => e.type === 'xp'));
});

test('horses buck off riders until tamed; tame ones take a saddle', () => {
  const { host, p, last } = setup();
  const horse = host.spawnMob('horse', 2.5, 200, 0.5);
  assert.ok(horse.speed >= 4.7 && horse.speed <= 14.3 && horse.jump >= 0.4 && horse.jump <= 1 && horse.hp >= 15 && horse.hp <= 30);
  host.message('a', { t: 'interact', e: horse.id, tool: ITEM.SADDLE });
  assert.ok(!horse.saddled, "a wild horse won't take a saddle");
  let tries = 0;
  while (!horse.tamed && tries < 40) {
    tries++;
    host.message('a', { t: 'mount', e: horse.id });
    horse.buckAt = 0;
    host.tick(0.05);
    if (!horse.tamed) assert.equal(p.riding, null, 'thrown off');
  }
  assert.ok(horse.tamed && horse.owner === 'Steve', `tamed after ${tries} tries`);
  assert.ok(tries > 1 || horse.temper > 0);
  assert.ok(last('dismounted')?.thrown || tries === 1);
  host.message('a', { t: 'dismount' });
  host.message('a', { t: 'interact', e: horse.id, tool: ITEM.SADDLE });
  assert.ok(horse.saddled);
  // feeding a wild horse makes it trust you more
  const wild = host.spawnMob('horse', -2.5, 200, 0.5);
  wild.hp = 1;
  host.message('a', { t: 'interact', e: wild.id, tool: ITEM.GOLDEN_CARROT });
  assert.equal(wild.temper, 5);
});

test('pigs need a saddle to ride', () => {
  const { host, p } = setup();
  const pig = host.spawnMob('pig', 2.5, 200, 0.5);
  host.message('a', { t: 'mount', e: pig.id });
  assert.ok(!p.riding, 'no saddle, no ride');
  assert.ok(!pig.rider);
  host.message('a', { t: 'interact', e: pig.id, tool: ITEM.SADDLE });
  host.message('a', { t: 'mount', e: pig.id });
  assert.equal(pig.rider, p.id);
  // leaving the game gets you off
  host.disconnect('a');
  assert.ok(!pig.rider);
});

test('boats paddle along water and are slow on land; horses jump', () => {
  const world = new World(1, 3);
  for (let x = -20; x <= 20; x++) for (let z = -3; z <= 3; z++) { world.setBlock(x, 199, z, BLOCK.STONE); world.setBlock(x, 200, z, x < 0 ? BLOCK.WATER : BLOCK.AIR); for (let y = 201; y < 206; y++) world.setBlock(x, y, z, BLOCK.AIR); }
  const boat = { kind: 'boat', x: -15.5, y: 200.7, z: 0.5, yaw: -Math.PI / 2, vx: 0, vy: 0, vz: 0, halfW: 0.65, height: 0.56 };
  for (let i = 0; i < 40; i++) stepVehicle(world, boat, { forward: 1, strafe: 0, jump: false, lookYaw: 0 }, 0.05);
  assert.ok(boat.x > -9, `paddled east on water (${boat.x.toFixed(1)})`);
  assert.ok(Math.abs(boat.y - 200.75) < 0.3, `floating (${boat.y.toFixed(2)})`);
  const land = { ...boat, x: 5.5, y: 200, vx: 0, vy: 0, vz: 0 };
  for (let i = 0; i < 40; i++) stepVehicle(world, land, { forward: 1, strafe: 0, jump: false, lookYaw: 0 }, 0.05);
  assert.ok(land.x - 5.5 < 2.5, `slow on land (${(land.x - 5.5).toFixed(1)})`);
  const horse = { kind: 'horse', x: 10.5, y: 200, z: 0.5, yaw: 0, vx: 0, vy: 0, vz: 0, halfW: 0.7, height: 1.6, speed: 9, jump: 1, onGround: false };
  for (let i = 0; i < 5; i++) stepVehicle(world, horse, { forward: 0, strafe: 0, jump: false, lookYaw: 0 }, 0.05);
  let top = 0;
  for (let i = 0; i < 40; i++) { stepVehicle(world, horse, { forward: 0, strafe: 0, jump: i === 0, lookYaw: 0 }, 0.05); top = Math.max(top, horse.y - 200); }
  assert.ok(top > 4, `a strong horse jumps about 5 blocks (${top.toFixed(1)})`);
});

test('rails join up into straights, curves and slopes; minecarts follow them', async () => {
  const { computeShape, railInfo, RAIL, POWERED_RAIL } = await import('../public/js/rails.js');
  const { host, p } = setup();
  const lay = (x, y, z, id = RAIL) => host.message('a', { t: 'set', x, y, z, id });
  Object.assign(p, { x: 0.5, y: 200, z: 4.5, mode: 'creative' });
  p.canBuild = () => true;
  // a line north-south, then a turn to the east at the north end
  lay(0, 200, 3); lay(0, 200, 2); lay(0, 200, 1);
  assert.equal(railInfo(host.world.getBlock(0, 200, 2)).shape, 0, 'north-south');
  lay(1, 200, 1);
  assert.equal(railInfo(host.world.getBlock(0, 200, 1)).shape, 6, 'the end turned into a curve joining south and east');
  assert.equal(railInfo(host.world.getBlock(1, 200, 1)).shape, 1, 'east-west');
  // a slope up onto a block
  host.setBlock(3, 200, 1, BLOCK.STONE);
  lay(3, 201, 1); lay(2, 200, 1);
  assert.equal(railInfo(host.world.getBlock(2, 200, 1)).shape, 2, 'sloping up to the east');
  const get = (x, y, z) => host.world.getBlock(x, y, z);
  assert.equal(computeShape(get, 5, 200, 5, false, 0), 0, 'alone: along the way you face');
  // a minecart rides the track round the curve and up the slope
  const world = host.dims.overworld.world;
  const cart = { kind: 'minecart', x: 0.5, y: 200.0625, z: 3.5, yaw: 0, vx: 0, vy: 0, vz: -6, halfW: 0.49, height: 0.7 };
  let maxY = 0, maxX = 0;
  for (let i = 0; i < 60; i++) { stepVehicle(world, cart, { forward: 0, strafe: 0, jump: false, lookYaw: 0 }, 0.02); maxY = Math.max(maxY, cart.y); maxX = Math.max(maxX, cart.x); }
  assert.ok(maxX > 2, `went round the corner to the east (${maxX.toFixed(2)})`);
  assert.ok(maxY > 200.5, `climbed the slope (${maxY.toFixed(2)})`);
  // powered rails switch with redstone
  lay(0, 200, 6, POWERED_RAIL);
  assert.equal(railInfo(host.world.getBlock(0, 200, 6)).on, false);
  host.setBlock(-1, 200, 6, BLOCK.REDSTONE_BLOCK);
  for (let i = 0; i < 10; i++) host.tick(0.05);
  assert.equal(railInfo(host.world.getBlock(0, 200, 6)).on, true, 'powered');
  // minecarts go on rails only, and drop themselves when broken
  host.message('a', { t: 'place_vehicle', kind: 'minecart', x: 5.5, y: 200, z: 5.5 });
  assert.ok(![...host.entities.values()].some((e) => e.type === 'minecart'), 'not off the rails');
  host.message('a', { t: 'place_vehicle', kind: 'minecart', x: 0.5, y: 200.06, z: 2.5 });
  const m = [...host.entities.values()].find((e) => e.type === 'minecart');
  assert.ok(m);
  host.message('a', { t: 'mount', e: m.id });
  assert.equal(m.rider, p.id);
});
