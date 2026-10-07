import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameHost, newWorldSave, daylight } from '../public/js/host.js';
import { World } from '../public/js/world.js';
import { BLOCK, ITEM, HEIGHT, SEA_LEVEL } from '../public/js/blocks.js';
import { mulberry32 } from '../public/js/noise.js';

// A host with a fake network: every message sent to a peer is recorded.
function setup(opts = {}, saveOpts = {}) {
  const inbox = new Map();
  const save = newWorldSave({ name: 'Test', seed: 1234, ...saveOpts });
  const host = new GameHost(save, (peer, msg) => {
    if (!inbox.has(peer)) inbox.set(peer, []);
    inbox.get(peer).push(structuredClone(msg));
  }, { random: mulberry32(7), ...opts });
  const join = (peer, name, extra = {}) => {
    host.connect(peer);
    host.message(peer, { t: 'hello', name, ...extra });
    return inbox.get(peer).find((m) => m.t === 'welcome' || m.t === 'error');
  };
  const last = (peer, t) => [...(inbox.get(peer) || [])].reverse().find((m) => m.t === t);
  const all = (peer, t) => (inbox.get(peer) || []).filter((m) => m.t === t);
  return { host, save, inbox, join, last, all };
}

// Puts a player at the world spawn and returns a nearby ground position.
function standAtSpawn(host, peer) {
  const [x, y, z] = host.save.spawn;
  host.message(peer, { t: 'pos', p: [x, y, z], r: [0, 0] });
  return [Math.floor(x), Math.floor(y), Math.floor(z)];
}

test('new worlds spawn players on dry land', () => {
  const save = newWorldSave({ name: 'W', seed: 99 });
  const w = new World(99);
  const [x, y, z] = save.spawn;
  assert.ok(y > SEA_LEVEL);
  assert.notEqual(w.getBlock(Math.floor(x), y - 1, Math.floor(z)), BLOCK.WATER);
});

test('players join, see each other and get unique names', () => {
  const { join, last } = setup();
  const a = join('a', 'Steve', { isHost: true });
  assert.equal(a.t, 'welcome');
  assert.equal(a.seed, 1234);
  assert.equal(a.players.length, 0);
  const b = join('b', 'steve');
  assert.equal(b.name, 'steve2');
  assert.deepEqual(b.players.map((p) => p.name), ['Steve']);
  assert.equal(last('a', 'join').name, 'steve2');
});

test('a password keeps strangers out', () => {
  const { join } = setup({ password: 'secret' });
  assert.equal(join('x', 'Eve', { password: 'nope' }).t, 'error');
  assert.equal(join('y', 'Friend', { password: 'secret' }).t, 'welcome');
});

test('placing blocks is relayed, validated and corrected', () => {
  const { host, join, last } = setup();
  join('a', 'A'); join('b', 'B');
  const [x, y, z] = standAtSpawn(host, 'a');
  // place a block in the air next to the player
  host.message('a', { t: 'set', x: x + 2, y: y + 1, z, id: BLOCK.PLANKS });
  assert.deepEqual(last('b', 'set'), { t: 'set', x: x + 2, y: y + 1, z, id: BLOCK.PLANKS });
  // far away: refused, and the sender is told the real block
  host.message('a', { t: 'set', x: x + 50, y: 60, z, id: BLOCK.STONE });
  assert.equal(last('a', 'set').x, x + 50);
  assert.equal(last('a', 'set').id, BLOCK.AIR);
  // survival players can't place water
  host.message('a', { t: 'set', x: x + 2, y: y + 2, z, id: BLOCK.WATER });
  assert.equal(host.world.getBlock(x + 2, y + 2, z), BLOCK.AIR);
});

test('mining drops items only with the right tool, and items can be picked up', () => {
  const { host, join, last } = setup();
  join('a', 'A');
  const [x, y, z] = standAtSpawn(host, 'a');
  host.world.setBlock(x + 1, y, z, BLOCK.STONE);
  host.message('a', { t: 'dig', x: x + 1, y, z, tool: 0 });
  assert.equal(host.world.getBlock(x + 1, y, z), BLOCK.AIR);
  assert.equal([...host.entities.values()].length, 0, 'stone by hand drops nothing');

  host.world.setBlock(x + 1, y, z, BLOCK.STONE);
  host.message('a', { t: 'dig', x: x + 1, y, z, tool: ITEM.WOODEN_PICKAXE });
  const drops = [...host.entities.values()];
  assert.equal(drops.length, 1);
  assert.equal(drops[0].item, BLOCK.COBBLE);

  host.message('a', { t: 'pickup', e: drops[0].id });
  assert.equal(last('a', 'give'), undefined, 'cannot pick up instantly');
  for (let i = 0; i < 20; i++) host.tick(0.05);
  host.message('a', { t: 'pickup', e: drops[0].id });
  assert.deepEqual(last('a', 'give'), { t: 'give', id: BLOCK.COBBLE, count: 1 });
  assert.equal(host.entities.size, 0);
});

