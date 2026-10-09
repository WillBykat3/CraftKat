import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameHost, newWorldSave } from '../public/js/host.js';
import { BLOCK, BLOCKS, ITEM, getDrops, SMELTING, woolOf, colorOf } from '../public/js/blocks.js';
import { findRecipe } from '../public/js/inventory.js';
import { mulberry32 } from '../public/js/noise.js';
import { COLORS, color } from '../public/js/colors.js';
import { TILE_NAMES } from '../public/js/atlas-layout.js';

const grid = (...ids) => ids.map((id) => (id ? { id, count: 1 } : null));
const DYE = (name) => ITEM.DYE + color(name);

test('sixteen colours of dye, wool, stained glass and terracotta', () => {
  assert.equal(COLORS.length, 16);
  for (let c = 0; c < 16; c++) {
    for (const id of [woolOf(c), BLOCK.STAINED_GLASS + c, BLOCK.TERRACOTTA + 1 + c, ITEM.DYE + c]) {
      assert.equal(colorOf(id), c, `colour of ${id}`);
    }
    assert.ok(BLOCKS[woolOf(c)].name.endsWith('Wool'));
    assert.ok(BLOCKS[BLOCK.STAINED_GLASS + c].translucent);
  }
  assert.equal(new Set(TILE_NAMES).size, TILE_NAMES.length, 'no duplicate textures');
  assert.ok(TILE_NAMES.length <= 32 * 32);
});

test('dyes come from flowers and other things, and mix like Minecraft', () => {
  const one = (id) => findRecipe(grid(id, 0, 0, 0), 2);
  assert.deepEqual(one(BLOCK.DANDELION), { id: DYE('yellow'), count: 1 });
  assert.deepEqual(one(BLOCK.POPPY), { id: DYE('red'), count: 1 });
  assert.deepEqual(one(BLOCK.CORNFLOWER), { id: DYE('blue'), count: 1 });
  assert.deepEqual(one(ITEM.INK_SAC), { id: DYE('black'), count: 1 });
  assert.deepEqual(one(ITEM.BONE_MEAL), { id: DYE('white'), count: 1 });
  assert.deepEqual(one(ITEM.LAPIS_LAZULI), { id: DYE('blue'), count: 1 });
  assert.deepEqual(one(ITEM.COCOA_BEANS), { id: DYE('brown'), count: 1 });
  assert.equal(SMELTING[BLOCK.CACTUS], DYE('green'));
  assert.deepEqual(findRecipe(grid(DYE('red'), DYE('yellow'), 0, 0), 2), { id: DYE('orange'), count: 2 });
  assert.deepEqual(findRecipe(grid(DYE('white'), 0, 0, DYE('blue')), 2), { id: DYE('light_blue'), count: 2 });
  assert.deepEqual(findRecipe(grid(DYE('blue'), DYE('green'), 0, 0), 2), { id: DYE('cyan'), count: 2 });
  assert.deepEqual(findRecipe(grid(DYE('black'), DYE('white'), DYE('white'), 0), 2), { id: DYE('light_gray'), count: 3 });
  assert.deepEqual(findRecipe(grid(DYE('purple'), DYE('pink'), 0, 0), 2), { id: DYE('magenta'), count: 2 });
});

test('dyeing wool, glass and terracotta', () => {
  assert.deepEqual(findRecipe(grid(BLOCK.WOOL, DYE('lime'), 0, 0), 2), { id: woolOf(color('lime')), count: 1 });
  assert.deepEqual(findRecipe(grid(woolOf(color('red')), DYE('blue'), 0, 0), 2), { id: woolOf(color('blue')), count: 1 }, 're-dye');
  const G = BLOCK.GLASS;
  assert.deepEqual(findRecipe(grid(G, G, G, G, DYE('purple'), G, G, G, G), 3), { id: BLOCK.STAINED_GLASS + color('purple'), count: 8 });
  const T = BLOCK.TERRACOTTA;
  assert.deepEqual(findRecipe(grid(T, T, T, T, DYE('cyan'), T, T, T, T), 3), { id: BLOCK.TERRACOTTA + 1 + color('cyan'), count: 8 });
  // any colour of wool makes a bed
  const R = woolOf(color('red')), P = BLOCK.PLANKS;
  assert.equal(findRecipe(grid(R, R, R, P, P, P, 0, 0, 0), 3)?.id, BLOCK.BED);
});

