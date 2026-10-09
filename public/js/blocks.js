// Block and item definitions, shared by every part of the game.
// IDs are saved in worlds, so only ever append new entries; never reorder.

export const CHUNK = 16;    // chunk width/depth in blocks
export const HEIGHT = 256;  // world height in blocks (generator 3 shows y as -64..191)
export const SEA_LEVEL = 30; // sea level of generator versions 1-2; see World.seaLevel
export const ITEM_BASE = 256; // ids below this are blocks, from here on items (up to 999)
export const HIGH_BLOCKS = 1000; // later blocks: ids 1000 to MAX_BLOCK - 1 (chunks store 16-bit ids)
export const MAX_BLOCK = 4096;
const ITEM_NETHER_WART = 351; // (ITEM is defined below)
import { COLORS, COLOR_NAMES } from './colors.js';

export const BLOCK = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, COBBLE: 4, SAND: 5, GRAVEL: 6, LOG: 7, LEAVES: 8,
  PLANKS: 9, GLASS: 10, BEDROCK: 11, BRICK: 12, SNOWY_GRASS: 13, COAL_ORE: 14, IRON_ORE: 15,
  GOLD_ORE: 16, DIAMOND_ORE: 17, WATER: 18, BIRCH_LOG: 19, BIRCH_LEAVES: 20, BIRCH_PLANKS: 21,
  CRAFTING_TABLE: 22, FURNACE: 23, TORCH: 24, DANDELION: 25, POPPY: 26, TALL_GRASS: 27,
  SANDSTONE: 28, WOOL: 29, STONE_BRICKS: 30, OBSIDIAN: 31, CLAY: 32, SNOW: 33,
  DEEPSLATE: 34, COBBLED_DEEPSLATE: 35, DEEPSLATE_COAL_ORE: 36, DEEPSLATE_IRON_ORE: 37,
  DEEPSLATE_GOLD_ORE: 38, DEEPSLATE_DIAMOND_ORE: 39, COPPER_ORE: 40, DEEPSLATE_COPPER_ORE: 41,
  GRANITE: 42, DIORITE: 43, ANDESITE: 44, CHERRY_LOG: 45, CHERRY_LEAVES: 46, CHERRY_PLANKS: 47,
  CHEST: 48, BED: 49, COPPER_BLOCK: 50,
  SPRUCE_LOG: 51, SPRUCE_LEAVES: 52, SPRUCE_PLANKS: 53, ACACIA_LOG: 54, ACACIA_LEAVES: 55, ACACIA_PLANKS: 56,
  DARK_OAK_LOG: 57, DARK_OAK_LEAVES: 58, DARK_OAK_PLANKS: 59, JUNGLE_LOG: 60, JUNGLE_LEAVES: 61, JUNGLE_PLANKS: 62,
  CACTUS: 63, DEAD_BUSH: 64, SUGAR_CANE: 65, ICE: 66, LAVA: 67, REDSTONE_ORE: 68, DEEPSLATE_REDSTONE_ORE: 69,
  LAPIS_ORE: 70, DEEPSLATE_LAPIS_ORE: 71, EMERALD_ORE: 72, FERN: 73, CORNFLOWER: 74,
  FARMLAND: 75, WHEAT: 76, CARROTS: 84, POTATOES: 88, OAK_DOOR: 92, LADDER: 108, OAK_FENCE: 112,
  OAK_SLAB: 113, COBBLESTONE_SLAB: 114, STONE_SLAB: 115, OAK_STAIRS: 116, COBBLESTONE_STAIRS: 120,
  REDSTONE_WIRE: 124, REDSTONE_TORCH: 128, LEVER: 138, STONE_BUTTON: 148, STONE_PRESSURE_PLATE: 158,
  OAK_PRESSURE_PLATE: 160, REPEATER: 162, REDSTONE_LAMP: 194, REDSTONE_BLOCK: 196, TNT: 197,
  PISTON: 198, STICKY_PISTON: 210, PISTON_HEAD: 222,
  NETHERRACK: 234, NETHER_QUARTZ_ORE: 235, SOUL_SAND: 236, GLOWSTONE: 237, NETHER_BRICKS: 238, NETHER_PORTAL: 239,
  MAGMA_BLOCK: 241, NETHER_GOLD_ORE: 242, BASALT: 243, END_STONE: 244, END_PORTAL_FRAME: 245, END_PORTAL: 247,
  DRAGON_EGG: 248, NETHER_BRICK_FENCE: 249, MOSSY_STONE_BRICKS: 250, CRACKED_STONE_BRICKS: 251,
  // ids from 1000 on (see HIGH_BLOCKS)
  WATER_FLOW: 1000, FALLING_WATER: 1008, LAVA_FLOW: 1010, FALLING_LAVA: 1018, FIRE: 1020,
  DIRT_PATH: 1030, HAY_BALE: 1031, BOOKSHELF: 1032, COMPOSTER: 1033, LECTERN: 1034, BLAST_FURNACE: 1035, SMOKER: 1036,
  SMITHING_TABLE: 1037, GRINDSTONE: 1038, FLETCHING_TABLE: 1039, LOOM: 1040, CARTOGRAPHY_TABLE: 1041, STONECUTTER: 1042,
  CAULDRON: 1043, BARREL: 1044, BELL: 1045,
  ENCHANTING_TABLE: 1046, ANVIL: 1047, CHIPPED_ANVIL: 1048, DAMAGED_ANVIL: 1049,
  IRON_BLOCK: 1050, GOLD_BLOCK: 1051, DIAMOND_BLOCK: 1052, EMERALD_BLOCK: 1053, LAPIS_BLOCK: 1054, COAL_BLOCK: 1055,
  BREWING_STAND: 1056, NETHER_WART: 1060, BROWN_MUSHROOM: 1064, RED_MUSHROOM: 1065, MELON: 1066, SLIME_BLOCK: 1067,
  STAINED_GLASS: 1085, TERRACOTTA: 1101, // (coloured wool is 1069 + colour, stained glass and terracotta 1085 / 1102 + colour)
};
//   NETHER_PORTAL + axis (0: the portal runs along x, 1: along z);  END_PORTAL_FRAME + (has an eye ? 1 : 0)
// Blocks with variants take a run of ids:
//   WHEAT + stage (0-7), CARROTS / POTATOES + stage (0-3)
//   OAK_DOOR + (upper ? 8 : 0) + (open ? 4 : 0) + facing
//   LADDER, OAK_STAIRS, COBBLESTONE_STAIRS + facing
//   REDSTONE_WIRE + brightness (0 off, 1-3 dim to bright; the host keeps the exact power 0-15)
//   REDSTONE_TORCH, LEVER, STONE_BUTTON + (on ? 5 : 0) + attach (0 on the floor, 1-4 on a wall facing 0-3)
//   STONE_PRESSURE_PLATE, OAK_PRESSURE_PLATE + (pressed ? 1 : 0)
//   REPEATER + (powered ? 16 : 0) + (delay - 1) * 4 + facing (the way the signal goes)
//   REDSTONE_LAMP + (lit ? 1 : 0)
//   PISTON, STICKY_PISTON + (extended ? 6 : 0) + facing6;  PISTON_HEAD + (sticky ? 6 : 0) + facing6
// facing: 0 north (-z), 1 east (+x), 2 south (+z), 3 west (-x); facing6 adds 4 up, 5 down
export const FACING = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
export const FACING6 = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];

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
//  height     visual height of a partial cube (beds); collision is still a full block
//  tint       'grass' | 'foliage' | 'water': coloured by the biome (only pixels marked as tintable in the texture)
//  translucent  drawn see-through with the water (ice)
//  shape      'slab' | 'stairs' | 'door' | 'ladder' | 'fence' | 'farmland' | 'bed': not a full cube (see shapes.js)
//  facing, open, upper   variant details for shaped blocks
//  item       what the block drops / is picked as (variants share one), defaults to itself
//  hidden     a variant that isn't listed in the creative inventory
//  crop       {kind, stage, max} for growing plants
//  climbable  ladders
//  liquid     'water' | 'lava'
const B = [];
function def(id, name, props) {
  B[id] = { name, ...props };
}
def(0, 'Air', { render: 'none', solid: false, transparent: true, replaceable: true, hardness: 0 });
def(1, 'Grass Block', { tex: ['grass_top', 'grass_side', 'dirt'], hardness: 0.6, tool: 'shovel', tint: 'grass' });
def(2, 'Dirt', { tex: ['dirt'], hardness: 0.5, tool: 'shovel' });
def(3, 'Stone', { tex: ['stone'], hardness: 1.5, tool: 'pickaxe', needsTier: 0 });
def(4, 'Cobblestone', { tex: ['cobble'], hardness: 2, tool: 'pickaxe', needsTier: 0 });
def(5, 'Sand', { tex: ['sand'], hardness: 0.5, tool: 'shovel', gravity: true });
def(6, 'Gravel', { tex: ['gravel'], hardness: 0.6, tool: 'shovel', gravity: true });
def(7, 'Oak Log', { tex: ['log_top', 'log_side', 'log_top'], hardness: 2, tool: 'axe' });
def(8, 'Oak Leaves', { tex: ['leaves'], hardness: 0.2, transparent: true, lightFilter: 1, tint: 'foliage' });
def(9, 'Oak Planks', { tex: ['planks'], hardness: 2, tool: 'axe' });
def(10, 'Glass', { tex: ['glass'], hardness: 0.3, transparent: true, cullSame: true });
def(11, 'Bedrock', { tex: ['bedrock'], hardness: Infinity });
def(12, 'Bricks', { tex: ['brick'], hardness: 2, tool: 'pickaxe', needsTier: 0 });
def(13, 'Snowy Grass', { tex: ['snow', 'snow_side', 'dirt'], hardness: 0.6, tool: 'shovel' });
def(14, 'Coal Ore', { tex: ['coal_ore'], hardness: 3, tool: 'pickaxe', needsTier: 0 });
def(15, 'Iron Ore', { tex: ['iron_ore'], hardness: 3, tool: 'pickaxe', needsTier: 1 });
def(16, 'Gold Ore', { tex: ['gold_ore'], hardness: 3, tool: 'pickaxe', needsTier: 2 });
def(17, 'Diamond Ore', { tex: ['diamond_ore'], hardness: 3, tool: 'pickaxe', needsTier: 2 });
def(18, 'Water', { tex: ['water'], render: 'water', liquid: 'water', tint: 'water', solid: false, transparent: true, lightFilter: 2, replaceable: true, hardness: Infinity });
def(19, 'Birch Log', { tex: ['birch_log_top', 'birch_log_side', 'birch_log_top'], hardness: 2, tool: 'axe' });
def(20, 'Birch Leaves', { tex: ['birch_leaves'], hardness: 0.2, transparent: true, lightFilter: 1 });
def(21, 'Birch Planks', { tex: ['birch_planks'], hardness: 2, tool: 'axe' });
def(22, 'Crafting Table', { tex: ['table_top', 'table_side', 'planks', 'table_front'], hardness: 2.5, tool: 'axe' });
def(23, 'Furnace', { tex: ['furnace_top', 'furnace_side', 'furnace_top', 'furnace_front'], hardness: 3.5, tool: 'pickaxe', needsTier: 0 });
def(24, 'Torch', { tex: ['torch'], render: 'cross', solid: false, transparent: true, emit: 14, hardness: 0, needsSupport: true });
def(25, 'Dandelion', { tex: ['dandelion'], render: 'cross', solid: false, transparent: true, hardness: 0, needsSupport: true, replaceable: false });
def(26, 'Poppy', { tex: ['poppy'], render: 'cross', solid: false, transparent: true, hardness: 0, needsSupport: true });
def(27, 'Tall Grass', { tex: ['tall_grass'], render: 'cross', solid: false, transparent: true, hardness: 0, needsSupport: true, replaceable: true, tint: 'grass' });
def(28, 'Sandstone', { tex: ['sandstone_top', 'sandstone_side', 'sandstone_top'], hardness: 0.8, tool: 'pickaxe', needsTier: 0 });
def(29, 'White Wool', { tex: ['wool'], hardness: 0.8 });
def(30, 'Stone Bricks', { tex: ['stone_bricks'], hardness: 1.5, tool: 'pickaxe', needsTier: 0 });
def(31, 'Obsidian', { tex: ['obsidian'], hardness: 50, tool: 'pickaxe', needsTier: 3 });
def(32, 'Clay', { tex: ['clay'], hardness: 0.6, tool: 'shovel' });
def(33, 'Snow Block', { tex: ['snow'], hardness: 0.2, tool: 'shovel' });
def(34, 'Deepslate', { tex: ['deepslate_top', 'deepslate', 'deepslate_top'], hardness: 3, tool: 'pickaxe', needsTier: 0 });
def(35, 'Cobbled Deepslate', { tex: ['cobbled_deepslate'], hardness: 3.5, tool: 'pickaxe', needsTier: 0 });
def(36, 'Deepslate Coal Ore', { tex: ['deepslate_coal_ore'], hardness: 4.5, tool: 'pickaxe', needsTier: 0 });
def(37, 'Deepslate Iron Ore', { tex: ['deepslate_iron_ore'], hardness: 4.5, tool: 'pickaxe', needsTier: 1 });
def(38, 'Deepslate Gold Ore', { tex: ['deepslate_gold_ore'], hardness: 4.5, tool: 'pickaxe', needsTier: 2 });
def(39, 'Deepslate Diamond Ore', { tex: ['deepslate_diamond_ore'], hardness: 4.5, tool: 'pickaxe', needsTier: 2 });
def(40, 'Copper Ore', { tex: ['copper_ore'], hardness: 3, tool: 'pickaxe', needsTier: 1 });
def(41, 'Deepslate Copper Ore', { tex: ['deepslate_copper_ore'], hardness: 4.5, tool: 'pickaxe', needsTier: 1 });
def(42, 'Granite', { tex: ['granite'], hardness: 1.5, tool: 'pickaxe', needsTier: 0 });
def(43, 'Diorite', { tex: ['diorite'], hardness: 1.5, tool: 'pickaxe', needsTier: 0 });
def(44, 'Andesite', { tex: ['andesite'], hardness: 1.5, tool: 'pickaxe', needsTier: 0 });
def(45, 'Cherry Log', { tex: ['cherry_log_top', 'cherry_log_side', 'cherry_log_top'], hardness: 2, tool: 'axe' });
def(46, 'Cherry Leaves', { tex: ['cherry_leaves'], hardness: 0.2, transparent: true, lightFilter: 1 });
def(47, 'Cherry Planks', { tex: ['cherry_planks'], hardness: 2, tool: 'axe' });
def(48, 'Chest', { tex: ['chest_top', 'chest_side', 'chest_top', 'chest_front'], hardness: 2.5, tool: 'axe' });
def(49, 'Bed', { tex: ['bed_top', 'bed_side', 'planks'], hardness: 0.2, transparent: true, height: 9 / 16, shape: 'bed' });
def(50, 'Block of Copper', { tex: ['copper_block'], hardness: 3, tool: 'pickaxe', needsTier: 1 });
def(51, 'Spruce Log', { tex: ['spruce_log_top', 'spruce_log_side', 'spruce_log_top'], hardness: 2, tool: 'axe' });
def(52, 'Spruce Leaves', { tex: ['spruce_leaves'], hardness: 0.2, transparent: true, lightFilter: 1 });
def(53, 'Spruce Planks', { tex: ['spruce_planks'], hardness: 2, tool: 'axe' });
def(54, 'Acacia Log', { tex: ['acacia_log_top', 'acacia_log_side', 'acacia_log_top'], hardness: 2, tool: 'axe' });
def(55, 'Acacia Leaves', { tex: ['acacia_leaves'], hardness: 0.2, transparent: true, lightFilter: 1, tint: 'foliage' });
def(56, 'Acacia Planks', { tex: ['acacia_planks'], hardness: 2, tool: 'axe' });
def(57, 'Dark Oak Log', { tex: ['dark_oak_log_top', 'dark_oak_log_side', 'dark_oak_log_top'], hardness: 2, tool: 'axe' });
def(58, 'Dark Oak Leaves', { tex: ['dark_oak_leaves'], hardness: 0.2, transparent: true, lightFilter: 1, tint: 'foliage' });
def(59, 'Dark Oak Planks', { tex: ['dark_oak_planks'], hardness: 2, tool: 'axe' });
def(60, 'Jungle Log', { tex: ['jungle_log_top', 'jungle_log_side', 'jungle_log_top'], hardness: 2, tool: 'axe' });
def(61, 'Jungle Leaves', { tex: ['jungle_leaves'], hardness: 0.2, transparent: true, lightFilter: 1, tint: 'foliage' });
def(62, 'Jungle Planks', { tex: ['jungle_planks'], hardness: 2, tool: 'axe' });
def(63, 'Cactus', { tex: ['cactus_top', 'cactus_side', 'cactus_top'], hardness: 0.4, transparent: true, needsSupport: true });
def(64, 'Dead Bush', { tex: ['dead_bush'], render: 'cross', solid: false, transparent: true, hardness: 0, needsSupport: true, replaceable: true });
def(65, 'Sugar Cane', { tex: ['sugar_cane'], render: 'cross', solid: false, transparent: true, hardness: 0, needsSupport: true });
def(66, 'Ice', { tex: ['ice'], hardness: 0.5, tool: 'pickaxe', transparent: true, cullSame: true, translucent: true });
def(67, 'Lava', { tex: ['lava'], render: 'water', liquid: 'lava', solid: false, transparent: true, emit: 15, replaceable: true, hardness: Infinity });
def(68, 'Redstone Ore', { tex: ['redstone_ore'], hardness: 3, tool: 'pickaxe', needsTier: 2 });
def(69, 'Deepslate Redstone Ore', { tex: ['deepslate_redstone_ore'], hardness: 4.5, tool: 'pickaxe', needsTier: 2 });
def(70, 'Lapis Lazuli Ore', { tex: ['lapis_ore'], hardness: 3, tool: 'pickaxe', needsTier: 1 });
def(71, 'Deepslate Lapis Lazuli Ore', { tex: ['deepslate_lapis_ore'], hardness: 4.5, tool: 'pickaxe', needsTier: 1 });
def(72, 'Emerald Ore', { tex: ['emerald_ore'], hardness: 3, tool: 'pickaxe', needsTier: 2 });
def(73, 'Fern', { tex: ['fern'], render: 'cross', solid: false, transparent: true, hardness: 0, needsSupport: true, replaceable: true, tint: 'grass' });
def(74, 'Cornflower', { tex: ['cornflower'], render: 'cross', solid: false, transparent: true, hardness: 0, needsSupport: true });

