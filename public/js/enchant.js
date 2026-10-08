// Enchantments, after Minecraft's rules: which items take which enchantments, how the
// enchanting table picks them (bookshelves raise the levels), how anvils combine them,
// and the numbers their effects use. A stack's enchantments are `ench: {name: level}`.

import { BLOCK, ITEM, ITEMS, toolOf, armorOf } from './blocks.js';
import { mulberry32 } from './noise.js';

// name -> [display name, max level, weight (rarity), min power at level l, power span, applies to, treasure?]
const E = (label, max, weight, min, span, kinds, treasure = false) => ({ label, max, weight, min, span, kinds, treasure });
const lin = (base, step) => (l) => base + (l - 1) * step;
export const ENCHANTS = {
  protection: E('Protection', 4, 10, lin(1, 11), 11, ['armor']),
  fire_protection: E('Fire Protection', 4, 5, lin(10, 8), 8, ['armor']),
  blast_protection: E('Blast Protection', 4, 2, lin(5, 8), 8, ['armor']),
  projectile_protection: E('Projectile Protection', 4, 5, lin(3, 6), 6, ['armor']),
  feather_falling: E('Feather Falling', 4, 5, lin(5, 6), 6, ['boots']),
  respiration: E('Respiration', 3, 2, (l) => 10 * l, 30, ['helmet']),
  aqua_affinity: E('Aqua Affinity', 1, 2, () => 1, 40, ['helmet']),
  depth_strider: E('Depth Strider', 3, 2, (l) => 10 * l, 15, ['boots']),
  thorns: E('Thorns', 3, 1, lin(10, 20), 50, ['chestplate']),
  sharpness: E('Sharpness', 5, 10, lin(1, 11), 20, ['sword', 'axe']),
  smite: E('Smite', 5, 5, lin(5, 8), 20, ['sword', 'axe']),
  bane_of_arthropods: E('Bane of Arthropods', 5, 5, lin(5, 8), 20, ['sword', 'axe']),
  knockback: E('Knockback', 2, 5, lin(5, 20), 50, ['sword']),
  fire_aspect: E('Fire Aspect', 2, 2, lin(10, 20), 50, ['sword']),
  looting: E('Looting', 3, 2, lin(15, 9), 50, ['sword']),
  efficiency: E('Efficiency', 5, 10, lin(1, 10), 50, ['digger']),
  silk_touch: E('Silk Touch', 1, 1, () => 15, 50, ['digger']),
  fortune: E('Fortune', 3, 2, lin(15, 9), 50, ['digger']),
  power: E('Power', 5, 10, lin(1, 10), 15, ['bow']),
  punch: E('Punch', 2, 2, lin(12, 20), 25, ['bow']),
  flame: E('Flame', 1, 2, () => 20, 30, ['bow']),
  infinity: E('Infinity', 1, 1, () => 20, 30, ['bow']),
  unbreaking: E('Unbreaking', 3, 5, lin(5, 8), 50, ['any']),
  mending: E('Mending', 1, 2, () => 25, 50, ['any'], true), // only from trading (and anvils)
  lure: E('Lure', 3, 2, lin(15, 9), 50, ['fishing_rod']),
  luck_of_the_sea: E('Luck of the Sea', 3, 2, lin(15, 9), 50, ['fishing_rod']),
};
const CONFLICTS = [
  ['protection', 'fire_protection', 'blast_protection', 'projectile_protection'],
  ['sharpness', 'smite', 'bane_of_arthropods'],
  ['silk_touch', 'fortune'],
  ['infinity', 'mending'],
];
export const conflicts = (a, b) => a !== b && CONFLICTS.some((g) => g.includes(a) && g.includes(b));

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
export const enchantName = (name, level) => `${ENCHANTS[name]?.label ?? name}${ENCHANTS[name]?.max > 1 ? ' ' + ROMAN[level] : ''}`;

// What kinds of enchantment an item can take: e.g. ['sword', 'any'].
function kindsOf(id) {
  if (id === ITEM.BOOK || id === ITEM.ENCHANTED_BOOK) return null; // books take anything
  const tool = toolOf(id), armor = armorOf(id);
  if (armor) return ['armor', ['helmet', 'chestplate', 'leggings', 'boots'][armor.slot], 'any'];
  if (!tool) return [];
  if (tool.kind === 'sword') return ['sword', 'any'];
  if (tool.kind === 'axe') return ['axe', 'digger', 'any'];
  if (tool.kind === 'pickaxe' || tool.kind === 'shovel' || tool.kind === 'hoe') return ['digger', 'any'];
  if (tool.kind === 'bow') return ['bow', 'any'];
  if (tool.kind === 'fishing_rod') return ['fishing_rod', 'any'];
  if (tool.kind === 'shears' || tool.kind === 'lighter') return ['any'];
  return [];
}
export function canApply(name, id) {
  const kinds = kindsOf(id);
  return kinds === null || ENCHANTS[name].kinds.some((k) => kinds.includes(k));
}
export const isEnchantable = (id) => id === ITEM.BOOK || (kindsOf(id)?.length ?? 0) > 1;

