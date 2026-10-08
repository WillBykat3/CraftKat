// Experience, with Minecraft's numbers.

import { BLOCK, ITEM } from './blocks.js';

// points needed to go from `level` to the next one
export function pointsForLevel(level) {
  return level < 16 ? 2 * level + 7 : level < 31 ? 5 * level - 38 : 9 * level - 158;
}

// {level, progress (0-1)} from total points
export function levelInfo(total) {
  let level = 0;
  let left = Math.max(0, Math.floor(total));
  while (left >= pointsForLevel(level)) left -= pointsForLevel(level++);
  return { level, progress: left / pointsForLevel(level) };
}

export const levelOf = (total) => levelInfo(total).level;

// orb sizes, largest first
export const XP_SIZES = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];

// [min, max] experience for mining an ore with a tool that gets its drop
export const ORE_XP = {
  [BLOCK.COAL_ORE]: [0, 2], [BLOCK.DEEPSLATE_COAL_ORE]: [0, 2],
  [BLOCK.DIAMOND_ORE]: [3, 7], [BLOCK.DEEPSLATE_DIAMOND_ORE]: [3, 7],
  [BLOCK.EMERALD_ORE]: [3, 7],
  [BLOCK.LAPIS_ORE]: [2, 5], [BLOCK.DEEPSLATE_LAPIS_ORE]: [2, 5],
  [BLOCK.REDSTONE_ORE]: [1, 5], [BLOCK.DEEPSLATE_REDSTONE_ORE]: [1, 5],
};

// experience per smelted item
export const SMELT_XP = {
  [ITEM.IRON_INGOT]: 0.7, [ITEM.GOLD_INGOT]: 1, [ITEM.COPPER_INGOT]: 0.7, [BLOCK.GLASS]: 0.1, [BLOCK.STONE]: 0.1,
  [ITEM.COAL]: 0.15, [BLOCK.BRICK]: 0.3, [ITEM.COOKED_PORKCHOP]: 0.35, [ITEM.STEAK]: 0.35,
  [ITEM.COOKED_CHICKEN]: 0.35, [ITEM.COOKED_MUTTON]: 0.35, [BLOCK.DEEPSLATE]: 0.1,
};