def(75, 'Farmland', { tex: ['farmland', 'dirt', 'dirt'], hardness: 0.6, tool: 'shovel', transparent: true, shape: 'farmland' });
for (let i = 0; i < 8; i++) {
  def(76 + i, 'Wheat Crops', { tex: ['wheat_' + i], render: 'crop', solid: false, transparent: true, hardness: 0, needsSupport: true, hidden: i > 0, crop: { kind: 'wheat', stage: i, max: 7 } });
}
for (const [base, kind, name] of [[84, 'carrots', 'Carrots'], [88, 'potatoes', 'Potatoes']]) {
  for (let i = 0; i < 4; i++) {
    def(base + i, name, { tex: [`${kind}_${i}`], render: 'crop', solid: false, transparent: true, hardness: 0, needsSupport: true, hidden: i > 0, crop: { kind, stage: i, max: 3 } });
  }
}
for (let i = 0; i < 16; i++) {
  const upper = i >= 8, open = (i & 4) !== 0, facing = i & 3;
  def(92 + i, 'Oak Door', { tex: [upper ? 'door_top' : 'door_bottom'], hardness: 3, tool: 'axe', transparent: true, shape: 'door', upper, open, facing, hidden: true, needsSupport: true });
}
for (let f = 0; f < 4; f++) {
  def(108 + f, 'Ladder', { tex: ['ladder'], hardness: 0.4, tool: 'axe', transparent: true, shape: 'ladder', facing: f, climbable: true, hidden: f > 0, item: 108 });
}
def(112, 'Oak Fence', { tex: ['planks'], hardness: 2, tool: 'axe', transparent: true, shape: 'fence' });
def(113, 'Oak Slab', { tex: ['planks'], hardness: 2, tool: 'axe', transparent: true, shape: 'slab', full: 9 });
def(114, 'Cobblestone Slab', { tex: ['cobble'], hardness: 2, tool: 'pickaxe', needsTier: 0, transparent: true, shape: 'slab', full: 4 });
def(115, 'Stone Slab', { tex: ['smooth_stone', 'smooth_stone_slab_side', 'smooth_stone'], hardness: 2, tool: 'pickaxe', needsTier: 0, transparent: true, shape: 'slab', full: 3 });
for (let f = 0; f < 4; f++) {
  def(116 + f, 'Oak Stairs', { tex: ['planks'], hardness: 2, tool: 'axe', transparent: true, shape: 'stairs', facing: f, hidden: f > 0, item: 116 });
  def(120 + f, 'Cobblestone Stairs', { tex: ['cobble'], hardness: 2, tool: 'pickaxe', needsTier: 0, transparent: true, shape: 'stairs', facing: f, hidden: f > 0, item: 120 });
}

