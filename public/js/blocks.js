// Block definitions shared by the browser client and the server.

export const CHUNK = 16;   // chunk width/depth in blocks
export const HEIGHT = 64;  // world height in blocks

export const BLOCK = {
  AIR: 0,
  GRASS: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  LOG: 5,
  LEAVES: 6,
  PLANKS: 7,
  COBBLE: 8,
  GLASS: 9,
  BEDROCK: 10,
  BRICK: 11,
  SNOW: 12,
};

// tex: [top, side, bottom] texture names (see textures.js)
// transparent: neighbouring faces are drawn through this block
// cullSame: faces between two blocks of this type are hidden (glass)
export const BLOCKS = [
  { name: 'Air', solid: false, transparent: true },
  { name: 'Grass', tex: ['grass_top', 'grass_side', 'dirt'], solid: true },
  { name: 'Dirt', tex: ['dirt', 'dirt', 'dirt'], solid: true },
  { name: 'Stone', tex: ['stone', 'stone', 'stone'], solid: true },
  { name: 'Sand', tex: ['sand', 'sand', 'sand'], solid: true },
  { name: 'Log', tex: ['log_top', 'log_side', 'log_top'], solid: true },
  { name: 'Leaves', tex: ['leaves', 'leaves', 'leaves'], solid: true, transparent: true },
  { name: 'Planks', tex: ['planks', 'planks', 'planks'], solid: true },
  { name: 'Cobblestone', tex: ['cobble', 'cobble', 'cobble'], solid: true },
  { name: 'Glass', tex: ['glass', 'glass', 'glass'], solid: true, transparent: true, cullSame: true },
  { name: 'Bedrock', tex: ['bedrock', 'bedrock', 'bedrock'], solid: true },
  { name: 'Brick', tex: ['brick', 'brick', 'brick'], solid: true },
  { name: 'Snow', tex: ['snow', 'snow_side', 'dirt'], solid: true },
];

// Blocks players may place (everything except air and bedrock).
export const PLACEABLE = BLOCKS.map((_, id) => id).filter(
  (id) => id !== BLOCK.AIR && id !== BLOCK.BEDROCK,
);

export const DEFAULT_HOTBAR = [
  BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE, BLOCK.COBBLE, BLOCK.PLANKS,
  BLOCK.LOG, BLOCK.GLASS, BLOCK.BRICK, BLOCK.SAND,
];

export function isSolid(id) {
  return BLOCKS[id].solid;
}

export function isTransparent(id) {
  return !!BLOCKS[id].transparent;
}
