import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameHost, newWorldSave } from '../public/js/host.js';
import { World } from '../public/js/world.js';
import { BLOCK, BLOCKS, ITEM } from '../public/js/blocks.js';
import { mulberry32 } from '../public/js/noise.js';
import { END_PLATFORM } from '../public/js/terrain-end.js';

function setup() {
  const inbox = new Map();
  const save = newWorldSave({ name: 'Test', seed: 1234, mode: 'creative' });
  const host = new GameHost(save, (peer, msg) => {
    if (!inbox.has(peer)) inbox.set(peer, []);
    inbox.get(peer).push(structuredClone(msg));
  }, { random: mulberry32(7) });
  const join = (peer, name) => { host.message(peer, { t: 'hello', name }); return host.players.get(peer); };
  const last = (peer, t) => [...(inbox.get(peer) || [])].reverse().find((m) => m.t === t);
  const all = (peer, t) => (inbox.get(peer) || []).filter((m) => m.t === t);
  return { host, save, inbox, join, last, all };
}

// A 4 x 5 obsidian frame (2 x 3 inside) along x, on a stone floor, high in the sky.
function buildFrame(host, x, y, z) {
  for (let i = -2; i <= 3; i++) for (let k = -2; k <= 2; k++) host.setBlock(x + i, y - 2, z + k, BLOCK.STONE);
  for (let i = -1; i <= 2; i++) for (let j = -1; j <= 3; j++) {
    const edge = i < 0 || i > 1 || j < 0 || j > 2;
    host.setBlock(x + i, y + j, z, edge ? BLOCK.OBSIDIAN : BLOCK.AIR);
  }
}

test('the Nether and the End generate like Minecraft', () => {
  const nether = new World(1234, 3, 'nether');
  assert.equal(nether.hasSky, false);
  assert.equal(nether.getBlock(5, 0, 5), BLOCK.BEDROCK);
  assert.equal(nether.getBlock(5, 127, 5), BLOCK.BEDROCK);
  let netherrack = 0, lava = 0;
  for (let x = 0; x < 32; x++) for (let y = 5; y < 120; y += 3) {
    const id = nether.getBlock(x, y, 7);
    if (id === BLOCK.NETHERRACK) netherrack++;
    if (id === BLOCK.LAVA) lava++;
  }
  assert.ok(netherrack > 200, 'mostly netherrack');
  assert.ok(lava > 0 || netherrack > 0);
  const end = new World(1234, 3, 'end');
  assert.equal(end.getBlock(20, 58, 0), BLOCK.END_STONE);
  assert.equal(end.getBlock(400, 58, 400), BLOCK.AIR, 'the void around the island');
  assert.equal(end.getBlock(...END_PLATFORM), BLOCK.OBSIDIAN);
});

test('flint and steel lights an obsidian frame, and breaking the frame puts it out', () => {
  const { host, join } = setup();
  const p = join('a', 'Steve');
  const [x, y, z] = [10, 200, 10];
  buildFrame(host, x, y, z);
  host.message('a', { t: 'pos', p: [x + 0.5, y, z + 2.5], r: [0, 0] });
  // not a frame: lighting the air beside it starts a fire
  host.message('a', { t: 'use', x: x + 3, y: y - 2, z: z + 2, item: ITEM.FLINT_AND_STEEL, face: [0, 1, 0] });
  assert.equal(host.world.getBlock(x + 3, y - 1, z + 2), BLOCK.FIRE);
  host.message('a', { t: 'use', x, y: y - 1, z, item: ITEM.FLINT_AND_STEEL, face: [0, 1, 0] });
  for (let i = 0; i <= 1; i++) for (let j = 0; j <= 2; j++) assert.equal(host.world.getBlock(x + i, y + j, z), BLOCK.NETHER_PORTAL, `${i},${j}`);
  assert.equal(host.portals.length, 1);
  assert.ok(p);
  host.message('a', { t: 'dig', x: x - 1, y: y + 1, z });
  for (let i = 0; i <= 1; i++) for (let j = 0; j <= 2; j++) assert.equal(host.world.getBlock(x + i, y + j, z), BLOCK.AIR);
  // an open frame doesn't make a portal (just a fire)
  host.message('a', { t: 'use', x, y: y - 1, z, item: ITEM.FLINT_AND_STEEL, face: [0, 1, 0] });
  assert.equal(host.world.getBlock(x, y + 1, z), BLOCK.AIR);
  assert.notEqual(BLOCKS[host.world.getBlock(x, y, z)].shape, 'portal');
});

