import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, blockIndex } from '../public/js/world.js';
import { gatherRegion, computeLight, regionIndex } from '../public/js/lighting.js';
import { BLOCK, BLOCKS, HEIGHT, CHUNK, SEA_LEVEL } from '../public/js/blocks.js';
import * as BIOMES_MODULE from '../public/js/biomes.js';

test('terrain is deterministic for a seed', () => {
  const a = new World(42);
  const b = new World(42);
  const c = new World(43);
  let diff = 0;
  for (let x = -40; x < 40; x += 3) {
    for (let z = -40; z < 40; z += 3) {
      for (let y = 0; y < HEIGHT; y += 2) {
        assert.equal(a.getBlock(x, y, z), b.getBlock(x, y, z));
        if (a.getBlock(x, y, z) !== c.getBlock(x, y, z)) diff++;
      }
    }
  }
  assert.ok(diff > 0, 'different seeds should give different terrain');
});

test('generation does not depend on the order chunks are generated in', () => {
  const w1 = new World(99);
  const w2 = new World(99);
  const coords = [];
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) coords.push([cx, cz]);
  for (const [cx, cz] of coords) w1.getChunk(cx, cz);
  for (const [cx, cz] of coords.reverse()) assert.deepEqual(w2.getChunk(cx, cz), w1.getChunk(cx, cz));
});

test('a large area contains every kind of feature', () => {
  const w = new World(2024);
  const counts = new Map();
  for (let cx = -6; cx <= 6; cx++) {
    for (let cz = -6; cz <= 6; cz++) {
      for (const id of w.getChunk(cx, cz)) counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  const has = (id, min = 1) => assert.ok((counts.get(id) || 0) >= min, `${BLOCKS[id].name}: ${counts.get(id) || 0}`);
  has(BLOCK.STONE, 1000); has(BLOCK.GRASS, 100); has(BLOCK.COAL_ORE, 100); has(BLOCK.IRON_ORE, 50);
  has(BLOCK.GOLD_ORE); has(BLOCK.DIAMOND_ORE); has(BLOCK.LOG, 50); has(BLOCK.LEAVES, 200);
  has(BLOCK.TALL_GRASS, 50); has(BLOCK.BEDROCK, 169 * 256);
  // caves: air below the surface
  let caveAir = 0;
  for (let x = -96; x < 96; x += 2) {
    for (let z = -96; z < 96; z += 2) {
      const h = w.heightAt(x, z);
      for (let y = 3; y < h - 3; y++) if (w.getBlock(x, y, z) === BLOCK.AIR) caveAir++;
    }
  }
  assert.ok(caveAir > 200, `expected caves, found ${caveAir} underground air samples`);
});

test('oceans are filled with water up to sea level', () => {
  const w = new World(2024);
  let found = false;
  for (let x = -400; x < 400 && !found; x += 4) {
    for (let z = -400; z < 400 && !found; z += 4) {
      const h = w.heightAt(x, z);
      if (h < SEA_LEVEL - 2) {
        for (let y = h + 1; y <= SEA_LEVEL; y++) assert.equal(w.getBlock(x, y, z), BLOCK.WATER, `y=${y}`);
        assert.equal(w.getBlock(x, SEA_LEVEL + 1, z), BLOCK.AIR);
        found = true;
      }
    }
  }
  assert.ok(found, 'no ocean found in the sampled area');
});

test('edits survive export/import and chunk unloading', () => {
  const w = new World(1);
  w.setBlock(5, 30, -7, BLOCK.BRICK);
  w.setBlock(-17, 2, 33, BLOCK.AIR);
  w.unloadFar(1000, 1000, 1);
  assert.equal(w.getBlock(5, 30, -7), BLOCK.BRICK);
  assert.equal(w.getBlock(-17, 2, 33), BLOCK.AIR);
  const copy = new World(1);
  copy.importEdits(w.exportEdits());
  assert.equal(copy.getBlock(5, 30, -7), BLOCK.BRICK);
  assert.equal(copy.exportEdits().length, 2);
});

// Brute-force reference: repeatedly relax light over a 5x5-chunk area until nothing changes.
function referenceLight(world, cx, cz) {
  const R = 2;
  const W = (2 * R + 1) * CHUNK;
  const idx = (x, y, z) => (y * W + z) * W + x;
  const ids = new Uint8Array(W * W * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
    ids[idx(x, y, z)] = world.getBlock((cx - R) * CHUNK + x, y, (cz - R) * CHUNK + z);
  }
  const sky = new Uint8Array(ids.length);
  const blk = new Uint8Array(ids.length);
  for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
    let l = 15;
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const b = BLOCKS[ids[idx(x, y, z)]];
      if (!b.transparent) break;
      l -= b.lightFilter;
      if (l <= 0) break;
      sky[idx(x, y, z)] = l;
    }
  }
  for (let i = 0; i < ids.length; i++) blk[i] = BLOCKS[ids[i]].emit;
  for (const light of [sky, blk]) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
        const i = idx(x, y, z);
        const b = BLOCKS[ids[i]];
        if (!b.transparent) continue;
        let best = light[i];
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (nx < 0 || ny < 0 || nz < 0 || nx >= W || nz >= W || ny >= HEIGHT) continue;
          const v = light[idx(nx, ny, nz)] - 1 - b.lightFilter;
          if (v > best) best = v;
        }
        if (best > light[i]) { light[i] = best; changed = true; }
      }
    }
  }
  return (lx, y, lz) => {
    const i = idx(lx + R * CHUNK, y, lz + R * CHUNK);
    return [sky[i], blk[i]];
  };
}