// ---------- redstone ----------
//  redstone   what part a block plays: 'wire' | 'torch' | 'lever' | 'button' | 'plate' | 'repeater'
//             | 'lamp' | 'block' | 'tnt' | 'piston' | 'head'
//  attach     0 floor, 1-4 wall (facing attach - 1): the block it hangs on is behind it
for (let i = 0; i < 4; i++) {
  def(124 + i, 'Redstone Dust', { tex: ['redstone_dust'], render: 'wire', solid: false, transparent: true, hardness: 0, needsSupport: true, hidden: true, redstone: 'wire', power: i, tint: 'redstone' });
}
for (let i = 0; i < 10; i++) {
  const on = i >= 5, attach = i % 5;
  def(128 + i, 'Redstone Torch', { tex: [on ? 'redstone_torch' : 'redstone_torch_off'], render: 'torch', solid: false, transparent: true, emit: on ? 7 : 0, hardness: 0, needsSupport: true, hidden: i !== 5, redstone: 'torch', on, attach, item: 133 });
  def(138 + i, 'Lever', { tex: ['cobble'], hardness: 0.5, transparent: true, shape: 'lever', solid: false, needsSupport: true, hidden: i !== 0, redstone: 'lever', on, attach, item: 138 });
  def(148 + i, 'Stone Button', { tex: ['stone'], hardness: 0.5, transparent: true, shape: 'button', solid: false, needsSupport: true, hidden: i !== 0, redstone: 'button', on, attach, item: 148 });
}
def(158, 'Stone Pressure Plate', { tex: ['stone'], hardness: 0.5, tool: 'pickaxe', transparent: true, shape: 'plate', solid: false, needsSupport: true, redstone: 'plate', on: false });
def(159, 'Stone Pressure Plate', { tex: ['stone'], hardness: 0.5, tool: 'pickaxe', transparent: true, shape: 'plate', solid: false, needsSupport: true, redstone: 'plate', on: true, hidden: true, item: 158 });
def(160, 'Oak Pressure Plate', { tex: ['planks'], hardness: 0.5, tool: 'axe', transparent: true, shape: 'plate', solid: false, needsSupport: true, redstone: 'plate', on: false, wooden: true });
def(161, 'Oak Pressure Plate', { tex: ['planks'], hardness: 0.5, tool: 'axe', transparent: true, shape: 'plate', solid: false, needsSupport: true, redstone: 'plate', on: true, wooden: true, hidden: true, item: 160 });
for (let i = 0; i < 32; i++) {
  def(162 + i, 'Redstone Repeater', { tex: ['repeater', 'smooth_stone_slab_side', 'smooth_stone'], hardness: 0, transparent: true, shape: 'repeater', needsSupport: true, hidden: i !== 0, redstone: 'repeater', on: i >= 16, delay: ((i >> 2) & 3) + 1, facing: i & 3, item: 162 });
}
def(194, 'Redstone Lamp', { tex: ['redstone_lamp'], hardness: 0.3, redstone: 'lamp', on: false });
def(195, 'Redstone Lamp', { tex: ['redstone_lamp_on'], hardness: 0.3, redstone: 'lamp', on: true, emit: 15, hidden: true, item: 194 });
def(196, 'Block of Redstone', { tex: ['redstone_block'], hardness: 5, tool: 'pickaxe', needsTier: 0, redstone: 'block' });
def(197, 'TNT', { tex: ['tnt_top', 'tnt_side', 'tnt_bottom'], hardness: 0, redstone: 'tnt' });
for (const [base, name, sticky] of [[198, 'Piston', false], [210, 'Sticky Piston', true]]) {
  for (let i = 0; i < 12; i++) {
    def(base + i, name, { tex: ['piston_side'], hardness: 1.5, transparent: i >= 6, shape: 'piston', redstone: 'piston', sticky, extended: i >= 6, facing6: i % 6, hidden: i !== 2, item: base + 2 });
  }
}
for (let i = 0; i < 12; i++) {
  def(222 + i, 'Piston Head', { tex: ['piston_top'], hardness: 1.5, transparent: true, shape: 'head', redstone: 'head', sticky: i >= 6, facing6: i % 6, hidden: true, item: 0 });
}