test('creative players break anything without drops', () => {
  const { host, join } = setup({}, { mode: 'creative' });
  join('a', 'A');
  const [x, y, z] = standAtSpawn(host, 'a');
  host.world.setBlock(x + 1, y, z, BLOCK.DIAMOND_ORE);
  host.message('a', { t: 'dig', x: x + 1, y, z, tool: 0 });
  assert.equal(host.world.getBlock(x + 1, y, z), BLOCK.AIR);
  assert.equal(host.entities.size, 0);
});

test('sand falls and flowers pop off when the ground goes', () => {
  const { host, join } = setup();
  join('a', 'A');
  const [x, y, z] = standAtSpawn(host, 'a');
  // a column: stone, stone, sand, sand on top of air pocket
  host.world.setBlock(x + 2, y, z, BLOCK.STONE);
  host.world.setBlock(x + 2, y + 1, z, BLOCK.SAND);
  host.world.setBlock(x + 2, y + 2, z, BLOCK.SAND);
  host.world.setBlock(x + 2, y - 1, z, BLOCK.STONE);
  host.message('a', { t: 'dig', x: x + 2, y, z, tool: ITEM.WOODEN_PICKAXE });
  assert.equal(host.world.getBlock(x + 2, y, z), BLOCK.SAND);
  assert.equal(host.world.getBlock(x + 2, y + 1, z), BLOCK.SAND);
  assert.equal(host.world.getBlock(x + 2, y + 2, z), BLOCK.AIR);

  host.entities.clear();
  host.world.setBlock(x - 2, y, z, BLOCK.DIRT);
  host.world.setBlock(x - 2, y + 1, z, BLOCK.POPPY);
  host.message('a', { t: 'dig', x: x - 2, y, z, tool: 0 });
  assert.equal(host.world.getBlock(x - 2, y + 1, z), BLOCK.AIR);
  const items = [...host.entities.values()].map((e) => e.item).sort();
  assert.deepEqual(items, [BLOCK.DIRT, BLOCK.POPPY].sort());
});

test('mobs spawn, zombies attack at night, and killing a pig drops pork', () => {
  const { host, join, all } = setup();
  join('a', 'A');
  standAtSpawn(host, 'a');
  host.time = 18000; // midnight
  for (let i = 0; i < 60 * 20; i++) host.tick(0.05);
  const types = [...host.entities.values()].map((e) => e.type);
  assert.ok(types.includes('zombie'), 'zombies spawn at night: ' + types.join());

  // put a zombie right next to the player and let it attack
  const p = host.players.get('a');
  const z = host.spawnMob('zombie', p.x + 1, p.y, p.z);
  for (let i = 0; i < 40; i++) { p.x = z.x + 1; p.y = z.y; p.z = z.z; host.tick(0.05); }
  assert.ok(all('a', 'hurt').length > 0, 'zombie hurts the player');

  const pig = host.spawnMob('pig', p.x + 1, p.y, p.z);
  for (let i = 0; i < 10; i++) host.message('a', { t: 'attack', e: pig.id, tool: ITEM.DIAMOND_SWORD });
  assert.ok(!host.entities.has(pig.id), 'pig died');
  assert.ok([...host.entities.values()].some((e) => e.type === 'item' && e.item === ITEM.RAW_PORKCHOP));
});

test('furnaces smelt over time', () => {
  const { host, join, last } = setup();
  join('a', 'A');
  const [x, y, z] = standAtSpawn(host, 'a');
  host.message('a', { t: 'set', x: x + 1, y: y + 1, z, id: BLOCK.FURNACE });
  const at = { x: x + 1, y: y + 1, z };
  host.message('a', { t: 'furnace_open', ...at });
  host.message('a', { t: 'furnace_click', ...at, slot: 0, button: 0, cursor: { id: ITEM.RAW_IRON, count: 2 } });
  assert.equal(last('a', 'cursor').stack, null);
  host.message('a', { t: 'furnace_click', ...at, slot: 1, button: 0, cursor: { id: ITEM.COAL, count: 1 } });
  for (let i = 0; i < 21 * 20; i++) host.tick(0.05);
  const state = last('a', 'furnace');
  assert.equal(state.slots[2].id, ITEM.IRON_INGOT);
  assert.equal(state.slots[2].count, 2);
  assert.equal(state.slots[0], null);
  host.message('a', { t: 'furnace_click', ...at, slot: 2, button: 0, cursor: null });
  assert.deepEqual(last('a', 'cursor').stack, { id: ITEM.IRON_INGOT, count: 2 });
});

