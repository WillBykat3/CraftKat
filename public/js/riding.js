// How the things you ride move, simulated by the rider's own game (the host follows along).
// A vehicle: {kind, x, y, z, yaw, vx, vy, vz, halfW, height, onGround, speed?, jump?}.
// input: {forward (-1..1), strafe (-1..1), jump (bool), lookYaw}.

import { BLOCKS, fluidOf } from './blocks.js';
import { moveBody } from './physics.js';

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
