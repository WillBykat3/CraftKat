import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brewResult, POTIONS, EFFECTS, isIngredient } from '../public/js/effects.js';
import { GameHost, newWorldSave } from '../public/js/host.js';
import { BLOCK, ITEM, getDrops } from '../public/js/blocks.js';
import { findRecipe } from '../public/js/inventory.js';
import { mulberry32 } from '../public/js/noise.js';

const bottle = (potion) => ({ id: ITEM.POTION, count: 1, potion });

test("brewing follows Minecraft's chart", () => {
  assert.equal(brewResult(bottle('water'), ITEM.NETHER_WART).potion, 'awkward');
  assert.equal(brewResult(bottle('awkward'), ITEM.SUGAR).potion, 'swiftness');
  assert.equal(brewResult(bottle('swiftness'), ITEM.REDSTONE).potion, 'long_swiftness');
  assert.equal(brewResult(bottle('swiftness'), ITEM.GLOWSTONE_DUST).potion, 'strong_swiftness');
  assert.equal(brewResult(bottle('swiftness'), ITEM.FERMENTED_SPIDER_EYE).potion, 'slowness');
  assert.equal(brewResult(bottle('healing'), ITEM.FERMENTED_SPIDER_EYE).potion, 'harming');
  assert.equal(brewResult(bottle('night_vision'), ITEM.FERMENTED_SPIDER_EYE).potion, 'invisibility');
  assert.equal(brewResult(bottle('strength'), ITEM.GUNPOWDER).id, ITEM.SPLASH_POTION);
  assert.equal(brewResult(bottle('water'), ITEM.SUGAR), null, 'sugar needs an awkward potion');
  assert.ok(isIngredient(ITEM.BLAZE_POWDER) && !isIngredient(ITEM.STICK));
  for (const p of Object.values(POTIONS)) for (const [e] of p.effects) assert.ok(EFFECTS[e], e);
});

test('ingredients: recipes, spider eyes, nether wart in fortresses, melons and mushrooms', async () => {
  const g = (rows) => rows.flat().map((id) => (id ? { id, count: 1 } : null));
  assert.equal(findRecipe(g([[ITEM.SPIDER_EYE, BLOCK.BROWN_MUSHROOM], [ITEM.SUGAR, 0]]), 2).id, ITEM.FERMENTED_SPIDER_EYE);
  const N = ITEM.GOLD_NUGGET;
  assert.equal(findRecipe(g([[N, N, N], [N, ITEM.MELON_SLICE, N], [N, N, N]]), 3).id, ITEM.GLISTERING_MELON_SLICE);
  assert.equal(findRecipe(g([[BLOCK.GLASS, 0, BLOCK.GLASS], [0, BLOCK.GLASS, 0]]), 3).count, 3);
  assert.ok(getDrops(BLOCK.MELON, 0, () => 0.5)[0][1] >= 3);
  assert.equal(getDrops(BLOCK.NETHER_WART + 3, 0, () => 0.5)[0][0], ITEM.NETHER_WART);
  const { NetherTerrain } = await import('../public/js/terrain-nether.js');
  const t = new NetherTerrain(5);
  let fort = null;
  for (let gx = -3; gx <= 3 && !fort; gx++) for (let gz = -3; gz <= 3 && !fort; gz++) fort = t.fortressIn(gx, gz);
  assert.equal(t.fortressBlock(fort[0] + 4, 65, fort[1] + 4), BLOCK.NETHER_WART + 3, 'wart in the fortress hall');
});

function setup() {
  const inbox = [];
  const host = new GameHost(newWorldSave({ name: 'B', seed: 5, mode: 'creative' }), (peer, m) => inbox.push(structuredClone(m)), { random: mulberry32(2) });
  host.message('a', { t: 'hello', name: 'Steve' });
  return { host, p: host.players.get('a'), inbox };
}

