import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameHost, newWorldSave } from '../public/js/host.js';
import { BLOCK, ITEM, maxDurability } from '../public/js/blocks.js';
import { findRecipe } from '../public/js/inventory.js';
import { mulberry32 } from '../public/js/noise.js';

const g = (...ids) => ids.map((id) => (id ? { id, count: 1 } : null));

test('the offhand slot is saved with the player and comes back when they rejoin', () => {
  const host = new GameHost(newWorldSave({ name: 'O', seed: 1 }), () => {}, { random: mulberry32(1) });
  host.message('a', { t: 'hello', name: 'Steve' });
  const p = host.players.get('a');
  host.message('a', { t: 'save', inv: new Array(36).fill(null), offhand: { id: ITEM.SHIELD, count: 1, dur: 300 } });
  assert.deepEqual(p.offhand, { id: ITEM.SHIELD, count: 1, dur: 300 });
  host.message('a', { t: 'save', offhand: { id: ITEM.SHIELD, count: 5 } }); // not a valid stack: ignored
  assert.equal(p.offhand.count, 1);
  host.storePlayer(p);
  const sent = [];
  const host3 = new GameHost(structuredClone(host.serialize()), (peer, m) => sent.push(m), {});
  host3.message('b', { t: 'hello', name: 'Steve' });
  assert.deepEqual(sent.find((m) => m.t === 'welcome').me.offhand, { id: ITEM.SHIELD, count: 1, dur: 300 });
});

test('shields, compasses and clocks are crafted like Minecraft', () => {
  const P = BLOCK.PLANKS, I = ITEM.IRON_INGOT, R = ITEM.REDSTONE, G = ITEM.GOLD_INGOT;
  assert.equal(findRecipe(g(P, I, P, P, P, P, 0, P, 0), 3)?.id, ITEM.SHIELD);
  assert.equal(maxDurability(ITEM.SHIELD), 336);
  assert.equal(findRecipe(g(0, I, 0, I, R, I, 0, I, 0), 3)?.id, ITEM.COMPASS);
  assert.equal(findRecipe(g(0, G, 0, G, R, G, 0, G, 0), 3)?.id, ITEM.CLOCK);
});
