// Block and item definitions, shared by every part of the game.
// IDs are saved in worlds, so only ever append new entries; never reorder.

export const CHUNK = 16;    // chunk width/depth in blocks
export const HEIGHT = 96;   // world height in blocks
export const SEA_LEVEL = 30;
export const ITEM_BASE = 256; // ids below this are blocks, from here on items

export const BLOCK = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLE: 4, SAND: 5, GRAVEL: 6, LOG: 7, LEAVES: 8,
  PLANKS: 9, GLASS: 10, BEDROCK: 11, BRICK: 12, SNOWY_GRASS: 13, COAL_ORE: 14, IRON_ORE: 15,
  GOLD_ORE: 16, DIAMOND_ORE: 17, WATER: 18, BIRCH_LOG: 19, BIRCH_LEAVES: 20, BIRCH_PLANKS: 21,
  CRAFTING_TABLE: 22, FURNACE: 23, TORCH: 24, DANDELION: 25, POPPY: 26, TALL_GRASS: 27,
  SANDSTONE: 28, WOOL: 29, STONE_BRICKS: 30, OBSIDIAN: 31, CLAY: 32, SNOW: 33,
};

// Block properties (defaults filled in below):
//  tex        [top, side, bottom, sideX?] texture names; sideX is used for the +-x faces
//  render     'cube' | 'cross' (plants, torches) | 'water' | 'none'
//  solid      players and mobs collide with it
//  transparent  light passes through and neighbouring faces are drawn
//  lightFilter  extra light lost when passing through (leaves, water)
//  emit       light level it gives off (0-15)
//  hardness   Minecraft-style hardness (seconds to break by hand is roughly hardness * 1.5)
//  tool       tool that breaks it fastest: 'pickaxe' | 'axe' | 'shovel'
//  needsTier  minimum tool tier (0 wood, 1 stone, 2 iron, 3 diamond) to get a drop
//  gravity    falls when the block below is removed (sand, gravel)
//  replaceable  placing a block here replaces it (water, tall grass)
//  needsSupport breaks when the block underneath disappears (plants, torches)
const B = [];
function def(id, name, props) {
  B[id] = { name, ...props };
}
def(0, 'Air', { render: 'none', solid: false, transparent: true, replaceable: true, hardness: 0 });
def(1, 'Grass Block', { tex: ['grass_top', 'grass_side', 'dirt'], hardness: 0.6, tool: 'shovel' });
def(2, 'Dirt', { tex: ['dirt'], hardness: 0.5, tool: 'shovel' });
def(3, 'Stone', { tex: ['stone'], hardness: 1.5, tool: 'pickaxe', needsTier: 0 });
def(4, 'Cobblestone', { tex: ['cobble'], hardness: 2, tool: 'pickaxe', needsTier: 0 });
def(5, 'Sand', { tex: ['sand'], hardness: 0.5, tool: 'shovel', gravity: true });
def(6, 'Gravel', { tex: ['gravel'], hardness: 0.6, tool: 'shovel', gravity: true });
def(7, 'Oak Log', { tex: ['log_top', 'log_side', 'log_top'], hardness: 2, tool: 'axe' });
def(8, 'Oak Leaves', { tex: ['leaves'], hardness: 0.2, transparent: true, lightFilter: 1 });
def(9, 'Oak Planks', { tex: ['planks'], hardness: 2, tool: 'axe' });
def(10, 'Glass', { tex: ['glass'], hardness: 0.3, transparent: true, cullSame: true });
def(11, 'Bedrock', { tex: ['bedrock'], hardness: Infinity });
def(12, 'Bricks', { tex: ['brick'], hardness: 2, tool: 'pickaxe', needsTier: 0 });
def(13, 'Snowy Grass', { tex: ['snow', 'snow_side', 'dirt'], hardness: 0.6, tool: 'shovel' });
def(14, 'Coal Ore', { tex: ['coal_ore'], hardness: 3, tool: 'pickaxe', needsTier: 0 });
def(15, 'Iron Ore', { tex: ['iron_ore'], hardness: 3, tool: 'pickaxe', needsTier: 1 });
def(16, 'Gold Ore', { tex: ['gold_ore'], hardness: 3, tool: 'pickaxe', needsTier: 2 });
def(17, 'Diamond Ore', { tex: ['diamond_ore'], hardness: 3, tool: 'pickaxe', needsTier: 2 });
def(18, 'Water', { tex: ['water'], render: 'water', solid: false, transparent: true, lightFilter: 2, replaceable: true, hardness: Infinity });
def(19, 'Birch Log', { tex: ['birch_log_top', 'birch_log_side', 'birch_log_top'], hardness: 2, tool: 'axe' });
def(20, 'Birch Leaves', { tex: ['birch_leaves'], hardness: 0.2, transparent: true, lightFilter: 1 });
def(21, 'Birch Planks', { tex: ['birch_planks'], hardness: 2, tool: 'axe' });
def(22, 'Crafting Table', { tex: ['table_top', 'table_side', 'planks', 'table_front'], hardness: 2.5, tool: 'axe' });
def(23, 'Furnace', { tex: ['furnace_top', 'furnace_side', 'furnace_top', 'furnace_front'], hardness: 3.5, tool: 'pickaxe', needsTier: 0 });
def(24, 'Torch', { tex: ['torch'], render: 'cross', solid: false, transparent: true, emit: 14, hardness: 0, needsSupport: true });
def(25, 'Dandelion', { tex: ['dandelion'], render: 'cross', solid: false, transparent: true, hardness: 0, needsSupport: true, replaceable: false });
def(26, 'Poppy', { tex: ['poppy'], render: 'cross', solid: false, transparent: true, hardness: 0, needsSupport: true });
def(27, 'Tall Grass', { tex: ['tall_grass'], render: 'cross', solid: false, transparent: true, hardness: 0, needsSupport: true, replaceable: true });
def(28, 'Sandstone', { tex: ['sandstone_top', 'sandstone_side', 'sandstone_top'], hardness: 0.8, tool: 'pickaxe', needsTier: 0 });
def(29, 'White Wool', { tex: ['wool'], hardness: 0.8 });
def(30, 'Stone Bricks', { tex: ['stone_bricks'], hardness: 1.5, tool: 'pickaxe', needsTier: 0 });
def(31, 'Obsidian', { tex: ['obsidian'], hardness: 50, tool: 'pickaxe', needsTier: 3 });
def(32, 'Clay', { tex: ['clay'], hardness: 0.6, tool: 'shovel' });
def(33, 'Snow Block', { tex: ['snow'], hardness: 0.2, tool: 'shovel' });

