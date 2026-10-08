// Inventory slots, Minecraft-style click handling and crafting recipes.
// A slot is null or {id, count, dur?} (dur = remaining tool durability).

import { BLOCK, ITEM, ITEMS, maxStack, maxDurability } from './blocks.js';

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36; // 0-8 hotbar, 9-35 backpack

export function makeStack(id, count = 1) {
  const dur = maxDurability(id);
  return dur ? { id, count: 1, dur } : { id, count };
}

function canMerge(a, b) {
  return a && b && a.id === b.id && a.dur === undefined && b.dur === undefined;
}

// Adds items to the inventory (hotbar first). Returns how many did not fit.
export function addItem(slots, id, count = 1, dur) {
  const limit = maxStack(id);
  if (dur === undefined && limit > 1) {
    for (let i = 0; i < slots.length && count > 0; i++) {
      const s = slots[i];
      if (s && s.id === id && s.dur === undefined && s.count < limit) {
        const n = Math.min(limit - s.count, count);
        s.count += n;
        count -= n;
      }
    }
  }
  for (let i = 0; i < slots.length && count > 0; i++) {
    if (!slots[i]) {
      const n = Math.min(limit, count);
      slots[i] = dur === undefined ? { id, count: n } : { id, count: n, dur };
      count -= n;
    }
  }
  return count;
}

export function countItem(slots, id) {
  return slots.reduce((n, s) => n + (s && s.id === id ? s.count : 0), 0);
}

// Removes one item from a slot.
export function takeOne(slots, i) {
  const s = slots[i];
  if (!s) return;
  s.count--;
  if (s.count <= 0) slots[i] = null;
}

// Handles a click on slots[i] while holding `cursor`. Returns the new cursor.
// button: 0 = left (whole stack), 2 = right (half / one).
export function clickSlot(slots, i, cursor, button) {
  const s = slots[i];
  if (button === 2) {
    if (!cursor) {
      if (!s) return null;
      const half = Math.ceil(s.count / 2);
      const picked = { ...s, count: half };
      s.count -= half;
      if (s.count <= 0) slots[i] = null;
      return picked;
    }
    if (!s) {
      slots[i] = { ...cursor, count: 1 };
      return cursor.count > 1 ? { ...cursor, count: cursor.count - 1 } : null;
    }
    if (canMerge(s, cursor) && s.count < maxStack(s.id)) {
      s.count++;
      return cursor.count > 1 ? { ...cursor, count: cursor.count - 1 } : null;
    }
    slots[i] = cursor;
    return s;
  }
  if (!cursor) {
    slots[i] = null;
    return s;
  }
  if (!s) {
    slots[i] = cursor;
    return null;
  }
  if (canMerge(s, cursor)) {
    const n = Math.min(maxStack(s.id) - s.count, cursor.count);
    s.count += n;
    return cursor.count - n > 0 ? { ...cursor, count: cursor.count - n } : null;
  }
  slots[i] = cursor;
  return s;
}

// Moves a whole stack into the first slots of `targets` (indices into `to`) that accept it.
// Returns the leftover stack or null.
export function quickMove(stack, to, targets) {
  if (!stack) return null;
  const limit = maxStack(stack.id);
  let left = stack.count;
  for (const t of targets) {
    if (left === 0) break;
    const s = to[t];
    if (s && canMerge(s, stack) && s.count < limit) {
      const n = Math.min(limit - s.count, left);
      s.count += n;
      left -= n;
    }
  }
  for (const t of targets) {
    if (left === 0) break;
    if (!to[t]) {
      const n = Math.min(limit, left);
      to[t] = { ...stack, count: n };
      left -= n;
    }
  }
  return left > 0 ? { ...stack, count: left } : null;
}

// ---------- crafting ----------
const PLANKS = [BLOCK.PLANKS, BLOCK.BIRCH_PLANKS, BLOCK.CHERRY_PLANKS, BLOCK.SPRUCE_PLANKS, BLOCK.ACACIA_PLANKS,
  BLOCK.DARK_OAK_PLANKS, BLOCK.JUNGLE_PLANKS];
const STONES = [BLOCK.COBBLE, BLOCK.COBBLED_DEEPSLATE]; // like Minecraft, either works for stone tools
const TOOL_MATERIALS = [
  [PLANKS, ITEM.WOODEN_PICKAXE],
  [STONES, ITEM.STONE_PICKAXE],
  [[ITEM.IRON_INGOT], ITEM.IRON_PICKAXE],
  [[ITEM.DIAMOND], ITEM.DIAMOND_PICKAXE],
];

