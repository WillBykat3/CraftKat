// Flowing water and lava, simulated by the host like Minecraft's: a source spreads up to
// 7 blocks (lava 3 in the Overworld), falls down first, prefers the shortest way to a
// drop, two water sources next to an empty block make a new source, and water meeting
// lava makes obsidian, cobblestone or stone. Fluids only move when something changes
// next to them, so still oceans and lava lakes cost nothing.

import { BLOCK, BLOCKS, fluidOf, fluidLevel, isSource, getDrops } from './blocks.js';

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const key = (x, y, z) => `${x},${y},${z}`;

export const flowId = (kind, level) => (kind === 'water' ? BLOCK.WATER_FLOW : BLOCK.LAVA_FLOW) + level;
export const fallingId = (kind) => (kind === 'water' ? BLOCK.FALLING_WATER : BLOCK.FALLING_LAVA);

export class FluidSim {
  // host: {setBlock, spawnItem, random, ...}; dim: lava is faster and spreads further in the Nether
  constructor(host, world, dim) {
    this.host = host;
    this.world = world;
    this.queue = new Map();   // key -> game tick when that block updates
    this.tick = 0;
    this.acc = 0;
    this.delay = { water: 5, lava: dim === 'nether' ? 10 : 30 }; // game ticks, like Minecraft
    this.drop = { water: 1, lava: dim === 'nether' ? 1 : 2 };
    this.slope = { water: 4, lava: dim === 'nether' ? 4 : 2 };   // how far it looks for a way down
  }

  get(x, y, z) {
    return y < 0 ? BLOCK.BEDROCK : this.world.getBlock(x, y, z);
  }

