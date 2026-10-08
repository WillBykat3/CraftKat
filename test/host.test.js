import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameHost, newWorldSave, daylight } from '../public/js/host.js';
import { World } from '../public/js/world.js';
import { BLOCK, BLOCKS, ITEM, HEIGHT, SEA_LEVEL } from '../public/js/blocks.js';
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
  for (const seed of [99, 1, 2, 3, 4]) {
    const save = newWorldSave({ name: 'W', seed });
    const w = new World(seed, save.genVersion);
    const [x, y, z] = save.spawn;
    assert.ok(y > w.seaLevel, `seed ${seed}`);
    const ground = w.getBlock(Math.floor(x), y - 1, Math.floor(z));
    assert.ok([BLOCK.GRASS, BLOCK.SAND, BLOCK.SNOWY_GRASS].includes(ground), `seed ${seed}: ground ${ground}`);
    assert.ok(!BLOCKS[w.getBlock(Math.floor(x), y, Math.floor(z))].solid);
  }
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
  host.message('a', { t: 'set', x: x + 50, y: 250, z, id: BLOCK.STONE });
  assert.equal(last('a', 'set').x, x + 50);
  assert.equal(last('a', 'set').id, BLOCK.AIR);
  // survival players can't place water
  host.message('a', { t: 'set', x: x + 2, y: y + 2, z, id: BLOCK.WATER });
  assert.notEqual(host.world.getBlock(x + 2, y + 2, z), BLOCK.WATER);
  host.message('a', { t: 'set', x: x + 2, y: y + 2, z, id: BLOCK.LAVA });
  assert.notEqual(host.world.getBlock(x + 2, y + 2, z), BLOCK.LAVA);
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

test('chests store items, support shift-moves and spill when broken', () => {
  const { host, join, last, all } = setup();
  join('a', 'A');
  const [x, y, z] = standAtSpawn(host, 'a');
  const at = { x: x + 1, y: y + 1, z };
  host.message('a', { t: 'set', ...at, id: BLOCK.CHEST });
  host.message('a', { t: 'chest_open', ...at });
  host.message('a', { t: 'chest_click', ...at, slot: 4, button: 0, cursor: { id: BLOCK.DIRT, count: 10 } });
  assert.equal(last('a', 'cursor').stack, null);
  assert.deepEqual(last('a', 'chest').slots[4], { id: BLOCK.DIRT, count: 10 });
  host.message('a', { t: 'chest_put', ...at, stack: { id: BLOCK.DIRT, count: 60 } });
  const slots = last('a', 'chest').slots;
  assert.equal(slots[4].count, 64);
  assert.equal(slots[0].count, 6);
  host.message('a', { t: 'chest_take', ...at, slot: 0 });
  assert.deepEqual(last('a', 'give'), { t: 'give', id: BLOCK.DIRT, count: 6 });
  // the chest is saved and restored
  const restored = new GameHost(JSON.parse(JSON.stringify(host.serialize())), () => {});
  assert.equal(restored.chests.get(`${at.x},${at.y},${at.z}`).slots[4].count, 64);
  // breaking it drops everything inside, and viewers are told
  host.entities.clear();
  host.message('a', { t: 'dig', ...at, tool: ITEM.WOODEN_AXE });
  const drops = [...host.entities.values()].map((e) => [e.item, e.count]);
  assert.deepEqual(drops.sort(), [[BLOCK.CHEST, 1], [BLOCK.DIRT, 64]].sort());
  assert.equal(all('a', 'chest_gone').length, 1);
});

test('buckets pick up and pour water', () => {
  const { host, join } = setup();
  join('a', 'A');
  const [x, y, z] = standAtSpawn(host, 'a');
  host.world.setBlock(x + 2, y, z, BLOCK.WATER);
  host.message('a', { t: 'bucket', x: x + 2, y, z, fill: true });
  assert.equal(host.world.getBlock(x + 2, y, z), BLOCK.AIR);
  host.message('a', { t: 'bucket', x: x + 2, y: y + 1, z, fill: false });
  assert.equal(host.world.getBlock(x + 2, y + 1, z), BLOCK.WATER);
  // can't "fill" from something that isn't water
  host.world.setBlock(x - 2, y, z, BLOCK.STONE);
  host.message('a', { t: 'bucket', x: x - 2, y, z, fill: true });
  assert.equal(host.world.getBlock(x - 2, y, z), BLOCK.STONE);
});

