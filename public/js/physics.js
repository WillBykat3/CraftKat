// Box-vs-voxel collision shared by players (client) and mobs (host).

import { BLOCKS, BLOCK } from './blocks.js';
import { shapeBoxes } from './shapes.js';

const EPS = 1e-4;

// Calls fn(box) (world coordinates) for every collision box that could touch the body.
// Cells one below the body are included, because fences are 1.5 blocks tall.
function boxesNear(world, body, fn) {
  const x0 = Math.floor(body.x - body.halfW), x1 = Math.floor(body.x + body.halfW);
  const y0 = Math.floor(body.y) - 1, y1 = Math.floor(body.y + body.height);
  const z0 = Math.floor(body.z - body.halfW), z1 = Math.floor(body.z + body.halfW);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const id = world.getBlock(x, y, z);
        const def = BLOCKS[id];
        if (!def.solid) continue;
        if (!def.shape) {
          if (y === y0) continue; // a full block below the feet can't reach up into the body
          if (fn(x, y, z, x + 1, y + 1, z + 1)) return true;
          continue;
        }
        const boxes = shapeBoxes(id, (dx, dy, dz) => world.getBlock(x + dx, y + dy, z + dz), true);
        for (const bx of boxes) if (fn(x + bx[0], y + bx[1], z + bx[2], x + bx[3], y + bx[4], z + bx[5])) return true;
      }
    }
  }
  return false;
}

function overlaps(body, x0, y0, z0, x1, y1, z1) {
  return x0 < body.x + body.halfW && x1 > body.x - body.halfW &&
    y0 < body.y + body.height && y1 > body.y &&
    z0 < body.z + body.halfW && z1 > body.z - body.halfW;
}

// body: {x, y, z, vx, vy, vz, halfW, height}; feet at y.
export function collides(world, body) {
  return boxesNear(world, body, (x0, y0, z0, x1, y1, z1) => overlaps(body, x0, y0, z0, x1, y1, z1));
}

// Moves along one axis (by less than a block) and snaps back against anything hit.
function moveAxis(world, body, axis, amount) {
  if (amount === 0) return false;
  body[axis] += amount;
  let limit = amount > 0 ? Infinity : -Infinity;
  boxesNear(world, body, (x0, y0, z0, x1, y1, z1) => {
    if (!overlaps(body, x0, y0, z0, x1, y1, z1)) return false;
    const lo = axis === 'x' ? x0 : axis === 'y' ? y0 : z0;
    const hi = axis === 'x' ? x1 : axis === 'y' ? y1 : z1;
    limit = amount > 0 ? Math.min(limit, lo) : Math.max(limit, hi);
    return false;
  });
  if (!Number.isFinite(limit)) return false;
  const below = axis === 'y' ? 0 : body.halfW;
  const above = axis === 'y' ? body.height : body.halfW;
  if (amount > 0) body[axis] = limit - above - EPS;
  else body[axis] = limit + below + EPS;
  return true;
}

// Integrates velocity for dt seconds. Returns {onGround, hitWall}.
// stepHeight: bodies on the ground walk up ledges this high (slabs, stairs), like Minecraft's 0.6.
export function moveBody(world, body, dt, stepHeight = 0) {
  const dx = body.vx * dt, dy = body.vy * dt, dz = body.vz * dt;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.4));
  let onGround = false, hitWall = false;
  const canStep = stepHeight > 0 && body.vy <= 0 && (body.onGround || body.wasOnGround);
  for (let i = 0; i < steps; i++) {
    const sx = dx / steps, sz = dz / steps;
    const start = { x: body.x, y: body.y, z: body.z };
    const hitX = moveAxis(world, body, 'x', sx);
    const hitZ = moveAxis(world, body, 'z', sz);
    if ((hitX || hitZ) && canStep) {
      // try again from higher up, then settle back down onto whatever we stepped on
      const blocked = { x: body.x, y: body.y, z: body.z };
      Object.assign(body, start);
      if (!moveAxis(world, body, 'y', stepHeight)) {
        const sxHit = moveAxis(world, body, 'x', sx);
        const szHit = moveAxis(world, body, 'z', sz);
        moveAxis(world, body, 'y', -stepHeight - EPS * 2);
        const gained = Math.hypot(body.x - blocked.x, body.z - blocked.z);
        if (gained > 1e-3 && body.y > start.y - EPS) {
          if (sxHit) body.vx = 0;
          if (szHit) body.vz = 0;
          hitWall = hitWall || sxHit || szHit;
          onGround = true;
          continue;
        }
      }
      Object.assign(body, blocked);
    }
    if (hitX) { body.vx = 0; hitWall = true; }
    if (hitZ) { body.vz = 0; hitWall = true; }
    if (moveAxis(world, body, 'y', dy / steps)) {
      if (dy < 0) onGround = true;
      body.vy = 0;
    }
  }
  return { onGround, hitWall };
}

// Pushes a body upward out of solid blocks (e.g. after a block was placed inside it).
export function unstick(world, body, maxY = 200) {
  while (collides(world, body) && body.y < maxY) body.y = Math.floor(body.y) + 1 + EPS;
}

export function isWater(world, x, y, z) {
  return BLOCKS[world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))]?.liquid === 'water';
}

export function boxOverlapsBlock(body, bx, by, bz) {
  return bx < body.x + body.halfW && bx + 1 > body.x - body.halfW &&
    by < body.y + body.height && by + 1 > body.y &&
    bz < body.z + body.halfW && bz + 1 > body.z - body.halfW;
}