test('standing in a portal takes you to the Nether and back to the same portal', () => {
  const { host, join, last, inbox } = setup();
  const p = join('a', 'Steve');
  const q = join('b', 'Alex');
  q.mode = 'survival';
  const [x, y, z] = [80, 200, 80];
  buildFrame(host, x, y, z);
  host.message('a', { t: 'pos', p: [x + 0.5, y, z + 2.5], r: [0, 0] });
  host.message('a', { t: 'use', x, y: y - 1, z, item: ITEM.FLINT_AND_STEEL, face: [0, 1, 0] });
  host.message('b', { t: 'pos', p: [x + 1, y, z + 0.5], r: [0, 0] });
  for (let i = 0; i < 30; i++) host.tick(0.1);
  assert.equal(q.dim, 'overworld', 'survival players wait 4 seconds');
  for (let i = 0; i < 15; i++) host.tick(0.1);
  assert.equal(q.dim, 'nether');
  const msg = last('b', 'dimension');
  assert.equal(msg.dim, 'nether');
  assert.equal(msg.ds, 1);
  assert.ok(Math.abs(msg.pos[0] - x / 8) < 20 && Math.abs(msg.pos[2] - z / 8) < 20, 'coordinates divide by 8');
  assert.equal(last('a', 'leave').id, q.id, 'the others see them go');
  // a portal was built where they arrived, and they stand in it
  const nether = host.dims.nether.world;
  assert.equal(BLOCKS[nether.getBlock(Math.floor(msg.pos[0]), msg.pos[1], Math.floor(msg.pos[2]))].shape, 'portal');
  // positions sent before arriving are ignored
  host.message('b', { t: 'pos', p: [x, y, z], r: [0, 0], ds: 0 });
  assert.notEqual(q.x, x);
  // they're still standing in the portal: nothing happens until they step out and back in
  for (let i = 0; i < 60; i++) host.tick(0.1);
  assert.equal(q.dim, 'nether');
  const [nx, ny, nz] = msg.pos;
  host.message('b', { t: 'pos', p: [nx + 3, ny, nz + 3], r: [0, 0], ds: 1 });
  host.tick(0.1);
  host.message('b', { t: 'pos', p: [nx, ny, nz], r: [0, 0], ds: 1 });
  for (let i = 0; i < 45; i++) host.tick(0.1);
  assert.equal(q.dim, 'overworld');
  const back = last('b', 'dimension');
  assert.ok(Math.abs(back.pos[0] - (x + 1)) <= 1 && Math.abs(back.pos[2] - (z + 0.5)) <= 1, `back at the first portal: ${back.pos}`);
  assert.equal(host.portals.length, 2, 'no extra portal was made');
  // blocks changed in one dimension aren't sent to players in the other
  q.dim = 'nether';
  inbox.set('a', []);
  host.inDim('nether', () => host.setBlock(0, 50, 0, BLOCK.STONE));
  assert.equal(last('a', 'set'), undefined);
  assert.ok(p);
});