test('flood-fill light matches a brute-force reference (with caves, trees and torches)', () => {
  const w = new World(2024);
  // dig a covered pit with torches so block light and dark areas are exercised
  for (let x = 2; x < 9; x++) for (let z = 2; z < 9; z++) for (let y = 15; y < 22; y++) w.setBlock(x, y, z, BLOCK.AIR);
  w.setBlock(5, 15, 5, BLOCK.TORCH);
  w.setBlock(15, 30, 0, BLOCK.TORCH); // near the chunk edge
  w.setBlock(-1, 20, 8, BLOCK.TORCH); // in the neighbouring chunk
  const ref = referenceLight(w, 0, 0);
  const { sky, block } = computeLight(gatherRegion(w, 0, 0));
  let checked = 0, lit = 0;
  for (let y = 0; y < HEIGHT; y++) for (let z = -1; z <= CHUNK; z++) for (let x = -1; x <= CHUNK; x++) {
    const [rs, rb] = ref(x, y, z);
    const i = regionIndex(x, y, z);
    if (sky[i] !== rs || block[i] !== rb) {
      assert.fail(`light mismatch at ${x},${y},${z}: got sky ${sky[i]} block ${block[i]}, expected ${rs} ${rb}`);
    }
    checked++;
    if (rb > 0) lit++;
  }
  assert.ok(lit > 100, 'torches should light some cells');
  assert.ok(checked > 30000);
});

test('blockIndex layout matches chunk size', () => {
  assert.equal(new World(1).getChunk(0, 0).length, CHUNK * CHUNK * HEIGHT);
  assert.equal(blockIndex(CHUNK - 1, HEIGHT - 1, CHUNK - 1), CHUNK * CHUNK * HEIGHT - 1);
});

// Versions 1 and 2 were made for a 96-block-tall world: hash that part, and check nothing is above it.
function legacyFingerprint(gen) {
  const w = new World(2024, gen);
  const below = CHUNK * CHUNK * 96;
  let h = 0;
  for (let cx = -4; cx <= 4; cx++) {
    for (let cz = -4; cz <= 4; cz++) {
      const data = w.getChunk(cx, cz);
      for (let i = 0; i < below; i++) h = (Math.imul(h, 31) + data[i]) | 0;
      assert.ok(data.subarray(below).every((b) => b === BLOCK.AIR));
    }
  }
  return h;
}

test('generator version 1 terrain never changes (old worlds keep their shape)', () => {
  assert.equal(legacyFingerprint(1), 384292837);
});

test('generator version 2 terrain never changes', () => {
  assert.equal(legacyFingerprint(2), -1122342747);
});

