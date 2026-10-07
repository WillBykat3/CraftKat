import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, clickSlot, findRecipe, consumeGrid, quickMove, makeStack, countItem } from '../public/js/inventory.js';
import { BLOCK, ITEM, breakTime, getDrops } from '../public/js/blocks.js';

const grid = (rows) => rows.flat().map((id) => (id ? { id, count: 1 } : null));
const P = BLOCK.PLANKS, S = ITEM.STICK, C = BLOCK.COBBLE, _ = 0;

test('adding items stacks to 64 and fills the hotbar first', () => {
  const slots = new Array(36).fill(null);
  assert.equal(addItem(slots, BLOCK.DIRT, 100), 0);
  assert.deepEqual(slots[0], { id: BLOCK.DIRT, count: 64 });
  assert.deepEqual(slots[1], { id: BLOCK.DIRT, count: 36 });
  addItem(slots, BLOCK.DIRT, 30);
  assert.equal(slots[1].count, 64);
  assert.equal(slots[2].count, 2);
  assert.equal(countItem(slots, BLOCK.DIRT), 130);
  // tools never stack
  addItem(slots, ITEM.STONE_PICKAXE, 1, 131);
  addItem(slots, ITEM.STONE_PICKAXE, 1, 131);
  assert.equal(slots[3].count, 1);
  assert.equal(slots[4].count, 1);
  // a full inventory reports the leftovers
  const full = new Array(2).fill(null);
  assert.equal(addItem(full, BLOCK.STONE, 200), 72);
});

test('clicking slots works like Minecraft', () => {
  const slots = [{ id: BLOCK.DIRT, count: 10 }, null, { id: BLOCK.STONE, count: 5 }];
  let cursor = clickSlot(slots, 0, null, 2); // right click: take half
  assert.deepEqual(cursor, { id: BLOCK.DIRT, count: 5 });
  assert.equal(slots[0].count, 5);
  cursor = clickSlot(slots, 1, cursor, 2); // right click empty: place one
  assert.deepEqual(slots[1], { id: BLOCK.DIRT, count: 1 });
  assert.equal(cursor.count, 4);
  cursor = clickSlot(slots, 0, cursor, 0); // left click same item: merge
  assert.equal(cursor, null);
  assert.equal(slots[0].count, 9);
  cursor = clickSlot(slots, 0, null, 0); // pick up
  cursor = clickSlot(slots, 2, cursor, 0); // swap with stone
  assert.deepEqual(cursor, { id: BLOCK.STONE, count: 5 });
  assert.deepEqual(slots[2], { id: BLOCK.DIRT, count: 9 });
});

test('quick move merges then fills empty slots', () => {
  const to = [{ id: BLOCK.SAND, count: 60 }, null, null];
  const left = quickMove({ id: BLOCK.SAND, count: 70 }, to, [0, 1, 2]);
  assert.equal(left, null);
  assert.equal(to[0].count, 64);
  assert.equal(to[1].count, 64); // 66 left after topping up slot 0: 64 here, 2 in the next
  assert.equal(to[2].count, 2);
});

test('crafting recipes match anywhere in the grid, including mirrored', () => {
  assert.deepEqual(findRecipe(grid([[_, _], [BLOCK.LOG, _]]), 2), { id: BLOCK.PLANKS, count: 4 });
  assert.deepEqual(findRecipe(grid([[_, P], [_, P]]), 2), { id: ITEM.STICK, count: 4 });
  assert.deepEqual(findRecipe(grid([[P, BLOCK.BIRCH_PLANKS], [P, P]]), 2), { id: BLOCK.CRAFTING_TABLE, count: 1 });
  const pick = findRecipe(grid([[C, C, C], [_, S, _], [_, S, _]]), 3);
  assert.equal(pick.id, ITEM.STONE_PICKAXE);
  assert.equal(pick.dur, 131);
  // axe and its mirror image
  assert.equal(findRecipe(grid([[P, P, _], [P, S, _], [_, S, _]]), 3).id, ITEM.WOODEN_AXE);
  assert.equal(findRecipe(grid([[_, P, P], [_, S, P], [_, S, _]]), 3).id, ITEM.WOODEN_AXE);
  assert.equal(findRecipe(grid([[ITEM.DIAMOND], [ITEM.DIAMOND], [S]].map((r) => [...r, _, _])), 3).id, ITEM.DIAMOND_SWORD);
  assert.equal(findRecipe(grid([[C, C, C], [C, _, C], [C, C, C]]), 3).id, BLOCK.FURNACE);
  // a 3x3 recipe does not fit in the 2x2 grid, and junk matches nothing
  assert.equal(findRecipe(grid([[P, S], [S, P]]), 2), null);
  assert.equal(findRecipe(grid([[_, _], [_, _]]), 2), null);
});

test('crafting consumes one of each ingredient', () => {
  const g = [{ id: P, count: 3 }, null, { id: P, count: 1 }, null];
  consumeGrid(g);
  assert.deepEqual(g, [{ id: P, count: 2 }, null, null, null]);
});

test('tools speed up mining and are needed for some drops', () => {
  assert.ok(breakTime(BLOCK.STONE, 0) > breakTime(BLOCK.STONE, ITEM.WOODEN_PICKAXE));
  assert.ok(breakTime(BLOCK.STONE, ITEM.WOODEN_PICKAXE) > breakTime(BLOCK.STONE, ITEM.DIAMOND_PICKAXE));
  assert.equal(breakTime(BLOCK.TORCH, 0), 0);
  assert.equal(breakTime(BLOCK.BEDROCK, ITEM.DIAMOND_PICKAXE), Infinity);
  assert.deepEqual(getDrops(BLOCK.STONE, 0), []);
  assert.deepEqual(getDrops(BLOCK.STONE, ITEM.WOODEN_PICKAXE), [[BLOCK.COBBLE, 1]]);
  assert.deepEqual(getDrops(BLOCK.IRON_ORE, ITEM.WOODEN_PICKAXE), []);
  assert.deepEqual(getDrops(BLOCK.IRON_ORE, ITEM.STONE_PICKAXE), [[ITEM.RAW_IRON, 1]]);
  assert.deepEqual(getDrops(BLOCK.DIAMOND_ORE, ITEM.IRON_PICKAXE), [[ITEM.DIAMOND, 1]]);
  assert.deepEqual(getDrops(BLOCK.GRASS, 0), [[BLOCK.DIRT, 1]]);
  assert.deepEqual(getDrops(BLOCK.LOG, 0), [[BLOCK.LOG, 1]]);
  assert.deepEqual(makeStack(ITEM.IRON_SWORD), { id: ITEM.IRON_SWORD, count: 1, dur: 250 });
});
