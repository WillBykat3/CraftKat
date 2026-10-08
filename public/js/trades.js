// Villager professions and their trades, after Minecraft's tables (only items this game has).
// Each level unlocks two offers from its list. An offer: [[costId, count], [costId2, count]?] -> [resultId, count],
// with how many times it can be used before the villager restocks, and the experience it gives the villager.

import { BLOCK, ITEM } from './blocks.js';
import { randomBook, ENCHANTS } from './enchant.js';

const E = ITEM.EMERALD;
export const LEVELS = ['Novice', 'Apprentice', 'Journeyman', 'Expert', 'Master'];
export const LEVEL_XP = [0, 10, 70, 150, 250]; // villager experience needed for each level

// job site block -> profession
export const PROFESSION_OF = {
  [BLOCK.COMPOSTER]: 'farmer', [BLOCK.LECTERN]: 'librarian', [BLOCK.BLAST_FURNACE]: 'armorer', [BLOCK.SMOKER]: 'butcher',
  [BLOCK.SMITHING_TABLE]: 'toolsmith', [BLOCK.GRINDSTONE]: 'weaponsmith', [BLOCK.FLETCHING_TABLE]: 'fletcher',
  [BLOCK.LOOM]: 'shepherd', [BLOCK.CARTOGRAPHY_TABLE]: 'cartographer', [BLOCK.STONECUTTER]: 'mason',
  [BLOCK.CAULDRON]: 'leatherworker', [BLOCK.BARREL]: 'fisherman',
};

// order used to tell clients a villager's profession (entity flags)
export const PROFESSIONS = ['unemployed', 'nitwit', 'farmer', 'librarian', 'armorer', 'butcher', 'toolsmith', 'weaponsmith',
  'fletcher', 'shepherd', 'cartographer', 'mason', 'leatherworker', 'fisherman'];

const buy = (id, n, xp = 2, uses = 16) => ({ cost: [[id, n]], result: [E, 1], uses, xp });
const sell = (n, id, count = 1, xp = 1, uses = 12, extra = null) => ({ cost: extra ? [[E, n], extra] : [[E, n]], result: [id, count], uses, xp });