test('dimensions are saved: edits, where players are, and portals', () => {
  const { host, join, save } = setup();
  const p = join('a', 'Steve');
  host.inDim('nether', () => host.setBlock(3, 60, 3, BLOCK.GLOWSTONE));
  host.changeDim(p, 'nether', [3.5, 61, 3.5]);
  host.addPortal.call(host, [1, 2, 3], 0);
  const data = structuredClone(host.serialize());
  assert.deepEqual(data.edits.find(([x, y, z]) => x === 3 && y === 60 && z === 3), undefined, 'not in the Overworld');
  const host2 = new GameHost(data, () => {}, {});
  assert.equal(host2.dims.nether.world.getBlock(3, 60, 3), BLOCK.GLOWSTONE);
  assert.equal(host2.portals.length, 1);
  host2.message('a', { t: 'hello', name: 'Steve' });
  assert.equal(host2.players.get('a').dim, 'nether');
  assert.ok(save);
});

test('dying in the Nether brings you home; beds explode there', () => {
  const { host, join, last } = setup();
  const p = join('a', 'Steve');
  host.changeDim(p, 'nether', [0.5, 70, 0.5]);
  host.message('a', { t: 'died', items: [] });
  host.message('a', { t: 'respawn' });
  assert.equal(p.dim, 'overworld');
  assert.deepEqual(last('a', 'dimension').pos, host.save.spawn);
  host.changeDim(p, 'nether', [0.5, 70, 0.5]);
  host.inDim('nether', () => host.setBlock(1, 70, 0, BLOCK.BED));
  host.message('a', { t: 'sleep', x: 1, y: 70, z: 0 });
  assert.equal(host.dims.nether.world.getBlock(1, 70, 0), BLOCK.AIR);
  assert.ok(last('a', 'boom'));
  assert.equal(p.bed, null);
});

test('an End portal takes you to the obsidian platform', () => {
  const { host, join, last } = setup();
  const p = join('a', 'Steve');
  host.setBlock(5, 150, 5, BLOCK.END_PORTAL);
  host.message('a', { t: 'pos', p: [5.5, 150, 5.5], r: [0, 0] });
  host.tick(0.05);
  assert.equal(p.dim, 'end');
  const [px, py, pz] = END_PLATFORM;
  assert.deepEqual(last('a', 'dimension').pos, [px + 0.5, py + 1, pz + 0.5]);
  assert.equal(host.dims.end.world.getBlock(px, py, pz), BLOCK.OBSIDIAN);
});

// A closed box of air in the Nether (stone walls), with the player standing in it.
function netherRoom(host, p, size = 12) {
  host.changeDim(p, 'nether', [0.5, 61, 0.5]);
  host.inDim('nether', () => {
    for (let x = -size; x <= size; x++) for (let z = -size; z <= size; z++) for (let y = 59; y <= 75; y++) {
      const wall = Math.abs(x) === size || Math.abs(z) === size || y === 59 || y === 75 || y === 60;
      host.dims.nether.world.setBlock(x, y, z, wall ? BLOCK.STONE : BLOCK.AIR);
    }
  });
  p.mode = 'survival';
}

test('ghasts spit fireballs that explode; hitting one back kills the ghast', () => {
  const { host, join, all } = setup();
  const p = join('a', 'Steve');
  netherRoom(host, p);
  host.message('a', { t: 'pos', p: [0.5, 61, 0.5], r: [0, 0], ds: p.ds });
  const ghast = host.inDim('nether', () => host.spawnMob('ghast', 0.5, 66, -8));
  let fireball = null;
  for (let i = 0; i < 60 && !fireball; i++) {
    host.tick(0.05);
    fireball = [...host.entities.values()].find((e) => e.type === 'fireball');
  }
  assert.ok(fireball, 'a fireball was shot');
  assert.equal(fireball.dim, 'nether');
  assert.ok(all('a', 'sfx').some((m) => m.s === 'ghast'));
  // punch it back towards the ghast
  const yaw = Math.atan2(-(ghast.x - p.x), -(ghast.z - p.z));
  const pitch = Math.atan2(ghast.y + 2 - (p.y + 1.6), Math.hypot(ghast.x - p.x, ghast.z - p.z));
  p.yaw = yaw; p.pitch = pitch;
  fireball.x = p.x; fireball.y = p.y + 1.5; fireball.z = p.z - 1;
  host.message('a', { t: 'attack', e: fireball.id, tool: 0 });
  assert.equal(fireball.reflected, 'Steve');
  for (let i = 0; i < 40 && host.entities.has(ghast.id); i++) host.tick(0.05);
  assert.ok(!host.entities.has(ghast.id), 'the ghast died');
  // a fireball that hits the player hurts them
  const g2 = host.inDim('nether', () => host.spawnMob('ghast', 0.5, 66, 8));
  const f2 = host.inDim('nether', () => host.shootFireball(g2, p, true));
  for (let i = 0; i < 40 && host.entities.has(f2.id); i++) host.tick(0.05);
  assert.ok(all('a', 'hurt').some((m) => m.cause === 'was fireballed by a Ghast'));
});