// How well an item takes enchantments, like Minecraft (gold is best).
export function enchantability(id) {
  if (id === ITEM.BOOK) return 1;
  const armor = armorOf(id);
  if (armor) return { leather: 15, iron: 9, gold: 25, diamond: 10 }[armor.material] ?? 1;
  const tool = toolOf(id);
  if (!tool) return 0;
  if (tool.kind === 'bow' || tool.kind === 'fishing_rod') return 1;
  return [15, 5, 14, 10][tool.tier] ?? 1; // wood, stone, iron, diamond
}

// Enchantments (by power level) an item could get at the table: [{name, level, weight}].
function candidates(id, power, treasure = false) {
  const out = [];
  for (const [name, e] of Object.entries(ENCHANTS)) {
    if ((e.treasure && !treasure) || !canApply(name, id)) continue;
    for (let l = e.max; l >= 1; l--) {
      const min = e.min(l);
      if (power >= min && power <= min + e.span) { out.push({ name, level: l, weight: e.weight }); break; }
    }
  }
  return out;
}
function weighted(list, rand) {
  let total = 0;
  for (const c of list) total += c.weight;
  let r = rand() * total;
  for (const c of list) { r -= c.weight; if (r < 0) return c; }
  return list[list.length - 1];
}

// The enchantments the table gives for a level cost (Minecraft's algorithm).
export function rollEnchants(id, cost, rand) {
  const ea = enchantability(id);
  if (!ea) return {};
  let power = cost + 1 + Math.floor(rand() * (Math.floor(ea / 4) + 1)) + Math.floor(rand() * (Math.floor(ea / 4) + 1));
  power = Math.max(1, Math.round(power * (1 + (rand() + rand() - 1) * 0.15)));
  let pool = candidates(id, power);
  const out = {};
  if (!pool.length) return out;
  let pick = weighted(pool, rand);
  out[pick.name] = pick.level;
  while (rand() < (power + 1) / 50) {
    pool = pool.filter((c) => c.name !== pick.name && !Object.keys(out).some((n) => conflicts(n, c.name)));
    if (!pool.length) break;
    pick = weighted(pool, rand);
    out[pick.name] = pick.level;
    power = Math.floor(power / 2);
  }
  return out;
}

// The table's three offers for an item, given the bookshelves around it (0-15) and the
// player's enchanting seed: [{cost (levels needed), lapis, ench, hint}].
export function tableOffers(id, shelves, seed) {
  if (!isEnchantable(id) || !enchantability(id)) return [];
  const rand = mulberry32(seed >>> 0);
  const b = Math.min(15, shelves);
  const base = 1 + Math.floor(rand() * 8) + Math.floor(b / 2) + Math.floor(rand() * (b + 1));
  const costs = [Math.max(Math.floor(base / 3), 1), Math.floor((base * 2) / 3) + 1, Math.max(base, b * 2)];
  return costs.map((cost, i) => {
    const r = mulberry32((seed + i * 7919) >>> 0);
    let ench = rollEnchants(id, cost, r);
    if (id === ITEM.BOOK && Object.keys(ench).length > 1) {
      // books lose one of their enchantments, like Minecraft
      const names = Object.keys(ench);
      delete ench[names[Math.floor(r() * names.length)]];
    }
    const first = Object.entries(ench)[0];
    return { cost, lapis: i + 1, levels: i + 1, ench, hint: first ? enchantName(first[0], first[1]) : null };
  }).filter((o) => o.hint);
}

// ---------- anvils ----------
const RARITY_COST = (name) => ({ 10: 1, 5: 2, 2: 4, 1: 8 }[ENCHANTS[name].weight] ?? 1);

