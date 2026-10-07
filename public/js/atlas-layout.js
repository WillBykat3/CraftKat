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
  'clay',
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