// pattern rows use keys; '.' or ' ' is empty. key -> list of accepted ids
export const RECIPES = [
  { pattern: ['L'], keys: { L: [BLOCK.LOG] }, result: [BLOCK.PLANKS, 4] },
  { pattern: ['L'], keys: { L: [BLOCK.BIRCH_LOG] }, result: [BLOCK.BIRCH_PLANKS, 4] },
  { pattern: ['P', 'P'], keys: { P: PLANKS }, result: [ITEM.STICK, 4] },
  { pattern: ['PP', 'PP'], keys: { P: PLANKS }, result: [BLOCK.CRAFTING_TABLE, 1] },
  { pattern: ['C', 'S'], keys: { C: [ITEM.COAL], S: [ITEM.STICK] }, result: [BLOCK.TORCH, 4] },
  { pattern: ['L'], keys: { L: [BLOCK.CHERRY_LOG] }, result: [BLOCK.CHERRY_PLANKS, 4] },
  { pattern: ['L'], keys: { L: [BLOCK.SPRUCE_LOG] }, result: [BLOCK.SPRUCE_PLANKS, 4] },
  { pattern: ['L'], keys: { L: [BLOCK.ACACIA_LOG] }, result: [BLOCK.ACACIA_PLANKS, 4] },
  { pattern: ['L'], keys: { L: [BLOCK.DARK_OAK_LOG] }, result: [BLOCK.DARK_OAK_PLANKS, 4] },
  { pattern: ['L'], keys: { L: [BLOCK.JUNGLE_LOG] }, result: [BLOCK.JUNGLE_PLANKS, 4] },
  { pattern: ['CCC', 'C.C', 'CCC'], keys: { C: STONES }, result: [BLOCK.FURNACE, 1] },
  { pattern: ['PPP', 'P.P', 'PPP'], keys: { P: PLANKS }, result: [BLOCK.CHEST, 1] },
  { pattern: ['WWW', 'PPP'], keys: { W: [BLOCK.WOOL], P: PLANKS }, result: [BLOCK.BED, 1] },
  { pattern: ['I.I', '.I.'], keys: { I: [ITEM.IRON_INGOT] }, result: [ITEM.BUCKET, 1] },
  { pattern: ['.I', 'I.'], keys: { I: [ITEM.IRON_INGOT] }, result: [ITEM.SHEARS, 1] },
  { pattern: ['SS', 'SS'], keys: { S: [ITEM.STRING] }, result: [BLOCK.WOOL, 1] },
  { pattern: ['CCC', 'CCC', 'CCC'], keys: { C: [ITEM.COPPER_INGOT] }, result: [BLOCK.COPPER_BLOCK, 1] },
  { pattern: ['B'], keys: { B: [BLOCK.COPPER_BLOCK] }, result: [ITEM.COPPER_INGOT, 9] },
  { pattern: ['SS', 'SS'], keys: { S: [BLOCK.STONE] }, result: [BLOCK.STONE_BRICKS, 4] },
  { pattern: ['SS', 'SS'], keys: { S: [BLOCK.SAND] }, result: [BLOCK.SANDSTONE, 1] },
  { pattern: ['SS', 'SS'], keys: { S: [BLOCK.SNOW] }, result: [BLOCK.SNOW, 1] },
];
for (const [material, pickaxe] of TOOL_MATERIALS) {
  const m = { M: material, S: [ITEM.STICK] };
  RECIPES.push({ pattern: ['MMM', '.S.', '.S.'], keys: m, result: [pickaxe, 1] });
  RECIPES.push({ pattern: ['MM', 'MS', '.S'], keys: m, result: [pickaxe + 1, 1] });     // axe
  RECIPES.push({ pattern: ['M', 'S', 'S'], keys: m, result: [pickaxe + 2, 1] });        // shovel
  RECIPES.push({ pattern: ['M', 'M', 'S'], keys: m, result: [pickaxe + 3, 1] });        // sword
}

TOOL_MATERIALS.forEach(([material], m) => {
  RECIPES.push({ pattern: ['MM', '.S', '.S'], keys: { M: material, S: [ITEM.STICK] }, result: [ITEM.WOODEN_HOE + m, 1] });
});
// armor from leather, iron, gold and diamonds
[[ITEM.LEATHER], [ITEM.IRON_INGOT], [ITEM.GOLD_INGOT], [ITEM.DIAMOND]].forEach((material, m) => {
  const keys = { M: material };
  const first = ITEM.LEATHER_HELMET + m * 4;
  RECIPES.push({ pattern: ['MMM', 'M.M'], keys, result: [first, 1] });
  RECIPES.push({ pattern: ['M.M', 'MMM', 'MMM'], keys, result: [first + 1, 1] });
  RECIPES.push({ pattern: ['MMM', 'M.M', 'M.M'], keys, result: [first + 2, 1] });
  RECIPES.push({ pattern: ['M.M', 'M.M'], keys, result: [first + 3, 1] });
});
RECIPES.push(
  { pattern: ['WWW'], keys: { W: [ITEM.WHEAT] }, result: [ITEM.BREAD, 1] },
  { pattern: ['.ST', 'S.T', '.ST'], keys: { S: [ITEM.STICK], T: [ITEM.STRING] }, result: [ITEM.BOW, 1] },
  { pattern: ['F', 'S', 'E'], keys: { F: [ITEM.FLINT], S: [ITEM.STICK], E: [ITEM.FEATHER] }, result: [ITEM.ARROW, 4] },
  { pattern: ['B'], keys: { B: [ITEM.BONE] }, result: [ITEM.BONE_MEAL, 3] },
  { pattern: ['PP', 'PP', 'PP'], keys: { P: PLANKS }, result: [ITEM.OAK_DOOR, 3] },
  { pattern: ['S.S', 'SSS', 'S.S'], keys: { S: [ITEM.STICK] }, result: [BLOCK.LADDER, 3] },
  { pattern: ['PSP', 'PSP'], keys: { P: PLANKS, S: [ITEM.STICK] }, result: [BLOCK.OAK_FENCE, 3] },
  { pattern: ['PPP'], keys: { P: PLANKS }, result: [BLOCK.OAK_SLAB, 6] },
  { pattern: ['CCC'], keys: { C: [BLOCK.COBBLE] }, result: [BLOCK.COBBLESTONE_SLAB, 6] },
  { pattern: ['SSS'], keys: { S: [BLOCK.STONE] }, result: [BLOCK.STONE_SLAB, 6] },
  { pattern: ['P..', 'PP.', 'PPP'], keys: { P: PLANKS }, result: [BLOCK.OAK_STAIRS, 4] },
  { pattern: ['C..', 'CC.', 'CCC'], keys: { C: [BLOCK.COBBLE] }, result: [BLOCK.COBBLESTONE_STAIRS, 4] },
);

