import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableOffers, anvilCombine, grind, canApply, rollEnchants, protectionPoints, wears, validEnch, conflicts, ENCHANTS } from '../public/js/enchant.js';
import { BLOCK, ITEM, getDrops, breakTime } from '../public/js/blocks.js';
import { GameHost, newWorldSave } from '../public/js/host.js';
import { mulberry32 } from '../public/js/noise.js';

test('the enchanting table: more bookshelves, higher levels; offers suit the item', () => {
  const none = tableOffers(ITEM.DIAMOND_SWORD, 0, 12345);
  const full = tableOffers(ITEM.DIAMOND_SWORD, 15, 12345);
  assert.equal(full.length, 3);
  assert.ok(Math.max(...none.map((o) => o.cost)) <= 8, 'no shelves: low levels');
  assert.equal(full[2].cost, 30, 'all 15 shelves: the bottom offer costs 30, like Minecraft');
  for (let seed = 0; seed < 200; seed++) {
    for (const o of tableOffers(ITEM.DIAMOND_SWORD, 15, seed)) {
      for (const name of Object.keys(o.ench)) assert.ok(canApply(name, ITEM.DIAMOND_SWORD), `${name} on a sword`);
      const names = Object.keys(o.ench);
      for (const a of names) for (const b of names) assert.ok(!conflicts(a, b), `${a} with ${b}`);
      assert.ok(!o.ench.mending, 'mending never comes from the table');
    }
    for (const o of tableOffers(ITEM.BOOK, 15, seed)) assert.ok(Object.keys(o.ench).length >= 1, 'books get enchanted');
  }
  assert.deepEqual(tableOffers(ITEM.STICK, 15, 1), [], "sticks can't be enchanted");
  // same seed, same offers (no rerolling by reopening the table)
  assert.deepEqual(tableOffers(ITEM.IRON_PICKAXE, 10, 77), tableOffers(ITEM.IRON_PICKAXE, 10, 77));
  // gold tools/armor enchant better than stone
  let gold = 0, leather = 0;
  for (let i = 0; i < 300; i++) {
    gold += Object.keys(rollEnchants(ITEM.GOLDEN_CHESTPLATE, 30, mulberry32(i))).length;
    leather += Object.keys(rollEnchants(ITEM.IRON_CHESTPLATE, 30, mulberry32(i))).length;
  }
  assert.ok(gold > leather);
});

test('anvils combine enchantments, repair with material, and get dearer each use', () => {
  const a = { id: ITEM.DIAMOND_SWORD, count: 1, dur: 500, ench: { sharpness: 3 } };
  const b = { id: ITEM.DIAMOND_SWORD, count: 1, dur: 800, ench: { sharpness: 3, looting: 2 } };
  const out = anvilCombine(a, b);
  assert.equal(out.result.ench.sharpness, 4, 'equal levels go up one');
  assert.equal(out.result.ench.looting, 2);
  assert.ok(out.result.dur > 1300 - 1);
  assert.equal(out.result.rc, 1);
  const book = { id: ITEM.ENCHANTED_BOOK, count: 1, ench: { mending: 1 } };
  const again = anvilCombine(out.result, book);
  assert.equal(again.result.ench.mending, 1);
  assert.ok(again.cost > 1, 'prior work makes it dearer');
  // conflicts don't combine
  assert.equal(anvilCombine({ id: ITEM.DIAMOND_PICKAXE, count: 1, dur: 10, ench: { silk_touch: 1 } }, { id: ITEM.ENCHANTED_BOOK, count: 1, ench: { fortune: 3 } })?.result.ench.fortune, undefined);
  // repair with diamonds: a quarter each
  const worn = { id: ITEM.DIAMOND_PICKAXE, count: 1, dur: 100 };
  const fixed = anvilCombine(worn, { id: ITEM.DIAMOND, count: 2 });
  assert.equal(fixed.used, 2);
  assert.ok(fixed.result.dur > 100 + 700);
  // grindstone takes enchantments off and gives experience
  const g = grind({ id: ITEM.ENCHANTED_BOOK, count: 1, ench: { sharpness: 5 } });
  assert.equal(g.result.id, ITEM.BOOK);
  assert.ok(g.xp > 0);
});