// profession -> five levels of offers
export const TRADES = {
  farmer: [
    [buy(ITEM.WHEAT, 20), buy(ITEM.POTATO, 26), buy(ITEM.CARROT, 22), sell(1, ITEM.BREAD, 6)],
    [sell(1, ITEM.APPLE, 4, 5), sell(1, ITEM.BAKED_POTATO, 6, 5), buy(BLOCK.SUGAR_CANE, 24, 10)],
    [buy(BLOCK.HAY_BALE, 4, 20), sell(1, ITEM.COOKED_CHICKEN, 6, 10)],
    [sell(1, ITEM.COOKED_PORKCHOP, 5, 15), buy(ITEM.BONE_MEAL, 24, 30)],
    [sell(3, ITEM.GOLD_NUGGET, 9, 30), sell(4, ITEM.STEAK, 8, 30)],
  ],
  librarian: [
    [buy(ITEM.PAPER, 24), sell(9, BLOCK.BOOKSHELF, 1, 1)],
    [buy(ITEM.BOOK, 4, 10), sell(1, BLOCK.TORCH, 8, 5)],
    [sell(1, BLOCK.GLASS, 4, 10), buy(ITEM.FEATHER, 16, 20)],
    [sell(5, ITEM.EYE_OF_ENDER, 1, 15), sell(2, BLOCK.LECTERN, 1, 15)],
    [sell(20, BLOCK.BOOKSHELF, 3, 30), sell(4, ITEM.BLAZE_POWDER, 2, 30)],
  ],
  armorer: [
    [buy(ITEM.COAL, 15), sell(5, ITEM.IRON_HELMET), sell(9, ITEM.IRON_CHESTPLATE), sell(7, ITEM.IRON_LEGGINGS), sell(4, ITEM.IRON_BOOTS)],
    [buy(ITEM.IRON_INGOT, 4, 10), sell(36, ITEM.DIAMOND_HELMET, 1, 5)],
    [buy(ITEM.LAVA_BUCKET, 1, 20), buy(ITEM.DIAMOND, 1, 20), sell(3, BLOCK.BLAST_FURNACE, 1, 10)],
    [sell(16, ITEM.DIAMOND_BOOTS, 1, 15), sell(19, ITEM.DIAMOND_LEGGINGS, 1, 15)],
    [sell(21, ITEM.DIAMOND_CHESTPLATE, 1, 30), sell(13, ITEM.DIAMOND_HELMET, 1, 30)],
  ],
  butcher: [
    [buy(ITEM.RAW_CHICKEN, 14), buy(ITEM.RAW_PORKCHOP, 7), sell(1, ITEM.COOKED_PORKCHOP, 5)],
    [buy(ITEM.COAL, 15, 10), sell(1, ITEM.COOKED_CHICKEN, 8, 5)],
    [buy(ITEM.RAW_MUTTON, 7, 20), buy(ITEM.RAW_BEEF, 10, 20)],
    [buy(ITEM.BREAD, 10, 30), sell(1, ITEM.COOKED_MUTTON, 4, 15)],
    [sell(1, ITEM.STEAK, 3, 30), buy(ITEM.BAKED_POTATO, 12, 30)],
  ],
  toolsmith: [
    [buy(ITEM.COAL, 15), sell(1, ITEM.STONE_AXE), sell(1, ITEM.STONE_SHOVEL), sell(1, ITEM.STONE_PICKAXE), sell(1, ITEM.STONE_HOE)],
    [buy(ITEM.IRON_INGOT, 4, 10), sell(1, ITEM.FLINT_AND_STEEL, 1, 5)],
    [buy(ITEM.FLINT, 30, 20), sell(3, ITEM.IRON_AXE, 1, 10), sell(3, ITEM.IRON_SHOVEL, 1, 10), sell(4, ITEM.IRON_PICKAXE, 1, 10)],
    [buy(ITEM.DIAMOND, 1, 30), sell(12, ITEM.DIAMOND_AXE, 1, 15), sell(5, ITEM.DIAMOND_SHOVEL, 1, 15)],
    [sell(13, ITEM.DIAMOND_PICKAXE, 1, 30)],
  ],
  weaponsmith: [
    [buy(ITEM.COAL, 15), sell(3, ITEM.IRON_AXE), sell(2, ITEM.IRON_SWORD)],
    [buy(ITEM.IRON_INGOT, 4, 10), sell(1, ITEM.STONE_SWORD, 1, 5)],
    [buy(ITEM.FLINT, 24, 20), sell(8, ITEM.DIAMOND_SWORD, 1, 10)],
    [buy(ITEM.DIAMOND, 1, 30), sell(12, ITEM.DIAMOND_AXE, 1, 15)],
    [sell(8, ITEM.DIAMOND_SWORD, 1, 30)],
  ],
  fletcher: [
    [buy(ITEM.STICK, 32), sell(1, ITEM.ARROW, 16), sell(1, ITEM.FLINT, 10, 1, 12, [BLOCK.GRAVEL, 10])],
    [buy(ITEM.FLINT, 26, 10), sell(2, ITEM.BOW, 1, 5)],
    [buy(ITEM.STRING, 14, 20), sell(3, ITEM.ARROW, 32, 10)],
    [buy(ITEM.FEATHER, 24, 30), sell(4, ITEM.BOW, 1, 15)],
    [buy(ITEM.GUNPOWDER, 12, 30), sell(2, ITEM.ARROW, 24, 30)],
  ],
  shepherd: [
    [buy(BLOCK.WOOL, 18), sell(2, ITEM.SHEARS)],
    [buy(ITEM.STRING, 12, 10), sell(1, BLOCK.WOOL, 1, 5)],
    [buy(ITEM.WHEAT, 20, 20), sell(3, BLOCK.BED, 1, 10)],
    [buy(ITEM.BONE_MEAL, 12, 30), sell(3, BLOCK.LOOM, 1, 15)],
    [sell(2, BLOCK.WOOL, 4, 30)],
  ],
  cartographer: [
    [buy(ITEM.PAPER, 24), sell(1, BLOCK.CARTOGRAPHY_TABLE, 1)],
    [buy(BLOCK.GLASS, 11, 10), sell(1, ITEM.PAPER, 6, 5)],
    [buy(ITEM.REDSTONE, 16, 20), sell(13, ITEM.EYE_OF_ENDER, 1, 10)],
    [buy(ITEM.LAPIS_LAZULI, 12, 30), sell(7, BLOCK.BOOKSHELF, 2, 15)],
    [sell(8, ITEM.DIAMOND, 1, 30)],
  ],
  mason: [
    [buy(BLOCK.CLAY, 10), sell(1, BLOCK.BRICK, 10)],
    [buy(BLOCK.STONE, 20, 10), sell(1, BLOCK.STONE_BRICKS, 4, 5), sell(1, BLOCK.MOSSY_STONE_BRICKS, 4, 5)],
    [buy(BLOCK.GRANITE, 16, 20), buy(BLOCK.ANDESITE, 16, 20), buy(BLOCK.DIORITE, 16, 20), sell(1, BLOCK.SANDSTONE, 4, 10)],
    [buy(ITEM.QUARTZ, 12, 30), sell(1, BLOCK.CRACKED_STONE_BRICKS, 4, 15)],
    [sell(1, BLOCK.NETHER_BRICKS, 4, 30), sell(1, BLOCK.COBBLESTONE_STAIRS, 4, 30)],
  ],
  leatherworker: [
    [buy(ITEM.LEATHER, 6), sell(3, ITEM.LEATHER_LEGGINGS), sell(7, ITEM.LEATHER_CHESTPLATE)],
    [buy(ITEM.FLINT, 26, 10), sell(5, ITEM.LEATHER_HELMET, 1, 5), sell(4, ITEM.LEATHER_BOOTS, 1, 5)],
    [buy(ITEM.RAW_BEEF, 9, 20), sell(6, ITEM.LEATHER, 4, 10)],
    [buy(ITEM.BONE, 20, 30), sell(6, BLOCK.CAULDRON, 1, 15)],
    [sell(6, ITEM.SHEARS, 1, 30), sell(5, ITEM.LEATHER_CHESTPLATE, 1, 30)],
  ],
  fisherman: [
    [buy(ITEM.STRING, 20), buy(ITEM.COAL, 10), sell(1, ITEM.BUCKET, 1)],
    [buy(ITEM.RAW_CHICKEN, 15, 10), sell(1, BLOCK.BARREL, 1, 5)],
    [buy(ITEM.BONE, 20, 20), sell(1, ITEM.COOKED_CHICKEN, 6, 10)],
    [buy(ITEM.WHEAT, 20, 30), sell(2, ITEM.WATER_BUCKET, 1, 15)],
    [buy(ITEM.STICK, 30, 30), sell(4, BLOCK.SUGAR_CANE, 16, 30)],
  ],
};

// Picks two offers from a level's list (seeded by the villager), as fresh offers.
export function offersFor(profession, level, rand) {
  const pool = [...(TRADES[profession]?.[level] || [])];
  // librarians also sell enchanted books (for emeralds and a book), priced like Minecraft's
  if (profession === 'librarian' && level < 4) {
    const ench = randomBook(rand);
    const [name, lvl] = Object.entries(ench)[0];
    let price = 2 + 3 * lvl + Math.floor(rand() * (5 + lvl * 10));
    if (ENCHANTS[name].treasure) price *= 2;
    pool.push({ cost: [[E, Math.min(64, price)], [ITEM.BOOK, 1]], result: [ITEM.ENCHANTED_BOOK, 1], ench, uses: 12, xp: 1 + level * 5 });
  }
  const out = [];
  for (let i = 0; i < 2 && pool.length; i++) {
    const o = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    out.push({ cost: o.cost.map((c) => [...c]), result: [...o.result], max: o.uses, uses: 0, xp: o.xp, ...(o.ench ? { ench: { ...o.ench } } : {}) });
  }
  return out;
}