// Trims empty rows/columns: returns {w, h, cells} for a square grid of slots.
function trim(grid, size) {
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (grid[y * size + x]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return null;
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const cells = [];
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) cells.push(grid[y * size + x]);
  return { w, h, cells };
}

function matches(recipe, t, mirror) {
  const h = recipe.pattern.length;
  const w = Math.max(...recipe.pattern.map((r) => r.length));
  if (w !== t.w || h !== t.h) return false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = recipe.pattern[y][mirror ? w - 1 - x : x] || '.';
    const slot = t.cells[y * w + x];
    if (ch === '.' || ch === ' ') {
      if (slot) return false;
    } else if (!slot || !recipe.keys[ch].includes(slot.id)) {
      return false;
    }
  }
  return true;
}

// grid: array of size*size slots. Returns a result stack or null.
export function findRecipe(grid, size) {
  const t = trim(grid, size);
  if (!t) return null;
  for (const r of RECIPES) {
    if (matches(r, t, false) || matches(r, t, true)) return makeStack(r.result[0], r.result[1]);
  }
  return null;
}

// Uses up one item from every filled grid cell (after taking a crafting result).
export function consumeGrid(grid) {
  for (let i = 0; i < grid.length; i++) {
    if (grid[i]) {
      grid[i].count--;
      if (grid[i].count <= 0) grid[i] = null;
    }
  }
}

export function foodValue(id) {
  return ITEMS[id]?.food ?? 0;
}

// ---------- recipe book ----------
function patternSize(r) {
  return { w: Math.max(...r.pattern.map((row) => row.length)), h: r.pattern.length };
}

// Does this recipe fit in a size x size grid?
export function recipeFits(r, size) {
  const { w, h } = patternSize(r);
  return w <= size && h <= size;
}

// The ingredient cells of a recipe: [{x, y, ids}]
function cells(r) {
  const out = [];
  r.pattern.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.' && row[x] !== ' ') out.push({ x, y, ids: r.keys[row[x]] });
  });
  return out;
}

// Picks which item fills each cell for `times` crafts, using `have` (id -> count). null if not enough.
function plan(r, have, times) {
  const left = new Map(have);
  const picks = [];
  for (const c of cells(r)) {
    const id = c.ids.find((i) => (left.get(i) || 0) >= times);
    if (id === undefined) return null;
    left.set(id, left.get(id) - times);
    picks.push({ ...c, id });
  }
  return picks;
}

function counts(stacks) {
  const have = new Map();
  for (const s of stacks) if (s && s.dur === undefined) have.set(s.id, (have.get(s.id) || 0) + s.count);
  return have;
}

// How many times the recipe could be crafted from these stacks (capped at 64).
export function craftableTimes(r, stacks) {
  const have = counts(stacks);
  let n = 0;
  while (n < 64 && plan(r, have, n + 1)) n++;
  return n;
}

// Moves ingredients from the inventory into an empty grid for `times` crafts.
// Returns false (changing nothing) if there aren't enough ingredients.
export function fillGrid(r, inv, grid, size, times = 1) {
  if (!recipeFits(r, size) || grid.some(Boolean)) return false;
  const picks = plan(r, counts(inv), times);
  if (!picks) return false;
  for (const { x, y, id } of picks) {
    let need = times;
    for (let i = 0; i < inv.length && need > 0; i++) {
      const s = inv[i];
      if (!s || s.id !== id || s.dur !== undefined) continue;
      const n = Math.min(need, s.count);
      s.count -= n;
      need -= n;
      if (s.count === 0) inv[i] = null;
    }
    grid[y * size + x] = { id, count: times };
  }
  return true;
}

export function recipeResult(r) {
  return makeStack(r.result[0], r.result[1]);
}
