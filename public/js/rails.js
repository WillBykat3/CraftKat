// Rails: which way a piece of track runs, worked out from the rails around it like
// Minecraft's, and the path a minecart follows along it.
// Shapes: 0 north-south, 1 east-west, 2-5 sloping up to the east/west/north/south,
// 6-9 curves joining south+east, south+west, north+west, north+east.

export const RAIL = 1120;         // + shape (0-9)
export const POWERED_RAIL = 1130; // + shape (0-5) + (powered ? 6 : 0)

export const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
export const SHAPE_EXITS = [['N', 'S'], ['E', 'W'], ['E', 'W'], ['E', 'W'], ['N', 'S'], ['N', 'S'], ['S', 'E'], ['S', 'W'], ['N', 'W'], ['N', 'E']];
export const UPHILL = { 2: 'E', 3: 'W', 4: 'N', 5: 'S' };

export const isRail = (id) => id >= RAIL && id < POWERED_RAIL + 12;
export function railInfo(id) {
  if (id >= RAIL && id < RAIL + 10) return { powered: false, on: false, shape: id - RAIL };
  if (id >= POWERED_RAIL && id < POWERED_RAIL + 12) { const k = id - POWERED_RAIL; return { powered: true, on: k >= 6, shape: k % 6 }; }
  return null;
}
export const railId = (info) => (info.powered ? POWERED_RAIL + info.shape + (info.on ? 6 : 0) : RAIL + info.shape);

// The shape a rail at (x, y, z) should have, from its neighbours (get(x, y, z) -> block id).
// yaw: which way the player faced, for a rail with no neighbours.
export function computeShape(get, x, y, z, powered, yaw = 0) {
  const conn = {};
  let up = null;
  for (const [d, [dx, dz]] of Object.entries(DIRS)) {
    if (isRail(get(x + dx, y, z + dz)) || isRail(get(x + dx, y - 1, z + dz))) conn[d] = true;
    if (isRail(get(x + dx, y + 1, z + dz))) { conn[d] = true; up ??= d; }
  }
  const ns = conn.N || conn.S, ew = conn.E || conn.W;
  if (up) return { E: 2, W: 3, N: 4, S: 5 }[up];
  if (!powered && ns && ew && !(conn.N && conn.S) && !(conn.E && conn.W)) {
    if (conn.S && conn.E) return 6;
    if (conn.S && conn.W) return 7;
    if (conn.N && conn.W) return 8;
    return 9;
  }
  if (ns && !(ew && !(conn.N && conn.S))) return 0;
  if (ew) return 1;
  return Math.abs(Math.sin(yaw)) > Math.abs(Math.cos(yaw)) ? 1 : 0;
}

// Whether a rail's both ends lead to other rails (if so, a new neighbour doesn't change it).
export function railConnected(get, x, y, z, shape) {
  return SHAPE_EXITS[shape].every((d) => {
    const [dx, dz] = DIRS[d];
    return [-1, 0, 1].some((dy) => isRail(get(x + dx, y + dy, z + dz)));
  });
}