// Combines `left` with `right` (the same item, an enchanted book, or repair material).
// Returns {result, cost, used (how many of right are used up)} or null if they don't combine.
export function anvilCombine(left, right) {
  if (!left || !right) return null;
  const result = { ...left, ench: { ...(left.ench || {}) } };
  let cost = 0, used = 1;
  const max = ITEMS[left.id]?.tool?.durability ?? ITEMS[left.id]?.armor?.durability;
  const repairMat = REPAIR[left.id];
  if (repairMat !== undefined && right.id === repairMat && max && left.dur < max) {
    // each unit of material fixes a quarter
    used = 0;
    while (used < right.count && result.dur < max) { result.dur = Math.min(max, result.dur + Math.ceil(max / 4)); used++; cost++; }
  } else if (right.id === left.id || right.id === ITEM.ENCHANTED_BOOK) {
    const book = right.id === ITEM.ENCHANTED_BOOK;
    if (!book && max && right.dur !== undefined) {
      const fixed = Math.min(max, left.dur + right.dur + Math.floor(max * 0.12));
      if (fixed > left.dur) { result.dur = fixed; cost += 2; }
    }
    for (const [name, level] of Object.entries(right.ench || {})) {
      if (!canApply(name, left.id)) continue;
      if (Object.keys(result.ench).some((n) => conflicts(n, name))) { cost += 1; continue; }
      const cur = result.ench[name] || 0;
      const lvl = cur === level ? Math.min(ENCHANTS[name].max, level + 1) : Math.max(cur, level);
      result.ench[name] = lvl;
      cost += lvl * Math.max(1, RARITY_COST(name) / (book ? 2 : 1));
    }
    if (cost === 0) return null;
  } else return null;
  // prior work: each anvil use makes the next one dearer
  const penalty = (2 ** (left.rc || 0) - 1) + (2 ** (right.rc || 0) - 1);
  cost += penalty;
  result.rc = Math.max(left.rc || 0, right.rc || 0) + 1;
  if (!Object.keys(result.ench).length) delete result.ench;
  return { result, cost, used };
}
const REPAIR = {};
for (const [id, it] of Object.entries(ITEMS)) {
  const t = it.tool, a = it.armor;
  if (t && ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'].includes(t.kind)) {
    REPAIR[id] = [BLOCK.PLANKS, BLOCK.COBBLE, ITEM.IRON_INGOT, ITEM.DIAMOND][t.tier];
  }
  if (a) REPAIR[id] = { leather: ITEM.LEATHER, iron: ITEM.IRON_INGOT, gold: ITEM.GOLD_INGOT, diamond: ITEM.DIAMOND }[a.material];
}

// Grindstone: takes off every enchantment and gives some experience back.
export function grind(stack) {
  if (!stack?.ench) return null;
  let xp = 0;
  for (const [name, level] of Object.entries(stack.ench)) xp += ENCHANTS[name] ? ENCHANTS[name].min(level) : 0;
  const result = { ...stack };
  delete result.ench;
  delete result.rc;
  if (result.id === ITEM.ENCHANTED_BOOK) result.id = ITEM.BOOK;
  return { result, xp: Math.ceil(xp / 2) };
}

// ---------- effects ----------
export const level = (stack, name) => stack?.ench?.[name] || 0;

// Enchantment protection points from worn armor against a kind of damage
// ('fire', 'blast', 'projectile', 'fall' or other), capped at 20 like Minecraft (4% each).
export function protectionPoints(armor, kind) {
  let epf = 0;
  for (const s of armor || []) {
    if (!s?.ench) continue;
    epf += level(s, 'protection');
    if (kind === 'fire') epf += 2 * level(s, 'fire_protection');
    if (kind === 'blast') epf += 2 * level(s, 'blast_protection');
    if (kind === 'projectile') epf += 2 * level(s, 'projectile_protection');
    if (kind === 'fall') epf += 3 * level(s, 'feather_falling');
  }
  return Math.min(20, epf);
}

// Whether using an item with Unbreaking should wear it this time.
export function wears(stack, rand = Math.random, armor = false) {
  const u = level(stack, 'unbreaking');
  if (!u) return true;
  return armor ? rand() < 0.6 + 0.4 / (u + 1) : rand() < 1 / (u + 1);
}

// Checks an `ench` object from the network.
export function validEnch(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
  const entries = Object.entries(e);
  return entries.length > 0 && entries.length <= 12 && entries.every(([n, l]) => ENCHANTS[n] && Number.isInteger(l) && l >= 1 && l <= ENCHANTS[n].max);
}

// A random enchanted book, for librarians: {name: level}.
export function randomBook(rand, treasure = true) {
  const names = Object.keys(ENCHANTS).filter((n) => treasure || !ENCHANTS[n].treasure);
  const name = names[Math.floor(rand() * names.length)];
  return { [name]: 1 + Math.floor(rand() * ENCHANTS[name].max) };
}
