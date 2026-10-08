import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameHost, newWorldSave } from '../public/js/host.js';
import { BLOCK, BLOCKS, ITEM } from '../public/js/blocks.js';

// A host with a stone floor high in the sky to build circuits on.
const Y = 200;
function bench() {
  const host = new GameHost(newWorldSave({ name: 'R', seed: 5 }), () => {}, { random: () => 0.5 });
  for (let x = -12; x <= 20; x++) for (let z = -6; z <= 6; z++) host.world.setBlock(x, Y, z, BLOCK.STONE);
  const set = (x, y, z, id) => host.setBlock(x, y, z, id);
  const get = (x, y, z) => host.world.getBlock(x, y, z);
  const run = (seconds) => { for (let t = 0; t < seconds - 1e-9; t += 0.05) host.tick(0.05); };
  return { host, set, get, run };
}
const R = BLOCK.REDSTONE_WIRE, LAMP = BLOCK.REDSTONE_LAMP;
const LEVER = (attach = 0, on = false) => BLOCK.LEVER + (on ? 5 : 0) + attach;
const TORCH = (attach = 0, lit = true) => BLOCK.REDSTONE_TORCH + (lit ? 5 : 0) + attach;
const REP = (facing, delay = 1, on = false) => BLOCK.REPEATER + (on ? 16 : 0) + (delay - 1) * 4 + facing;
const power = (host, x, y, z) => host.redstone.power.get(`${x},${y},${z}`) || 0;

test('a lever lights a lamp through dust, and power fades 1 per block', () => {
  const { host, set, get, run } = bench();
  set(0, Y + 1, 0, LEVER());
  for (let x = 1; x <= 15; x++) set(x, Y + 1, 0, R);
  set(16, Y + 1, 0, LAMP);
  run(0.3);
  assert.equal(get(16, Y + 1, 0), LAMP, 'off while the lever is off');
  host.redstone.use(0, Y + 1, 0);
  run(0.3);
  assert.equal(power(host, 1, Y + 1, 0), 15);
  assert.equal(power(host, 15, Y + 1, 0), 1);
  assert.equal(get(16, Y + 1, 0), LAMP + 1, 'lamp on at the end of 15 dust');
  assert.equal(get(8, Y + 1, 0), R + 2, 'dust looks medium bright in the middle');
  host.redstone.use(0, Y + 1, 0);
  run(0.5);
  assert.equal(get(16, Y + 1, 0), LAMP, 'lamp off again');
  // 16 dust is too far
  set(16, Y + 1, 0, R);
  set(17, Y + 1, 0, LAMP);
  host.redstone.use(0, Y + 1, 0);
  run(0.5);
  assert.equal(get(17, Y + 1, 0), LAMP, 'power runs out after 15 blocks');
});

test('torches invert: power the block a torch hangs on and it turns off', () => {
  const { host, set, get, run } = bench();
  set(0, Y + 1, 0, BLOCK.STONE);
  set(1, Y + 1, 0, TORCH(2)); // on the east side of the stone, facing east
  set(2, Y + 1, 0, LAMP);
  run(0.3);
  assert.equal(get(2, Y + 1, 0), LAMP + 1, 'torch powers the lamp');
  set(-1, Y + 1, 0, LEVER(4)); // lever on the west side of the stone: powers it
  host.redstone.use(-1, Y + 1, 0);
  run(0.5);
  assert.equal(get(1, Y + 1, 0), TORCH(2, false), 'torch went out');
  assert.equal(get(2, Y + 1, 0), LAMP, 'so the lamp is off');
});

