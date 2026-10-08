// Where each block texture sits in the 16x16-tile atlas. Pure data, so the
// mesh worker can compute texture coordinates without drawing anything.

export const TILE = 16;      // pixels per tile
export const ATLAS_TILES = 16; // tiles per row/column

export const TILE_NAMES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'cobble', 'sand', 'gravel', 'log_top',
  'log_side', 'leaves', 'planks', 'glass', 'bedrock', 'brick', 'snow', 'snow_side',
  'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'water', 'birch_log_top', 'birch_log_side', 'birch_leaves',
  'birch_planks', 'table_top', 'table_side', 'table_front', 'furnace_top', 'furnace_side', 'furnace_front', 'torch',
  'dandelion', 'poppy', 'tall_grass', 'sandstone_top', 'sandstone_side', 'wool', 'stone_bricks', 'obsidian',
  'clay', 'deepslate', 'deepslate_top', 'cobbled_deepslate', 'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_gold_ore',
  'deepslate_diamond_ore', 'copper_ore', 'deepslate_copper_ore', 'granite', 'diorite', 'andesite', 'cherry_log_top', 'cherry_log_side',
  'cherry_leaves', 'cherry_planks', 'chest_top', 'chest_side', 'chest_front', 'bed_top', 'bed_side', 'copper_block',
  'spruce_log_top', 'spruce_log_side', 'spruce_leaves', 'spruce_planks', 'acacia_log_top', 'acacia_log_side', 'acacia_leaves', 'acacia_planks',
  'dark_oak_log_top', 'dark_oak_log_side', 'dark_oak_leaves', 'dark_oak_planks', 'jungle_log_top', 'jungle_log_side', 'jungle_leaves', 'jungle_planks',
  'cactus_top', 'cactus_side', 'dead_bush', 'sugar_cane', 'ice', 'lava', 'redstone_ore', 'deepslate_redstone_ore',
  'lapis_ore', 'deepslate_lapis_ore', 'emerald_ore', 'fern', 'cornflower',
  'farmland', 'wheat_0', 'wheat_1', 'wheat_2', 'wheat_3', 'wheat_4', 'wheat_5', 'wheat_6', 'wheat_7',
  'carrots_0', 'carrots_1', 'carrots_2', 'carrots_3', 'potatoes_0', 'potatoes_1', 'potatoes_2', 'potatoes_3',
  'door_top', 'door_bottom', 'ladder', 'smooth_stone', 'smooth_stone_slab_side',
  'redstone_dust_dot', 'redstone_dust_line', 'redstone_torch', 'redstone_torch_off', 'lever_handle', 'torch_tip_on', 'torch_tip_off',
  'repeater', 'redstone_lamp', 'redstone_lamp_on', 'redstone_block', 'tnt_top', 'tnt_side', 'tnt_bottom',
  'piston_side', 'piston_top', 'piston_bottom', 'piston_inner',
];

const INDEX = new Map(TILE_NAMES.map((name, i) => [name, i]));

export function tileIndex(name) {
  const i = INDEX.get(name);
  if (i === undefined) throw new Error('unknown texture ' + name);
  return i;
}

// Texture coordinates [u0, v0, u1, v1]; v goes up (the canvas is flipped when uploaded).
const UVS = new Map();
const inset = 0.02 / (ATLAS_TILES * TILE);
for (const [name, i] of INDEX) {
  const col = i % ATLAS_TILES;
  const row = Math.floor(i / ATLAS_TILES);
  UVS.set(name, [
    col / ATLAS_TILES + inset,
    1 - (row + 1) / ATLAS_TILES + inset,
    (col + 1) / ATLAS_TILES - inset,
    1 - row / ATLAS_TILES - inset,
  ]);
}

export function uvOf(name) {
  const uv = UVS.get(name);
  if (!uv) throw new Error('unknown texture ' + name);
  return uv;
}
