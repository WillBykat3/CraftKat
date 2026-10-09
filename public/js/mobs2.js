// Cats, foxes, goats and polar bears (mixed into GameHost like mob-ai.js).

import { BLOCK, ITEM } from './blocks.js';
import { collides } from './physics.js';

export const CAT_FOOD = [ITEM.RAW_COD, ITEM.RAW_SALMON];
const FOX_PREY = ['chicken', 'rabbit'];

export const mobs2 = {
  // Stray cats are shy; feed one raw fish and it may trust you (one in three), then it follows
  // you, sits when clicked, and scares creepers away.
  feedCat(p, e, item) {
    if (!CAT_FOOD.includes(item)) return false;
    if (!e.tamed) {
      if (this.random() < 1 / 3) {
        Object.assign(e, { tamed: true, owner: p.name, sitting: true, persist: true });
        this.broadcastHere({ t: 'sfx', s: 'love', x: e.x, y: e.y, z: e.z });
      } else this.broadcastHere({ t: 'sfx', s: 'smoke', x: e.x, y: e.y, z: e.z });
      return true;
    }
    return false; // (tame cats breed: see onInteract)
  },

  catMind(e, t, dt) {
    if (e.tamed) {
      const owner = [...this.players.values()].find((q) => q.name === e.owner && q.dim === e.dim);
      if (e.sitting) return 0;
      if (owner) return this.followOwner(e, owner, t);
    }
    const love = this.animalMind(e, t, dt);
    if (love !== null) return love;
    // wild cats keep away from people who aren't sneaking up on them
    if (!e.tamed) {
      const near = this.nearestPlayer(e, 6, true);
      if (near && !near[0].sneaking) { e.yaw = Math.atan2(near[0].x - e.x, near[0].z - e.z); return t.speed * 1.3; }
    }
    return null;
  },

  // Follow a player like a pet: catch up when far, teleport when very far.
  followOwner(e, owner, t) {
    const d = Math.hypot(owner.x - e.x, owner.z - e.z);
    if (d > 14) {
      const spot = { ...e, x: owner.x + (this.random() - 0.5) * 2, y: owner.y, z: owner.z + (this.random() - 0.5) * 2 };
      if (!collides(this.world, spot)) { e.x = spot.x; e.y = spot.y; e.z = spot.z; e.vx = e.vy = e.vz = 0; }
      return 0;
    }
    if (d > 3) { e.yaw = Math.atan2(-(owner.x - e.x), -(owner.z - e.z)); return t.speed * (d > 7 ? 1.5 : 1); }
    return 0;
  },

  // Foxes sleep in the day, keep away from people, hunt chickens and rabbits at night and
  // eat sweet berries off bushes.
  foxMind(e, t, dt) {
    const day = this.daylightNow() > 0.5;
    const near = this.nearestPlayer(e, 8, true);
    if (near && !near[0].sneaking) { e.sleeping = false; e.yaw = Math.atan2(near[0].x - e.x, near[0].z - e.z); return t.speed * 1.4; }
    if (day) { e.sleeping = true; return 0; }
    e.sleeping = false;
    if (!e.prey && this.random() < dt / 10) {
      const prey = this.nearestOf(e, FOX_PREY[Math.floor(this.random() * 2)], 16);
      if (prey) e.prey = prey[0].id;
    }
    const prey = e.prey && this.entities.get(e.prey);
    if (prey && prey.dim === e.dim) {
      const d = Math.hypot(prey.x - e.x, prey.z - e.z);
      e.yaw = Math.atan2(-(prey.x - e.x), -(prey.z - e.z));
      if (d < 1.2 && e.attackCooldown === 0) { e.attackCooldown = 1; this.hurtMob(prey, 2, prey.x - e.x, prey.z - e.z, null); }
      return d > 1 ? t.speed * 1.3 : 0;
    }
    e.prey = null;
    // nibble berries from a bush underfoot
    const bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    const id = this.world.getBlock(bx, by, bz);
    if (id >= BLOCK.SWEET_BERRY_BUSH + 2 && id <= BLOCK.SWEET_BERRY_BUSH + 3) this.setBlock(bx, by, bz, BLOCK.SWEET_BERRY_BUSH + 1);
    return null;
  },

  // Goats leap about mountains, and now and then charge at someone and ram them.
  goatMind(e, t, dt) {
    if (e.onGround && this.random() < dt / 4) e.vy = 9; // big jumps
    e.ramTimer = (e.ramTimer ?? 20 + this.random() * 40) - dt;
    const near = this.nearestPlayer(e, 12, true);
    if (near && e.ramTimer <= 0) {
      const [p, d] = near;
      e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z));
      if (d < 1.4) {
        e.ramTimer = 30 + this.random() * 60;
        this.send(p.peerId, { t: 'hurt', amount: 2, from: [e.x, e.z], cause: 'was rammed by a Goat', knock: 3 });
        return 0;
      }
      return t.speed * 2.2;
    }
    return null;
  },

  // Polar bears are calm unless hurt, or when someone comes near their cub.
  polarBearMind(e, t, dt) {
    let target = e.angryAt ? [...this.here()].find((q) => q.name === e.angryAt && !q.dead && q.mode === 'survival') : null;
    if (!target && !(e.baby > 0)) {
      const cub = [...this.entities.values()].find((o) => o.type === 'polar_bear' && o.baby > 0 && o.dim === e.dim && Math.hypot(o.x - e.x, o.z - e.z) < 12);
      if (cub) { const near = this.nearestPlayer(cub, 6, true); if (near) target = near[0]; }
    }
    if (!target) { e.angryAt = null; return this.animalMind(e, t, dt); }
    const d = Math.hypot(target.x - e.x, target.z - e.z);
    if (d > 24) { e.angryAt = null; return null; }
    e.yaw = Math.atan2(-(target.x - e.x), -(target.z - e.z));
    if (d < 1.8 && Math.abs(target.y - e.y) < 2 && e.attackCooldown === 0) {
      e.attackCooldown = 1.2;
      this.send(target.peerId, { t: 'hurt', amount: 6, from: [e.x, e.z], cause: 'was slain by a Polar Bear', by: e.id });
    }
    return d > 1.5 ? t.speed * 1.6 : 0;
  },
};