test('sleeping skips the night once everyone is in bed, and beds become respawn points', () => {
  const { host, join, last } = setup();
  join('a', 'A'); join('b', 'B');
  const [x, y, z] = standAtSpawn(host, 'a');
  standAtSpawn(host, 'b');
  host.world.setBlock(x + 1, y, z, BLOCK.BED);
  host.world.setBlock(x - 1, y, z, BLOCK.BED);
  host.time = 3000; // daytime: only sets the respawn point
  host.message('a', { t: 'sleep', x: x + 1, y, z });
  assert.match(last('a', 'sys').msg, /only sleep at night/);
  host.time = 15000;
  host.message('a', { t: 'sleep', x: x + 1, y, z });
  assert.ok(last('a', 'sleeping'));
  for (let i = 0; i < 80; i++) host.tick(0.05);
  assert.ok(host.time > 15000, 'one sleeper is not enough');
  host.message('b', { t: 'sleep', x: x - 1, y, z });
  for (let i = 0; i < 80; i++) host.tick(0.05);
  assert.ok(host.time < 1000, 'morning: ' + host.time);
  assert.ok(last('a', 'wake'));
  // respawn at the bed; after it's broken, back to world spawn
  host.message('a', { t: 'respawn' });
  assert.deepEqual(last('a', 'teleport').p, [x + 1.5, y + 1, z + 0.5]);
  host.world.setBlock(x + 1, y, z, BLOCK.AIR);
  host.message('a', { t: 'respawn' });
  assert.deepEqual(last('a', 'teleport').p, host.save.spawn);
});

test('creepers blow up blocks and hurt nearby players', () => {
  const { host, join, all } = setup();
  join('a', 'A');
  standAtSpawn(host, 'a');
  const p = host.players.get('a');
  host.time = 18000;
  const c = host.spawnMob('creeper', p.x + 2, p.y, p.z);
  const groundBefore = host.world.getBlock(Math.floor(c.x), Math.floor(c.y) - 1, Math.floor(c.z));
  for (let i = 0; i < 60 && host.entities.has(c.id); i++) { c.x = p.x + 2; c.z = p.z; c.y = p.y; host.tick(0.05); }
  assert.ok(!host.entities.has(c.id), 'creeper exploded');
  assert.ok(all('a', 'boom').length === 1);
  assert.ok(all('a', 'hurt').some((m) => /blown up/.test(m.cause) && m.amount > 5), 'player hurt by the blast');
  assert.ok(groundBefore !== BLOCK.AIR && host.world.getBlock(Math.floor(p.x) + 2, Math.floor(p.y) - 1, Math.floor(p.z)) !== groundBefore, 'crater');
});

test('skeletons shoot arrows that hit players', () => {
  const { host, join, all } = setup();
  join('a', 'A');
  standAtSpawn(host, 'a');
  const p = host.players.get('a');
  // a clear flat platform high up so terrain can't block the shot
  for (let dx = -12; dx <= 12; dx++) for (let dz = -3; dz <= 3; dz++) {
    host.world.setBlock(Math.floor(p.x) + dx, 80, Math.floor(p.z) + dz, BLOCK.STONE);
    for (let dy = 81; dy < 85; dy++) host.world.setBlock(Math.floor(p.x) + dx, dy, Math.floor(p.z) + dz, BLOCK.AIR);
  }
  p.y = 81;
  host.time = 18000;
  const s = host.spawnMob('skeleton', p.x + 9, 81, p.z);
  for (let i = 0; i < 120 && !all('a', 'hurt').length; i++) { s.x = p.x + 9; s.z = p.z; host.tick(0.05); }
  assert.ok(all('a', 'hurt').some((m) => /shot/.test(m.cause)), 'arrow hit');
});

test('shears give wool from sheep, which regrows', () => {
  const { host, join } = setup();
  join('a', 'A');
  standAtSpawn(host, 'a');
  const p = host.players.get('a');
  const sheep = host.spawnMob('sheep', p.x + 1, p.y, p.z);
  host.message('a', { t: 'interact', e: sheep.id, tool: ITEM.SHEARS });
  assert.ok(sheep.sheared);
  assert.ok([...host.entities.values()].some((e) => e.item === BLOCK.WOOL));
  sheep.regrow = 0.01;
  host.tick(0.05);
  assert.ok(!sheep.sheared, 'wool grew back');
});

test('identical items lying together merge into one stack', () => {
  const { host, join } = setup();
  join('a', 'A');
  const [x, y, z] = standAtSpawn(host, 'a');
  for (let i = 0; i < 5; i++) host.spawnItem(x + 0.5 + i * 0.1, y + 0.2, z + 0.5, BLOCK.COBBLE, 20, undefined, [0, 0, 0]);
  host.spawnItem(x + 0.5, y + 0.2, z + 0.5, BLOCK.DIRT, 3, undefined, [0, 0, 0]);
  host.spawnItem(x + 0.5, y + 0.2, z + 0.5, ITEM.IRON_PICKAXE, 1, 200, [0, 0, 0]); // tools never merge
  host.spawnItem(x + 0.5, y + 0.2, z + 0.5, ITEM.IRON_PICKAXE, 1, 100, [0, 0, 0]);
  host.mergeItems();
  const stacks = [...host.entities.values()].map((e) => [e.item, e.count]).sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  assert.deepEqual(stacks, [[BLOCK.DIRT, 3], [BLOCK.COBBLE, 64], [BLOCK.COBBLE, 36], [ITEM.IRON_PICKAXE, 1], [ITEM.IRON_PICKAXE, 1]].sort((a, b) => a[0] - b[0] || b[1] - a[1]));
});

