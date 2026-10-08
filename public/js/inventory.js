// Inventory slots, Minecraft-style click handling and crafting recipes.
// A slot is null or {id, count, dur?} (dur = remaining tool durability).

import { BLOCK, ITEM, ITEMS, maxStack, maxDurability, woolOf } from './blocks.js';

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36; // 0-8 hotbar, 9-35 backpack

export function makeStack(id, count = 1) {
  const dur = maxDurability(id);
  return dur ? { id, count: 1, dur } : { id, count };
}

function canMerge(a, b) {
  return a && b && a.id === b.id && a.dur === undefined && b.dur === undefined && !a.ench && !b.ench && a.potion === b.potion;
}

// The extra parts of a stack (enchantments, anvil uses) to keep when it moves.
export function extras(s) {
  const out = {};
  if (s?.ench) out.ench = s.ench;
  if (s?.rc) out.rc = s.rc;
  if (s?.potion) out.potion = s.potion;
  return out;
}

// Adds items to the inventory (hotbar first). Returns how many did not fit.
// extra: {ench, rc} of an enchanted item (those never stack)
export function addItem(slots, id, count = 1, dur, extra) {
  const limit = maxStack(id);
  if (extra && !extra.ench && !extra.rc && !extra.potion) extra = undefined;
  if (dur === undefined && limit > 1 && !extra) {
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
      slots[i] = dur === undefined ? { id, count: n, ...extra } : { id, count: n, dur, ...extra };
      count -= n;
    }
  }
  return count;
}

export function countItem(slots, id) {
  return slots.reduce((n, s) => n + (s && s.id === id ? s.count : 0), 0);
}