test('generator version 2 adds deepslate, copper, stone variants and cherry trees', () => {
  const w = new World(2024, 2);
  const counts = new Map();
  for (let cx = -10; cx <= 10; cx++) for (let cz = -10; cz <= 10; cz++) for (const id of w.getChunk(cx, cz)) counts.set(id, (counts.get(id) || 0) + 1);
  for (const id of [BLOCK.DEEPSLATE, BLOCK.DEEPSLATE_DIAMOND_ORE, BLOCK.COPPER_ORE, BLOCK.GRANITE, BLOCK.DIORITE, BLOCK.ANDESITE, BLOCK.CHERRY_LOG, BLOCK.CHERRY_LEAVES]) {
    assert.ok((counts.get(id) || 0) > 0, BLOCKS[id].name);
  }
  // no deepslate in version 1
  const old = new World(2024, 1);
  assert.ok(!old.getChunk(0, 0).includes(BLOCK.DEEPSLATE));
});

// ---------- generator version 3 ----------

// Finds a column of each wanted biome on a coarse grid around the origin.
function findBiomes(t, wanted) {
  const found = new Map();
  for (let r = 0; r < 3000 && found.size < wanted.length; r += 48) {
    for (let x = -r; x <= r; x += 48) {
      for (const z of [-r, r]) {
        for (const [px, pz] of [[x, z], [z, x]]) {
          const b = t.column(px, pz).biome;
          if (wanted.includes(b) && !found.has(b)) found.set(b, [px, pz]);
        }
      }
    }
  }
  return found;
}

test('version 3: tall terrain with sea level 63 (shown y), up to 320, bedrock and deepslate at the bottom', () => {
  const w = new World(2024, 3);
  assert.equal(w.seaLevel - w.yOffset, 63);
  assert.equal(HEIGHT - w.yOffset, 320); // (the build limit, like Minecraft's)
  const data = w.getChunk(0, 0);
  for (let i = 0; i < CHUNK * CHUNK; i++) assert.equal(data[i], BLOCK.BEDROCK);
  let deepslate = 0;
  for (let y = 5; y < w.yOffset; y++) for (let i = 0; i < CHUNK * CHUNK; i++) if (data[y * CHUNK * CHUNK + i] === BLOCK.DEEPSLATE) deepslate++;
  assert.ok(deepslate > 5000, `deepslate ${deepslate}`);
  // heights cover deep oceans to high mountains
  let lo = Infinity, hi = -Infinity;
  for (let x = -3000; x < 3000; x += 37) for (let z = -3000; z < 3000; z += 41) {
    const h = w.heightAt(x, z) - w.yOffset;
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  assert.ok(lo < 35 && hi > 150 && hi < 310, `heights ${lo}..${hi}`);
});

test('version 3: oceans fill with water (or ice) up to sea level', () => {
  const w = new World(2024, 3);
  let checked = 0;
  for (let x = -2000; x < 2000 && checked < 20; x += 50) {
    for (let z = -2000; z < 2000 && checked < 20; z += 50) {
      const h = w.heightAt(x, z);
      if (h > w.seaLevel - 5) continue;
      for (let y = h + 1; y < w.seaLevel; y++) assert.equal(w.getBlock(x, y, z), BLOCK.WATER, `${x},${y},${z}`);
      assert.ok([BLOCK.WATER, BLOCK.ICE].includes(w.getBlock(x, w.seaLevel, z)));
      assert.equal(w.getBlock(x, w.seaLevel + 1, z), BLOCK.AIR);
      checked++;
    }
  }
  assert.equal(checked, 20);
});

test('version 3: each biome gets its own surface, trees and plants', () => {
  const w = new World(2024, 3);
  const { BIOME } = BIOMES_MODULE;
  const expect = {
    [BIOME.DESERT]: [BLOCK.SAND, BLOCK.CACTUS],
    [BIOME.TAIGA]: [BLOCK.SPRUCE_LOG, BLOCK.SPRUCE_LEAVES, BLOCK.FERN],
    [BIOME.SAVANNA]: [BLOCK.ACACIA_LOG, BLOCK.ACACIA_LEAVES],
    [BIOME.DARK_FOREST]: [BLOCK.DARK_OAK_LOG, BLOCK.DARK_OAK_LEAVES],
    [BIOME.JUNGLE]: [BLOCK.JUNGLE_LOG, BLOCK.JUNGLE_LEAVES],
    [BIOME.FOREST]: [BLOCK.LOG, BLOCK.LEAVES, BLOCK.TALL_GRASS],
    [BIOME.BIRCH_FOREST]: [BLOCK.BIRCH_LOG],
    [BIOME.CHERRY_GROVE]: [BLOCK.CHERRY_LOG, BLOCK.CHERRY_LEAVES],
    [BIOME.SNOWY_PLAINS]: [BLOCK.SNOWY_GRASS],
    [BIOME.FROZEN_OCEAN]: [BLOCK.ICE],
    [BIOME.PLAINS]: [BLOCK.GRASS, BLOCK.TALL_GRASS],
  };
  const where = findBiomes(w.terrain, Object.keys(expect).map(Number));
  for (const [biome, blocks] of Object.entries(expect)) {
    const pos = where.get(+biome);
    assert.ok(pos, `no ${BIOMES_MODULE.BIOMES[biome].name} found`);
    const counts = new Map();
    const cx = Math.floor(pos[0] / CHUNK), cz = Math.floor(pos[1] / CHUNK);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const id of w.getChunk(cx + dx, cz + dz)) counts.set(id, (counts.get(id) || 0) + 1);
    for (const id of blocks) assert.ok(counts.get(id) > 0, `${BIOMES_MODULE.BIOMES[biome].name} should have ${BLOCKS[id].name}`);
  }
});

