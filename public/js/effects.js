// Status effects, potions and brewing, with Minecraft's numbers. A potion stack is
// {id: POTION / SPLASH_POTION, count: 1, potion: 'swiftness'}; effects on players are
// {name: {amp, time}} (amp 0 = level I; time in seconds).

import { ITEM, BLOCK } from './blocks.js';

// effect -> [display name, colour, good?]
export const EFFECTS = {
  speed: ['Speed', '#7cafc6', true], slowness: ['Slowness', '#5a6c81', false], haste: ['Haste', '#d9c043', true],
  mining_fatigue: ['Mining Fatigue', '#4a4217', false], strength: ['Strength', '#932423', true],
  instant_health: ['Instant Health', '#f82423', true], instant_damage: ['Instant Damage', '#430a09', false],
  jump_boost: ['Jump Boost', '#22ff4c', true], nausea: ['Nausea', '#551d4a', false], regeneration: ['Regeneration', '#cd5cab', true],
  resistance: ['Resistance', '#99453a', true], fire_resistance: ['Fire Resistance', '#e49a3a', true],
  water_breathing: ['Water Breathing', '#2e5299', true], invisibility: ['Invisibility', '#7f8392', true],
  blindness: ['Blindness', '#1f1f23', false], night_vision: ['Night Vision', '#1f1fa1', true], hunger: ['Hunger', '#587653', false],
  weakness: ['Weakness', '#484d48', false], poison: ['Poison', '#4e9331', false], wither: ['Wither', '#352a27', false],
  absorption: ['Absorption', '#2552a5', true], saturation: ['Saturation', '#f82423', true], slow_falling: ['Slow Falling', '#f7f8e0', true],
};

// potion -> [display name, effects [[effect, amp, seconds]]]
const P = (label, effects = []) => ({ label, effects });
export const POTIONS = {
  water: P('Water Bottle'), awkward: P('Awkward Potion'), mundane: P('Mundane Potion'), thick: P('Thick Potion'),
  swiftness: P('Potion of Swiftness', [['speed', 0, 180]]), long_swiftness: P('Potion of Swiftness', [['speed', 0, 480]]), strong_swiftness: P('Potion of Swiftness', [['speed', 1, 90]]),
  slowness: P('Potion of Slowness', [['slowness', 0, 90]]), long_slowness: P('Potion of Slowness', [['slowness', 0, 240]]), strong_slowness: P('Potion of Slowness', [['slowness', 3, 20]]),
  strength: P('Potion of Strength', [['strength', 0, 180]]), long_strength: P('Potion of Strength', [['strength', 0, 480]]), strong_strength: P('Potion of Strength', [['strength', 1, 90]]),
  healing: P('Potion of Healing', [['instant_health', 0, 0]]), strong_healing: P('Potion of Healing', [['instant_health', 1, 0]]),
  harming: P('Potion of Harming', [['instant_damage', 0, 0]]), strong_harming: P('Potion of Harming', [['instant_damage', 1, 0]]),
  poison: P('Potion of Poison', [['poison', 0, 45]]), long_poison: P('Potion of Poison', [['poison', 0, 90]]), strong_poison: P('Potion of Poison', [['poison', 1, 21]]),
  regeneration: P('Potion of Regeneration', [['regeneration', 0, 45]]), long_regeneration: P('Potion of Regeneration', [['regeneration', 0, 90]]), strong_regeneration: P('Potion of Regeneration', [['regeneration', 1, 22]]),
  fire_resistance: P('Potion of Fire Resistance', [['fire_resistance', 0, 180]]), long_fire_resistance: P('Potion of Fire Resistance', [['fire_resistance', 0, 480]]),
  night_vision: P('Potion of Night Vision', [['night_vision', 0, 180]]), long_night_vision: P('Potion of Night Vision', [['night_vision', 0, 480]]),
  invisibility: P('Potion of Invisibility', [['invisibility', 0, 180]]), long_invisibility: P('Potion of Invisibility', [['invisibility', 0, 480]]),
  weakness: P('Potion of Weakness', [['weakness', 0, 90]]), long_weakness: P('Potion of Weakness', [['weakness', 0, 240]]),
  leaping: P('Potion of Leaping', [['jump_boost', 0, 180]]), long_leaping: P('Potion of Leaping', [['jump_boost', 0, 480]]), strong_leaping: P('Potion of Leaping', [['jump_boost', 1, 90]]),
  water_breathing: P('Potion of Water Breathing', [['water_breathing', 0, 180]]), long_water_breathing: P('Potion of Water Breathing', [['water_breathing', 0, 480]]),
  slow_falling: P('Potion of Slow Falling', [['slow_falling', 0, 90]]), long_slow_falling: P('Potion of Slow Falling', [['slow_falling', 0, 240]]),
};