test('zombified piglins are calm until one is hit, then the group attacks', () => {
  const { host, join, all } = setup();
  const p = join('a', 'Steve');
  netherRoom(host, p);
  host.message('a', { t: 'pos', p: [0.5, 61, 0.5], r: [0, 0], ds: p.ds });
  const a = host.inDim('nether', () => host.spawnMob('zombified_piglin', 2.5, 61, 0.5));
  const b = host.inDim('nether', () => host.spawnMob('zombified_piglin', -3.5, 61, 3.5));
  for (let i = 0; i < 60; i++) host.tick(0.05);
  assert.equal(all('a', 'hurt').length, 0, 'calm');
  p.x = a.x - 1; p.z = a.z;
  host.message('a', { t: 'attack', e: a.id, tool: 0 });
  assert.ok(b.angry, 'the other one is angry too');
  for (let i = 0; i < 100; i++) host.tick(0.05);
  assert.ok(all('a', 'hurt').some((m) => m.cause === 'was slain by a Zombified Piglin'));
});

test('blazes shoot bursts of three fireballs and drop blaze rods', () => {
  const { host, join } = setup();
  const p = join('a', 'Steve');
  netherRoom(host, p);
  host.message('a', { t: 'pos', p: [0.5, 61, 0.5], r: [0, 0], ds: p.ds });
  const blaze = host.inDim('nether', () => host.spawnMob('blaze', 0.5, 62, -9));
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    host.tick(0.05);
    for (const e of host.entities.values()) if (e.type === 'small_fireball') seen.add(e.id);
  }
  assert.ok(seen.size >= 3, `fireballs: ${seen.size}`);
  // killing blazes drops rods (sometimes)
  let rods = 0;
  for (let i = 0; i < 10; i++) {
    const b = host.inDim('nether', () => host.spawnMob('blaze', 0.5, 62, -9));
    host.inDim('nether', () => host.killMob(b));
  }
  for (const e of host.entities.values()) if (e.type === 'item' && e.item === ITEM.BLAZE_ROD) rods += e.count;
  assert.ok(rods > 0);
  assert.ok(blaze);
});

test('monsters spawn in the Nether: blazes and wither skeletons in fortresses', () => {
  const { host, join } = setup();
  const p = join('a', 'Steve');
  host.changeDim(p, 'nether', [0.5, 70, 0.5]);
  for (let i = 0; i < 200; i++) host.spawnMobs();
  const types = new Set([...host.entities.values()].filter((e) => e.dim === 'nether').map((e) => e.type));
  assert.ok(types.size > 0, 'something spawned');
  for (const t of types) assert.ok(['zombified_piglin', 'ghast', 'skeleton', 'enderman', 'blaze', 'wither_skeleton', 'piglin', 'magma_cube'].includes(t), t);
  assert.ok(![...host.entities.values()].some((e) => ['pig', 'cow', 'sheep', 'chicken'].includes(e.type)), 'no farm animals');
  // fortress floors: mostly blazes and wither skeletons, never ghasts or piglins
  host.entities.clear();
  host.inDim('nether', () => {
    for (let x = -50; x <= 50; x++) for (let z = -50; z <= 50; z++) {
      for (let y = 40; y <= 69; y++) host.dims.nether.world.setBlock(x, y, z, BLOCK.NETHER_BRICKS);
      for (let y = 70; y < 100; y++) host.dims.nether.world.setBlock(x, y, z, BLOCK.AIR);
    }
  });
  for (let i = 0; i < 100; i++) host.spawnMobs();
  const fort = new Set([...host.entities.values()].map((e) => e.type));
  assert.ok(fort.has('blaze') || fort.has('wither_skeleton'));
  for (const t of fort) assert.ok(['blaze', 'wither_skeleton', 'magma_cube', 'skeleton', 'zombified_piglin'].includes(t), t);
});