test('version 3: ores at their depths, and lava deep down', () => {
  const w = new World(7, 3);
  const counts = new Map();
  for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) for (const id of w.getChunk(cx, cz)) counts.set(id, (counts.get(id) || 0) + 1);
  for (const id of [BLOCK.COAL_ORE, BLOCK.IRON_ORE, BLOCK.COPPER_ORE, BLOCK.DEEPSLATE_DIAMOND_ORE, BLOCK.DEEPSLATE_REDSTONE_ORE,
    BLOCK.DEEPSLATE_GOLD_ORE, BLOCK.LAVA, BLOCK.GRANITE, BLOCK.DIORITE, BLOCK.ANDESITE, BLOCK.GRAVEL]) {
    assert.ok(counts.get(id) > 0, BLOCKS[id].name);
  }
  assert.ok((counts.get(BLOCK.LAPIS_ORE) || 0) + (counts.get(BLOCK.DEEPSLATE_LAPIS_ORE) || 0) > 0, 'lapis');
  // lava only below shown y -54
  const data = w.getChunk(0, 0);
  for (let i = 0; i < data.length; i++) if (data[i] === BLOCK.LAVA) assert.ok(Math.floor(i / (CHUNK * CHUNK)) <= -54 + w.yOffset);
});

test('version 3: caves are carved identically however they are looked up', () => {
  const w = new World(2024, 3);
  const t = w.terrain;
  for (const [cx, cz] of [[0, 0], [-3, 5], [7, -2]]) {
    const data = w.getChunk(cx, cz);
    let air = 0;
    for (let lx = 0; lx < CHUNK; lx += 3) {
      for (let lz = 0; lz < CHUNK; lz += 3) {
        const x = cx * CHUNK + lx, z = cz * CHUNK + lz;
        const h = w.heightAt(x, z);
        for (let y = 1; y < h; y++) {
          const id = data[blockIndex(lx, y, lz)];
          if (id === BLOCK.BEDROCK) continue;
          const [a, b, k] = t.caveAt(x, y, z);
          const carved = t.constructor.carved(a, b, k, y, h, h < w.seaLevel);
          assert.equal(id === BLOCK.AIR || id === BLOCK.LAVA, carved, `${x},${y},${z}`);
          if (carved) air++;
        }
      }
    }
    assert.ok(air > 0);
  }
});

test('version 3: terrain is deterministic and independent of generation order', () => {
  const a = new World(5, 3), b = new World(5, 3), c = new World(6, 3);
  const coords = [];
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) coords.push([cx, cz]);
  for (const [cx, cz] of coords) a.getChunk(cx, cz);
  let diff = 0;
  for (const [cx, cz] of coords.reverse()) {
    assert.deepEqual(b.getChunk(cx, cz), a.getChunk(cx, cz));
    if (c.getChunk(cx, cz).some((v, i) => v !== a.getChunk(cx, cz)[i])) diff++;
  }
  assert.ok(diff > 0);
});
