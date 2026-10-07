// Box-vs-voxel collision shared by players (client) and mobs (host).

import { BLOCKS, BLOCK } from './blocks.js';

const EPS = 1e-4;

// body: {x, y, z, vx, vy, vz, halfW, height}; feet at y.
export function collides(world, body) {
  const x0 = Math.floor(body.x - body.halfW), x1 = Math.floor(body.x + body.halfW);
  const y0 = Math.floor(body.y), y1 = Math.floor(body.y + body.height);
  const z0 = Math.floor(body.z - body.halfW), z1 = Math.floor(body.z + body.halfW);
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (BLOCKS[world.getBlock(x, y, z)].solid) return true;
      }
    }
  }
  return false;
}

// Moves along one axis (by less than a block) and snaps back against anything hit.
function moveAxis(world, body, axis, amount) {
  if (amount === 0) return false;
  body[axis] += amount;
  if (!collides(world, body)) return false;
  const below = axis === 'y' ? 0 : body.halfW;
  const above = axis === 'y' ? body.height : body.halfW;
  if (amount > 0) body[axis] = Math.floor(body[axis] + above) - above - EPS;
  else body[axis] = Math.floor(body[axis] - below) + 1 + below + EPS;
  return true;
}

// Integrates velocity for dt seconds. Returns {onGround, hitWall}.
export function moveBody(world, body, dt) {
  const dx = body.vx * dt, dy = body.vy * dt, dz = body.vz * dt;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) / 0.4));
  let onGround = false, hitWall = false;
  for (let i = 0; i < steps; i++) {
    if (moveAxis(world, body, 'x', dx / steps)) { body.vx = 0; hitWall = true; }
    if (moveAxis(world, body, 'z', dz / steps)) { body.vz = 0; hitWall = true; }
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
  return world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) === BLOCK.WATER;
}

export function boxOverlapsBlock(body, bx, by, bz) {
  return bx < body.x + body.halfW && bx + 1 > body.x - body.halfW &&
    by < body.y + body.height && by + 1 > body.y &&
    bz < body.z + body.halfW && bz + 1 > body.z - body.halfW;
}
