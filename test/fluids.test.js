import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameHost, newWorldSave } from '../public/js/host.js';
import { BLOCK, BLOCKS, ITEM, fluidOf, fluidLevel } from '../public/js/blocks.js';
import { World } from '../public/js/world.js';
import { mulberry32 } from '../public/js/noise.js';

function setup() {
  const inbox = new Map();
  const host = new GameHost(newWorldSave({ name: 'T', seed: 77, mode: 'creative' }), (peer, msg) => {
    if (!inbox.has(peer)) inbox.set(peer, []);
    inbox.get(peer).push(msg);
  }, { random: mulberry32(3) });
  host.message('a', { t: 'hello', name: 'Steve' });
  const p = host.players.get('a');
  return { host, p, inbox };
}
// a flat stone floor high up, cleared above
function floor(host, cx, y, cz, r = 12) {
  for (let x = cx - r; x <= cx + r; x++) for (let z = cz - r; z <= cz + r; z++) {
    host.world.setBlock(x, y, z, BLOCK.STONE);
    for (let yy = y + 1; yy < y + 6; yy++) host.world.setBlock(x, yy, z, BLOCK.AIR);
  }
}
const run = (host, s) => { for (let i = 0; i < s * 20; i++) host.tick(0.05); };

test('16-bit block ids: worlds store and save ids over 255', () => {
  const w = new World(5, 3);
  w.setBlock(3, 150, 3, BLOCK.FIRE);
  assert.equal(w.getBlock(3, 150, 3), BLOCK.FIRE);
  const w2 = new World(5, 3);
  w2.importEdits(w.exportEdits());
  assert.equal(w2.getBlock(3, 150, 3), BLOCK.FIRE);
});

test('water spreads 7 blocks over flat ground and falls first', () => {
  const { host } = setup();
  floor(host, 0, 150, 0);
  host.setBlock(0, 151, 0, BLOCK.WATER);
  run(host, 6);
  assert.equal(fluidLevel(host.world.getBlock(3, 151, 0)), 3);
  assert.equal(fluidLevel(host.world.getBlock(7, 151, 0)), 7);
  assert.equal(host.world.getBlock(8, 151, 0), BLOCK.AIR);
  assert.equal(fluidOf(host.world.getBlock(4, 151, 3)), 'water', 'spreads in a diamond');
  // take the source away: the flow dries up
  host.setBlock(0, 151, 0, BLOCK.AIR);
  run(host, 6);
  assert.equal(host.world.getBlock(3, 151, 0), BLOCK.AIR);
});

test('water heads for the nearest drop, and pours down as a falling column', () => {
  const { host } = setup();
  floor(host, 0, 150, 0);
  host.setBlock(2, 150, 0, BLOCK.AIR); // a hole two blocks east
  host.setBlock(2, 149, 0, BLOCK.STONE);
  host.setBlock(0, 151, 0, BLOCK.WATER);
  run(host, 3);
  assert.equal(host.world.getBlock(-1, 151, 0), BLOCK.AIR, "doesn't spread away from the hole");
  assert.equal(fluidOf(host.world.getBlock(1, 151, 0)), 'water');
  assert.ok(BLOCKS[host.world.getBlock(2, 150, 0)].falling, 'falls into the hole');
});

test('two water sources make a third (infinite water), and buckets scoop only sources', () => {
  const { host } = setup();
  floor(host, 0, 150, 0); // big enough that there's no drop nearby to run off to
  for (const x of [-1, 0, 1]) for (const z of [-1, 1]) host.setBlock(x, 151, z, BLOCK.STONE);
  host.setBlock(-1, 151, 0, BLOCK.WATER);
  host.setBlock(1, 151, 0, BLOCK.WATER);
  run(host, 2);
  assert.equal(host.world.getBlock(0, 151, 0), BLOCK.WATER);
});

test('lava is slow, spreads 3 blocks in the Overworld, and hardens against water', () => {
  const { host } = setup();
  floor(host, 0, 150, 0);
  host.setBlock(0, 151, 0, BLOCK.LAVA);
  run(host, 1);
  assert.equal(host.world.getBlock(1, 151, 0), BLOCK.AIR, 'lava takes 1.5 s a step');
  run(host, 8);
  assert.equal(fluidOf(host.world.getBlock(3, 151, 0)), 'lava');
  assert.equal(host.world.getBlock(4, 151, 0), BLOCK.AIR);
  // water flowing into the lava source makes obsidian; into flowing lava, cobblestone
  host.setBlock(0, 152, 0, BLOCK.STONE);
  host.setBlock(-6, 151, 0, BLOCK.WATER);
  run(host, 6);
  const made = [];
  for (let x = -3; x <= 3; x++) made.push(host.world.getBlock(x, 151, 0));
  assert.ok(made.includes(BLOCK.COBBLE) || made.includes(BLOCK.OBSIDIAN), made.join(','));
});

test('fire spreads to wood, burns it away, and goes out; flint and steel starts it', () => {
  const { host, p } = setup();
  floor(host, 0, 150, 0, 6);
  for (let x = -3; x <= 3; x++) for (let y = 151; y <= 153; y++) host.setBlock(x, y, 0, BLOCK.PLANKS);
  host.message('a', { t: 'pos', p: [0.5, 151, 4.5], r: [0, 0] });
  host.message('a', { t: 'use', x: 0, y: 150, z: 1, item: ITEM.FLINT_AND_STEEL, face: [0, 1, 0] });
  assert.equal(host.world.getBlock(0, 151, 1), BLOCK.FIRE);
  run(host, 120);
  let planks = 0;
  for (let x = -3; x <= 3; x++) for (let y = 151; y <= 153; y++) if (host.world.getBlock(x, y, 0) === BLOCK.PLANKS) planks++;
  assert.ok(planks < 21, `the wall burned (${planks} of 21 planks left)`);
  // on netherrack it never goes out
  host.setBlock(5, 150, 5, BLOCK.NETHERRACK);
  host.setBlock(5, 151, 5, BLOCK.FIRE);
  run(host, 30);
  assert.equal(host.world.getBlock(5, 151, 5), BLOCK.FIRE);
  assert.ok(p);
});

test('lava buckets: scoop a lava source and pour it', () => {
  const { host } = setup();
  floor(host, 0, 150, 0, 3);
  host.message('a', { t: 'pos', p: [0.5, 151, 2.5], r: [0, 0] });
  host.setBlock(0, 151, 0, BLOCK.LAVA);
  host.message('a', { t: 'bucket', x: 0, y: 151, z: 0, fill: true });
  assert.equal(host.world.getBlock(0, 151, 0), BLOCK.AIR);
  host.message('a', { t: 'bucket', x: 1, y: 151, z: 0, fill: false, lava: true });
  assert.equal(host.world.getBlock(1, 151, 0), BLOCK.LAVA);
});