test('worlds saved by the previous version still load (no generator version, chests or beds)', () => {
  const old = {
    version: 2, name: 'Old', seed: 2024, mode: 'survival', cheats: true, spawn: [0.5, 40, 0.5], time: 5000,
    edits: [[1, 40, 1, 12]], players: { alex: { pos: [3, 40, 3], rot: [0, 0], mode: 'survival', inv: null, health: 17, food: 20 } },
    furnaces: {}, created: 1, lastPlayed: 1,
  };
  const inbox = [];
  const host = new GameHost(old, (peer, msg) => inbox.push(msg));
  assert.equal(host.gen, 1, 'old worlds keep the original terrain generator');
  host.message('p', { t: 'hello', name: 'Alex' });
  const w = inbox.find((m) => m.t === 'welcome');
  assert.equal(w.gen, 1);
  assert.equal(w.me.health, 17, 'existing player data found by name');
  assert.deepEqual(w.me.pos, [3, 40, 3]);
  // and it saves in the new format
  const saved = host.serialize();
  assert.deepEqual(saved.chests, {});
  assert.equal(host.world.getBlock(1, 40, 1), 12);
});

test('experience: orbs from mobs and ores fly to the player, and levels follow Minecraft', async () => {
  const { levelInfo, pointsForLevel } = await import('../public/js/xp.js');
  assert.deepEqual([0, 1, 2, 15, 16, 30, 31].map(pointsForLevel), [7, 9, 11, 37, 42, 112, 121]);
  assert.equal(levelInfo(7).level, 1);
  assert.equal(levelInfo(315).level, 15);   // Minecraft: 315 points = level 15
  assert.equal(levelInfo(352).level, 16);
  assert.equal(levelInfo(1395).level, 30);  // and 1395 points = level 30

  const { host, join, all } = setup();
  join('a', 'A');
  const [x, y, z] = standAtSpawn(host, 'a');
  const pig = host.spawnMob('pig', x + 2.5, y, z + 0.5);
  pig.hp = 1;
  host.message('a', { t: 'attack', e: pig.id, tool: 0 });
  const orbs = [...host.entities.values()].filter((e) => e.type === 'xp');
  assert.ok(orbs.length >= 1, 'a killed pig drops experience');
  const total = orbs.reduce((n, e) => n + e.value, 0);
  for (let i = 0; i < 100; i++) host.tick(0.05);
  assert.equal(all('a', 'xp').reduce((n, m) => n + m.amount, 0), total, 'all of it reaches the player');
  assert.equal([...host.entities.values()].filter((e) => e.type === 'xp').length, 0);

  // diamond ore with an iron pickaxe gives 3-7 points
  host.world.setBlock(x + 1, y, z, BLOCK.DIAMOND_ORE);
  host.message('a', { t: 'dig', x: x + 1, y, z, tool: ITEM.IRON_PICKAXE });
  const ore = [...host.entities.values()].filter((e) => e.type === 'xp').reduce((n, e) => n + e.value, 0);
  assert.ok(ore >= 3 && ore <= 7, `ore xp ${ore}`);
  // ...but nothing without the right tool
  host.world.setBlock(x + 1, y, z, BLOCK.DIAMOND_ORE);
  const before = host.entities.size;
  host.message('a', { t: 'dig', x: x + 1, y, z, tool: 0 });
  assert.equal(host.entities.size, before);
});

test('experience is saved, and dying drops 7 points per level', () => {
  const { host, join, last } = setup();
  join('a', 'A');
  standAtSpawn(host, 'a');
  host.message('a', { t: 'save', inv: new Array(36).fill(null), health: 20, food: 20, xp: 160 }); // level 10
  const key = Object.keys(host.serialize().players)[0];
  assert.equal(host.save.players[key].xp, 160);
  host.message('a', { t: 'died', items: [], cause: 'fell', xp: 160 });
  const dropped = [...host.entities.values()].filter((e) => e.type === 'xp').reduce((n, e) => n + e.value, 0);
  assert.equal(dropped, 70);
  host.serialize();
  assert.equal(host.save.players[key].xp, 0);
  assert.equal(last('a', 'welcome').me.xp, 0);
});

test('the host frees terrain far from every player, keeping edits', () => {
  const { host, join } = setup();
  join('a', 'A');
  standAtSpawn(host, 'a');
  host.world.setBlock(2000, 150, 2000, BLOCK.BRICK);
  for (let cx = 100; cx < 127; cx++) for (let cz = 100; cz < 127; cz++) host.world.getChunk(cx, cz);
  const p = [...host.players.values()][0];
  host.world.getChunk(Math.floor(p.x / 16), Math.floor(p.z / 16));
  assert.ok(host.world.chunks.size > 600);
  host.trimMemory();
  assert.ok(host.world.chunks.size < 300, `${host.world.chunks.size} chunks left`);
  assert.ok(host.world.hasChunk(Math.floor(p.x / 16), Math.floor(p.z / 16)), 'chunks near the player stay');
  assert.equal(host.world.getBlock(2000, 150, 2000), BLOCK.BRICK, 'edits survive');
});