test('strongholds have a portal room; eyes of ender lead there and open the End portal', async () => {
  const { strongholdSpots, portalCenter, SH_FLOOR } = await import('../public/js/stronghold.js');
  const { host, join, all, last } = setup();
  const p = join('a', 'Steve');
  const spots = strongholdSpots(1234);
  assert.equal(spots.length, 3);
  for (const [x, z] of spots) { const d = Math.hypot(x, z); assert.ok(d >= 1280 && d <= 2816, `distance ${d}`); }
  const world = host.dims.overworld.world;
  const [cx, cy, cz] = portalCenter(spots[0]);
  assert.equal(world.getBlock(cx, cy - 1, cz), BLOCK.LAVA, 'lava under the portal');
  let frames = 0;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    if (BLOCKS[world.getBlock(cx + dx, cy, cz + dz)].shape === 'frame') frames++;
  }
  assert.equal(frames, 12);
  assert.ok([BLOCK.STONE_BRICKS, BLOCK.MOSSY_STONE_BRICKS, BLOCK.CRACKED_STONE_BRICKS].includes(world.getBlock(spots[0][0] + 5, SH_FLOOR + 2, spots[0][1])), 'brick walls');
  // older worlds have none
  assert.deepEqual(new World(1234, 2).strongholds(), []);
  // a thrown eye flies towards the nearest one
  host.message('a', { t: 'pos', p: [0.5, 150, 0.5], r: [0, 0] });
  host.message('a', { t: 'eye' });
  const eye = [...host.entities.values()].find((e) => e.type === 'eye');
  assert.ok(eye);
  const near = host.nearestStronghold(0, 0);
  for (let i = 0; i < 20; i++) host.tick(0.1);
  const dir = (near[0] * (eye.x - 0.5) + near[2] * (eye.z - 0.5)) / Math.hypot(near[0], near[2]);
  assert.ok(dir > 10, `went the right way: ${dir}`);
  for (let i = 0; i < 20; i++) host.tick(0.1);
  assert.ok(!host.entities.has(eye.id), 'it dropped or broke');
  assert.ok(all('a', 'sfx').some((m) => m.s === 'eye'));
  // fill every frame with an eye: the portal opens and leads to the End
  p.x = cx + 0.5; p.y = cy + 1; p.z = cz - 3.5;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    if (world.getBlock(cx + dx, cy, cz + dz) === BLOCK.END_PORTAL_FRAME) host.message('a', { t: 'use', x: cx + dx, y: cy, z: cz + dz, item: ITEM.EYE_OF_ENDER });
  }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) assert.equal(world.getBlock(cx + dx, cy, cz + dz), BLOCK.END_PORTAL);
  assert.ok(all('a', 'sfx').some((m) => m.s === 'endPortal'));
  host.message('a', { t: 'pos', p: [cx + 0.5, cy + 0.8, cz + 0.5], r: [0, 0] });
  host.tick(0.05);
  assert.equal(p.dim, 'end');
  assert.equal(last('a', 'dimension').dim, 'end');
  host.message('a', { t: 'chat', msg: '/locate stronghold' });
});