// ---------- the Nether and the End ----------
def(234, 'Netherrack', { tex: ['netherrack'], hardness: 0.4, tool: 'pickaxe', needsTier: 0 });
def(235, 'Nether Quartz Ore', { tex: ['nether_quartz_ore'], hardness: 3, tool: 'pickaxe', needsTier: 0 });
def(236, 'Soul Sand', { tex: ['soul_sand'], hardness: 0.5, tool: 'shovel', slow: 0.4 });
def(237, 'Glowstone', { tex: ['glowstone'], hardness: 0.3, emit: 15 });
def(238, 'Nether Bricks', { tex: ['nether_bricks'], hardness: 2, tool: 'pickaxe', needsTier: 0 });
for (let a = 0; a < 2; a++) {
  def(239 + a, 'Nether Portal', { tex: ['nether_portal'], hardness: Infinity, transparent: true, translucent: true, solid: false, shape: 'portal', axis: a, emit: 11, hidden: true, item: 0 });
}
def(241, 'Magma Block', { tex: ['magma'], hardness: 0.5, tool: 'pickaxe', needsTier: 0, emit: 3, hot: true });
def(242, 'Nether Gold Ore', { tex: ['nether_gold_ore'], hardness: 3, tool: 'pickaxe', needsTier: 0 });
def(243, 'Basalt', { tex: ['basalt_top', 'basalt_side', 'basalt_top'], hardness: 1.25, tool: 'pickaxe', needsTier: 0 });
def(244, 'End Stone', { tex: ['end_stone'], hardness: 3, tool: 'pickaxe', needsTier: 0 });
def(245, 'End Portal Frame', { tex: ['end_portal_frame_top', 'end_portal_frame_side', 'end_stone'], hardness: Infinity, transparent: true, shape: 'frame', eye: false });
def(246, 'End Portal Frame', { tex: ['end_portal_frame_top', 'end_portal_frame_side', 'end_stone'], hardness: Infinity, transparent: true, shape: 'frame', eye: true, hidden: true, item: 245 });
def(247, 'End Portal', { tex: ['end_portal'], hardness: Infinity, transparent: true, solid: false, shape: 'end_portal', emit: 15, hidden: true, item: 0 });
def(248, 'Dragon Egg', { tex: ['dragon_egg'], hardness: 3, transparent: true, shape: 'egg', emit: 1 });
def(249, 'Nether Brick Fence', { tex: ['nether_bricks'], hardness: 2, tool: 'pickaxe', needsTier: 0, transparent: true, shape: 'fence' });
def(250, 'Mossy Stone Bricks', { tex: ['mossy_stone_bricks'], hardness: 1.5, tool: 'pickaxe', needsTier: 0 });
def(251, 'Cracked Stone Bricks', { tex: ['cracked_stone_bricks'], hardness: 1.5, tool: 'pickaxe', needsTier: 0 });
// Flowing water and lava: WATER_FLOW / LAVA_FLOW + level (1-7, further from the source = lower),
// and FALLING_* for a column pouring down. Sources are the plain WATER and LAVA blocks.
for (let level = 1; level <= 8; level++) {
  const falling = level === 8;
  def(1000 + level, 'Water', { tex: ['water'], render: 'water', liquid: 'water', tint: 'water', solid: false, transparent: true, lightFilter: 2, replaceable: true, hardness: Infinity, hidden: true, item: 0, level: falling ? 0 : level, falling });
  def(1010 + level, 'Lava', { tex: ['lava'], render: 'water', liquid: 'lava', solid: false, transparent: true, emit: 15, replaceable: true, hardness: Infinity, hidden: true, item: 0, level: falling ? 0 : level, falling });
}
// villages: paths, decoration and the job sites that give villagers their professions
def(1030, 'Dirt Path', { tex: ['dirt_path_top', 'dirt_path_side', 'dirt'], hardness: 0.65, tool: 'shovel', transparent: true, shape: 'path' });
def(1031, 'Hay Bale', { tex: ['hay_top', 'hay_side', 'hay_top'], hardness: 0.5, tool: 'hoe' });
def(1032, 'Bookshelf', { tex: ['planks', 'bookshelf', 'planks'], hardness: 1.5, tool: 'axe' });
def(1033, 'Composter', { tex: ['composter_top', 'composter_side', 'planks'], hardness: 0.6, tool: 'axe', job: 'farmer' });
def(1034, 'Lectern', { tex: ['lectern_top', 'lectern_side', 'planks'], hardness: 2.5, tool: 'axe', job: 'librarian' });
def(1035, 'Blast Furnace', { tex: ['blast_furnace_top', 'blast_furnace_side', 'blast_furnace_top', 'blast_furnace_front'], hardness: 3.5, tool: 'pickaxe', needsTier: 0, job: 'armorer', furnace: 'ore' });
def(1036, 'Smoker', { tex: ['smoker_top', 'smoker_side', 'smoker_top', 'smoker_front'], hardness: 3.5, tool: 'pickaxe', needsTier: 0, job: 'butcher', furnace: 'food' });
def(1037, 'Smithing Table', { tex: ['smithing_table_top', 'smithing_table_side', 'planks'], hardness: 2.5, tool: 'axe', job: 'toolsmith' });
def(1038, 'Grindstone', { tex: ['grindstone', 'grindstone_side', 'grindstone'], hardness: 2, tool: 'pickaxe', needsTier: 0, transparent: true, shape: 'grindstone', job: 'weaponsmith' });
def(1039, 'Fletching Table', { tex: ['fletching_table_top', 'fletching_table_side', 'planks'], hardness: 2.5, tool: 'axe', job: 'fletcher' });
def(1040, 'Loom', { tex: ['loom_top', 'loom_side', 'planks'], hardness: 2.5, tool: 'axe', job: 'shepherd' });
def(1041, 'Cartography Table', { tex: ['cartography_table_top', 'cartography_table_side', 'planks'], hardness: 2.5, tool: 'axe', job: 'cartographer' });
def(1042, 'Stonecutter', { tex: ['stonecutter_top', 'stonecutter_side', 'stone'], hardness: 3.5, tool: 'pickaxe', needsTier: 0, transparent: true, shape: 'stonecutter', job: 'mason' });
def(1043, 'Cauldron', { tex: ['cauldron_top', 'cauldron_side', 'cauldron_side'], hardness: 2, tool: 'pickaxe', needsTier: 0, transparent: true, shape: 'cauldron', job: 'leatherworker' });
def(1044, 'Barrel', { tex: ['barrel_top', 'barrel_side', 'barrel_top'], hardness: 2.5, tool: 'axe', job: 'fisherman', container: true });
def(1045, 'Bell', { tex: ['bell'], hardness: 5, tool: 'pickaxe', transparent: true, shape: 'bell', solid: false });
// enchanting and anvils, and blocks of ingots and gems
def(1046, 'Enchanting Table', { tex: ['enchanting_table_top', 'enchanting_table_side', 'obsidian'], hardness: 5, tool: 'pickaxe', needsTier: 0, transparent: true, shape: 'table12', emit: 7 });
def(1047, 'Anvil', { tex: ['anvil_top', 'anvil', 'anvil'], hardness: 5, tool: 'pickaxe', needsTier: 0, transparent: true, shape: 'anvil', gravity: true });
def(1048, 'Chipped Anvil', { tex: ['anvil_top_chipped', 'anvil', 'anvil'], hardness: 5, tool: 'pickaxe', needsTier: 0, transparent: true, shape: 'anvil', gravity: true });
def(1049, 'Damaged Anvil', { tex: ['anvil_top_damaged', 'anvil', 'anvil'], hardness: 5, tool: 'pickaxe', needsTier: 0, transparent: true, shape: 'anvil', gravity: true });
def(1050, 'Block of Iron', { tex: ['iron_block'], hardness: 5, tool: 'pickaxe', needsTier: 1 });
def(1051, 'Block of Gold', { tex: ['gold_block'], hardness: 3, tool: 'pickaxe', needsTier: 2 });
def(1052, 'Block of Diamond', { tex: ['diamond_block'], hardness: 5, tool: 'pickaxe', needsTier: 2 });
def(1053, 'Block of Emerald', { tex: ['emerald_block'], hardness: 5, tool: 'pickaxe', needsTier: 2 });
def(1054, 'Block of Lapis Lazuli', { tex: ['lapis_block'], hardness: 3, tool: 'pickaxe', needsTier: 1 });
def(1055, 'Block of Coal', { tex: ['coal_block'], hardness: 5, tool: 'pickaxe', needsTier: 0 });
// brewing
def(1056, 'Brewing Stand', { tex: ['brewing_stand_base', 'brewing_stand', 'brewing_stand_base'], hardness: 0.5, tool: 'pickaxe', transparent: true, shape: 'brewing', job: 'cleric', emit: 1 });
for (let i = 0; i < 4; i++) {
  def(1060 + i, 'Nether Wart', { tex: [`nether_wart_${i}`], render: 'crop', solid: false, transparent: true, hardness: 0, needsSupport: true, hidden: true, wart: i, item: ITEM_NETHER_WART });
}
def(1064, 'Brown Mushroom', { tex: ['brown_mushroom'], render: 'cross', solid: false, transparent: true, hardness: 0, needsSupport: true, emit: 1 });
def(1065, 'Red Mushroom', { tex: ['red_mushroom'], render: 'cross', solid: false, transparent: true, hardness: 0, needsSupport: true });
def(1066, 'Melon', { tex: ['melon_top', 'melon_side', 'melon_top'], hardness: 1, tool: 'axe' });
// the sixteen colours (white wool is block 29)
COLORS.forEach((c, i) => {
  if (i > 0) def(1069 + i, `${COLOR_NAMES[i]} Wool`, { tex: ['wool_' + c], hardness: 0.8, color: i });
  def(1085 + i, `${COLOR_NAMES[i]} Stained Glass`, { tex: ['stained_glass_' + c], hardness: 0.3, transparent: true, translucent: true, cullSame: true, color: i });
  def(1102 + i, `${COLOR_NAMES[i]} Terracotta`, { tex: ['terracotta_' + c], hardness: 1.25, tool: 'pickaxe', needsTier: 0, color: i });
});
def(1101, 'Terracotta', { tex: ['terracotta'], hardness: 1.25, tool: 'pickaxe', needsTier: 0 });
def(1067, 'Slime Block', { tex: ['slime_block'], hardness: 0, transparent: true, translucent: true, bouncy: true });
def(1020, 'Fire', { tex: ['fire'], render: 'cross', solid: false, transparent: true, replaceable: true, emit: 15, hardness: 0, hidden: true, item: 0, fire: true });

