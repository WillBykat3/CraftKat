// More mobs' behaviour, added to GameHost (see the end of host.js): breeding and babies,
// tame wolves, slimes and magma cubes, witches, drowned, phantoms, bats, squid,
// rabbits and piglins. Each "mind" sets e.yaw and returns how fast to walk, unless it
// moves the mob itself (slimes, phantoms, bats and squid).

import { BLOCK, BLOCKS, ITEM, fluidOf, armorOf } from './blocks.js';
import { moveBody, collides } from './physics.js';

// what each animal eats (to breed it), like Minecraft
export const BREED_FOOD = {
  cow: [ITEM.WHEAT], sheep: [ITEM.WHEAT], pig: [ITEM.CARROT, ITEM.POTATO], chicken: [ITEM.WHEAT_SEEDS],
  rabbit: [ITEM.CARROT, ITEM.GOLDEN_CARROT, BLOCK.DANDELION],
  wolf: [ITEM.RAW_BEEF, ITEM.STEAK, ITEM.RAW_PORKCHOP, ITEM.COOKED_PORKCHOP, ITEM.RAW_CHICKEN, ITEM.COOKED_CHICKEN, ITEM.RAW_MUTTON, ITEM.COOKED_MUTTON, ITEM.ROTTEN_FLESH],
};
const GROW_UP = 1200;     // seconds for a baby to grow up (20 minutes, like Minecraft)
const BREED_COOLDOWN = 300;
// what piglins give for a gold ingot: [item, min, max, weight]
const BARTER = [
  [ITEM.ENDER_PEARL, 2, 4, 10], [ITEM.STRING, 3, 9, 20], [ITEM.QUARTZ, 5, 12, 20], [BLOCK.OBSIDIAN, 1, 1, 40],
  [ITEM.LEATHER, 2, 4, 40], [BLOCK.SOUL_SAND, 2, 8, 40], [BLOCK.NETHER_BRICKS, 2, 8, 40], [BLOCK.GRAVEL, 8, 16, 40],
  [ITEM.FLINT, 2, 6, 40], [ITEM.GLOWSTONE_DUST, 2, 6, 20], [ITEM.MAGMA_CREAM, 2, 6, 20], [ITEM.GOLD_NUGGET, 4, 12, 20],
];
const GOLD_ARMOR = (armor) => (armor || []).some((s) => s && armorOf(s.id)?.material === 'gold');
export const SLIME_SIZES = [1, 2, 4];