test('enchantment effects: protection, unbreaking, efficiency, silk touch, fortune', () => {
  const armor = [{ id: ITEM.DIAMOND_HELMET, count: 1, dur: 1, ench: { protection: 4 } }, null, null, { id: ITEM.DIAMOND_BOOTS, count: 1, dur: 1, ench: { feather_falling: 4 } }];
  assert.equal(protectionPoints(armor, 'other'), 4);
  assert.equal(protectionPoints(armor, 'fall'), 16);
  let used = 0;
  for (let i = 0; i < 1000; i++) if (wears({ ench: { unbreaking: 3 } }, mulberry32(i))) used++;
  assert.ok(used > 150 && used < 350, `unbreaking III: about a quarter (${used})`);
  assert.ok(breakTime(BLOCK.STONE, ITEM.IRON_PICKAXE, 5) < breakTime(BLOCK.STONE, ITEM.IRON_PICKAXE) / 3);
  assert.deepEqual(getDrops(BLOCK.DIAMOND_ORE, ITEM.IRON_PICKAXE, () => 0.5, { silk_touch: 1 }), [[BLOCK.DIAMOND_ORE, 1]]);
  let diamonds = 0;
  for (let i = 0; i < 400; i++) diamonds += getDrops(BLOCK.DIAMOND_ORE, ITEM.IRON_PICKAXE, mulberry32(i), { fortune: 3 })[0][1];
  assert.ok(diamonds / 400 > 1.8, `fortune III averages ~2.2 diamonds (${diamonds / 400})`);
  assert.ok(validEnch({ sharpness: 5 }) && !validEnch({ sharpness: 6 }) && !validEnch({ nope: 1 }) && !validEnch([]));
  assert.ok(Object.keys(ENCHANTS).length >= 20);
});

test('host: sharpness, smite and looting hurt more and drop more; enchanted items keep their enchantments', () => {
  const inbox = [];
  const host = new GameHost(newWorldSave({ name: 'E', seed: 3 }), (peer, m) => inbox.push(m), { random: mulberry32(1) });
  host.message('a', { t: 'hello', name: 'Steve' });
  const p = host.players.get('a');
  const z = host.spawnMob('zombie', p.x + 1, p.y, p.z);
  host.message('a', { t: 'attack', e: z.id, tool: ITEM.DIAMOND_SWORD });
  const plain = 20 - z.hp;
  const z2 = host.spawnMob('zombie', p.x + 1, p.y, p.z);
  host.message('a', { t: 'attack', e: z2.id, tool: ITEM.DIAMOND_SWORD, ench: { smite: 5 } });
  assert.equal(20 - z2.hp, plain + 12.5);
  // a bad enchantment is ignored
  const z3 = host.spawnMob('zombie', p.x + 1, p.y, p.z);
  host.message('a', { t: 'attack', e: z3.id, tool: ITEM.DIAMOND_SWORD, ench: { smite: 99 } });
  assert.equal(20 - z3.hp, plain);
  // dropped enchanted items stay enchanted when picked up
  host.message('a', { t: 'drop', stack: { id: ITEM.DIAMOND_SWORD, count: 1, dur: 1000, ench: { sharpness: 5 } } });
  const item = [...host.entities.values()].find((e) => e.type === 'item' && e.item === ITEM.DIAMOND_SWORD);
  assert.deepEqual(item.ench, { sharpness: 5 });
  item.age = 5; item.x = p.x; item.y = p.y + 0.9; item.z = p.z;
  host.message('a', { t: 'pickup', e: item.id });
  assert.deepEqual(inbox.filter((m) => m.t === 'give').pop().ench, { sharpness: 5 });
});