test('the End: the dragon and its crystals, the boss bar, and the way home', async () => {
  const { EndTerrain, FOUNTAIN_Y } = await import('../public/js/terrain-end.js');
  const { host, join, last, all } = setup();
  const p = join('a', 'Steve');
  host.changeDim(p, 'end', [100.5, 49, 0.5]);
  p.mode = 'survival';
  host.tick(0.05);
  const dragon = () => [...host.entities.values()].find((e) => e.type === 'ender_dragon');
  const crystals = () => [...host.entities.values()].filter((e) => e.type === 'end_crystal');
  assert.ok(dragon(), 'the dragon is there');
  assert.equal(crystals().length, 10, 'a crystal on every pillar');
  host.tick(0.05);
  assert.deepEqual([last('a', 'boss').hp, last('a', 'boss').max], [200, 200]);
  // it flies around
  const d = dragon();
  const start = [d.x, d.z];
  for (let i = 0; i < 20; i++) host.tick(0.05);
  assert.ok(Math.hypot(d.x - start[0], d.z - start[1]) > 3, 'it moved');
  // hitting it in flight does a quarter of the damage (plus 1)
  host.hurtMob(d, 8, 0, 0, 'Steve');
  assert.equal(d.hp, 200 - 3);
  // breaking a crystal blows it up and remembers it
  const c = crystals()[0];
  host.inDim('end', () => host.hurtMob(c, 1, 0, 0, 'Steve'));
  assert.equal(crystals().length, 9);
  assert.deepEqual(host.endState.crystalsGone, [c.pillar]);
  assert.ok(all('a', 'boom').length > 0);
  // the kill: experience, the exit portal and the egg
  d.perched = true;
  host.inDim('end', () => host.hurtMob(d, 1000, 0, 0, 'Steve'));
  assert.ok(!dragon());
  assert.equal(last('a', 'boss').hp, 0);
  const end = host.dims.end.world;
  for (const [x, y, z] of EndTerrain.portalCells()) assert.equal(end.getBlock(x, y, z), BLOCK.END_PORTAL);
  assert.equal(end.getBlock(0, FOUNTAIN_Y + 4, 0), BLOCK.DRAGON_EGG);
  const xp = [...host.entities.values()].filter((e) => e.type === 'xp').reduce((n, e) => n + e.value, 0);
  assert.equal(xp, 12000);
  // it stays dead (also after saving and loading)
  for (let i = 0; i < 10; i++) host.tick(0.05);
  assert.ok(!dragon());
  const data = structuredClone(host.serialize());
  assert.equal(data.dims.end.dragonKilled, true);
  const host2 = new GameHost(data, () => {}, {});
  assert.equal(host2.endState.dragonKilled, true);
  // the exit portal leads home
  host.message('a', { t: 'pos', p: [2.5, FOUNTAIN_Y + 0.8, 0.5], r: [0, 0], ds: p.ds });
  host.tick(0.05);
  assert.equal(p.dim, 'overworld');
});

test('endermen spawn on the end stone island', () => {
  const { host, join } = setup();
  const p = join('a', 'Steve');
  host.changeDim(p, 'end', [30.5, 61, 0.5]);
  host.endState.dragonKilled = true;
  for (let i = 0; i < 100; i++) host.spawnMobs();
  const types = new Set([...host.entities.values()].filter((e) => e.dim === 'end').map((e) => e.type));
  assert.deepEqual([...types], ['enderman']);
});

test('water poured on lava turns it into obsidian', () => {
  const { host, join, last } = setup();
  join('a', 'Steve');
  host.setBlock(10, 150, 10, BLOCK.STONE);
  host.setBlock(10, 151, 10, BLOCK.LAVA);
  host.setBlock(11, 151, 10, BLOCK.LAVA);
  host.message('a', { t: 'pos', p: [12.5, 151, 12.5], r: [0, 0] });
  // straight onto the lava
  host.message('a', { t: 'bucket', x: 10, y: 151, z: 10, fill: false });
  assert.equal(host.world.getBlock(10, 151, 10), BLOCK.OBSIDIAN);
  assert.deepEqual(last('a', 'set'), { t: 'set', x: 10, y: 151, z: 10, id: BLOCK.OBSIDIAN }, 'the pourer is told too');
  // next to it: the lava hardens a moment later
  host.message('a', { t: 'bucket', x: 12, y: 151, z: 10, fill: false });
  for (let i = 0; i < 40; i++) host.tick(0.05);
  assert.equal(host.world.getBlock(11, 151, 10), BLOCK.OBSIDIAN);
  assert.equal(host.world.getBlock(12, 151, 10), BLOCK.WATER);
});