export const mobAI = {
  // ---------- breeding ----------
  // A player feeds an animal its food: an adult goes into love mode, a baby grows faster,
  // a wild wolf may be tamed with bones. Returns true if the food was taken.
  feedAnimal(p, e, item) {
    if (e.type === 'wolf') return this.feedWolf(p, e, item);
    const food = BREED_FOOD[e.type];
    if (!food || !food.includes(item)) return false;
    e.persist = true; // animals people look after don't wander off for good
    if (e.baby > 0) { e.baby = Math.max(0, e.baby - GROW_UP * 0.1); return true; }
    if ((e.breedCooldown || 0) > 0 || e.love > 0) return false;
    e.love = 30;
    e.lovedBy = p.name;
    this.broadcastHere({ t: 'sfx', s: 'love', x: e.x, y: e.y, z: e.z });
    return true;
  },

  // Animals in love find a partner and have a baby; babies grow up; chickens lay eggs.
  animalMind(e, t, dt) {
    if (e.baby > 0) {
      e.baby -= dt;
      if (e.baby <= 0) { e.baby = 0; e.halfW = t.halfW; e.height = t.height; }
    }
    if (e.breedCooldown > 0) e.breedCooldown -= dt;
    if (e.type === 'chicken' && !(e.baby > 0)) {
      e.eggTimer ??= 300 + this.random() * 300;
      e.eggTimer -= dt;
      if (e.eggTimer <= 0) { e.eggTimer = 300 + this.random() * 300; this.spawnItem(e.x, e.y + 0.3, e.z, ITEM.EGG, 1); this.broadcastHere({ t: 'sfx', s: 'pop', x: e.x, y: e.y, z: e.z }); }
    }
    if (!(e.love > 0)) return null;
    e.love -= dt;
    let mate = null, best = 8;
    for (const o of this.entities.values()) {
      if (o === e || o.type !== e.type || o.dim !== e.dim || !(o.love > 0) || o.baby > 0) continue;
      const d = Math.hypot(o.x - e.x, o.z - e.z);
      if (d < best) { best = d; mate = o; }
    }
    if (!mate) return null;
    e.yaw = Math.atan2(-(mate.x - e.x), -(mate.z - e.z));
    if (best < 1.5) {
      e.love = mate.love = 0;
      e.breedCooldown = mate.breedCooldown = BREED_COOLDOWN;
      const baby = this.spawnBaby(e.type, (e.x + mate.x) / 2, e.y, (e.z + mate.z) / 2);
      if (e.type === 'wolf' && e.owner) Object.assign(baby, { owner: e.owner, tamed: true, hp: 20, persist: true });
      this.spawnXP(e.x, e.y + 0.5, e.z, 1 + Math.floor(this.random() * 7));
      return 0;
    }
    return t.speed;
  },

  spawnBaby(type, x, y, z) {
    const b = this.spawnMob(type, x, y, z);
    b.baby = GROW_UP;
    b.halfW /= 2;
    b.height /= 2;
    b.persist = true;
    return b;
  },

  // A thrown egg: one in eight hatches a chick.
  hatchEgg(x, y, z) {
    if (this.random() < 1 / 8) {
      const n = this.random() < 1 / 32 ? 4 : 1;
      for (let i = 0; i < n; i++) this.spawnBaby('chicken', x, y, z);
    }
  },

  // ---------- wolves ----------
  feedWolf(p, e, item) {
    if (!e.tamed) {
      if (item !== ITEM.BONE || e.angry || e.angryAt) return false;
      if (this.random() < 1 / 3) {
        Object.assign(e, { tamed: true, owner: p.name, sitting: true, hp: 20, persist: true, angry: false, angryAt: null });
        this.broadcastHere({ t: 'sfx', s: 'love', x: e.x, y: e.y, z: e.z });
      } else this.broadcastHere({ t: 'sfx', s: 'smoke', x: e.x, y: e.y, z: e.z });
      return true;
    }
    if (e.owner !== p.name) return false;
    if (BREED_FOOD.wolf.includes(item)) {
      if (e.hp < 20) { e.hp = Math.min(20, e.hp + 4); return true; }
      if (!(e.breedCooldown > 0) && !(e.love > 0) && !(e.baby > 0)) { e.love = 30; this.broadcastHere({ t: 'sfx', s: 'love', x: e.x, y: e.y, z: e.z }); return true; }
      return false;
    }
    // anything else: sit / stand up
    e.sitting = !e.sitting;
    return false;
  },

  // Wild wolves wander in packs and turn on whoever hurts one; tame ones follow their
  // owner, sit when told, and fight whatever their owner fights.
  wolfMind(e, t, dt) {
    const owner = e.tamed ? [...this.players.values()].find((q) => q.name === e.owner && q.dim === e.dim) : null;
    let target = e.target ? this.entities.get(e.target) : null;
    if (target && (target.dim !== e.dim || Math.hypot(target.x - e.x, target.z - e.z) > 24)) target = null;
    if (!target) e.target = null;
    if (!e.tamed && e.angryAt) {
      const p = [...this.here()].find((q) => q.name === e.angryAt && !q.dead && q.mode === 'survival');
      if (p) target = p;
    }
    if (target && !e.sitting) {
      const d = Math.hypot(target.x - e.x, target.z - e.z);
      e.yaw = Math.atan2(-(target.x - e.x), -(target.z - e.z));
      if (d < 1.6 && e.attackCooldown === 0) {
        e.attackCooldown = 1;
        if (target.peerId) this.send(target.peerId, { t: 'hurt', amount: 4, from: [e.x, e.z], cause: 'was slain by a Wolf', by: e.id });
        else this.hurtMob(target, 4, target.x - e.x, target.z - e.z, null);
      }
      return d > 1.2 ? t.speed * 1.4 : 0;
    }
    if (owner) {
      if (e.sitting) return 0;
      const d = Math.hypot(owner.x - e.x, owner.z - e.z);
      if (d > 14) { // too far: catch up like Minecraft's wolves do
        const spot = { ...e, x: owner.x + (this.random() - 0.5) * 2, y: owner.y, z: owner.z + (this.random() - 0.5) * 2 };
        if (!collides(this.world, spot)) { e.x = spot.x; e.y = spot.y; e.z = spot.z; e.vx = e.vy = e.vz = 0; }
        return 0;
      }
      if (d > 3) { e.yaw = Math.atan2(-(owner.x - e.x), -(owner.z - e.z)); return t.speed * (d > 7 ? 1.5 : 1); }
      return 0;
    }
    const love = this.animalMind(e, t, dt);
    if (love !== null) return love;
    // wild wolves hunt sheep and rabbits now and then
    if (!e.tamed && this.random() < dt / 40) {
      const prey = this.nearestOf(e, this.random() < 0.5 ? 'sheep' : 'rabbit', 16);
      if (prey) e.target = prey[0].id;
    }
    return null; // wander like other animals
  },

  // Tame wolves of a player go after a mob that player hit, or that hit them.
  wolvesDefend(ownerName, mob) {
    if (!mob || mob.type === 'wolf') return;
    for (const w of this.entities.values()) if (w.type === 'wolf' && w.tamed && w.owner === ownerName && !w.sitting && w.dim === mob.dim) w.target = mob.id;
  },

  // ---------- slimes and magma cubes ----------
  // They hop towards you; big ones split into smaller ones when they die.
  slimeTick(e, t, dt) {
    const magma = e.type === 'magma_cube';
    const target = this.nearestPlayer(e, 16, true);
    e.hopTimer = (e.hopTimer ?? this.random()) - dt;
    if (e.onGround) { e.vx *= 0.6; e.vz *= 0.6; }
    if (e.onGround && e.hopTimer <= 0) {
      e.hopTimer = (target ? 0.6 : 1.5) + this.random() * (target ? 0.6 : 2);
      if (target) e.yaw = Math.atan2(-(target[0].x - e.x), -(target[0].z - e.z));
      else e.yaw += (this.random() - 0.5) * 2;
      const s = (target ? 2.6 : 1.6) * (0.6 + e.size * 0.15);
      e.vx = -Math.sin(e.yaw) * s; e.vz = -Math.cos(e.yaw) * s;
      e.vy = magma ? 7 + e.size : 6;
    }
    if (target && e.size > 1 || (target && magma)) {
      const [p, d] = target;
      if (d < e.halfW + 0.9 && Math.abs(p.y - e.y) < e.height + 0.5 && e.attackCooldown === 0) {
        e.attackCooldown = 1;
        const dmg = magma ? [3, 4, 6][SLIME_SIZES.indexOf(e.size)] : [0, 2, 4][SLIME_SIZES.indexOf(e.size)];
        if (dmg) this.send(p.peerId, { t: 'hurt', amount: dmg, from: [e.x, e.z], cause: magma ? 'was slain by a Magma Cube' : 'was slain by a Slime', by: e.id });
      }
    }
    e.vy = Math.max(-40, e.vy - 28 * dt);
    const res = moveBody(this.world, e, dt, 0);
    e.onGround = res.onGround;
    if (e.y < -20) this.entities.delete(e.id);
  },

  setSlimeSize(e, size) {
    e.size = size;
    e.halfW = 0.26 * size;
    e.height = 0.52 * size;
    e.hp = size * size;
  },

  splitSlime(e) {
    if (e.size <= 1) return;
    const n = 2 + Math.floor(this.random() * 3);
    for (let i = 0; i < n; i++) {
      const s = this.spawnMob(e.type, e.x + (this.random() - 0.5) * e.halfW, e.y + 0.3, e.z + (this.random() - 0.5) * e.halfW);
      this.setSlimeSize(s, e.size / 2);
    }
  },

  // ---------- witches ----------
  // Witches keep their distance and throw harmful potions, and drink healing ones when hurt.
  witchMind(e, t, dt) {
    if (e.hp < 18 && !(e.drinking > 0) && this.random() < dt / 2) { e.drinking = 1.6; }
    if (e.drinking > 0) {
      e.drinking -= dt;
      if (e.drinking <= 0) { e.hp = Math.min(26, e.hp + 4); this.broadcastHere({ t: 'sfx', s: 'drink', x: e.x, y: e.y, z: e.z }); }
      return 0;
    }
    const target = this.nearestPlayer(e, 16, true);
    if (!target) return null;
    const [p, d] = target;
    e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z));
    if (d < 10 && e.attackCooldown === 0 && this.canSee(e.x, e.y + 1.5, e.z, p.x, p.y + 1.5, p.z)) {
      e.attackCooldown = 3;
      const potion = d > 8 ? 'slowness' : p.health >= 8 && this.random() < 0.25 ? 'poison' : d <= 3 && this.random() < 0.25 ? 'weakness' : 'harming';
      const flight = d / 12;
      const yaw = e.yaw, pitch = Math.atan2(p.y - e.y + flight * 8, d);
      this.addEntity({
        id: this.nextEntityId++, type: 'potion', potion, x: e.x - Math.sin(yaw) * 0.6, y: e.y + 1.6, z: e.z - Math.cos(yaw) * 0.6, halfW: 0.12, height: 0.25,
        vx: -Math.sin(yaw) * Math.cos(pitch) * 12, vy: Math.sin(pitch) * 12 + 2, vz: -Math.cos(yaw) * Math.cos(pitch) * 12, yaw, age: 0.2, thrower: null,
      });
    }
    return d > 8 ? t.speed : d < 4 ? -t.speed * 0.7 : 0;
  },

  // ---------- drowned ----------
  // Zombies of the deep: they swim up and down towards you.
  drownedMind(e, t, dt) {
    const target = this.nearestPlayer(e, 24, true);
    const inWater = fluidOf(this.world.getBlock(Math.floor(e.x), Math.floor(e.y + 1), Math.floor(e.z))) === 'water';
    if (!target) { if (inWater) e.vy = Math.max(e.vy - 2 * dt, -0.5); return null; }
    const [p, d] = target;
    e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z));
    if (inWater) e.vy += (Math.sign(p.y - e.y) * 2.5 - e.vy) * Math.min(1, dt * 3);
    if (d < 1.6 && Math.abs(p.y - e.y) < 1.8 && e.attackCooldown === 0) {
      e.attackCooldown = 1;
      this.send(p.peerId, { t: 'hurt', amount: 3, from: [e.x, e.z], cause: 'was slain by a Drowned', by: e.id });
    }
    return d > 1.2 ? t.speed : 0;
  },

  // ---------- phantoms ----------
  // They circle high above players who haven't slept for three nights, then swoop down.
  phantomTick(e, t, dt) {
    const target = this.nearestPlayer(e, 64, true);
    if (this.world.hasSky && this.daylightNow() > 0.6 && this.world.topBlockY(Math.floor(e.x), Math.floor(e.z)) < e.y) e.fireTime = Math.max(e.fireTime || 0, 2);
    e.angle = (e.angle ?? this.random() * 6.28) + dt * 0.9;
    let gx, gy, gz;
    if (target) {
      const [p] = target;
      e.swoopTimer = (e.swoopTimer ?? 5) - dt;
      if (e.swoopTimer <= 0 && !e.swooping) { e.swooping = true; e.swoopTimer = 6 + this.random() * 6; }
      if (e.swooping) {
        gx = p.x; gy = p.y + 1; gz = p.z;
        if (Math.hypot(p.x - e.x, p.y + 1 - e.y, p.z - e.z) < 1.5) {
          if (e.attackCooldown === 0) { e.attackCooldown = 1; this.send(p.peerId, { t: 'hurt', amount: 2, from: [e.x, e.z], cause: 'was slain by a Phantom', by: e.id }); }
          e.swooping = false;
        }
      } else { gx = p.x + Math.cos(e.angle) * 12; gy = p.y + 14; gz = p.z + Math.sin(e.angle) * 12; }
    } else { gx = e.x + Math.cos(e.angle) * 10; gy = e.y; gz = e.z + Math.sin(e.angle) * 10; }
    const dx = gx - e.x, dy = gy - e.y, dz = gz - e.z, len = Math.hypot(dx, dy, dz) || 1;
    const sp = e.swooping ? 10 : t.speed;
    const k = Math.min(1, dt * 2);
    e.vx += (dx / len * sp - e.vx) * k; e.vy += (dy / len * sp - e.vy) * k; e.vz += (dz / len * sp - e.vz) * k;
    e.yaw = Math.atan2(-e.vx, -e.vz);
    const res = moveBody(this.world, e, dt, 0);
    if (res.hitWall) e.swooping = false;
  },

  // ---------- bats and squid ----------
  batTick(e, t, dt) {
    e.think -= dt;
    if (e.think <= 0) { e.think = 0.5 + this.random() * 1.5; e.goal = [e.x + (this.random() - 0.5) * 8, e.y + (this.random() - 0.4) * 4, e.z + (this.random() - 0.5) * 8]; }
    const [gx, gy, gz] = e.goal || [e.x, e.y, e.z];
    const dx = gx - e.x, dy = gy - e.y, dz = gz - e.z, len = Math.hypot(dx, dy, dz) || 1;
    e.vx = dx / len * t.speed; e.vy = dy / len * t.speed; e.vz = dz / len * t.speed;
    e.yaw = Math.atan2(-e.vx, -e.vz);
    const res = moveBody(this.world, e, dt, 0);
    if (res.hitWall) e.think = 0;
  },

  squidTick(e, t, dt) {
    const inWater = fluidOf(this.world.getBlock(Math.floor(e.x), Math.floor(e.y + 0.4), Math.floor(e.z))) === 'water';
    if (!inWater) {
      // out of water: flops about and slowly suffocates
      e.vy = Math.max(-40, e.vy - 28 * dt);
      e.dry = (e.dry || 0) + dt;
      if (e.dry > 1) { e.dry = 0; e.hp -= 1; if (e.hp <= 0) return this.killMob(e); }
    } else {
      e.think -= dt;
      if (e.think <= 0) { e.think = 2 + this.random() * 3; e.goal = [(this.random() - 0.5) * 2, (this.random() - 0.5), (this.random() - 0.5) * 2]; }
      const [gx, gy, gz] = e.goal || [0, 0, 0];
      e.vx += (gx * t.speed - e.vx) * dt; e.vy += (gy * t.speed - e.vy) * dt; e.vz += (gz * t.speed - e.vz) * dt;
      if (e.panic > 0) { e.vx *= 1.05; e.vz *= 1.05; }
    }
    if (Math.hypot(e.vx, e.vz) > 0.1) e.yaw = Math.atan2(-e.vx, -e.vz);
    moveBody(this.world, e, dt, 0);
  },

  // ---------- piglins ----------
  // Piglins attack anyone not wearing gold. Drop a gold ingot near one and it gives you
  // something for it.
  piglinMind(e, t, dt) {
    if (e.admiring > 0) {
      e.admiring -= dt;
      if (e.admiring <= 0) this.barter(e);
      return 0;
    }
    // pick up gold ingots lying nearby
    for (const it of this.entities.values()) {
      if (it.type !== 'item' || it.item !== ITEM.GOLD_INGOT || it.dim !== e.dim || it.age < 0.5) continue;
      if (Math.hypot(it.x - e.x, it.z - e.z) < 1.5 && Math.abs(it.y - e.y) < 2) {
        it.count--;
        if (it.count <= 0) this.entities.delete(it.id);
        e.admiring = 6;
        this.broadcastHere({ t: 'sfx', s: 'piglinAdmire', x: e.x, y: e.y, z: e.z });
        return 0;
      }
    }
    const target = this.nearestPlayer(e, 16, true);
    const p = target && (!GOLD_ARMOR(target[0].armor) || e.angryAt === target[0].name) ? target[0] : null;
    if (!p) return null;
    const d = target[1];
    e.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z));
    if (d < 1.6 && Math.abs(p.y - e.y) < 1.8 && e.attackCooldown === 0) {
      e.attackCooldown = 1;
      this.send(p.peerId, { t: 'hurt', amount: 5, from: [e.x, e.z], cause: 'was slain by a Piglin', by: e.id });
    }
    return d > 1.2 ? t.speed : 0;
  },

  barter(e) {
    let total = 0;
    for (const b of BARTER) total += b[3];
    let r = this.random() * total;
    for (const [id, min, max, w] of BARTER) {
      r -= w;
      if (r > 0) continue;
      const n = min + Math.floor(this.random() * (max - min + 1));
      this.spawnItem(e.x, e.y + 1, e.z, id, n, undefined, [-Math.sin(e.yaw) * 2, 3, -Math.cos(e.yaw) * 2]);
      return;
    }
  },

  daylightNow() {
    const t = ((this.time % 24000) + 24000) % 24000;
    return t < 12000 ? 1 : t < 13800 ? 1 - (t - 12000) / 1800 : t < 22200 ? 0 : (t - 22200) / 1800;
  },
};