test('a brewing stand brews three bottles in 20 seconds using blaze powder', () => {
  const { host, p, inbox } = setup();
  host.setBlock(1, 150, 1, BLOCK.BREWING_STAND);
  p.x = 1; p.y = 150; p.z = 2.5;
  host.message('a', { t: 'brew_open', x: 1, y: 150, z: 1 });
  const click = (slot, cursor) => host.message('a', { t: 'brew_click', x: 1, y: 150, z: 1, slot, button: 0, cursor });
  for (const i of [0, 1, 2]) click(i, bottle('water'));
  click(3, { id: ITEM.NETHER_WART, count: 2 });
  click(4, { id: ITEM.BLAZE_POWDER, count: 1 });
  click(4, { id: ITEM.STICK, count: 1 }); // not fuel: refused
  for (let i = 0; i < 21 * 20; i++) host.tick(0.05);
  const b = host.brewers.get('1,150,1');
  assert.deepEqual(b.slots.slice(0, 3).map((s) => s.potion), ['awkward', 'awkward', 'awkward']);
  assert.equal(b.slots[3].count, 1);
  assert.equal(b.fuel, 19);
  assert.ok(inbox.some((m) => m.t === 'brewing'));
  // it's saved
  const data = structuredClone(host.serialize());
  assert.equal(new GameHost(data, () => {}, {}).dims.overworld.brewers.get('1,150,1').slots[0].potion, 'awkward');
});

test('splash potions hit players and mobs nearby; harming hurts, healing hurts the undead', () => {
  const { host, p, inbox } = setup();
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) host.setBlock(x, 199, z, BLOCK.STONE);
  p.x = 0.5; p.y = 200; p.z = 0.5; p.pitch = -1.2; p.yaw = 0;
  const pig = host.spawnMob('pig', 0.5, 200, -1.5);
  const zombie = host.spawnMob('zombie', 1.5, 200, -1.5);
  host.time = 18000; // (night, so it doesn't burn in the sun)
  host.message('a', { t: 'throw', kind: 'splash', potion: 'strong_harming', yaw: 0, pitch: -1.2 });
  for (let i = 0; i < 40; i++) host.tick(0.05);
  assert.ok(pig.hp < 10 || !host.entities.has(pig.id), 'the pig was hurt');
  assert.equal(zombie.hp, 20, 'harming heals the undead');
  assert.ok(inbox.some((m) => m.t === 'effect' && m.potion === 'strong_harming'));
  host.message('a', { t: 'throw', kind: 'splash', potion: 'nonsense', yaw: 0, pitch: -1.2 });
  assert.ok(![...host.entities.values()].some((e) => e.type === 'potion'), 'unknown potions are refused');
  // bottles o' enchanting give experience
  host.message('a', { t: 'throw', kind: 'xp', yaw: 0, pitch: -1.2 });
  for (let i = 0; i < 40; i++) host.tick(0.05);
  assert.ok([...host.entities.values()].some((e) => e.type === 'xp') || inbox.some((m) => m.t === 'xp'), 'experience (maybe already collected)');
});

test('wither skeletons wither you; nether wart grows on soul sand', () => {
  const { host, p, inbox } = setup();
  p.mode = 'survival';
  host.changeDim(p, 'nether', [0.5, 80, 0.5]);
  host.inDim('nether', () => {
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) { host.setBlock(x, 79, z, BLOCK.NETHER_BRICKS); for (let y = 80; y < 84; y++) host.setBlock(x, y, z, BLOCK.AIR); }
    host.spawnMob('wither_skeleton', 1.5, 80, 0.5);
    host.setBlock(-2, 79, -2, BLOCK.SOUL_SAND);
    host.setBlock(-2, 80, -2, BLOCK.NETHER_WART);
  });
  for (let i = 0; i < 60; i++) host.tick(0.05);
  const hit = inbox.find((m) => m.t === 'hurt' && m.cause === 'was slain by a Wither Skeleton');
  assert.deepEqual(hit.effects, [['wither', 0, 10]]);
  for (let i = 0; i < 600; i++) host.tick(1);
  assert.equal(host.dims.nether.world.getBlock(-2, 80, -2), BLOCK.NETHER_WART + 3, 'fully grown after a while');
});
