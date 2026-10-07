// Inventory slots, Minecraft-style click handling and crafting recipes.
// A slot is null or {id, count, dur?} (dur = remaining tool durability).

import { BLOCK, ITEM, ITEMS, maxStack, toolOf } from './blocks.js';

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36; // 0-8 hotbar, 9-35 backpack

export function makeStack(id, count = 1) {
  const tool = toolOf(id);
  return tool ? { id, count: 1, dur: tool.durability } : { id, count };
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
const PLANKS = [BLOCK.PLANKS, BLOCK.BIRCH_PLANKS];
const TOOL_MATERIALS = [
  [PLANKS, ITEM.WOODEN_PICKAXE],
  [[BLOCK.COBBLE], ITEM.STONE_PICKAXE],
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
  { pattern: ['CCC', 'C.C', 'CCC'], keys: { C: [BLOCK.COBBLE] }, result: [BLOCK.FURNACE, 1] },
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
