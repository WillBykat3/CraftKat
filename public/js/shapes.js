// Shapes of blocks that aren't full cubes: slabs, stairs, doors, ladders,
// fences, farmland and beds. A shape is a list of boxes [x0, y0, z0, x1, y1, z1]
// in block coordinates (0-1). The same boxes are drawn, collided with and aimed at.

import { BLOCKS } from './blocks.js';

const P = 1 / 16;
const DOOR = 3 * P;

// Box of thickness t against one side of the block. side: facing index (0 N, 1 E, 2 S, 3 W)
function sideBox(side, t, y0 = 0, y1 = 1) {
  switch (side) {
    case 0: return [0, y0, 0, 1, y1, t];
    case 1: return [1 - t, y0, 0, 1, y1, 1];
    case 2: return [0, y0, 1 - t, 1, y1, 1];
    default: return [0, y0, 0, t, y1, 1];
  }
}

// What a fence connects to: other fences and full solid blocks.
function fenceConnects(id) {
  const b = BLOCKS[id];
  return !!b && (b.shape === 'fence' || (b.solid && !b.transparent && b.render === 'cube'));
}

// neighbor(dx, dy, dz) -> block id. collision: fences are 1.5 blocks tall to collide with.
export function shapeBoxes(id, neighbor, collision = false) {
  const b = BLOCKS[id];
  switch (b.shape) {
    case 'slab': return [[0, 0, 0, 1, 0.5, 1]];
    case 'farmland': return [[0, 0, 0, 1, 15 * P, 1]];
    case 'bed': return [[0, 0, 0, 1, 9 * P, 1]];
    case 'stairs': {
      // a bottom slab plus the back half on top, on the side the player faced when placing
      return [[0, 0, 0, 1, 0.5, 1], sideBox(b.facing, 0.5, 0.5, 1)];
    }
    case 'ladder': return [sideBox((b.facing + 2) % 4, 3 * P)];
    case 'door': {
      // closed: on the side of the block nearest the player who placed it; open: swung to the left
      const side = b.open ? (b.facing + 3) % 4 : (b.facing + 2) % 4;
      return [sideBox(side, DOOR)];
    }
    case 'fence': {
      const top = collision ? 1.5 : 1;
      const boxes = [[6 * P, 0, 6 * P, 10 * P, top, 10 * P]];
      const arms = [[0, -1, [7 * P, 0, 7 * P, 9 * P]], [1, 0, [9 * P, 7 * P, 1, 9 * P]], [0, 1, [7 * P, 9 * P, 9 * P, 1]], [-1, 0, [0, 7 * P, 7 * P, 9 * P]]];
      for (const [dx, dz, [x0, z0, x1, z1]] of arms) {
        if (!neighbor || !fenceConnects(neighbor(dx, 0, dz))) continue;
        if (collision) boxes.push([x0, 0, z0, x1, top, z1]);
        else { boxes.push([x0, 6 * P, z0, x1, 9 * P, z1]); boxes.push([x0, 12 * P, z0, x1, 15 * P, z1]); }
      }
      return boxes;
    }
    default: return null;
  }
}

// Boxes to collide with, in block coordinates: full cube for solid cubes, none for non-solid blocks.
const FULL = [[0, 0, 0, 1, 1, 1]];
export function collisionBoxes(id, neighbor) {
  const b = BLOCKS[id];
  if (!b || !b.solid) return null;
  if (b.shape) return shapeBoxes(id, neighbor, true);
  return FULL;
}

// Boxes you can aim at (outlines and clicking): the drawn shape, or the full block.
export function selectionBoxes(id, neighbor) {
  const b = BLOCKS[id];
  if (b.shape) return shapeBoxes(id, neighbor, false);
  if (b.crop) return [[0, 0, 0, 1, (2 + b.crop.stage * (12 / b.crop.max)) * P, 1]];
  if (b.render === 'cross' || b.render === 'crop') return [[2 * P, 0, 2 * P, 14 * P, 13 * P, 14 * P]];
  return FULL;
}

// Ray against one box: distance along the ray and the face normal, or null.
export function rayBox(o, d, box, ox = 0, oy = 0, oz = 0) {
  let tmin = 0, tmax = Infinity, axis = -1, sign = 0;
  const lo = [box[0] + ox, box[1] + oy, box[2] + oz], hi = [box[3] + ox, box[4] + oy, box[5] + oz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < lo[a] || o[a] > hi[a]) return null;
      continue;
    }
    let t0 = (lo[a] - o[a]) / d[a], t1 = (hi[a] - o[a]) / d[a];
    let s = -Math.sign(d[a]);
    if (t0 > t1) { [t0, t1] = [t1, t0]; }
    if (t0 > tmin) { tmin = t0; axis = a; sign = s; }
    tmax = Math.min(tmax, t1);
    if (tmin > tmax) return null;
  }
  const normal = [0, 0, 0];
  if (axis >= 0) normal[axis] = sign;
  return { t: tmin, normal };
}

// Union of boxes, for the block outline.
export function boundsOf(boxes) {
  const b = [1, 1, 1, 0, 0, 0];
  for (const x of boxes) for (let i = 0; i < 3; i++) { b[i] = Math.min(b[i], x[i]); b[i + 3] = Math.max(b[i + 3], x[i + 3]); }
  return b;
}

// Facing (0 N, 1 E, 2 S, 3 W) from a look direction yaw (yaw 0 looks north).
export function facingFromYaw(yaw) {
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  if (Math.abs(fz) >= Math.abs(fx)) return fz < 0 ? 0 : 2;
  return fx > 0 ? 1 : 3;
}