test('water boils away in the Nether', () => {
  const { host, join } = setup();
  const p = join('a', 'Steve');
  host.changeDim(p, 'nether', [0.5, 70, 0.5]);
  host.inDim('nether', () => { host.setBlock(2, 69, 0, BLOCK.NETHERRACK); host.setBlock(2, 70, 0, BLOCK.AIR); });
  host.message('a', { t: 'bucket', x: 2, y: 70, z: 0, fill: false });
  assert.equal(host.dims.nether.world.getBlock(2, 70, 0), BLOCK.AIR);
});

test('review fixes: blasts spare End portals, no double kills, dragon keeps flying, boss bar for late arrivals, stale actions dropped', async () => {
  const { portalCenter, strongholdSpots } = await import('../public/js/stronghold.js');
  const { host, join, last, all } = setup();
  const p = join('a', 'Steve');
  const [cx, cy, cz] = portalCenter(strongholdSpots(1234)[0]);
  const w = host.dims.overworld.world;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (w.getBlock(cx + dx, cy, cz + dz) === BLOCK.END_PORTAL_FRAME) w.setBlock(cx + dx, cy, cz + dz, BLOCK.END_PORTAL_FRAME + 1);
  host.checkEndPortal(cx - 2, cy, cz);
  host.explode(cx + 0.5, cy + 1, cz + 0.5, 4);
  assert.equal(w.getBlock(cx, cy, cz), BLOCK.END_PORTAL);
  assert.equal(w.getBlock(cx - 2, cy, cz), BLOCK.END_PORTAL_FRAME + 1);
  // a crystal blowing up inside another blast doesn't kill a mob twice
  host.changeDim(p, 'end', [100.5, 49, 0.5]);
  host.endState.dragonKilled = true;
  const deaths = () => all('a', 'mobdeath').length;
  host.inDim('end', () => {
    const c = host.spawnMob('end_crystal', 200.5, 70, 0.5);
    const m = host.spawnMob('enderman', 202.5, 70, 0.5);
    m.hp = 15; // survives the first blast alone, not the crystal's
    const before = deaths();
    host.explode(199.5, 70, 0.5, 4);
    assert.ok(!host.entities.has(c.id) && !host.entities.has(m.id));
    assert.equal(deaths() - before, 2, 'crystal and enderman, once each');
  });
  // the dragon flies even when the only player is on the far platform
  host.endState.dragonKilled = false;
  host.entities.clear();
  host.tick(0.05);
  const d = [...host.entities.values()].find((e) => e.type === 'ender_dragon');
  d.x = -15; d.z = 48; d.y = 80;
  const at = d.x;
  for (let i = 0; i < 10; i++) host.tick(0.05);
  assert.notEqual(d.x, at);
  // a second player arriving gets the boss bar
  const q = join('b', 'Alex');
  host.changeDim(q, 'end', [100.5, 49, 0.5]);
  host.tick(0.05);
  assert.equal(last('b', 'boss').hp, Math.round(d.hp));
  // a dig sent before a trip is ignored afterwards
  host.setBlock(100, 48, 2, BLOCK.STONE);
  host.inDim('end', () => host.setBlock(100, 48, 2, BLOCK.END_STONE));
  host.message('b', { t: 'dig', x: 100, y: 48, z: 2, ds: 0 });
  assert.equal(host.dims.end.world.getBlock(100, 48, 2), BLOCK.END_STONE);
});