test('repeaters delay, carry power on and only work one way', () => {
  const { host, set, get, run } = bench();
  set(0, Y + 1, 0, LEVER());
  set(1, Y + 1, 0, REP(1, 4)); // facing east, 4 ticks
  set(2, Y + 1, 0, LAMP);
  host.redstone.use(0, Y + 1, 0);
  run(0.25);
  assert.equal(get(2, Y + 1, 0), LAMP, 'not yet after 2 ticks');
  run(0.4);
  assert.equal(get(2, Y + 1, 0), LAMP + 1, 'on after the delay');
  // backwards: a lever in front of a repeater doesn't power what's behind it
  set(5, Y + 1, 0, LAMP);
  set(6, Y + 1, 0, REP(1));
  set(7, Y + 1, 0, LEVER(0, true));
  run(0.5);
  assert.equal(get(5, Y + 1, 0), LAMP, 'repeaters are one-way');
});

test('buttons give a short pulse; pressure plates react to players', () => {
  const { host, set, get, run } = bench();
  set(0, Y + 1, 0, BLOCK.STONE);
  set(1, Y + 1, 0, BLOCK.STONE_BUTTON + 2); // on the east face
  set(0, Y + 2, 0, LAMP);
  host.redstone.use(1, Y + 1, 0);
  run(0.3);
  assert.equal(get(0, Y + 2, 0), LAMP + 1, 'button powers the block it is on, which lights the lamp above');
  run(1.5);
  assert.equal(get(0, Y + 2, 0), LAMP, 'and lets go after a second');

  set(5, Y + 1, 0, BLOCK.STONE_PRESSURE_PLATE);
  set(6, Y + 1, 0, LAMP);
  host.connect('p');
  host.message('p', { t: 'hello', name: 'P' });
  const p = [...host.players.values()][0];
  p.x = 5.5; p.y = Y + 1; p.z = 0.5;
  run(0.3);
  assert.equal(get(5, Y + 1, 0), BLOCK.STONE_PRESSURE_PLATE + 1);
  assert.equal(get(6, Y + 1, 0), LAMP + 1, 'stepping on the plate lights the lamp');
  p.x = 10.5;
  run(1.6);
  assert.equal(get(6, Y + 1, 0), LAMP, 'stepping off turns it off');
});

test('pistons push lines of blocks, sticky pistons pull them back, doors open with power', () => {
  const { host, set, get, run } = bench();
  set(0, Y + 1, 0, BLOCK.PISTON + 1); // facing east
  set(1, Y + 1, 0, BLOCK.PLANKS);
  set(2, Y + 1, 0, BLOCK.COBBLE);
  set(-1, Y + 1, 0, LEVER());
  host.redstone.use(-1, Y + 1, 0);
  run(0.3);
  assert.equal(get(0, Y + 1, 0), BLOCK.PISTON + 6 + 1, 'extended');
  assert.equal(get(1, Y + 1, 0), BLOCK.PISTON_HEAD + 1);
  assert.equal(get(2, Y + 1, 0), BLOCK.PLANKS);
  assert.equal(get(3, Y + 1, 0), BLOCK.COBBLE);
  host.redstone.use(-1, Y + 1, 0);
  run(0.3);
  assert.equal(get(1, Y + 1, 0), BLOCK.AIR, 'a normal piston leaves the blocks');
  assert.equal(get(2, Y + 1, 0), BLOCK.PLANKS);

  set(0, Y + 1, 3, BLOCK.STICKY_PISTON + 1);
  set(1, Y + 1, 3, BLOCK.PLANKS);
  set(-1, Y + 1, 3, LEVER());
  host.redstone.use(-1, Y + 1, 3);
  run(0.3);
  assert.equal(get(2, Y + 1, 3), BLOCK.PLANKS);
  host.redstone.use(-1, Y + 1, 3);
  run(0.3);
  assert.equal(get(1, Y + 1, 3), BLOCK.PLANKS, 'sticky piston pulled it back');
  assert.equal(get(2, Y + 1, 3), BLOCK.AIR);

  // obsidian can't be pushed
  set(0, Y + 1, -3, BLOCK.PISTON + 1);
  set(1, Y + 1, -3, BLOCK.OBSIDIAN);
  set(-1, Y + 1, -3, LEVER(0, true));
  run(0.3);
  assert.equal(get(0, Y + 1, -3), BLOCK.PISTON + 1, 'stays in');

  // a door next to a lever
  set(10, Y + 1, 0, BLOCK.OAK_DOOR + 1);
  set(10, Y + 2, 0, BLOCK.OAK_DOOR + 9);
  run(0.2);
  set(11, Y + 1, 0, LEVER());
  run(0.2);
  host.redstone.use(11, Y + 1, 0);
  run(0.3);
  assert.equal(get(10, Y + 1, 0), BLOCK.OAK_DOOR + 5, 'door opened');
  assert.equal(get(10, Y + 2, 0), BLOCK.OAK_DOOR + 13);
  host.redstone.use(11, Y + 1, 0);
  run(0.3);
  assert.equal(get(10, Y + 1, 0), BLOCK.OAK_DOOR + 1, 'and closed');
});