test('the world and player inventories survive saving and loading', () => {
  const { host, join, save } = setup();
  join('a', 'Alex');
  const [x, y, z] = standAtSpawn(host, 'a');
  host.message('a', { t: 'set', x: x + 1, y: y + 1, z, id: BLOCK.BRICK });
  const inv = new Array(36).fill(null);
  inv[0] = { id: ITEM.IRON_PICKAXE, count: 1, dur: 200 };
  inv[5] = { id: BLOCK.DIRT, count: 12 };
  host.message('a', { t: 'save', inv, health: 15, food: 9 });
  host.disconnect('a');
  const json = JSON.parse(JSON.stringify(host.serialize()));

  const inbox = [];
  const host2 = new GameHost(json, (peer, msg) => inbox.push(msg));
  host2.message('b', { t: 'hello', name: 'alex' });
  const w = inbox.find((m) => m.t === 'welcome');
  assert.deepEqual(w.me.inv, inv);
  assert.equal(w.me.health, 15);
  assert.ok(w.edits.some(([ex, ey, ez, id]) => ex === x + 1 && ey === y + 1 && ez === z && id === BLOCK.BRICK));
  assert.equal(host2.world.getBlock(x + 1, y + 1, z), BLOCK.BRICK);
  assert.equal(save.name, 'Test');
});

test('only the host (or everyone, if cheats are on) can use /gamemode', () => {
  const { host, join, last } = setup({}, { cheats: false });
  join('local', 'Host', { isHost: true });
  join('b', 'Guest');
  host.message('b', { t: 'chat', msg: '/gamemode creative' });
  assert.match(last('b', 'sys').msg, /Only the host/);
  host.message('local', { t: 'chat', msg: '/gamemode creative Guest' });
  assert.deepEqual(last('b', 'mode'), { t: 'mode', mode: 'creative' });
});

test('junk messages are ignored', () => {
  const { host, join } = setup();
  join('a', 'A');
  for (const junk of [null, 1, 'x', {}, { t: 5 }, { t: 'set', x: 'a' }, { t: 'dig', x: 1.5, y: 2, z: 3 },
    { t: 'pos', p: [NaN, 0, 0], r: [0, 0] }, { t: 'save', inv: 'lots' }, { t: 'drop', stack: { id: 9999, count: 1 } },
    { t: 'furnace_click', x: 0, y: 0, z: 0, slot: 7 }, { t: 'attack', e: 'x' }, { t: 'chat', msg: {} }]) {
    host.message('a', junk);
  }
  host.tick(0.05);
  assert.equal(host.players.size, 1);
});

test('daylight follows the day cycle', () => {
  assert.equal(daylight(1000), 1);
  assert.equal(daylight(18000), 0);
  assert.ok(daylight(12900) > 0 && daylight(12900) < 1);
  assert.ok(HEIGHT > SEA_LEVEL);
});

test('zombies leave dead players alone until they respawn', () => {
  const { host, join, all } = setup();
  join('a', 'A');
  standAtSpawn(host, 'a');
  const p = host.players.get('a');
  host.message('a', { t: 'died', items: [{ id: BLOCK.DIRT, count: 3 }], cause: 'died' });
  const z = host.spawnMob('zombie', p.x + 1, p.y, p.z);
  host.time = 18000;
  for (let i = 0; i < 40; i++) { z.x = p.x + 1; z.y = p.y; z.z = p.z; host.tick(0.05); }
  assert.equal(all('a', 'hurt').length, 0, 'no attacks while dead');
  assert.ok([...host.entities.values()].some((e) => e.type === 'item' && e.item === BLOCK.DIRT), 'items dropped');
  host.message('a', { t: 'respawn' });
  for (let i = 0; i < 40; i++) { z.x = p.x + 1; z.y = p.y; z.z = p.z; host.tick(0.05); }
  assert.ok(all('a', 'hurt').length > 0, 'attacks again after respawning');
});