  // Called for every block change: the block and its neighbours may need to flow.
  changed(x, y, z) {
    for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const kind = fluidOf(this.get(x + dx, y + dy, z + dz));
      if (kind) this.schedule(x + dx, y + dy, z + dz, this.delay[kind]);
    }
  }

  schedule(x, y, z, delay) {
    const k = key(x, y, z);
    if (!this.queue.has(k)) this.queue.set(k, this.tick + delay);
  }

  get busy() {
    return this.queue.size > 0;
  }

  // dt in seconds; runs Minecraft's 20 game ticks per second.
  update(dt) {
    if (!this.queue.size) { this.acc = 0; return; }
    this.acc = Math.min(this.acc + dt * 20, 40);
    while (this.acc >= 1) {
      this.acc--;
      this.tick++;
      let budget = 600; // updates per tick, so a flood can't freeze the game
      for (const [k, at] of this.queue) {
        if (at > this.tick) continue;
        this.queue.delete(k);
        const [x, y, z] = k.split(',').map(Number);
        this.step(x, y, z);
        if (--budget <= 0) break;
      }
    }
  }

  step(x, y, z) {
    let id = this.get(x, y, z);
    const kind = fluidOf(id);
    if (!kind) return;
    // lava touching water hardens: obsidian from a source, cobblestone from flowing lava
    if (kind === 'lava') {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
        if (fluidOf(this.get(x + dx, y + dy, z + dz)) === 'water') {
          this.host.setBlock(x, y, z, isSource(id) ? BLOCK.OBSIDIAN : BLOCK.COBBLE);
          this.host.fizz?.(x, y, z);
          return;
        }
      }
    }
    if (!isSource(id)) {
      const want = this.desired(x, y, z, kind);
      if (want !== id) {
        this.host.setBlock(x, y, z, want);
        if (want === BLOCK.AIR) return;
        id = want;
      }
    }
    this.spread(x, y, z, id, kind);
  }

  // What a flowing block should be, given what feeds it.
  desired(x, y, z, kind) {
    if (fluidOf(this.get(x, y + 1, z)) === kind) return fallingId(kind);
    let best = 99, sources = 0;
    for (const [dx, dz] of SIDES) {
      const n = this.get(x + dx, y, z + dz);
      if (fluidOf(n) !== kind) continue;
      if (isSource(n)) sources++;
      best = Math.min(best, fluidLevel(n));
    }
    if (kind === 'water' && sources >= 2) {
      const below = this.get(x, y - 1, z);
      if (BLOCKS[below].solid || below === BLOCK.WATER) return BLOCK.WATER; // infinite water
    }
    const level = best + this.drop[kind];
    return best === 99 || level > 7 ? BLOCK.AIR : flowId(kind, level);
  }

  // Can this fluid go into a block (empty, a plant it washes away, weaker fluid, or the other fluid)?
  canEnter(id, kind, level) {
    if (id === BLOCK.AIR) return true;
    const other = fluidOf(id);
    if (other && other !== kind) return true;
    if (other) return !isSource(id) && !BLOCKS[id].falling && fluidLevel(id) > level;
    const b = BLOCKS[id];
    return !!b.replaceable || (!b.solid && !!b.needsSupport && b.render !== 'wire' && !b.redstone && b.shape !== 'door');
  }

  spread(x, y, z, id, kind) {
    const below = this.get(x, y - 1, z);
    const belowKind = fluidOf(below);
    const fallingNext = fallingId(kind);
    const canDown = y > 0 && (below === BLOCK.AIR || (belowKind && belowKind !== kind) ||
      (belowKind === kind ? !isSource(below) && !BLOCKS[below].falling : this.canEnter(below, kind, 0)));
    if (canDown) {
      this.into(x, y - 1, z, fallingNext, kind, true);
      if (!isSource(id)) return; // flowing fluid only goes down while it can
    } else if (belowKind === kind && !isSource(id)) {
      return; // pouring into more of itself: no spreading sideways
    }
    const level = (BLOCKS[id].falling ? 0 : fluidLevel(id)) + this.drop[kind];
    if (level > 7) return;
    // like Minecraft, flow only towards the nearest way down, if there is one close by
    // (directions it already flows in count too, or it would spill the other way)
    const open = SIDES.filter(([dx, dz]) => {
      const n = this.get(x + dx, y, z + dz);
      return this.canEnter(n, kind, level) || (fluidOf(n) === kind && !isSource(n));
    });
    if (!open.length) return;
    const dist = open.map(([dx, dz]) => this.holeDistance(x + dx, y, z + dz, kind, this.slope[kind], dx, dz));
    const nearest = Math.min(...dist);
    const dirs = nearest < Infinity ? open.filter((_, i) => dist[i] === nearest) : open;
    for (const [dx, dz] of dirs) {
      if (this.canEnter(this.get(x + dx, y, z + dz), kind, level)) this.into(x + dx, y, z + dz, flowId(kind, level), kind, false);
    }
  }

  // Steps from (x, y, z) to a block the fluid could fall from, searching up to `left` blocks (not going back).
  holeDistance(x, y, z, kind, left, fromDx, fromDz) {
    if (this.canFall(x, y, z, kind)) return 0;
    if (left <= 1) return Infinity;
    let best = Infinity;
    for (const [dx, dz] of SIDES) {
      if (dx === -fromDx && dz === -fromDz) continue;
      const n = this.get(x + dx, y, z + dz);
      if (n !== BLOCK.AIR && !(fluidOf(n) === kind && !isSource(n)) && !BLOCKS[n].replaceable) continue;
      best = Math.min(best, 1 + this.holeDistance(x + dx, y, z + dz, kind, left - 1, dx, dz));
    }
    return best;
  }

  canFall(x, y, z, kind) {
    const b = this.get(x, y - 1, z);
    return y > 0 && (b === BLOCK.AIR || (fluidOf(b) === kind && !isSource(b)) || (!!BLOCKS[b].replaceable && !fluidOf(b)));
  }

  into(x, y, z, newId, kind, falling) {
    const cur = this.get(x, y, z);
    const curKind = fluidOf(cur);
    if (curKind && curKind !== kind) {
      // water and lava meet
      let result;
      if (kind === 'water') result = isSource(cur) ? BLOCK.OBSIDIAN : BLOCK.COBBLE;
      else result = falling ? BLOCK.STONE : BLOCK.COBBLE;
      this.host.setBlock(x, y, z, result);
      this.host.fizz?.(x, y, z);
      return;
    }
    if (curKind === kind) {
      if (isSource(cur) || cur === newId) return;
      if (!falling && (BLOCKS[cur].falling || fluidLevel(cur) <= fluidLevel(newId))) return;
    } else if (cur !== BLOCK.AIR) {
      // washes away plants, torches and the like (they drop as items)
      if (cur === BLOCK.FIRE && kind === 'water') { this.host.setBlock(x, y, z, newId); return; }
      for (const [d, c] of getDrops(cur, 0, this.host.random)) this.host.spawnItem(x + 0.5, y + 0.3, z + 0.5, d, c);
    }
    this.host.setBlock(x, y, z, newId);
  }
}

// Which way flowing fluid pushes things standing in it: [x, z], towards lower levels.
export function flowAt(world, x, y, z) {
  const id = world.getBlock(x, y, z);
  const kind = fluidOf(id);
  if (!kind || isSource(id)) return [0, 0];
  const level = BLOCKS[id].falling ? 0 : fluidLevel(id);
  let fx = 0, fz = 0;
  for (const [dx, dz] of SIDES) {
    const n = world.getBlock(x + dx, y, z + dz);
    if (fluidOf(n) === kind) {
      const nl = BLOCKS[n].falling ? 0 : fluidLevel(n);
      fx += dx * (nl - level); fz += dz * (nl - level);
    } else if (n === BLOCK.AIR || BLOCKS[n].replaceable) {
      // flowing over an edge pulls that way
      const below = world.getBlock(x + dx, y - 1, z + dz);
      if (fluidOf(below) === kind || below === BLOCK.AIR) { fx += dx * 4; fz += dz * 4; }
    }
  }
  const len = Math.hypot(fx, fz);
  return len ? [fx / len, fz / len] : [0, 0];
}