B.forEach((b) => {
  b.render ??= 'cube';
  b.solid ??= b.render === 'cube';
  if (b.shape) b.render = 'shape';
  b.transparent = !!b.transparent;
  b.lightFilter ??= 0;
  b.emit ??= 0;
  b.cullSame = !!b.cullSame;
  if (b.tex) {
    const [top, side = top, bottom = top, sideX = side] = b.tex;
    b.tex = [top, side, bottom, sideX];
  }
});
export const BLOCKS = B;

// Whether a block that needs support can stay on top of `below`.
export function isSupported(id, below) {
  if (!B[id].needsSupport) return true;
  if (id === BLOCK.SUGAR_CANE && below === BLOCK.SUGAR_CANE) return true;
  if (id === BLOCK.CACTUS) return below === BLOCK.CACTUS || below === BLOCK.SAND;
  if (B[id].crop) return below === BLOCK.FARMLAND;
  if (B[id].wart !== undefined) return below === BLOCK.SOUL_SAND;
  if (id === BLOCK.BROWN_MUSHROOM || id === BLOCK.RED_MUSHROOM) return B[below].solid && !B[below].transparent;
  if (B[id].shape === 'door') return B[id].upper ? B[below].shape === 'door' && !B[below].upper : B[below].solid && B[below].shape !== 'door';
  if (B[id].attach > 0) return true; // wall-mounted: see supportOffset
  if (B[id].redstone === 'wire' || B[id].redstone === 'repeater' || B[id].redstone === 'plate') return B[below].solid && !B[below].transparent;
  return B[below].solid && below !== BLOCK.CACTUS;
}

// Where the block a wall- or floor-mounted thing hangs on is, relative to it (or null).
export function supportOffset(id) {
  const b = B[id];
  if (b.attach === undefined && b.shape !== 'ladder') return null;
  if (b.shape === 'ladder') { const [fx, , fz] = FACING[b.facing]; return [-fx, 0, -fz]; }
  if (b.attach === 0) return [0, -1, 0];
  const [fx, , fz] = FACING[b.attach - 1];
  return [-fx, 0, -fz];
}

// Whether a block can hold a wall- or floor-mounted thing: a full solid block.
export function canHoldAttached(id) {
  const b = B[id];
  return !!b && b.solid && !b.transparent && b.render === 'cube';
}

