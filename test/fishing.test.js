import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameHost, newWorldSave } from '../public/js/host.js';
import { BLOCK, ITEM, SMELTING } from '../public/js/blocks.js';
import { findRecipe } from '../public/js/inventory.js';
import { mulberry32 } from '../public/js/noise.js';
import { canApply, ENCHANTS } from '../public/js/enchant.js';

function setup() {
  const inbox = [];
  const host = new GameHost(newWorldSave({ name: 'F', seed: 9 }), (peer, msg) => inbox.push(structuredClone(msg)), { random: mulberry32(4) });
  host.message('a', { t: 'hello', name: 'Steve' });
  const p = host.players.get('a');
  // a pond: stone floor, 3 deep of still water, the player on its edge
  for (let x = -2; x <= 12; x++) for (let z = -6; z <= 6; z++) {
    host.setBlock(x, 196, z, BLOCK.STONE);
    for (let y = 197; y < 200; y++) host.setBlock(x, y, z, x < 2 ? BLOCK.STONE : BLOCK.WATER);
    for (let y = 200; y < 206; y++) host.setBlock(x, y, z, BLOCK.AIR);
  }
  Object.assign(p, { x: 0.5, y: 200, z: 0.5, yaw: -Math.PI / 2, held: ITEM.FISHING_ROD });
  const bobber = () => [...host.entities.values()].find((e) => e.type === 'bobber');
  return { host, p, inbox, bobber };
}
const cast = (host, extra = {}) => host.message('a', { t: 'fish', yaw: -Math.PI / 2, pitch: 0.3, ...extra });

test('casting a rod lands a bobber in the water, a fish bites, and reeling in catches it', () => {
  const { host, p, inbox, bobber } = setup();
  cast(host);
  const b = bobber();
  assert.ok(b && b.owner === p.id);
  for (let i = 0; i < 60; i++) host.tick(0.05);
  assert.ok(b.x > 2, `flew out over the water (${b.x.toFixed(1)})`);
  let bit = false;
  for (let i = 0; i < 40 * 20 && !bit; i++) { host.tick(0.05); bit = b.bite > 0; }
  assert.ok(bit, 'a bite within 40 seconds');
  assert.ok(Math.abs(b.y - 200) < 1, `floating at the surface (${b.y.toFixed(2)})`);
  const items = () => [...host.entities.values()].filter((e) => e.type === 'item' && e.y > 190); // (not seeds washed out of the terrain below)
  cast(host); // reel in
  assert.equal(bobber(), undefined);
  assert.ok(inbox.some((m) => m.t === 'reeled' && m.caught));
  assert.equal(items().length, 1, JSON.stringify(items().map((e) => [e.item, e.x, e.y, e.z])));
  const catchItem = items()[0];
  // it flies to the player
  for (let i = 0; i < 25; i++) host.tick(0.05);
  assert.ok(Math.hypot(catchItem.x - p.x, catchItem.z - p.z) < 3, `landed near the player (${catchItem.x.toFixed(1)}, ${catchItem.z.toFixed(1)})`);
  // reeling in too early catches nothing
  inbox.length = 0;
  cast(host);
  host.tick(0.5);
  cast(host);
  assert.ok(inbox.some((m) => m.t === 'reeled' && !m.caught));
});

test('the bobber goes when you put the rod away or walk off', () => {
  const { host, p, bobber } = setup();
  cast(host);
  host.tick(0.1);
  p.held = ITEM.STICK;
  host.tick(0.1);
  assert.equal(bobber(), undefined);
  p.held = ITEM.FISHING_ROD;
  cast(host);
  p.x = 60;
  host.tick(0.1);
  assert.equal(bobber(), undefined);
});

test("fishing loot is mostly fish, some junk and treasure; Luck of the Sea helps", () => {
  const { host } = setup();
  const tally = (luck) => {
    const c = { fish: 0, treasure: 0, junk: 0 };
    const fish = new Set([ITEM.RAW_COD, ITEM.RAW_SALMON, ITEM.TROPICAL_FISH, ITEM.PUFFERFISH]);
    const treasure = new Set([ITEM.BOW, ITEM.ENCHANTED_BOOK, ITEM.NAME_TAG, ITEM.SADDLE]);
    for (let i = 0; i < 4000; i++) {
      const [id, , extra] = host.fishLoot(luck);
      if (fish.has(id)) c.fish++;
      else if (treasure.has(id) || (id === ITEM.FISHING_ROD && extra.ench && Object.keys(extra.ench).length)) c.treasure++;
      else c.junk++;
      if (id === ITEM.ENCHANTED_BOOK) assert.ok(Object.keys(extra.ench).length > 0);
    }
    return c;
  };
  const plain = tally(0), lucky = tally(3);
  assert.ok(plain.fish > 3200 && plain.fish < 3600, `fish ${plain.fish}`);
  assert.ok(plain.treasure > 120 && plain.treasure < 300, `treasure ${plain.treasure}`);
  assert.ok(lucky.treasure > plain.treasure * 1.6, `luck: ${lucky.treasure} vs ${plain.treasure}`);
});

test('Lure makes bites come sooner; rods, cooked fish and fishing enchantments', () => {
  const avgWait = (lure) => {
    const { host, bobber } = setup();
    let total = 0;
    for (let k = 0; k < 20; k++) {
      cast(host, { lure });
      for (let i = 0; i < 60; i++) host.tick(0.05);
      total += bobber().wait;
      cast(host);
    }
    return total / 20;
  };
  assert.ok(avgWait(3) < avgWait(0) - 8);
  const S = ITEM.STICK, T = ITEM.STRING;
  assert.equal(findRecipe([null, null, { id: S, count: 1 }, null, { id: S, count: 1 }, { id: T, count: 1 }, { id: S, count: 1 }, null, { id: T, count: 1 }], 3)?.id, ITEM.FISHING_ROD);
  assert.equal(SMELTING[ITEM.RAW_COD], ITEM.COOKED_COD);
  assert.equal(SMELTING[ITEM.RAW_SALMON], ITEM.COOKED_SALMON);
  assert.ok(ENCHANTS.lure && ENCHANTS.luck_of_the_sea);
  assert.ok(canApply('lure', ITEM.FISHING_ROD));
  assert.ok(!canApply('lure', ITEM.DIAMOND_SWORD));
});
