// Biomes of generator version 3, with Minecraft's grass and foliage colours.
// Biome ids are only used while the game runs (they are never saved), but
// keep them stable anyway so debug output stays comparable.

export const BIOME = {
  LEGACY: 0, OCEAN: 1, DEEP_OCEAN: 2, WARM_OCEAN: 3, FROZEN_OCEAN: 4, RIVER: 5, FROZEN_RIVER: 6,
  BEACH: 7, SNOWY_BEACH: 8, STONY_SHORE: 9, PLAINS: 10, SUNFLOWER_PLAINS: 11, FOREST: 12, FLOWER_FOREST: 13,
  BIRCH_FOREST: 14, DARK_FOREST: 15, TAIGA: 16, SNOWY_TAIGA: 17, SNOWY_PLAINS: 18, DESERT: 19, SAVANNA: 20,
  JUNGLE: 21, SWAMP: 22, CHERRY_GROVE: 23, MEADOW: 24, STONY_PEAKS: 25, SNOWY_SLOPES: 26, FROZEN_PEAKS: 27,
};

// [name, grass colour, foliage colour, water colour]
const DEFS = {
  [BIOME.LEGACY]: ['plains', 0x91bd59, 0x77ab2f, 0x3f76e4],
  [BIOME.OCEAN]: ['ocean', 0x8eb971, 0x71a74d, 0x3f76e4],
  [BIOME.DEEP_OCEAN]: ['deep_ocean', 0x8eb971, 0x71a74d, 0x3f76e4],
  [BIOME.WARM_OCEAN]: ['warm_ocean', 0x8eb971, 0x71a74d, 0x43d5ee],
  [BIOME.FROZEN_OCEAN]: ['frozen_ocean', 0x80b497, 0x60a17b, 0x3938c9],
  [BIOME.RIVER]: ['river', 0x8eb971, 0x71a74d, 0x3f76e4],
  [BIOME.FROZEN_RIVER]: ['frozen_river', 0x80b497, 0x60a17b, 0x3938c9],
  [BIOME.BEACH]: ['beach', 0x91bd59, 0x77ab2f, 0x3f76e4],
  [BIOME.SNOWY_BEACH]: ['snowy_beach', 0x80b497, 0x60a17b, 0x3d57d6],
  [BIOME.STONY_SHORE]: ['stony_shore', 0x8ab689, 0x6da36b, 0x3f76e4],
  [BIOME.PLAINS]: ['plains', 0x91bd59, 0x77ab2f, 0x3f76e4],
  [BIOME.SUNFLOWER_PLAINS]: ['sunflower_plains', 0x91bd59, 0x77ab2f, 0x3f76e4],
  [BIOME.FOREST]: ['forest', 0x79c05a, 0x59ae30, 0x3f76e4],
  [BIOME.FLOWER_FOREST]: ['flower_forest', 0x79c05a, 0x59ae30, 0x3f76e4],
  [BIOME.BIRCH_FOREST]: ['birch_forest', 0x88bb67, 0x6ba941, 0x3f76e4],
  [BIOME.DARK_FOREST]: ['dark_forest', 0x507a32, 0x59ae30, 0x3f76e4],
  [BIOME.TAIGA]: ['taiga', 0x86b783, 0x68a464, 0x287082],
  [BIOME.SNOWY_TAIGA]: ['snowy_taiga', 0x80b497, 0x60a17b, 0x3d57d6],
  [BIOME.SNOWY_PLAINS]: ['snowy_plains', 0x80b497, 0x60a17b, 0x3d57d6],
  [BIOME.DESERT]: ['desert', 0xbfb755, 0xaea42a, 0x32a598],
  [BIOME.SAVANNA]: ['savanna', 0xbfb755, 0xaea42a, 0x2c8b9c],
  [BIOME.JUNGLE]: ['jungle', 0x59c93c, 0x30bb0b, 0x14a2c5],
  [BIOME.SWAMP]: ['swamp', 0x6a7039, 0x6a7039, 0x617b64],
  [BIOME.CHERRY_GROVE]: ['cherry_grove', 0xb6db61, 0xb6db61, 0x5db7ef],
  [BIOME.MEADOW]: ['meadow', 0x83bb6d, 0x63a948, 0x0e4ecf],
  [BIOME.STONY_PEAKS]: ['stony_peaks', 0x9abe4b, 0x82ac1e, 0x3f76e4],
  [BIOME.SNOWY_SLOPES]: ['snowy_slopes', 0x80b497, 0x60a17b, 0x3d57d6],
  [BIOME.FROZEN_PEAKS]: ['frozen_peaks', 0x80b497, 0x60a17b, 0x3938c9],
};

const rgb = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

export const BIOMES = [];
for (const [id, [name, grass, foliage, water]] of Object.entries(DEFS)) {
  BIOMES[id] = { id: +id, name, grass: rgb(grass), foliage: rgb(foliage), water: rgb(water) };
}

export const DEFAULT_GRASS = BIOMES[BIOME.PLAINS].grass;
export const DEFAULT_FOLIAGE = BIOMES[BIOME.PLAINS].foliage;

export const FROZEN = new Set([BIOME.FROZEN_OCEAN, BIOME.FROZEN_RIVER, BIOME.SNOWY_PLAINS, BIOME.SNOWY_TAIGA,
  BIOME.SNOWY_BEACH, BIOME.SNOWY_SLOPES, BIOME.FROZEN_PEAKS]);
