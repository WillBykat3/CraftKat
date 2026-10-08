// Redstone, simulated by the host 10 times a second (Minecraft's "redstone tick").
//
// Power works like Minecraft's, slightly simplified:
//  - sources: levers, buttons, pressure plates, redstone torches, blocks of redstone,
//    and repeaters (out of their front)
//  - dust carries power 15 from a source, losing 1 per block, and can climb up and down
//  - a solid block is "strongly" powered by a lever/button on it, a pressure plate on it,
//    a torch under it or a repeater facing it (then it powers dust next to it too), and
//    "weakly" powered by dust on top of it or pointing into it (that only powers devices)
//  - devices (lamps, doors, pistons, TNT) turn on when power reaches them directly or
//    through a powered block next to them
//  - torches turn off when the block they hang on is powered (one tick later);
//    repeaters pass power on after their delay (1-4 ticks)

import { BLOCK, BLOCKS, FACING, FACING6, ITEM, getDrops } from './blocks.js';
import { wireConnections, wirePoints, wireBucket } from './redstone.js';

const TICK = 0.1;
const BUTTON_TICKS = 10;   // stone buttons stay pressed for a second
const PLATE_TICKS = 10;    // and plates for a second after you step off
const LAMP_OFF_TICKS = 2;
const PUSH_LIMIT = 12;
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

const key = (x, y, z) => `${x},${y},${z}`;
const unkey = (k) => k.split(',').map(Number);

// Does this block take part in redstone (so the simulation keeps an eye on it)?
export function isRedstoneBlock(id) {
  const b = BLOCKS[id];
  return !!b && (!!b.redstone || b.shape === 'door');
}

export class RedstoneSim {
  // host: {world, setBlock(x, y, z, id), spawnItem(...), primeTnt(x, y, z, fuse), entityBoxes()}
  constructor(host) {
    this.host = host;
    this.world = host.world;
    this.positions = new Set();
    this.power = new Map();     // dust power 0-15
    this.pending = new Map();   // key -> {id, at}: changes waiting for their delay
    this.timers = new Map();    // key -> tick when a button/plate turns off
    this.doorPowered = new Map();
    this.tickCount = 0;
    this.acc = 0;
    for (const [x, y, z, id] of this.world.exportEdits()) if (isRedstoneBlock(id)) this.positions.add(key(x, y, z));
  }

  // Called for every block change.
  changed(x, y, z, id) {
    const k = key(x, y, z);
    if (isRedstoneBlock(id)) this.positions.add(k);
    else { this.positions.delete(k); this.power.delete(k); this.pending.delete(k); this.timers.delete(k); }
  }

  get(x, y, z) {
    return this.world.getBlock(x, y, z);
  }

  set(x, y, z, id) {
    if (this.get(x, y, z) !== id) this.host.setBlock(x, y, z, id);
  }