for (const b of B) {
  b.render ??= 'cube';
  b.solid ??= b.render === 'cube';
  b.transparent = !!b.transparent;
  b.lightFilter ??= 0;
  b.emit ??= 0;
  b.cullSame = !!b.cullSame;
  if (b.tex) {
    const [top, side = top, bottom = top, sideX = side] = b.tex;
    b.tex = [top, side, bottom, sideX];
  }
}
export const BLOCKS = B;

// ---------- items ----------
export const ITEM = {
  STICK: 256, COAL: 257, RAW_IRON: 258, IRON_INGOT: 259, RAW_GOLD: 260, GOLD_INGOT: 261, DIAMOND: 262,
  WOODEN_PICKAXE: 263, WOODEN_AXE: 264, WOODEN_SHOVEL: 265, WOODEN_SWORD: 266,
  STONE_PICKAXE: 267, STONE_AXE: 268, STONE_SHOVEL: 269, STONE_SWORD: 270,
  IRON_PICKAXE: 271, IRON_AXE: 272, IRON_SHOVEL: 273, IRON_SWORD: 274,
  DIAMOND_PICKAXE: 275, DIAMOND_AXE: 276, DIAMOND_SHOVEL: 277, DIAMOND_SWORD: 278,
  APPLE: 279, RAW_PORKCHOP: 280, COOKED_PORKCHOP: 281, RAW_BEEF: 282, STEAK: 283, ROTTEN_FLESH: 284,
  BREAD: 285, LEATHER: 286,
};

// tool: {kind, tier, speed, damage, durability}; food: hunger points restored
const I = {};
function item(id, name, props = {}) {
  I[id] = { name, stack: 64, ...props };
}
item(256, 'Stick', { icon: 'stick' });
item(257, 'Coal', { icon: 'coal' });
item(258, 'Raw Iron', { icon: 'raw_iron' });
item(259, 'Iron Ingot', { icon: 'iron_ingot' });
item(260, 'Raw Gold', { icon: 'raw_gold' });
item(261, 'Gold Ingot', { icon: 'gold_ingot' });
item(262, 'Diamond', { icon: 'diamond' });
const MATERIALS = [
  ['Wooden', 'wood', 0, 2, 59],
  ['Stone', 'stone', 1, 4, 131],
  ['Iron', 'iron', 2, 6, 250],
  ['Diamond', 'diamond', 3, 8, 1561],
];
const TOOL_KINDS = [['Pickaxe', 'pickaxe', 2], ['Axe', 'axe', 3], ['Shovel', 'shovel', 1.5], ['Sword', 'sword', 4]];
MATERIALS.forEach(([matName, mat, tier, speed, durability], m) => {
  TOOL_KINDS.forEach(([kindName, kind, baseDamage], k) => {
    item(263 + m * 4 + k, `${matName} ${kindName}`, {
      icon: `${mat}_${kind}`, stack: 1,
      tool: { kind, tier, speed, damage: baseDamage + tier, durability },
    });
  });
});
item(279, 'Apple', { icon: 'apple', food: 4 });
item(280, 'Raw Porkchop', { icon: 'raw_porkchop', food: 3 });
item(281, 'Cooked Porkchop', { icon: 'cooked_porkchop', food: 8 });
item(282, 'Raw Beef', { icon: 'raw_beef', food: 3 });
item(283, 'Steak', { icon: 'steak', food: 8 });
item(284, 'Rotten Flesh', { icon: 'rotten_flesh', food: 2 });
item(285, 'Bread', { icon: 'bread', food: 5 });
item(286, 'Leather', { icon: 'leather' });
export const ITEMS = I;

