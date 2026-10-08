// Redstone rules shared by the mesher (how dust looks) and the host (how power flows).

import { BLOCKS, FACING } from './blocks.js';

export const WIRE_COLORS = [[75, 0, 0], [140, 10, 0], [200, 20, 0], [255, 50, 40]]; // off ... bright

// Dust brightness bucket (0-3) for a power level (0-15).
export function wireBucket(power) {
  return power <= 0 ? 0 : power <= 5 ? 1 : power <= 10 ? 2 : 3;
}

const isWire = (id) => BLOCKS[id]?.redstone === 'wire';
const opaque = (id) => !!BLOCKS[id] && !BLOCKS[id].transparent;

// Things dust visually connects to from side d (0-3).
function connectsTo(id, d) {
  const b = BLOCKS[id];
  if (!b || !b.redstone) return false;
  switch (b.redstone) {
    case 'wire': case 'torch': case 'lever': case 'button': case 'plate': case 'block': return true;
    case 'repeater': return b.facing === d || b.facing === (d + 2) % 4;
    default: return false;
  }
}

// Which sides dust at (x, y, z) connects to. get(x, y, z) -> block id.
// Returns {side: [n, e, s, w] booleans, up: [n, e, s, w] (climbs the block on that side)}.
export function wireConnections(get, x, y, z) {
  const side = [false, false, false, false];
  const up = [false, false, false, false];
  const aboveOpen = !opaque(get(x, y + 1, z));
  for (let d = 0; d < 4; d++) {
    const [dx, , dz] = FACING[d];
    const n = get(x + dx, y, z + dz);
    if (connectsTo(n, d)) { side[d] = true; continue; }
    if (aboveOpen && opaque(n) && isWire(get(x + dx, y + 1, z + dz))) { side[d] = true; up[d] = true; continue; }
    if (!opaque(n) && isWire(get(x + dx, y - 1, z + dz))) side[d] = true;
  }
  return { side, up };
}

// The directions dust points (and so powers): its connections, a straight line
// if it has just one, or every side if it has none.
export function wirePoints(conn) {
  const n = conn.side.filter(Boolean).length;
  if (n === 0) return [true, true, true, true];
  if (n === 1) {
    const d = conn.side.indexOf(true);
    const out = [false, false, false, false];
    out[d] = true;
    out[(d + 2) % 4] = true;
    return out;
  }
  return conn.side;
}
