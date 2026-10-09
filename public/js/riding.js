// How the things you ride move, simulated by the rider's own game (the host follows along).
// A vehicle: {kind, x, y, z, yaw, vx, vy, vz, halfW, height, onGround, speed?, jump?}.
// input: {forward (-1..1), strafe (-1..1), jump (bool), lookYaw}.

import { BLOCKS, fluidOf } from './blocks.js';
import { moveBody } from './physics.js';
import { railInfo, SHAPE_EXITS, DIRS, UPHILL } from './rails.js';

const GRAVITY = 32;
export const SIZES = { boat: [0.65, 0.56], horse: [0.7, 1.6], pig: [0.45, 0.9], minecart: [0.49, 0.7] };

const blockAt = (world, x, y, z) => world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
const isWater = (world, x, y, z) => fluidOf(blockAt(world, x, y, z)) === 'water';

// The height of the water's surface above (x, y, z), or null if there's no water there.
function waterSurface(world, x, y, z) {
  let by = Math.floor(y);
  if (!isWater(world, x, by, z)) { if (!isWater(world, x, by - 1, z)) return null; by--; }
  while (by < 255 && isWater(world, x, by + 1, z)) by++;
  return by + 0.9;
}

export function stepVehicle(world, v, input, dt) {
  if (v.kind === 'boat') return stepBoat(world, v, input, dt);
  if (v.kind === 'minecart') return stepMinecart(world, v, input, dt);
  return stepAnimal(world, v, input, dt);
}

// Boats: W and S paddle, A and D turn. Fast on water, faster on ice, slow on land.
function stepBoat(world, v, input, dt) {
  const surface = waterSurface(world, v.x, v.y + 0.2, v.z);
  const under = BLOCKS[blockAt(world, v.x, v.y - 0.1, v.z)];
  v.yaw += -input.strafe * 2.4 * dt;
  const onIce = !surface && /Ice/.test(under.name || '');
  const max = surface !== null ? 8 : onIce ? 25 : 1.2;
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
  const thrust = input.forward > 0 ? input.forward : input.forward * 0.4;
  v.vx += fx * thrust * max * 1.5 * dt;
  v.vz += fz * thrust * max * 1.5 * dt;
  const drag = Math.exp(-(surface !== null ? 1.5 : onIce ? 0.3 : 6) * dt);
  v.vx *= drag; v.vz *= drag;
  const sp = Math.hypot(v.vx, v.vz);
  if (sp > max) { v.vx *= max / sp; v.vz *= max / sp; }
  if (surface !== null) {
    // float: the bottom of the boat a little under the surface
    const target = surface - 0.15;
    v.vy += ((target - v.y) * 12 - v.vy) * Math.min(1, dt * 6);
  } else v.vy = Math.max(-40, v.vy - GRAVITY * dt);
  const res = moveBody(world, v, dt, 0);
  v.onGround = res.onGround;
  if (res.hitWall) { v.vx *= 0.3; v.vz *= 0.3; }
}

// Horses and pigs: walk where the rider looks, step up whole blocks, swim, and (horses) jump.
function stepAnimal(world, v, input, dt) {
  v.yaw = input.lookYaw;
  const sin = Math.sin(v.yaw), cos = Math.cos(v.yaw);
  let wx = -sin * input.forward + cos * input.strafe * 0.5, wz = -cos * input.forward - sin * input.strafe * 0.5;
  const len = Math.hypot(wx, wz);
  if (len > 1) { wx /= len; wz /= len; }
  const inWater = isWater(world, v.x, v.y + 0.6, v.z);
  const speed = (v.speed || 4) * (inWater ? 0.4 : 1);
  const a = Math.min(1, dt * (v.onGround ? 10 : 3));
  v.vx += (wx * speed - v.vx) * a;
  v.vz += (wz * speed - v.vz) * a;
  if (inWater) v.vy = Math.min(v.vy + 30 * dt, 2.5);
  else v.vy = Math.max(-60, v.vy - GRAVITY * dt);
  if (input.jump && v.onGround && v.jump) {
    const h = 1.1 + ((v.jump - 0.4) / 0.6) * 4.2; // jump strength 0.4-1.0: about 1 to 5 blocks
    v.vy = Math.sqrt(2 * GRAVITY * h);
  }
  v.wasOnGround = v.onGround;
  const res = moveBody(world, v, dt, 1.05);
  v.onGround = res.onGround;
}