export function isBlockId(id) {
  return id > 0 && id < ITEM_BASE && !!BLOCKS[id];
}

export function isValidId(id) {
  return Number.isInteger(id) && (isBlockId(id) || !!ITEMS[id]);
}

export function itemName(id) {
  return isBlockId(id) ? BLOCKS[id].name : ITEMS[id]?.name ?? 'Unknown';
}

export function maxStack(id) {
  return isBlockId(id) ? 64 : ITEMS[id]?.stack ?? 64;
}

export function toolOf(id) {
  return ITEMS[id]?.tool ?? null;
}

export function isSolid(id) {
  return BLOCKS[id].solid;
}

export function isTransparent(id) {
  return BLOCKS[id].transparent;
}

// Blocks a player can place from the creative inventory.
export const CREATIVE_BLOCKS = B.map((_, id) => id).filter(
  (id) => id !== BLOCK.AIR && id !== BLOCK.BEDROCK && id !== BLOCK.WATER,
).concat([BLOCK.WATER]);
export const CREATIVE_ITEMS = Object.keys(I).map(Number);

// Seconds to break a block with the given held item (Minecraft's formula, simplified).
export function breakTime(blockId, heldId) {
  const b = BLOCKS[blockId];
  if (b.hardness === 0) return 0;
  if (!Number.isFinite(b.hardness)) return Infinity;
  const tool = toolOf(heldId);
  const rightTool = tool && b.tool && tool.kind === b.tool;
  const speed = rightTool ? tool.speed : 1;
  const canHarvest = b.needsTier === undefined || (rightTool && tool.tier >= b.needsTier);
  return (b.hardness * (canHarvest ? 1.5 : 5)) / speed;
}

// What a block drops when broken with the given item. rand() -> [0, 1)
export function getDrops(blockId, heldId, rand = Math.random) {
  const b = BLOCKS[blockId];
  const tool = toolOf(heldId);
  if (b.needsTier !== undefined && !(tool && tool.kind === b.tool && tool.tier >= b.needsTier)) return [];
  switch (blockId) {
    case BLOCK.GRASS:
    case BLOCK.SNOWY_GRASS: return [[BLOCK.DIRT, 1]];
    case BLOCK.STONE: return [[BLOCK.COBBLE, 1]];
    case BLOCK.COAL_ORE: return [[ITEM.COAL, 1]];
    case BLOCK.IRON_ORE: return [[ITEM.RAW_IRON, 1]];
    case BLOCK.GOLD_ORE: return [[ITEM.RAW_GOLD, 1]];
    case BLOCK.DIAMOND_ORE: return [[ITEM.DIAMOND, 1]];
    case BLOCK.LEAVES: return rand() < 0.05 ? [[ITEM.APPLE, 1]] : [];
    case BLOCK.BIRCH_LEAVES:
    case BLOCK.GLASS:
    case BLOCK.TALL_GRASS:
    case BLOCK.WATER:
    case BLOCK.BEDROCK: return [];
    case BLOCK.CLAY: return [[BLOCK.CLAY, 1]];
    case BLOCK.SNOW: return [[BLOCK.SNOW, 1]];
    default: return [[blockId, 1]];
  }
}

// Furnace recipes: input -> output, and how many items a fuel smelts.
export const SMELTING = {
  [ITEM.RAW_IRON]: ITEM.IRON_INGOT,
  [ITEM.RAW_GOLD]: ITEM.GOLD_INGOT,
  [BLOCK.SAND]: BLOCK.GLASS,
  [BLOCK.COBBLE]: BLOCK.STONE,
  [ITEM.RAW_PORKCHOP]: ITEM.COOKED_PORKCHOP,
  [ITEM.RAW_BEEF]: ITEM.STEAK,
  [BLOCK.LOG]: ITEM.COAL,
  [BLOCK.BIRCH_LOG]: ITEM.COAL,
  [BLOCK.CLAY]: BLOCK.BRICK,
};
export const FUEL = {
  [ITEM.COAL]: 8,
  [BLOCK.LOG]: 1.5,
  [BLOCK.BIRCH_LOG]: 1.5,
  [BLOCK.PLANKS]: 1.5,
  [BLOCK.BIRCH_PLANKS]: 1.5,
  [BLOCK.CRAFTING_TABLE]: 1.5,
  [ITEM.STICK]: 0.5,
};
for (const id of Object.keys(I).map(Number)) {
  if (I[id].tool && I[id].tool.tier === 0) FUEL[id] = 1;
}
export const SMELT_SECONDS = 10;