// ---------- items ----------
export const ITEM = {
  STICK: 256, COAL: 257, RAW_IRON: 258, IRON_INGOT: 259, RAW_GOLD: 260, GOLD_INGOT: 261, DIAMOND: 262,
  WOODEN_PICKAXE: 263, WOODEN_AXE: 264, WOODEN_SHOVEL: 265, WOODEN_SWORD: 266,
  STONE_PICKAXE: 267, STONE_AXE: 268, STONE_SHOVEL: 269, STONE_SWORD: 270,
  IRON_PICKAXE: 271, IRON_AXE: 272, IRON_SHOVEL: 273, IRON_SWORD: 274,
  DIAMOND_PICKAXE: 275, DIAMOND_AXE: 276, DIAMOND_SHOVEL: 277, DIAMOND_SWORD: 278,
  APPLE: 279, RAW_PORKCHOP: 280, COOKED_PORKCHOP: 281, RAW_BEEF: 282, STEAK: 283, ROTTEN_FLESH: 284,
  BREAD: 285, LEATHER: 286,
  RAW_COPPER: 287, COPPER_INGOT: 288, BUCKET: 289, WATER_BUCKET: 290, SHEARS: 291,
  RAW_CHICKEN: 292, COOKED_CHICKEN: 293, RAW_MUTTON: 294, COOKED_MUTTON: 295,
  FEATHER: 296, BONE: 297, ARROW: 298, GUNPOWDER: 299, STRING: 300,
  REDSTONE: 301, LAPIS_LAZULI: 302, EMERALD: 303,
  WOODEN_HOE: 304, STONE_HOE: 305, IRON_HOE: 306, DIAMOND_HOE: 307,
  LEATHER_HELMET: 308, LEATHER_CHESTPLATE: 309, LEATHER_LEGGINGS: 310, LEATHER_BOOTS: 311,
  IRON_HELMET: 312, IRON_CHESTPLATE: 313, IRON_LEGGINGS: 314, IRON_BOOTS: 315,
  GOLDEN_HELMET: 316, GOLDEN_CHESTPLATE: 317, GOLDEN_LEGGINGS: 318, GOLDEN_BOOTS: 319,
  DIAMOND_HELMET: 320, DIAMOND_CHESTPLATE: 321, DIAMOND_LEGGINGS: 322, DIAMOND_BOOTS: 323,
  BOW: 324, WHEAT_SEEDS: 325, WHEAT: 326, CARROT: 327, POTATO: 328, BAKED_POTATO: 329, BONE_MEAL: 330,
  ENDER_PEARL: 331, FLINT: 332, OAK_DOOR: 333, FLINT_AND_STEEL: 334,
  GLOWSTONE_DUST: 335, QUARTZ: 336, BLAZE_ROD: 337, BLAZE_POWDER: 338, EYE_OF_ENDER: 339, NETHER_BRICK: 340,
  GHAST_TEAR: 341, GOLD_NUGGET: 342, LAVA_BUCKET: 343, PAPER: 344, BOOK: 345, ENCHANTED_BOOK: 346, EXPERIENCE_BOTTLE: 347,
  GLASS_BOTTLE: 348, POTION: 349, SPLASH_POTION: 350, NETHER_WART: 351, SPIDER_EYE: 352, FERMENTED_SPIDER_EYE: 353, SUGAR: 354,
  MELON_SLICE: 355, GLISTERING_MELON_SLICE: 356, GOLDEN_CARROT: 357, MAGMA_CREAM: 358, RABBIT_FOOT: 359, PUFFERFISH: 360,
  PHANTOM_MEMBRANE: 361, GOLDEN_APPLE: 362, MILK_BUCKET: 363, EGG: 364, SLIMEBALL: 365, INK_SAC: 366, RAW_RABBIT: 367,
  COOKED_RABBIT: 368, RABBIT_HIDE: 369, DYE: 370, COCOA_BEANS: 386, CLAY_BALL: 398, BRICK: 399, // (dyes are 370 + colour)
  FISHING_ROD: 387, RAW_COD: 388, COOKED_COD: 389, RAW_SALMON: 390, COOKED_SALMON: 391, TROPICAL_FISH: 392,
  SHIELD: 393, COMPASS: 394, CLOCK: 395, NAME_TAG: 396, SADDLE: 397,
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
item(287, 'Raw Copper', { icon: 'raw_copper' });
item(288, 'Copper Ingot', { icon: 'copper_ingot' });
item(289, 'Bucket', { icon: 'bucket', stack: 16 });
item(290, 'Water Bucket', { icon: 'water_bucket', stack: 1 });
item(343, 'Lava Bucket', { icon: 'lava_bucket', stack: 1 });
item(344, 'Paper', { icon: 'paper' });
item(345, 'Book', { icon: 'book' });
item(346, 'Enchanted Book', { icon: 'enchanted_book', stack: 1 });
item(347, "Bottle o' Enchanting", { icon: 'experience_bottle' });
item(348, 'Glass Bottle', { icon: 'glass_bottle' });
item(349, 'Potion', { icon: 'potion', stack: 1 });
item(350, 'Splash Potion', { icon: 'splash_potion', stack: 1 });
item(351, 'Nether Wart', { icon: 'nether_wart', plants: 1060 });
item(352, 'Spider Eye', { icon: 'spider_eye', food: 2 });
item(353, 'Fermented Spider Eye', { icon: 'fermented_spider_eye' });
item(354, 'Sugar', { icon: 'sugar' });
item(355, 'Melon Slice', { icon: 'melon_slice', food: 2 });
item(356, 'Glistering Melon Slice', { icon: 'glistering_melon_slice' });
item(357, 'Golden Carrot', { icon: 'golden_carrot', food: 6 });
item(358, 'Magma Cream', { icon: 'magma_cream' });
item(359, "Rabbit's Foot", { icon: 'rabbit_foot' });
item(360, 'Pufferfish', { icon: 'pufferfish', food: 1 });
item(361, 'Phantom Membrane', { icon: 'phantom_membrane' });
item(362, 'Golden Apple', { icon: 'golden_apple', food: 4, alwaysEat: true });
item(363, 'Milk Bucket', { icon: 'milk_bucket', stack: 1, drink: true });
item(364, 'Egg', { icon: 'egg', stack: 16 });
item(365, 'Slimeball', { icon: 'slimeball' });
item(366, 'Ink Sac', { icon: 'ink_sac' });
item(367, 'Raw Rabbit', { icon: 'raw_rabbit', food: 3 });
item(368, 'Cooked Rabbit', { icon: 'cooked_rabbit', food: 5 });
item(369, 'Rabbit Hide', { icon: 'rabbit_hide' });
COLORS.forEach((c, i) => item(370 + i, `${COLOR_NAMES[i]} Dye`, { icon: 'dye_' + c, dye: i }));
item(386, 'Cocoa Beans', { icon: 'cocoa_beans' });
item(398, 'Clay Ball', { icon: 'clay_ball' });
item(399, 'Brick', { icon: 'brick_item' });
item(387, 'Fishing Rod', { icon: 'fishing_rod', stack: 1, tool: { kind: 'fishing_rod', tier: 0, speed: 1, damage: 1, durability: 64 } });
item(388, 'Raw Cod', { icon: 'raw_cod', food: 2 });
item(389, 'Cooked Cod', { icon: 'cooked_cod', food: 5 });
item(390, 'Raw Salmon', { icon: 'raw_salmon', food: 2 });
item(391, 'Cooked Salmon', { icon: 'cooked_salmon', food: 6 });
item(392, 'Tropical Fish', { icon: 'tropical_fish', food: 1 });
item(396, 'Name Tag', { icon: 'name_tag' });
item(393, 'Shield', { icon: 'shield', stack: 1, tool: { kind: 'shield', tier: -1, speed: 1, damage: 1, durability: 336 } });
item(394, 'Compass', { icon: 'compass' });
item(395, 'Clock', { icon: 'clock' });
item(397, 'Saddle', { icon: 'saddle', stack: 1 });
item(291, 'Shears', { icon: 'shears', stack: 1, tool: { kind: 'shears', tier: 2, speed: 5, damage: 1, durability: 238 } });
item(292, 'Raw Chicken', { icon: 'raw_chicken', food: 2 });
item(293, 'Cooked Chicken', { icon: 'cooked_chicken', food: 6 });
item(294, 'Raw Mutton', { icon: 'raw_mutton', food: 2 });
item(295, 'Cooked Mutton', { icon: 'cooked_mutton', food: 6 });
item(296, 'Feather', { icon: 'feather' });
item(297, 'Bone', { icon: 'bone' });
item(298, 'Arrow', { icon: 'arrow' });
item(299, 'Gunpowder', { icon: 'gunpowder' });
item(300, 'String', { icon: 'string' });
item(301, 'Redstone Dust', { icon: 'redstone', plants: 124 });
item(302, 'Lapis Lazuli', { icon: 'lapis' });
item(303, 'Emerald', { icon: 'emerald' });
MATERIALS.forEach(([matName, mat, tier, speed, durability], m) => {
  item(304 + m, `${matName} Hoe`, { icon: `${mat}_hoe`, stack: 1, tool: { kind: 'hoe', tier, speed, damage: 1, durability } });
});
// armor: [slot (0 helmet, 1 chestplate, 2 leggings, 3 boots), defense points, durability]
const ARMOR_MATERIALS = [
  ['Leather', 'leather', [1, 3, 2, 1], [55, 80, 75, 65], 0],
  ['Iron', 'iron', [2, 6, 5, 2], [165, 240, 225, 195], 0],
  ['Golden', 'gold', [2, 5, 3, 1], [77, 112, 105, 91], 0],
  ['Diamond', 'diamond', [3, 8, 6, 3], [363, 528, 495, 429], 2],
];
const ARMOR_PIECES = [['Helmet', 'helmet'], ['Chestplate', 'chestplate'], ['Leggings', 'leggings'], ['Boots', 'boots']];
ARMOR_MATERIALS.forEach(([matName, mat, defense, durability, toughness], m) => {
  ARMOR_PIECES.forEach(([pieceName, piece], slot) => {
    item(308 + m * 4 + slot, `${matName} ${pieceName}`, {
      icon: `${mat}_${piece}`, stack: 1,
      armor: { slot, material: mat, defense: defense[slot], toughness, durability: durability[slot] },
    });
  });
});
item(324, 'Bow', { icon: 'bow', stack: 1, tool: { kind: 'bow', tier: 0, speed: 1, damage: 1, durability: 384 } });
item(325, 'Wheat Seeds', { icon: 'wheat_seeds', plants: 76 });
item(326, 'Wheat', { icon: 'wheat' });
item(327, 'Carrot', { icon: 'carrot', food: 3, plants: 84 });
item(328, 'Potato', { icon: 'potato', food: 1, plants: 88 });
item(329, 'Baked Potato', { icon: 'baked_potato', food: 5 });
item(330, 'Bone Meal', { icon: 'bone_meal' });
item(331, 'Ender Pearl', { icon: 'ender_pearl', stack: 16 });
item(332, 'Flint', { icon: 'flint' });
item(333, 'Oak Door', { icon: 'oak_door' });
item(335, 'Glowstone Dust', { icon: 'glowstone_dust' });
item(336, 'Nether Quartz', { icon: 'quartz' });
item(337, 'Blaze Rod', { icon: 'blaze_rod' });
item(338, 'Blaze Powder', { icon: 'blaze_powder' });
item(339, 'Eye of Ender', { icon: 'eye_of_ender' });
item(340, 'Nether Brick', { icon: 'nether_brick' });
item(341, 'Ghast Tear', { icon: 'ghast_tear' });
item(342, 'Gold Nugget', { icon: 'gold_nugget' });
item(334, 'Flint and Steel', { icon: 'flint_and_steel', stack: 1, tool: { kind: 'lighter', tier: 0, speed: 1, damage: 1, durability: 64 } });
export const ITEMS = I;

// Fluids: 'water' or 'lava' (any level), else null; and how far the fluid has spread
// (0 for sources and falling columns, 1-7 for flowing blocks).
export function fluidOf(id) {
  return B[id]?.liquid || null;
}
export function fluidLevel(id) {
  return B[id]?.level ?? 0;
}
export const isSource = (id) => id === BLOCK.WATER || id === BLOCK.LAVA;
// furnaces (and the smoker and blast furnace), and blocks that hold 27 items like a chest (barrels)
export const isFurnace = (id) => id === BLOCK.FURNACE || !!B[id]?.furnace;
export const isContainer = (id) => id === BLOCK.CHEST || !!B[id]?.container;

export function isBlockId(id) {
  return ((id > 0 && id < ITEM_BASE) || (id >= HIGH_BLOCKS && id < MAX_BLOCK)) && !!BLOCKS[id];
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

// Durability of tools and armor (undefined for everything else).
export function maxDurability(id) {
  return ITEMS[id]?.tool?.durability ?? ITEMS[id]?.armor?.durability;
}

export function armorOf(id) {
  return ITEMS[id]?.armor ?? null;
}

// The item a block gives when broken or picked (door halves, rotated ladders and stairs...).
export function blockItem(id) {
  const b = BLOCKS[id];
  if (b.shape === 'door') return ITEM.OAK_DOOR;
  if (b.redstone === 'wire') return ITEM.REDSTONE;
  if (b.crop) return null;
  return b.item ?? id;
}

export function isSolid(id) {
  return BLOCKS[id].solid;
}

export function isTransparent(id) {
  return BLOCKS[id].transparent;
}

// Blocks a player can place from the creative inventory.
export const CREATIVE_BLOCKS = B.map((_, id) => id).filter(
  (id) => id !== BLOCK.AIR && id !== BLOCK.BEDROCK && id !== BLOCK.WATER && id !== BLOCK.LAVA && !B[id].hidden && !B[id].crop,
).concat([BLOCK.WATER, BLOCK.LAVA]);
export const CREATIVE_ITEMS = Object.keys(I).map(Number);

// Seconds to break a block with the given held item (Minecraft's formula, simplified).
// efficiency: the tool's Efficiency enchantment level (adds level² + 1 to the right tool's speed)
export function breakTime(blockId, heldId, efficiency = 0) {
  const b = BLOCKS[blockId];
  if (b.hardness === 0) return 0;
  if (!Number.isFinite(b.hardness)) return Infinity;
  const tool = toolOf(heldId);
  const rightTool = tool && b.tool && tool.kind === b.tool;
  const speed = rightTool ? tool.speed + (efficiency ? efficiency * efficiency + 1 : 0) : 1;
  const canHarvest = b.needsTier === undefined || (rightTool && tool.tier >= b.needsTier);
  return (b.hardness * (canHarvest ? 1.5 : 5)) / speed;
}

// Blocks Silk Touch picks up as themselves (instead of what they'd drop), and ores Fortune multiplies.
const SILK = new Set();
const FORTUNE = new Set();
// What a block drops when broken with the given item. rand() -> [0, 1)
// ench: the tool's enchantments ({silk_touch: 1} or {fortune: 1-3})
export function getDrops(blockId, heldId, rand = Math.random, ench = null) {
  const b = BLOCKS[blockId];
  const tool = toolOf(heldId);
  if (b.needsTier !== undefined && !(tool && tool.kind === b.tool && tool.tier >= b.needsTier)) return [];
  if (ench?.silk_touch && SILK.has(blockId)) return [[blockId, 1]];
  const drops = baseDrops(blockId, b, tool, rand);
  const fortune = ench?.fortune || 0;
  if (fortune && FORTUNE.has(blockId)) {
    // Minecraft: a bonus multiplier from 1 to fortune + 1 (with a good chance of no bonus)
    const bonus = Math.max(0, Math.floor(rand() * (fortune + 2)) - 1);
    return drops.map(([id, n]) => [id, n * (bonus + 1)]);
  }
  return drops;
}
function baseDrops(blockId, b, tool, rand) {
  switch (blockId) {
    case BLOCK.GRASS:
    case BLOCK.DIRT_PATH:
    case BLOCK.SNOWY_GRASS: return [[BLOCK.DIRT, 1]];
    case BLOCK.BOOKSHELF: return [[ITEM.BOOK, 3]];
    case BLOCK.STONE: return [[BLOCK.COBBLE, 1]];
    case BLOCK.DEEPSLATE: return [[BLOCK.COBBLED_DEEPSLATE, 1]];
    case BLOCK.COAL_ORE:
    case BLOCK.DEEPSLATE_COAL_ORE: return [[ITEM.COAL, 1]];
    case BLOCK.IRON_ORE:
    case BLOCK.DEEPSLATE_IRON_ORE: return [[ITEM.RAW_IRON, 1]];
    case BLOCK.GOLD_ORE:
    case BLOCK.DEEPSLATE_GOLD_ORE: return [[ITEM.RAW_GOLD, 1]];
    case BLOCK.DIAMOND_ORE:
    case BLOCK.DEEPSLATE_DIAMOND_ORE: return [[ITEM.DIAMOND, 1]];
    case BLOCK.COPPER_ORE:
    case BLOCK.DEEPSLATE_COPPER_ORE: return [[ITEM.RAW_COPPER, 2 + Math.floor(rand() * 4)]];
    case BLOCK.REDSTONE_ORE:
    case BLOCK.DEEPSLATE_REDSTONE_ORE: return [[ITEM.REDSTONE, 4 + Math.floor(rand() * 2)]];
    case BLOCK.LAPIS_ORE:
    case BLOCK.DEEPSLATE_LAPIS_ORE: return [[ITEM.LAPIS_LAZULI, 4 + Math.floor(rand() * 6)]];
    case BLOCK.EMERALD_ORE: return [[ITEM.EMERALD, 1]];
    case BLOCK.LEAVES:
    case BLOCK.DARK_OAK_LEAVES: return rand() < 0.05 ? [[ITEM.APPLE, 1]] : [];
    case BLOCK.DEAD_BUSH: return rand() < 0.5 ? [[ITEM.STICK, 1 + Math.floor(rand() * 2)]] : [];
    case BLOCK.BIRCH_LEAVES:
    case BLOCK.CHERRY_LEAVES:
    case BLOCK.SPRUCE_LEAVES:
    case BLOCK.ACACIA_LEAVES:
    case BLOCK.JUNGLE_LEAVES: if (blockId === BLOCK.JUNGLE_LEAVES && rand() < 0.03) return [[ITEM.COCOA_BEANS, 1]]; // falls through
    case BLOCK.TALL_GRASS: return rand() < 0.125 ? [[ITEM.WHEAT_SEEDS, 1]] : [];
    case BLOCK.GRAVEL: return rand() < 0.1 ? [[ITEM.FLINT, 1]] : [[BLOCK.GRAVEL, 1]];
    case BLOCK.FARMLAND: return [[BLOCK.DIRT, 1]];
    case BLOCK.TNT: return [[BLOCK.TNT, 1]];
    case BLOCK.NETHER_QUARTZ_ORE: return [[ITEM.QUARTZ, 1]];
    case BLOCK.NETHER_GOLD_ORE: return [[ITEM.GOLD_NUGGET, 2 + Math.floor(rand() * 5)]];
    case BLOCK.GLOWSTONE: return [[ITEM.GLOWSTONE_DUST, 2 + Math.floor(rand() * 3)]];
    case BLOCK.MELON: return [[ITEM.MELON_SLICE, 3 + Math.floor(rand() * 5)]];
    case BLOCK.NETHERRACK: return [[BLOCK.NETHERRACK, 1]];
    case BLOCK.FERN:
    case BLOCK.ICE:
    case BLOCK.LAVA:
    case BLOCK.GLASS:
    case BLOCK.WATER:
    case BLOCK.BEDROCK: return [];
    case BLOCK.CLAY: return [[ITEM.CLAY_BALL, 4]];
    case BLOCK.SNOW: return [[BLOCK.SNOW, 1]];
    default: break;
  }
  if (b.translucent && b.color !== undefined) return []; // stained glass breaks (unless Silk Touch)
  if (b.wart !== undefined) return [[ITEM.NETHER_WART, b.wart === 3 ? 2 + Math.floor(rand() * 3) : 1]];
  if (b.crop) {
    const { kind, stage, max } = b.crop;
    const ripe = stage === max;
    if (kind === 'wheat') return ripe ? [[ITEM.WHEAT, 1], [ITEM.WHEAT_SEEDS, Math.floor(rand() * 4)]].filter(([, n]) => n > 0) : [[ITEM.WHEAT_SEEDS, 1]];
    const crop = kind === 'carrots' ? ITEM.CARROT : ITEM.POTATO;
    return [[crop, ripe ? 2 + Math.floor(rand() * 4) : 1]];
  }
  if (b.shape === 'door') return b.upper ? [] : [[ITEM.OAK_DOOR, 1]];
  if (b.redstone === 'head' || b.shape === 'portal' || b.shape === 'end_portal') return [];
  return [[blockItem(blockId), 1]];
}

for (const name of ['GRASS', 'SNOWY_GRASS', 'DIRT_PATH', 'STONE', 'DEEPSLATE', 'COAL_ORE', 'DEEPSLATE_COAL_ORE', 'IRON_ORE', 'DEEPSLATE_IRON_ORE',
  'GOLD_ORE', 'DEEPSLATE_GOLD_ORE', 'DIAMOND_ORE', 'DEEPSLATE_DIAMOND_ORE', 'COPPER_ORE', 'DEEPSLATE_COPPER_ORE', 'REDSTONE_ORE',
  'DEEPSLATE_REDSTONE_ORE', 'LAPIS_ORE', 'DEEPSLATE_LAPIS_ORE', 'EMERALD_ORE', 'GLASS', 'ICE', 'LEAVES', 'BIRCH_LEAVES', 'SPRUCE_LEAVES',
  'ACACIA_LEAVES', 'DARK_OAK_LEAVES', 'JUNGLE_LEAVES', 'CHERRY_LEAVES', 'BOOKSHELF', 'GLOWSTONE', 'NETHER_QUARTZ_ORE', 'NETHER_GOLD_ORE',
  'GRAVEL', 'TALL_GRASS', 'FERN', 'DEAD_BUSH', 'CLAY', 'SNOW']) if (BLOCK[name] !== undefined) SILK.add(BLOCK[name]);
for (let c = 0; c < 16; c++) SILK.add(1085 + c);
for (const name of ['COAL_ORE', 'DEEPSLATE_COAL_ORE', 'DIAMOND_ORE', 'DEEPSLATE_DIAMOND_ORE', 'EMERALD_ORE', 'LAPIS_ORE', 'DEEPSLATE_LAPIS_ORE',
  'REDSTONE_ORE', 'DEEPSLATE_REDSTONE_ORE', 'COPPER_ORE', 'DEEPSLATE_COPPER_ORE', 'IRON_ORE', 'DEEPSLATE_IRON_ORE', 'GOLD_ORE',
  'DEEPSLATE_GOLD_ORE', 'NETHER_QUARTZ_ORE', 'NETHER_GOLD_ORE', 'GLOWSTONE']) FORTUNE.add(BLOCK[name]);

// Furnace recipes: input -> output, and how many items a fuel smelts.
export const SMELTING = {
  [ITEM.RAW_IRON]: ITEM.IRON_INGOT,
  [ITEM.RAW_GOLD]: ITEM.GOLD_INGOT,
  [BLOCK.SAND]: BLOCK.GLASS,
  [BLOCK.STONE_BRICKS]: BLOCK.CRACKED_STONE_BRICKS,
  [ITEM.RAW_RABBIT]: ITEM.COOKED_RABBIT,
  [ITEM.RAW_COD]: ITEM.COOKED_COD,
  [ITEM.RAW_SALMON]: ITEM.COOKED_SALMON,
  [BLOCK.COBBLE]: BLOCK.STONE,
  [ITEM.RAW_PORKCHOP]: ITEM.COOKED_PORKCHOP,
  [ITEM.RAW_BEEF]: ITEM.STEAK,
  [BLOCK.LOG]: ITEM.COAL,
  [BLOCK.BIRCH_LOG]: ITEM.COAL,
  [BLOCK.CLAY]: BLOCK.TERRACOTTA,
  [ITEM.CLAY_BALL]: ITEM.BRICK,
  [BLOCK.CACTUS]: ITEM.DYE + 13,
  [BLOCK.CHERRY_LOG]: ITEM.COAL,
  [BLOCK.SPRUCE_LOG]: ITEM.COAL,
  [BLOCK.ACACIA_LOG]: ITEM.COAL,
  [BLOCK.DARK_OAK_LOG]: ITEM.COAL,
  [BLOCK.JUNGLE_LOG]: ITEM.COAL,
  [ITEM.RAW_COPPER]: ITEM.COPPER_INGOT,
  [ITEM.RAW_CHICKEN]: ITEM.COOKED_CHICKEN,
  [ITEM.RAW_MUTTON]: ITEM.COOKED_MUTTON,
  [BLOCK.COBBLED_DEEPSLATE]: BLOCK.DEEPSLATE,
  [ITEM.POTATO]: ITEM.BAKED_POTATO,
  [BLOCK.NETHERRACK]: ITEM.NETHER_BRICK,
  [BLOCK.NETHER_GOLD_ORE]: ITEM.GOLD_INGOT,
  [BLOCK.NETHER_QUARTZ_ORE]: ITEM.QUARTZ,
};
export const FUEL = {
  [ITEM.COAL]: 8,
  [BLOCK.LOG]: 1.5,
  [BLOCK.BIRCH_LOG]: 1.5,
  [BLOCK.PLANKS]: 1.5,
  [BLOCK.BIRCH_PLANKS]: 1.5,
  [BLOCK.CRAFTING_TABLE]: 1.5,
  [BLOCK.CHERRY_LOG]: 1.5,
  [BLOCK.CHERRY_PLANKS]: 1.5,
  [BLOCK.CHEST]: 1.5,
  [ITEM.STICK]: 0.5,
  [ITEM.BLAZE_ROD]: 12,
};
for (const id of [BLOCK.OAK_FENCE, BLOCK.OAK_SLAB, BLOCK.OAK_STAIRS, BLOCK.LADDER, ITEM.OAK_DOOR, ITEM.BOW]) FUEL[id] = id === BLOCK.OAK_SLAB ? 0.75 : 1.5;
for (const wood of ['SPRUCE', 'ACACIA', 'DARK_OAK', 'JUNGLE']) {
  FUEL[BLOCK[wood + '_LOG']] = 1.5;
  FUEL[BLOCK[wood + '_PLANKS']] = 1.5;
}
for (const id of Object.keys(I).map(Number)) {
  if (I[id].tool && I[id].tool.tier === 0) FUEL[id] = 1;
}
export const SMELT_SECONDS = 10;

// Colours: wool of a colour, and the colour of a dye or coloured block (or -1).
export const woolOf = (c) => (c === 0 ? BLOCK.WOOL : 1069 + c);
export const colorOf = (id) => (id === BLOCK.WOOL ? 0 : ITEMS[id]?.dye ?? BLOCKS[id]?.color ?? -1);
export const isWool = (id) => id === BLOCK.WOOL || (id >= 1070 && id <= 1084);