  update(dt) {
    if (this.positions.size === 0) return;
    this.acc += dt;
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.tick();
    }
  }

  // ---------- player actions ----------
  use(x, y, z, item) {
    const id = this.get(x, y, z);
    const b = BLOCKS[id];
    if (b.redstone === 'lever') { this.set(x, y, z, id + (b.on ? -5 : 5)); return true; }
    if (b.redstone === 'button') {
      if (!b.on) this.set(x, y, z, id + 5);
      this.timers.set(key(x, y, z), this.tickCount + BUTTON_TICKS);
      return true;
    }
    if (b.redstone === 'repeater') {
      const off = id - BLOCK.REPEATER;
      this.set(x, y, z, BLOCK.REPEATER + (off & 16) + ((((off >> 2) & 3) + 1) % 4) * 4 + (off & 3));
      return true;
    }
    if (b.redstone === 'tnt' && item === ITEM.FLINT_AND_STEEL) {
      this.host.setBlock(x, y, z, BLOCK.AIR);
      this.host.primeTnt(x, y, z, 4);
      return true;
    }
    return false;
  }

  // ---------- the simulation ----------
  tick() {
    this.tickCount++;
    const now = this.tickCount;
    // delayed changes and buttons/plates letting go
    for (const [k, p] of [...this.pending]) {
      if (p.at > now) continue;
      this.pending.delete(k);
      const [x, y, z] = unkey(k);
      if (this.get(x, y, z) === p.from) this.set(x, y, z, p.id);
    }
    for (const [k, at] of [...this.timers]) {
      if (at > now) continue;
      const [x, y, z] = unkey(k);
      const b = BLOCKS[this.get(x, y, z)];
      if (b.redstone === 'button' && b.on) { this.timers.delete(k); this.set(x, y, z, this.get(x, y, z) - 5); }
      if (b.redstone === 'plate' && b.on && !this.plateOccupied(x, y, z, b)) { this.timers.delete(k); this.set(x, y, z, this.get(x, y, z) - 1); }
      if (!b.redstone || (b.redstone !== 'button' && b.redstone !== 'plate')) this.timers.delete(k);
    }
    this.checkPlates();
    this.compute();
    this.react();
  }

  plateOccupied(x, y, z, b) {
    for (const e of this.host.entityBoxes(b.wooden)) {
      if (e.x + e.halfW > x && e.x - e.halfW < x + 1 && e.z + e.halfW > z && e.z - e.halfW < z + 1 && e.y < y + 0.3 && e.y + e.height > y) return true;
    }
    return false;
  }

  checkPlates() {
    for (const k of this.positions) {
      const [x, y, z] = unkey(k);
      const id = this.get(x, y, z);
      const b = BLOCKS[id];
      if (b.redstone !== 'plate') continue;
      if (this.plateOccupied(x, y, z, b)) {
        if (!b.on) this.set(x, y, z, id + 1);
        this.timers.set(k, this.tickCount + PLATE_TICKS);
      }
    }
  }

  // Works out where power is: direct power next to sources, strongly and weakly
  // powered blocks, and how strong every piece of dust is.
  compute() {
    const direct = new Set();   // cells right next to a source (or in front of a repeater)
    const strong = new Set();   // solid blocks strongly powered
    const sources = [];
    for (const k of this.positions) {
      const [x, y, z] = unkey(k);
      const b = BLOCKS[this.get(x, y, z)];
      if (!b.redstone) continue;
      const on = b.redstone === 'block' || (b.on && ['torch', 'lever', 'button', 'plate', 'repeater'].includes(b.redstone));
      if (!on) continue;
      sources.push([x, y, z]);
      if (b.redstone === 'repeater') {
        const [fx, , fz] = FACING[b.facing];
        direct.add(key(x + fx, y, z + fz));
        strong.add(key(x + fx, y, z + fz));
        continue;
      }
      const support = b.attach === undefined ? null : b.attach === 0 ? [0, -1, 0] : FACING[b.attach - 1].map((v) => -v);
      for (const [dx, dy, dz] of SIDES) {
        if (b.redstone === 'torch' && support && dx === support[0] && dy === support[1] && dz === support[2]) continue;
        direct.add(key(x + dx, y + dy, z + dz));
      }
      if (b.redstone === 'torch') strong.add(key(x, y + 1, z));
      else if (b.redstone === 'plate') strong.add(key(x, y - 1, z));
      else if (support) strong.add(key(x + support[0], y + support[1], z + support[2]));
    }
    // only solid opaque blocks can be powered
    for (const k of [...strong]) { const [x, y, z] = unkey(k); if (!this.opaque(this.get(x, y, z))) strong.delete(k); }

    // dust: start at 15 next to a source or a strongly powered block, then spread
    const level = new Map();
    const queue = [];
    for (const k of this.positions) {
      const [x, y, z] = unkey(k);
      if (BLOCKS[this.get(x, y, z)].redstone !== 'wire') continue;
      let start = this.sourceFeedsWire(x, y, z) ? 15 : 0;
      if (!start) for (const [dx, dy, dz] of SIDES) if (strong.has(key(x + dx, y + dy, z + dz))) { start = 15; break; }
      level.set(k, start);
      if (start) queue.push(k);
    }
    while (queue.length) {
      const k = queue.shift();
      const l = level.get(k);
      if (l <= 1) continue;
      const [x, y, z] = unkey(k);
      for (const n of this.wireNeighbours(x, y, z)) {
        if ((level.get(n) ?? -1) < l - 1 && level.has(n)) { level.set(n, l - 1); queue.push(n); }
      }
    }
    this.power = level;

    // weakly powered blocks: under lit dust, or where lit dust points
    const weak = new Set();
    for (const [k, l] of level) {
      if (l <= 0) continue;
      const [x, y, z] = unkey(k);
      weak.add(key(x, y - 1, z));
      const points = wirePoints(wireConnections((a, b, c) => this.get(a, b, c), x, y, z));
      points.forEach((p, d) => { if (p) weak.add(key(x + FACING[d][0], y, z + FACING[d][2])); });
    }
    for (const k of [...weak]) { const [x, y, z] = unkey(k); if (!this.opaque(this.get(x, y, z))) weak.delete(k); }
    this.direct = direct;
    this.strong = strong;
    this.weak = weak;
  }

  // Dust next to a source takes power from it, except from the back or sides of a repeater.
  sourceFeedsWire(x, y, z) {
    for (const [dx, dy, dz] of SIDES) {
      const b = BLOCKS[this.get(x + dx, y + dy, z + dz)];
      if (!b.redstone) continue;
      if (b.redstone === 'repeater') {
        if (b.on && FACING[b.facing][0] === -dx && FACING[b.facing][2] === -dz && dy === 0) return true;
        continue;
      }
      if (b.redstone === 'block' || (b.on && ['torch', 'lever', 'button', 'plate'].includes(b.redstone))) return true;
    }
    return false;
  }

  // Dust that dust at (x, y, z) passes power to: beside it, one up (if nothing blocks
  // the way above), or one down (if the block beside isn't solid).
  wireNeighbours(x, y, z) {
    const out = [];
    const aboveOpen = !this.opaque(this.get(x, y + 1, z));
    for (const [dx, , dz] of FACING) {
      const side = this.get(x + dx, y, z + dz);
      if (BLOCKS[side].redstone === 'wire') out.push(key(x + dx, y, z + dz));
      else if (this.opaque(side)) { if (aboveOpen && BLOCKS[this.get(x + dx, y + 1, z + dz)].redstone === 'wire') out.push(key(x + dx, y + 1, z + dz)); }
      else if (BLOCKS[this.get(x + dx, y - 1, z + dz)].redstone === 'wire') out.push(key(x + dx, y - 1, z + dz));
    }
    return out;
  }

  opaque(id) {
    const b = BLOCKS[id];
    return !!b && b.solid && !b.transparent && b.render === 'cube';
  }

  // Is a solid block powered (for torches hanging on it)?
  blockPowered(x, y, z) {
    const k = key(x, y, z);
    return this.strong.has(k) || this.weak.has(k);
  }

  // Is a device at (x, y, z) powered? except: a direction (dx, dy, dz) to ignore (a piston's front)
  devicePowered(x, y, z, except = null) {
    if (this.direct.has(key(x, y, z)) && !this.onlyFrom(x, y, z, except)) return true;
    for (const [dx, dy, dz] of SIDES) {
      if (except && dx === except[0] && dy === except[1] && dz === except[2]) continue;
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (this.blockPowered(nx, ny, nz)) return true;
      const n = BLOCKS[this.get(nx, ny, nz)];
      if (n.redstone === 'wire' && (this.power.get(key(nx, ny, nz)) || 0) > 0) {
        if (dy !== 0) continue; // dust powers what it points at, not what's above or below it
        const points = wirePoints(wireConnections((a, b, c) => this.get(a, b, c), nx, ny, nz));
        const d = FACING.findIndex(([fx, , fz]) => fx === -dx && fz === -dz);
        if (points[d]) return true;
      }
    }
    return false;
  }

  // True if the only direct power at a cell comes from the ignored direction.
  onlyFrom(x, y, z, except) {
    if (!except) return false;
    for (const [dx, dy, dz] of SIDES) {
      if (dx === except[0] && dy === except[1] && dz === except[2]) continue;
      const b = BLOCKS[this.get(x + dx, y + dy, z + dz)];
      if (b.redstone === 'block' || (b.on && ['torch', 'lever', 'button', 'plate'].includes(b.redstone))) return false;
      if (b.redstone === 'repeater' && b.on && FACING[b.facing][0] === -dx && FACING[b.facing][2] === -dz && dy === 0) return false;
    }
    return true;
  }

  schedule(x, y, z, from, id, delay) {
    const k = key(x, y, z);
    const p = this.pending.get(k);
    if (p && p.id === id) return;
    this.pending.set(k, { from, id, at: this.tickCount + delay });
  }

  // Devices respond to the power worked out in compute().
  react() {
    for (const k of [...this.positions]) {
      const [x, y, z] = unkey(k);
      const id = this.get(x, y, z);
      const b = BLOCKS[id];
      switch (b.redstone) {
        case 'wire': {
          const want = BLOCK.REDSTONE_WIRE + wireBucket(this.power.get(k) || 0);
          if (want !== id) this.set(x, y, z, want);
          break;
        }
        case 'torch': {
          const [sx, sy, sz] = b.attach === 0 ? [0, -1, 0] : FACING[b.attach - 1].map((v) => -v);
          const lit = !this.blockPowered(x + sx, y + sy, z + sz);
          if (lit !== b.on) this.schedule(x, y, z, id, id + (lit ? 5 : -5), 1);
          else this.pending.delete(k);
          break;
        }
        case 'repeater': {
          const [fx, , fz] = FACING[b.facing];
          const bx = x - fx, bz = z - fz;
          const back = BLOCKS[this.get(bx, y, bz)];
          const input = (back.redstone === 'wire' && (this.power.get(key(bx, y, bz)) || 0) > 0) ||
            back.redstone === 'block' || (back.on && ['torch', 'lever', 'button', 'plate'].includes(back.redstone)) ||
            (back.redstone === 'repeater' && back.on && back.facing === b.facing) ||
            this.blockPowered(bx, y, bz);
          if (input !== b.on) this.schedule(x, y, z, id, id + (input ? 16 : -16), b.delay);
          break;
        }
        case 'lamp': {
          const want = this.devicePowered(x, y, z);
          if (want && !b.on) { this.pending.delete(k); this.set(x, y, z, BLOCK.REDSTONE_LAMP + 1); }
          else if (!want && b.on) this.schedule(x, y, z, id, BLOCK.REDSTONE_LAMP, LAMP_OFF_TICKS);
          else this.pending.delete(k);
          break;
        }
        case 'tnt':
          if (this.devicePowered(x, y, z)) { this.host.setBlock(x, y, z, BLOCK.AIR); this.host.primeTnt(x, y, z, 4); }
          break;
        case 'piston': {
          const [fx, fy, fz] = FACING6[b.facing6];
          const want = this.devicePowered(x, y, z, [fx, fy, fz]);
          if (want && !b.extended) this.extend(x, y, z, b);
          else if (!want && b.extended) this.retract(x, y, z, b);
          break;
        }
        default:
          if (b.shape === 'door' && !b.upper) {
            const powered = this.devicePowered(x, y, z) || this.devicePowered(x, y + 1, z);
            const before = this.doorPowered.get(k);
            this.doorPowered.set(k, powered);
            if (before === undefined || before === powered) break;
            // power changed: open or close both halves
            for (const yy of [y, y + 1]) {
              const d = this.get(x, yy, z);
              if (BLOCKS[d].shape !== 'door') continue;
              const want = BLOCK.OAK_DOOR + ((d - BLOCK.OAK_DOOR) & ~4) + (powered ? 4 : 0);
              this.set(x, yy, z, want);
            }
          }
      }
    }
  }

  // ---------- pistons ----------
  movable(id) {
    const b = BLOCKS[id];
    if (!b || id === BLOCK.AIR) return 'air';
    if (b.liquid || b.replaceable) return 'air';
    if (!Number.isFinite(b.hardness) || id === BLOCK.OBSIDIAN || id === BLOCK.BEDROCK || id === BLOCK.CHEST || id === BLOCK.FURNACE) return 'no';
    if (b.redstone === 'head' || (b.redstone === 'piston' && b.extended)) return 'no';
    if (b.shape === 'door' || b.needsSupport || b.render === 'cross' || b.render === 'crop' || b.render === 'torch' || b.render === 'wire' || b.attach !== undefined) return 'breaks';
    return 'yes';
  }

  extend(x, y, z, b) {
    const [fx, fy, fz] = FACING6[b.facing6];
    const line = [];
    let cx = x + fx, cy = y + fy, cz = z + fz;
    for (;;) {
      if (cy < 1 || cy >= 255) return false;
      const id = this.get(cx, cy, cz);
      const m = this.movable(id);
      if (m === 'air') break;
      if (m === 'no') return false;
      if (m === 'breaks') { this.breakPushed(cx, cy, cz, id); break; }
      line.push([cx, cy, cz, id]);
      if (line.length > PUSH_LIMIT) return false;
      cx += fx; cy += fy; cz += fz;
    }
    // move from the far end back, then the head
    for (let i = line.length - 1; i >= 0; i--) {
      const [lx, ly, lz, id] = line[i];
      this.host.setBlock(lx + fx, ly + fy, lz + fz, id);
    }
    const base = b.sticky ? BLOCK.STICKY_PISTON : BLOCK.PISTON;
    this.host.setBlock(x + fx, y + fy, z + fz, BLOCK.PISTON_HEAD + (b.sticky ? 6 : 0) + b.facing6);
    this.host.setBlock(x, y, z, base + 6 + b.facing6);
    this.host.pushed?.(x + fx, y + fy, z + fz, fx, fy, fz);
    return true;
  }

  retract(x, y, z, b) {
    const [fx, fy, fz] = FACING6[b.facing6];
    const base = b.sticky ? BLOCK.STICKY_PISTON : BLOCK.PISTON;
    const hx = x + fx, hy = y + fy, hz = z + fz;
    if (BLOCKS[this.get(hx, hy, hz)].redstone === 'head') this.host.setBlock(hx, hy, hz, BLOCK.AIR);
    if (b.sticky) {
      const px = hx + fx, py = hy + fy, pz = hz + fz;
      const id = this.get(px, py, pz);
      if (this.movable(id) === 'yes') {
        this.host.setBlock(px, py, pz, BLOCK.AIR);
        this.host.setBlock(hx, hy, hz, id);
      }
    }
    this.host.setBlock(x, y, z, base + b.facing6);
  }

  breakPushed(x, y, z, id) {
    this.host.setBlock(x, y, z, BLOCK.AIR);
    for (const [d, n] of getDrops(id, ITEM.DIAMOND_PICKAXE)) this.host.spawnItem(x + 0.5, y + 0.3, z + 0.5, d, n);
  }
}