// Minecarts: follow the track (straight, round curves, up and down slopes), keeping their
// speed; slopes speed them up or slow them down, powered rails push (or brake when off),
// W gives a little push the way you look. Off the end of the track they roll and fall.
const CART_MAX = 8;
function railUnder(world, v) {
  const bx = Math.floor(v.x), bz = Math.floor(v.z);
  for (const by of [Math.floor(v.y + 0.1), Math.floor(v.y + 0.1) - 1]) {
    const info = railInfo(world.getBlock(bx, by, bz));
    if (info) return { ...info, bx, by, bz };
  }
  return null;
}

function stepMinecart(world, v, input, dt) {
  const rail = railUnder(world, v);
  if (!rail) {
    // off the rails: a heavy box that slides to a stop
    v.vy = Math.max(-40, v.vy - GRAVITY * dt);
    if (v.onGround) { const f = Math.exp(-4 * dt); v.vx *= f; v.vz *= f; }
    const res = moveBody(world, v, dt, 0);
    v.onGround = res.onGround;
    return;
  }
  const cx = rail.bx + 0.5, cz = rail.bz + 0.5;
  const exits = SHAPE_EXITS[rail.shape].map((d) => DIRS[d]);
  let speed = Math.hypot(v.vx, v.vz);
  let dir = speed > 1e-3 ? [v.vx / speed, v.vz / speed] : null;
  // a push from the rider, along the track
  if (input.forward > 0) {
    const look = [-Math.sin(input.lookYaw), -Math.cos(input.lookYaw)];
    const best = exits.reduce((a, e) => (e[0] * look[0] + e[1] * look[1] > a[0] * look[0] + a[1] * look[1] ? e : a));
    if (!dir || speed < 2) { if (!dir || best[0] * dir[0] + best[1] * dir[1] > 0) { dir = best; speed = Math.min(CART_MAX, speed + 4 * dt); } }
  }
  if (!dir) { v.vx = v.vz = 0; v.y = rail.by + 0.0625; return; }
  // the exit we're heading for, and the other end of this piece of track
  let out = exits[0], back = exits[1];
  if (exits[1][0] * dir[0] + exits[1][1] * dir[1] > exits[0][0] * dir[0] + exits[0][1] * dir[1]) { out = exits[1]; back = exits[0]; }
  // still on the near half: head for the middle first (this is what takes us round curves)
  const rx = v.x - cx, rz = v.z - cz;
  let move;
  if (rx * back[0] + rz * back[1] > 0.02) { const l = Math.hypot(rx, rz) || 1; move = [-rx / l, -rz / l]; }
  else {
    move = out;
    // keep to the middle of the track
    if (out[0] === 0) v.x = cx; else v.z = cz;
  }
  // slopes, powered rails and friction
  const up = UPHILL[rail.shape];
  if (up) {
    const [ux, uz] = DIRS[up];
    speed += (move[0] * ux + move[1] * uz > 0 ? -1 : 1) * 4 * dt;
    if (speed < 0) { speed = -speed; move = [-move[0], -move[1]]; }
  }
  if (rail.powered) speed = rail.on ? Math.min(CART_MAX, speed + 10 * dt) : speed * Math.exp(-8 * dt);
  speed *= Math.exp(-0.08 * dt);
  speed = Math.min(CART_MAX, speed);
  const nx = v.x + move[0] * speed * dt, nz = v.z + move[1] * speed * dt;
  // a wall at the end of the track stops us
  const ahead = world.getBlock(Math.floor(nx + move[0] * v.halfW), Math.floor(v.y + 0.3), Math.floor(nz + move[1] * v.halfW));
  if (BLOCKS[ahead].solid && !railInfo(ahead)) { v.vx = v.vz = 0; return; }
  v.x = nx; v.z = nz;
  v.vx = move[0] * speed; v.vz = move[1] * speed; v.vy = 0;
  // height: on the rail, rising along a slope
  if (up) {
    const [ux, uz] = DIRS[up];
    const along = (v.x - cx) * ux + (v.z - cz) * uz + 0.5; // 0 at the low end, 1 at the high end
    v.y = rail.by + 0.0625 + Math.max(0, Math.min(1, along));
  } else v.y = rail.by + 0.0625;
  v.yaw = Math.atan2(-move[0], -move[1]);
  v.onGround = true;
}