// The colour a potion's liquid is drawn in.
export function potionColor(name) {
  const e = POTIONS[name]?.effects[0];
  if (!e) return name === 'water' ? '#385dc6' : '#5f6fd8';
  return EFFECTS[e[0]][1];
}

export function potionLabel(id, name) {
  const base = POTIONS[name]?.label ?? 'Potion';
  if (id === ITEM.SPLASH_POTION) return base.replace('Potion of', 'Splash Potion of').replace(/^(Water Bottle|Awkward Potion|Mundane Potion|Thick Potion)$/, (m) => `Splash ${m}`);
  return base;
}

// Brewing: [potion, ingredient] -> potion (base ingredients first, then modifiers).
const BREWS = new Map();
const brew = (from, ingredient, to) => BREWS.set(`${from}|${ingredient}`, to);
brew('water', ITEM.NETHER_WART, 'awkward');
brew('water', ITEM.REDSTONE, 'mundane');
brew('water', ITEM.GLOWSTONE_DUST, 'thick');
brew('water', ITEM.FERMENTED_SPIDER_EYE, 'weakness');
brew('awkward', ITEM.SUGAR, 'swiftness');
brew('awkward', ITEM.GLISTERING_MELON_SLICE, 'healing');
brew('awkward', ITEM.SPIDER_EYE, 'poison');
brew('awkward', ITEM.GHAST_TEAR, 'regeneration');
brew('awkward', ITEM.BLAZE_POWDER, 'strength');
brew('awkward', ITEM.MAGMA_CREAM, 'fire_resistance');
brew('awkward', ITEM.GOLDEN_CARROT, 'night_vision');
brew('awkward', ITEM.RABBIT_FOOT, 'leaping');
brew('awkward', ITEM.PUFFERFISH, 'water_breathing');
brew('awkward', ITEM.PHANTOM_MEMBRANE, 'slow_falling');
// corrupting with a fermented spider eye
for (const [from, to] of [['swiftness', 'slowness'], ['long_swiftness', 'long_slowness'], ['leaping', 'slowness'], ['long_leaping', 'long_slowness'],
  ['healing', 'harming'], ['strong_healing', 'strong_harming'], ['poison', 'harming'], ['long_poison', 'harming'], ['strong_poison', 'strong_harming'],
  ['night_vision', 'invisibility'], ['long_night_vision', 'long_invisibility']]) brew(from, ITEM.FERMENTED_SPIDER_EYE, to);
// redstone makes it last longer, glowstone makes it stronger
for (const name of Object.keys(POTIONS)) {
  if (POTIONS[`long_${name}`]) brew(name, ITEM.REDSTONE, `long_${name}`);
  if (POTIONS[`strong_${name}`]) brew(name, ITEM.GLOWSTONE_DUST, `strong_${name}`);
}

export const BREW_SECONDS = 20;
export const isIngredient = (id) => [...BREWS.keys()].some((k) => Number(k.split('|')[1]) === id) || id === ITEM.GUNPOWDER;

// What a bottle in a brewing stand becomes with an ingredient, or null.
export function brewResult(bottle, ingredient) {
  if (!bottle || (bottle.id !== ITEM.POTION && bottle.id !== ITEM.SPLASH_POTION)) return null;
  if (ingredient === ITEM.GUNPOWDER) return bottle.id === ITEM.POTION ? { ...bottle, id: ITEM.SPLASH_POTION } : null;
  const to = BREWS.get(`${bottle.potion}|${ingredient}`);
  return to ? { ...bottle, potion: to } : null;
}

export const validPotion = (name) => typeof name === 'string' && Object.hasOwn(POTIONS, name);

// Undead are hurt by healing and healed by harming.
export const UNDEAD = new Set(['zombie', 'husk', 'skeleton', 'stray', 'wither_skeleton', 'zombified_piglin', 'drowned', 'phantom', 'zombie_villager']);

// Effects of food, and of mobs' attacks: item or attacker -> [[effect, amp, seconds, chance]]
export const FOOD_EFFECTS = {
  [ITEM.GOLDEN_APPLE]: [['regeneration', 1, 5], ['absorption', 0, 120]],
  [ITEM.ROTTEN_FLESH]: [['hunger', 0, 30, 0.8]],
  [ITEM.SPIDER_EYE]: [['poison', 0, 5]],
  [ITEM.RAW_CHICKEN]: [['hunger', 0, 30, 0.3]],
  [ITEM.PUFFERFISH]: [['poison', 1, 60], ['hunger', 2, 15], ['nausea', 0, 15]],
};
export const ATTACK_EFFECTS = {
  wither_skeleton: [['wither', 0, 10]],
  husk: [['hunger', 0, 7]],
};

void BLOCK;