test('TNT: lit by power or flint and steel, explodes after 4 seconds, sets off nearby TNT', () => {
  const { host, set, get, run } = bench();
  set(0, Y + 1, 0, BLOCK.TNT);
  set(1, Y + 1, 0, BLOCK.REDSTONE_BLOCK);
  set(0, Y + 1, 3, BLOCK.TNT);
  run(0.3);
  assert.equal(get(0, Y + 1, 0), BLOCK.AIR, 'primed');
  assert.equal([...host.entities.values()].filter((e) => e.type === 'tnt').length, 1);
  run(3);
  assert.equal(get(0, Y + 1, 3), BLOCK.TNT, 'the other TNT is still there');
  run(1.5);
  assert.notEqual(get(0, Y, 0), BLOCK.STONE, 'it blew a hole in the floor');
  assert.ok([...host.entities.values()].some((e) => e.type === 'tnt') || get(0, Y + 1, 3) === BLOCK.AIR, 'and lit the TNT nearby');
  // flint and steel
  set(10, Y + 1, 0, BLOCK.TNT);
  assert.ok(host.redstone.use(10, Y + 1, 0, ITEM.FLINT_AND_STEEL));
  assert.equal(get(10, Y + 1, 0), BLOCK.AIR);
});

test('a torch clock blinks; breaking a block drops the lever on it; dust climbs', () => {
  const { host, set, get, run } = bench();
  // dust up a step: lever, dust, stone with dust on top, lamp next to that dust
  set(0, Y + 1, 0, LEVER(0, true));
  set(1, Y + 1, 0, R);
  set(2, Y + 1, 0, BLOCK.STONE);
  set(2, Y + 2, 0, R);
  set(3, Y + 2, 0, LAMP);
  run(0.3);
  assert.ok(power(host, 2, Y + 2, 0) === 14, 'dust climbed onto the block');
  assert.equal(get(3, Y + 2, 0), LAMP + 1);
  // breaking the stone a lever hangs on drops the lever
  set(6, Y + 1, 0, BLOCK.STONE);
  set(7, Y + 1, 0, LEVER(2));
  host.breakBlock(6, Y + 1, 0, 0);
  assert.equal(get(7, Y + 1, 0), BLOCK.AIR);
  assert.ok([...host.entities.values()].some((e) => e.type === 'item' && e.item === BLOCK.LEVER));
  // clock: torch -> repeater -> block the torch hangs on
  set(10, Y + 1, 0, BLOCK.STONE);
  set(11, Y + 1, 0, TORCH(2)); // on the east side, facing east
  set(11, Y + 1, 1, R);
  set(11, Y + 1, 2, R);
  set(10, Y + 1, 2, R);
  set(10, Y + 1, 1, REP(0, 1)); // facing north, into the stone
  run(0.2);
  const seen = new Set();
  for (let i = 0; i < 30; i++) { run(0.1); seen.add(get(11, Y + 1, 0)); }
  assert.ok(seen.has(TORCH(2, true)) && seen.has(TORCH(2, false)), 'the torch blinks');
  void BLOCKS;
});