test('clay, bricks and terracotta; stained glass needs Silk Touch', () => {
  const r = mulberry32(1);
  assert.deepEqual(getDrops(BLOCK.CLAY, 0, r), [[ITEM.CLAY_BALL, 4]]);
  assert.deepEqual(getDrops(BLOCK.CLAY, 0, r, { silk_touch: 1 }), [[BLOCK.CLAY, 1]]);
  assert.equal(SMELTING[ITEM.CLAY_BALL], ITEM.BRICK);
  assert.equal(SMELTING[BLOCK.CLAY], BLOCK.TERRACOTTA);
  assert.deepEqual(findRecipe(grid(ITEM.BRICK, ITEM.BRICK, ITEM.BRICK, ITEM.BRICK), 2), { id: BLOCK.BRICK, count: 1 });
  assert.deepEqual(findRecipe(grid(ITEM.CLAY_BALL, ITEM.CLAY_BALL, ITEM.CLAY_BALL, ITEM.CLAY_BALL), 2), { id: BLOCK.CLAY, count: 1 });
  assert.deepEqual(getDrops(BLOCK.STAINED_GLASS + 3, 0, r), []);
  assert.deepEqual(getDrops(BLOCK.STAINED_GLASS + 3, 0, r, { silk_touch: 1 }), [[BLOCK.STAINED_GLASS + 3, 1]]);
  assert.deepEqual(getDrops(woolOf(5), 0, r), [[woolOf(5), 1]]);
});

test('sheep come in natural colours, can be dyed, and grow wool of their colour', () => {
  const inbox = [];
  const host = new GameHost(newWorldSave({ name: 'C', seed: 3 }), (peer, msg) => inbox.push(msg), { random: mulberry32(2) });
  host.message('a', { t: 'hello', name: 'Steve' });
  const p = host.players.get('a');
  Object.assign(p, { x: 0.5, y: 200, z: 0.5 });
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) host.setBlock(x, 199, z, BLOCK.STONE);
  const counts = new Map();
  for (let i = 0; i < 2000; i++) {
    const s = host.spawnMob('sheep', 50, 300, 50);
    counts.set(s.color, (counts.get(s.color) || 0) + 1);
    host.entities.delete(s.id);
  }
  assert.ok(counts.get(0) > 1500 && counts.get(0) < 1750, `white: ${counts.get(0)}`);
  for (const c of counts.keys()) assert.ok([0, 15, 7, 8, 12, 6].includes(c), `natural colour ${c}`);
  const sheep = host.spawnMob('sheep', 2.5, 200, 0.5);
  sheep.color = 0;
  host.message('a', { t: 'interact', e: sheep.id, tool: DYE('blue') });
  assert.equal(sheep.color, color('blue'));
  assert.ok(inbox.some((m) => m.t === 'consume'), 'the dye is used up');
  host.message('a', { t: 'interact', e: sheep.id, tool: ITEM.SHEARS });
  const wool = [...host.entities.values()].filter((e) => e.type === 'item');
  assert.ok(wool.length && wool.every((w) => w.item === woolOf(color('blue'))), 'blue wool');
  assert.ok(!(sheep.love > 0), "dye isn't food");
});

test('concrete powder sets into concrete in water; carpets and glass panes', () => {
  const g = (...ids) => ids.map((id) => (id ? { id, count: 1 } : null));
  const S = BLOCK.SAND, G = BLOCK.GRAVEL;
  assert.deepEqual(findRecipe(g(DYE('lime'), S, S, S, S, G, G, G, G), 3), { id: BLOCK.CONCRETE_POWDER + color('lime'), count: 8 });
  assert.deepEqual(findRecipe(g(woolOf(color('red')), woolOf(color('red')), 0, 0), 2), { id: BLOCK.CARPET + color('red'), count: 3 });
  const GL = BLOCK.GLASS;
  assert.deepEqual(findRecipe(g(GL, GL, GL, GL, GL, GL, 0, 0, 0), 3), { id: BLOCK.GLASS_PANE, count: 16 });
  const host = new GameHost(newWorldSave({ name: 'C', seed: 3 }), () => {}, { random: mulberry32(2) });
  host.setBlock(0, 199, 0, BLOCK.STONE);
  host.setBlock(0, 200, 0, BLOCK.CONCRETE_POWDER + 4);
  assert.equal(host.world.getBlock(0, 200, 0), BLOCK.CONCRETE_POWDER + 4);
  host.setBlock(1, 200, 0, BLOCK.WATER);
  assert.equal(host.world.getBlock(0, 200, 0), BLOCK.CONCRETE + 4, 'set into yellow concrete');
});
