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
    case 'path': return [[0, 0, 0, 1, 15 * P, 1]];
    case 'rail': return [[0, 0, 0, 1, 2 * P, 1]];
    case 'brewing': return [[7 * P, 0, 7 * P, 9 * P, 14 * P, 9 * P, 'brewing_stand_rod'], [1 * P, 0, 1 * P, 15 * P, 2 * P, 15 * P]];
    case 'table12': return [[0, 0, 0, 1, 12 * P, 1]];
    case 'anvil': return [[2 * P, 0, 2 * P, 14 * P, 4 * P, 14 * P], [4 * P, 4 * P, 3 * P, 12 * P, 5 * P, 13 * P], [6 * P, 5 * P, 4 * P, 10 * P, 10 * P, 12 * P], [3 * P, 10 * P, 0, 13 * P, 16 * P, 1]];
    case 'stonecutter': return [[0, 0, 0, 1, 9 * P, 1]];
    case 'grindstone': return [[4 * P, 4 * P, 2 * P, 12 * P, 16 * P, 14 * P], [2 * P, 0, 6 * P, 4 * P, 12 * P, 10 * P, 'planks'], [12 * P, 0, 6 * P, 14 * P, 12 * P, 10 * P, 'planks']];
    case 'cauldron': return [[0, 3 * P, 0, 1, 1, 2 * P], [0, 3 * P, 14 * P, 1, 1, 1], [0, 3 * P, 2 * P, 2 * P, 1, 14 * P], [14 * P, 3 * P, 2 * P, 1, 1, 14 * P], [2 * P, 3 * P, 2 * P, 14 * P, 4 * P, 14 * P],
      [0, 0, 0, 4 * P, 3 * P, 4 * P], [12 * P, 0, 0, 1, 3 * P, 4 * P], [0, 0, 12 * P, 4 * P, 3 * P, 1], [12 * P, 0, 12 * P, 1, 3 * P, 1]];
    case 'bell': return [[5 * P, 4 * P, 5 * P, 11 * P, 11 * P, 11 * P], [4 * P, 4 * P, 4 * P, 12 * P, 6 * P, 12 * P], [7 * P, 11 * P, 7 * P, 9 * P, 16 * P, 9 * P, 'cobble']];
    case 'portal': return [b.axis === 0 ? [0, 0, 6 * P, 1, 1, 10 * P] : [6 * P, 0, 0, 10 * P, 1, 1]];
    case 'end_portal': return [[0, 11 * P, 0, 1, 12 * P, 1]];
    case 'frame': {
      const boxes = [[0, 0, 0, 1, 13 * P, 1]];
      if (b.eye) boxes.push([4 * P, 13 * P, 4 * P, 12 * P, 16 * P, 12 * P, 'end_portal_frame_eye']);
      return boxes;
    }
    case 'egg': return [[3 * P, 0, 3 * P, 13 * P, 8 * P, 13 * P], [4 * P, 8 * P, 4 * P, 12 * P, 12 * P, 12 * P], [5 * P, 12 * P, 5 * P, 11 * P, 14 * P, 11 * P], [6 * P, 14 * P, 6 * P, 10 * P, 15 * P, 10 * P]];
    case 'lever': {
      // a cobblestone base and a handle tipped one way (off) or the other (on)
      const handle = b.on ? [7, 3, 3, 9, 10, 7] : [7, 3, 9, 9, 10, 13];
      return [mounted([5, 0, 4, 11, 3, 12], b.attach, 'cobble'), mounted(handle, b.attach, 'lever_handle')];
    }
    case 'button': return [mounted([5, 0, 6, 11, b.on ? 1 : 2, 10], b.attach)];
    case 'plate': return [[P, 0, P, 15 * P, b.on ? 0.5 * P : P, 15 * P]];
    case 'repeater': {
      // a thin stone slab with two little torches; the back one moves with the delay
      const tip = b.on ? 'torch_tip_on' : 'torch_tip_off';
      const back = 2 + (b.delay - 1) * 2;
      return [[0, 0, 0, 1, 2 * P, 1], along4(b.facing, 12 * P, 14 * P, 7 * P, 9 * P, 2 * P, 7 * P, tip), along4(b.facing, back * P, (back + 2) * P, 7 * P, 9 * P, 2 * P, 7 * P, tip)];
    }
    case 'piston': {
      const f = b.facing6;
      const faces = pistonFaces(f, b.extended ? 'piston_inner' : 'piston_top');
      return [along6(f, 0, b.extended ? 12 * P : 1, 0, 1, faces)];
    }
    case 'head': {
      const f = b.facing6;
      return [along6(f, 12 * P, 1, 0, 1, pistonFaces(f, 'piston_top')), along6(f, -4 * P, 12 * P, 6 * P, 10 * P, 'piston_side')];
    }
    default: return null;
  }
}

// A box given for something standing on the floor (in 16ths), turned to hang on a wall.
// attach 0: on the floor; 1-4: on the wall behind, facing 0-3. tex: optional texture for the box.
function mounted([x0, y0, z0, x1, y1, z1], attach, tex) {
  const k = [x0 * P, y0 * P, z0 * P, x1 * P, y1 * P, z1 * P];
  let box;
  if (attach === 0) box = k;
  else {
    // local y (away from the support) becomes the facing direction, local z becomes up
    const f = attach - 1;
    const map = (lx, ly, lz) => {
      switch (f) {
        case 2: return [lx, lz, ly];
        case 0: return [1 - lx, lz, 1 - ly];
        case 1: return [ly, lz, 1 - lx];
        default: return [1 - ly, lz, lx];
      }
    };
    const a = map(k[0], k[1], k[2]), c = map(k[3], k[4], k[5]);
    box = [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.min(a[2], c[2]), Math.max(a[0], c[0]), Math.max(a[1], c[1]), Math.max(a[2], c[2])];
  }
  if (tex) box.push(tex);
  return box;
}

// A box along a horizontal facing: t0-t1 from back (0) to front (1), c0-c1 across, y0-y1 up.
function along4(f, t0, t1, c0, c1, y0, y1, tex) {
  let box;
  switch (f) {
    case 0: box = [c0, y0, 1 - t1, c1, y1, 1 - t0]; break;
    case 2: box = [c0, y0, t0, c1, y1, t1]; break;
    case 1: box = [t0, y0, c0, t1, y1, c1]; break;
    default: box = [1 - t1, y0, c0, 1 - t0, y1, c1];
  }
  if (tex) box.push(tex);
  return box;
}

// Same for any of the 6 directions, with c0-c1 on both other axes.
function along6(f, t0, t1, c0, c1, tex) {
  let box;
  switch (f) {
    case 4: box = [c0, t0, c0, c1, t1, c1]; break;
    case 5: box = [c0, 1 - t1, c0, c1, 1 - t0, c1]; break;
    default: { const b = along4(f, t0, t1, c0, c1, c0, c1); box = b; }
  }
  if (tex) box.push(tex);
  return box;
}

// Textures for each face of a piston (in the mesher's face order: -x +x -y +y -z +z).
const FACE_OF = [4, 1, 5, 0, 3, 2]; // facing6 -> face index
function pistonFaces(f, front) {
  const faces = new Array(6).fill('piston_side');
  faces[FACE_OF[f]] = front;
  faces[FACE_OF[f] ^ 1] = 'piston_bottom';
  return faces;
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