// Removes `count` items of a kind from wherever they are (if there are enough). Returns whether it did.
export function takeItems(slots, id, count) {
  if (countItem(slots, id) < count) return false;
  for (let i = slots.length - 1; i >= 0 && count > 0; i--) {
    const s = slots[i];
    if (!s || s.id !== id) continue;
    const n = Math.min(count, s.count);
    s.count -= n;
    count -= n;
    if (s.count <= 0) slots[i] = null;
  }
  return true;
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
// shapeless: the items can go anywhere in the grid (the pattern is how the recipe book shows it)
const ALL_WOOL = Array.from({ length: 16 }, (_, c) => woolOf(c));
const DYE = (c) => ITEM.DYE + c;
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
  { pattern: ['WWW', 'PPP'], keys: { W: ALL_WOOL, P: PLANKS }, result: [BLOCK.BED, 1] },
  { pattern: ['I.I', '.I.'], keys: { I: [ITEM.IRON_INGOT] }, result: [ITEM.BUCKET, 1] },
  { pattern: ['.I', 'I.'], keys: { I: [ITEM.IRON_INGOT] }, result: [ITEM.SHEARS, 1] },
  { pattern: ['SS', 'SS'], keys: { S: [ITEM.STRING] }, result: [BLOCK.WOOL, 1] },
  { pattern: ['CCC', 'CCC', 'CCC'], keys: { C: [ITEM.COPPER_INGOT] }, result: [BLOCK.COPPER_BLOCK, 1] },
  ...[[ITEM.IRON_INGOT, BLOCK.IRON_BLOCK], [ITEM.GOLD_INGOT, BLOCK.GOLD_BLOCK], [ITEM.DIAMOND, BLOCK.DIAMOND_BLOCK], [ITEM.EMERALD, BLOCK.EMERALD_BLOCK],
    [ITEM.LAPIS_LAZULI, BLOCK.LAPIS_BLOCK], [ITEM.COAL, BLOCK.COAL_BLOCK]].flatMap(([item, block]) => [
    { pattern: ['CCC', 'CCC', 'CCC'], keys: { C: [item] }, result: [block, 1] },
    { pattern: ['B'], keys: { B: [block] }, result: [item, 9] },
  ]),
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
  // redstone
  { pattern: ['R', 'S'], keys: { R: [ITEM.REDSTONE], S: [ITEM.STICK] }, result: [BLOCK.REDSTONE_TORCH + 5, 1] },
  { pattern: ['S', 'C'], keys: { S: [ITEM.STICK], C: STONES }, result: [BLOCK.LEVER, 1] },
  { pattern: ['S'], keys: { S: [BLOCK.STONE] }, result: [BLOCK.STONE_BUTTON, 1] },
  { pattern: ['SS'], keys: { S: [BLOCK.STONE] }, result: [BLOCK.STONE_PRESSURE_PLATE, 1] },
  { pattern: ['PP'], keys: { P: PLANKS }, result: [BLOCK.OAK_PRESSURE_PLATE, 1] },
  { pattern: ['TRT', 'SSS'], keys: { T: [BLOCK.REDSTONE_TORCH + 5], R: [ITEM.REDSTONE], S: [BLOCK.STONE] }, result: [BLOCK.REPEATER, 1] },
  { pattern: ['.R.', 'RGR', '.R.'], keys: { R: [ITEM.REDSTONE], G: [BLOCK.GLOWSTONE] }, result: [BLOCK.REDSTONE_LAMP, 1] },
  { pattern: ['RRR', 'RRR', 'RRR'], keys: { R: [ITEM.REDSTONE] }, result: [BLOCK.REDSTONE_BLOCK, 1] },
  { pattern: ['B'], keys: { B: [BLOCK.REDSTONE_BLOCK] }, result: [ITEM.REDSTONE, 9] },
  { pattern: ['GSG', 'SGS', 'GSG'], keys: { G: [ITEM.GUNPOWDER], S: [BLOCK.SAND] }, result: [BLOCK.TNT, 1] },
  { pattern: ['PPP', 'CIC', 'CRC'], keys: { P: PLANKS, C: STONES, I: [ITEM.IRON_INGOT], R: [ITEM.REDSTONE] }, result: [BLOCK.PISTON + 2, 1] },
  { pattern: ['S', 'P'], keys: { S: [ITEM.SLIMEBALL], P: [BLOCK.PISTON + 2] }, result: [BLOCK.STICKY_PISTON + 2, 1] },
  { pattern: ['IF'], keys: { I: [ITEM.IRON_INGOT], F: [ITEM.FLINT] }, result: [ITEM.FLINT_AND_STEEL, 1], shapeless: true },
  // the Nether and the End
  { pattern: ['DD', 'DD'], keys: { D: [ITEM.GLOWSTONE_DUST] }, result: [BLOCK.GLOWSTONE, 1] },
  { pattern: ['BB', 'BB'], keys: { B: [ITEM.NETHER_BRICK] }, result: [BLOCK.NETHER_BRICKS, 1] },
  { pattern: ['NBN', 'NBN'], keys: { N: [BLOCK.NETHER_BRICKS], B: [ITEM.NETHER_BRICK] }, result: [BLOCK.NETHER_BRICK_FENCE, 6] },
  { pattern: ['NNN', 'NNN', 'NNN'], keys: { N: [ITEM.GOLD_NUGGET] }, result: [ITEM.GOLD_INGOT, 1] },
  { pattern: ['G'], keys: { G: [ITEM.GOLD_INGOT] }, result: [ITEM.GOLD_NUGGET, 9] },
  { pattern: ['R'], keys: { R: [ITEM.BLAZE_ROD] }, result: [ITEM.BLAZE_POWDER, 2] },
  { pattern: ['PB'], keys: { P: [ITEM.ENDER_PEARL], B: [ITEM.BLAZE_POWDER] }, result: [ITEM.EYE_OF_ENDER, 1], shapeless: true },
  // books and village job sites
  { pattern: ['SSS'], keys: { S: [BLOCK.SUGAR_CANE] }, result: [ITEM.PAPER, 3] },
  { pattern: ['BS'], keys: { B: [ITEM.BLAZE_POWDER], S: [ITEM.SLIMEBALL] }, result: [ITEM.MAGMA_CREAM, 1], shapeless: true },
  { pattern: ['SSS', 'SSS', 'SSS'], keys: { S: [ITEM.SLIMEBALL] }, result: [BLOCK.SLIME_BLOCK, 1] },
  { pattern: ['B'], keys: { B: [BLOCK.SLIME_BLOCK] }, result: [ITEM.SLIMEBALL, 9] },
  { pattern: ['HH', 'HH'], keys: { H: [ITEM.RABBIT_HIDE] }, result: [ITEM.LEATHER, 1] },
  // brewing
  { pattern: ['.B.', 'SSS'], keys: { B: [ITEM.BLAZE_ROD], S: [BLOCK.COBBLE, BLOCK.COBBLED_DEEPSLATE] }, result: [BLOCK.BREWING_STAND, 1] },
  { pattern: ['G.G', '.G.'], keys: { G: [BLOCK.GLASS] }, result: [ITEM.GLASS_BOTTLE, 3] },
  { pattern: ['S'], keys: { S: [BLOCK.SUGAR_CANE] }, result: [ITEM.SUGAR, 1] },
  { pattern: ['EMS'], keys: { E: [ITEM.SPIDER_EYE], M: [BLOCK.BROWN_MUSHROOM], S: [ITEM.SUGAR] }, result: [ITEM.FERMENTED_SPIDER_EYE, 1], shapeless: true },
  { pattern: ['NNN', 'NMN', 'NNN'], keys: { N: [ITEM.GOLD_NUGGET], M: [ITEM.MELON_SLICE] }, result: [ITEM.GLISTERING_MELON_SLICE, 1] },
  { pattern: ['NNN', 'NCN', 'NNN'], keys: { N: [ITEM.GOLD_NUGGET], C: [ITEM.CARROT] }, result: [ITEM.GOLDEN_CARROT, 1] },
  { pattern: ['GGG', 'GAG', 'GGG'], keys: { G: [ITEM.GOLD_INGOT], A: [ITEM.APPLE] }, result: [ITEM.GOLDEN_APPLE, 1] },
  { pattern: ['MMM', 'MMM', 'MMM'], keys: { M: [ITEM.MELON_SLICE] }, result: [BLOCK.MELON, 1] },
  { pattern: ['.B.', 'DOD', 'OOO'], keys: { B: [ITEM.BOOK], D: [ITEM.DIAMOND], O: [BLOCK.OBSIDIAN] }, result: [BLOCK.ENCHANTING_TABLE, 1] },
  { pattern: ['BBB', '.I.', 'III'], keys: { B: [BLOCK.IRON_BLOCK], I: [ITEM.IRON_INGOT] }, result: [BLOCK.ANVIL, 1] },
  { pattern: ['PPL'], keys: { P: [ITEM.PAPER], L: [ITEM.LEATHER] }, result: [ITEM.BOOK, 1], shapeless: true },
  { pattern: ['PPP', 'BBB', 'PPP'], keys: { P: PLANKS, B: [ITEM.BOOK] }, result: [BLOCK.BOOKSHELF, 1] },
  { pattern: ['WWW', 'WWW', 'WWW'], keys: { W: [ITEM.WHEAT] }, result: [BLOCK.HAY_BALE, 1] },
  { pattern: ['H'], keys: { H: [BLOCK.HAY_BALE] }, result: [ITEM.WHEAT, 9] },
  { pattern: ['S.S', 'S.S', 'SSS'], keys: { S: [BLOCK.OAK_SLAB] }, result: [BLOCK.COMPOSTER, 1] },
  { pattern: ['SSS', '.B.', '.S.'], keys: { S: [BLOCK.OAK_SLAB], B: [BLOCK.BOOKSHELF] }, result: [BLOCK.LECTERN, 1] },
  { pattern: ['III', 'IFI', 'SSS'], keys: { I: [ITEM.IRON_INGOT], F: [BLOCK.FURNACE], S: [BLOCK.STONE] }, result: [BLOCK.BLAST_FURNACE, 1] },
  { pattern: ['.L.', 'LFL', '.L.'], keys: { L: [BLOCK.LOG, BLOCK.BIRCH_LOG, BLOCK.SPRUCE_LOG, BLOCK.ACACIA_LOG, BLOCK.DARK_OAK_LOG, BLOCK.JUNGLE_LOG, BLOCK.CHERRY_LOG], F: [BLOCK.FURNACE] }, result: [BLOCK.SMOKER, 1] },
  { pattern: ['II', 'PP', 'PP'], keys: { I: [ITEM.IRON_INGOT], P: PLANKS }, result: [BLOCK.SMITHING_TABLE, 1] },
  { pattern: ['SAS', 'P.P'], keys: { S: [ITEM.STICK], A: [BLOCK.STONE_SLAB], P: PLANKS }, result: [BLOCK.GRINDSTONE, 1] },
  { pattern: ['FF', 'PP', 'PP'], keys: { F: [ITEM.FLINT], P: PLANKS }, result: [BLOCK.FLETCHING_TABLE, 1] },
  { pattern: ['SS', 'PP'], keys: { S: [ITEM.STRING], P: PLANKS }, result: [BLOCK.LOOM, 1] },
  { pattern: ['AA', 'PP', 'PP'], keys: { A: [ITEM.PAPER], P: PLANKS }, result: [BLOCK.CARTOGRAPHY_TABLE, 1] },
  { pattern: ['.I.', 'SSS'], keys: { I: [ITEM.IRON_INGOT], S: [BLOCK.STONE] }, result: [BLOCK.STONECUTTER, 1] },
  { pattern: ['I.I', 'I.I', 'III'], keys: { I: [ITEM.IRON_INGOT] }, result: [BLOCK.CAULDRON, 1] },
  { pattern: ['PSP', 'P.P', 'PSP'], keys: { P: PLANKS, S: [BLOCK.OAK_SLAB] }, result: [BLOCK.BARREL, 1] },
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

// Each ingredient once, in any slots.
function matchesShapeless(recipe, grid) {
  const need = recipe.pattern.join('').split('').filter((ch) => ch !== '.' && ch !== ' ');
  const items = grid.filter(Boolean);
  if (items.length !== need.length) return false;
  const left = [...need];
  for (const s of items) {
    const i = left.findIndex((ch) => recipe.keys[ch].includes(s.id));
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}

// grid: array of size*size slots. Returns a result stack or null.
export function findRecipe(grid, size) {
  const t = trim(grid, size);
  if (!t) return null;
  for (const r of RECIPES) {
    if (r.shapeless ? matchesShapeless(r, grid) : matches(r, t, false) || matches(r, t, true)) return makeStack(r.result[0], r.result[1]);
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

// dyes: from flowers and other things, and mixed from other dyes (colour numbers: see colors.js)
for (const [from, c, n] of [[BLOCK.DANDELION, 4, 1], [BLOCK.POPPY, 14, 1], [BLOCK.CORNFLOWER, 11, 1], [ITEM.INK_SAC, 15, 1],
  [ITEM.LAPIS_LAZULI, 11, 1], [ITEM.BONE_MEAL, 0, 1], [ITEM.COCOA_BEANS, 12, 1]]) {
  RECIPES.push({ pattern: ['X'], keys: { X: [from] }, result: [DYE(c), n], shapeless: true });
}
for (const [parts, c] of [[[14, 4], 1], [[11, 0], 3], [[14, 0], 6], [[13, 0], 5], [[15, 0], 7], [[7, 0], 8], [[15, 0, 0], 8],
  [[11, 13], 9], [[14, 11], 10], [[10, 6], 2], [[11, 14, 6], 2], [[11, 14, 14, 0], 2]]) {
  const keys = {}, letters = 'ABCD';
  parts.forEach((d, i) => { keys[letters[i]] = [DYE(d)]; });
  RECIPES.push({ pattern: [letters.slice(0, parts.length)], keys, result: [DYE(c), parts.length], shapeless: true });
}
for (let c = 0; c < 16; c++) {
  RECIPES.push({ pattern: ['DW'], keys: { D: [DYE(c)], W: ALL_WOOL.filter((w) => w !== woolOf(c)) }, result: [woolOf(c), 1], shapeless: true });
  RECIPES.push({ pattern: ['GGG', 'GDG', 'GGG'], keys: { G: [BLOCK.GLASS], D: [DYE(c)] }, result: [BLOCK.STAINED_GLASS + c, 8] });
  RECIPES.push({ pattern: ['TTT', 'TDT', 'TTT'], keys: { T: [BLOCK.TERRACOTTA], D: [DYE(c)] }, result: [BLOCK.TERRACOTTA + 1 + c, 8] });
}
// clay and bricks
RECIPES.push({ pattern: ['CC', 'CC'], keys: { C: [ITEM.CLAY_BALL] }, result: [BLOCK.CLAY, 1] });
RECIPES.push({ pattern: ['BB', 'BB'], keys: { B: [ITEM.BRICK] }, result: [BLOCK.BRICK, 1] });

// fishing
RECIPES.push({ pattern: ['..S', '.ST', 'S.T'], keys: { S: [ITEM.STICK], T: [ITEM.STRING] }, result: [ITEM.FISHING_ROD, 1] });
