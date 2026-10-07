// Visuals for other players, mobs and dropped items. Positions arrive from the
// host ~10 times a second and are smoothed here.

import * as THREE from 'three';
import { BLOCKS, isBlockId } from './blocks.js';
import { uvOf } from './atlas-layout.js';

const SHIRTS = [0x3b82f6, 0xef4444, 0x22c55e, 0xf59e0b, 0xa855f7, 0x14b8a6, 0xec4899, 0xf97316];
const FACE_SHADE = [0.8, 0.8, 1.0, 0.5, 0.65, 0.65]; // +x -x +y -y +z -z

function box(w, h, d, color, faceColors = null) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const colors = [];
  for (let f = 0; f < 6; f++) {
    const c = new THREE.Color(faceColors?.[f] ?? color);
    for (let v = 0; v < 4; v++) colors.push(c.r * FACE_SHADE[f], c.g * FACE_SHADE[f], c.b * FACE_SHADE[f]);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
}

// A limb that swings from its top end.
function limb(w, h, d, color, x, y, z) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const m = box(w, h, d, color);
  m.position.y = -h / 2;
  pivot.add(m);
  return pivot;
}

function nameTag(name) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = 'bold 32px monospace';
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(name).width) + 24;
  canvas.width = width;
  canvas.height = 48;
  ctx.font = font;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, width, 48);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 12, 25);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(width / 96, 0.5, 1);
  return sprite;
}

function eyes(head, y, z, color = 0x222244) {
  for (const ex of [-0.12, 0.12]) {
    const eye = box(0.08, 0.08, 0.02, color);
    eye.position.set(ex, y, z);
    head.add(eye);
  }
}

function humanoid(skin, shirt, pants, armsForward) {
  const g = new THREE.Group();
  const legL = limb(0.25, 0.75, 0.25, pants, -0.125, 0.75, 0);
  const legR = limb(0.25, 0.75, 0.25, pants, 0.125, 0.75, 0);
  const body = box(0.5, 0.75, 0.25, shirt);
  body.position.y = 1.125;
  const armL = limb(0.25, 0.75, 0.25, armsForward ? skin : shirt, -0.375, 1.5, 0);
  const armR = limb(0.25, 0.75, 0.25, armsForward ? skin : shirt, 0.375, 1.5, 0);
  if (armsForward) { armL.rotation.x = armR.rotation.x = Math.PI / 2; }
  const head = new THREE.Group();
  head.position.y = 1.5;
  const skull = box(0.5, 0.5, 0.5, skin);
  skull.position.y = 0.25;
  head.add(skull);
  eyes(head, 0.28, -0.26);
  g.add(legL, legR, body, armL, armR, head);
  return { group: g, head, legs: [legL, legR], arms: armsForward ? [] : [armL, armR], armsForward };
}

function quadruped(bodyColor, headColor, size, extra) {
  const g = new THREE.Group();
  const [bw, bh, bl, legH] = size;
  const body = box(bw, bh, bl, bodyColor, extra.bodyFaces);
  body.position.y = legH + bh / 2;
  const legs = [];
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const l = limb(0.25, legH, 0.25, extra.legColor ?? bodyColor, lx * (bw / 2 - 0.125), legH, lz * (bl / 2 - 0.15));
    legs.push(l);
    g.add(l);
  }
  const head = new THREE.Group();
  head.position.set(0, legH + bh * 0.75, -bl / 2);
  const skull = box(0.5, 0.5, 0.45, headColor);
  skull.position.set(0, 0, -0.2);
  head.add(skull);
  eyes(head, 0.08, -0.43, 0x111111);
  extra.decorate?.(head);
  g.add(body, head);
  return { group: g, head, legs, arms: [] };
}

const MOB_BUILDERS = {
  pig: () => quadruped(0xf0a5a2, 0xf0a5a2, [0.6, 0.55, 0.9, 0.35], {
    decorate: (head) => { const s = box(0.25, 0.18, 0.06, 0xd98580); s.position.set(0, -0.06, -0.44); head.add(s); },
  }),
  cow: () => quadruped(0x4a3424, 0x4a3424, [0.7, 0.65, 1.1, 0.6], {
    bodyFaces: [0x4a3424, 0xe8e8e8, 0x4a3424, 0xe8e8e8, 0x4a3424, 0x4a3424],
    decorate: (head) => {
      const s = box(0.3, 0.18, 0.06, 0xb8a090); s.position.set(0, -0.12, -0.44); head.add(s);
      for (const hx of [-0.3, 0.3]) { const h = box(0.08, 0.15, 0.08, 0xe0d8c0); h.position.set(hx, 0.25, -0.2); head.add(h); }
    },
  }),
  zombie: () => humanoid(0x5d9b4a, 0x2f8f9b, 0x3a3f9b, true),
};

function itemMesh(id, textures) {
  if (isBlockId(id) && BLOCKS[id].render === 'cube') {
    const geo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const tex = BLOCKS[id].tex;
    // BoxGeometry face order: +x -x +y -y +z -z
    const faceTex = [tex[3], tex[3], tex[0], tex[2], tex[1], tex[1]];
    const uv = geo.attributes.uv;
    for (let f = 0; f < 6; f++) {
      const [u0, v0, u1, v1] = uvOf(faceTex[f]);
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
      }
    }
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: textures.atlasSRGB, alphaTest: 0.5 }));
  }
  const map = isBlockId(id) ? textures.tileTexture(BLOCKS[id].tex[0]) : textures.itemTexture(id);
  return new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35),
    new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide }));
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (o.material.map && o.isSprite) o.material.map.dispose();
      o.material.dispose();
    }
  });
}

export class EntityViews {
  constructor(scene, textures) {
    this.scene = scene;
    this.textures = textures;
    this.players = new Map(); // player id -> view
    this.entities = new Map(); // entity id -> view
    this.lightAt = () => 1; // (x, y, z) -> linear brightness, set by the game
  }

  // ----- players -----
  addPlayer(id, name, p, r) {
    this.removePlayer(id);
    const model = humanoid(0xd8a47f, SHIRTS[id % SHIRTS.length], 0x2c3e7a, false);
    const tag = nameTag(name);
    tag.position.y = 2.3;
    model.group.add(tag);
    model.group.position.set(p[0], p[1], p[2]);
    this.scene.add(model.group);
    this.players.set(id, { name, model, target: new THREE.Vector3(...p), yaw: r[0], pitch: r[1], tYaw: r[0], tPitch: r[1], walk: 0 });
  }

  removePlayer(id) {
    const v = this.players.get(id);
    if (!v) return;
    this.scene.remove(v.model.group);
    disposeTree(v.model.group);
    this.players.delete(id);
  }

  movePlayer(id, p, r) {
    const v = this.players.get(id);
    if (!v) return;
    v.target.set(p[0], p[1], p[2]);
    v.tYaw = r[0];
    v.tPitch = r[1];
  }

  // ----- mobs & items -----
  // list: [[id, typeOrItemId, x, y, z, yaw], ...] = everything near us right now
  syncEntities(list) {
    const seen = new Set();
    for (const [id, kind, x, y, z, yaw] of list) {
      seen.add(id);
      let v = this.entities.get(id);
      if (!v) {
        v = this.createEntity(kind);
        v.group.position.set(x, y, z);
        v.yaw = yaw;
        this.scene.add(v.group);
        this.entities.set(id, v);
      }
      v.target.set(x, y, z);
      v.tYaw = yaw;
    }
    for (const id of [...this.entities.keys()]) if (!seen.has(id)) this.removeEntity(id);
  }

  createEntity(kind) {
    if (typeof kind === 'number') {
      const group = new THREE.Group();
      const mesh = itemMesh(kind, this.textures);
      group.add(mesh);
      return { item: kind, group, mesh, target: new THREE.Vector3(), yaw: 0, tYaw: 0, spin: Math.random() * 6 };
    }
    const build = MOB_BUILDERS[kind] || MOB_BUILDERS.pig;
    const model = build();
    return { mob: kind, group: model.group, model, target: new THREE.Vector3(), yaw: 0, tYaw: 0, walk: 0, hurt: 0 };
  }

  removeEntity(id) {
    const v = this.entities.get(id);
    if (!v) return;
    this.scene.remove(v.group);
    disposeTree(v.group);
    this.entities.delete(id);
  }

  hurt(id) {
    const v = this.entities.get(id);
    if (v) v.hurt = 0.35;
  }

  // Ray test against mobs: returns {id, dist} of the closest one hit, or null.
  raycastMobs(origin, dir, maxDist) {
    let best = null;
    for (const [id, v] of this.entities) {
      if (!v.mob) continue;
      const p = v.group.position;
      const hw = v.mob === 'zombie' ? 0.35 : 0.5;
      const h = v.mob === 'zombie' ? 1.95 : v.mob === 'cow' ? 1.4 : 0.95;
      const t = rayBox(origin, dir, p.x - hw, p.y, p.z - hw, p.x + hw, p.y + h, p.z + hw);
      if (t !== null && t <= maxDist && (!best || t < best.dist)) best = { id, dist: t };
    }
    return best;
  }

  setMaterialTint(group, r, g, b) {
    group.traverse((o) => {
      if (o.material && !o.isSprite) o.material.color.setRGB(r, g, b);
    });
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 12);
    for (const v of this.players.values()) {
      const g = v.model.group;
      const bx = g.position.x, bz = g.position.z;
      g.position.lerp(v.target, k);
      v.yaw += angleDiff(v.tYaw, v.yaw) * k;
      v.pitch += (v.tPitch - v.pitch) * k;
      g.rotation.y = v.yaw;
      v.model.head.rotation.x = v.pitch;
      animateLimbs(v, Math.hypot(g.position.x - bx, g.position.z - bz), dt);
      const lp = this.lightAt(g.position.x, g.position.y + 1.6, g.position.z);
      this.setMaterialTint(g, lp, lp, lp);
    }
    for (const v of this.entities.values()) {
      const g = v.group;
      const bx = g.position.x, bz = g.position.z;
      g.position.lerp(v.target, k);
      if (v.item !== undefined) {
        v.spin += dt * 1.5;
        v.mesh.rotation.y = v.spin;
        v.mesh.position.y = 0.2 + Math.sin(v.spin * 1.3) * 0.06;
        const li = this.lightAt(g.position.x, g.position.y + 0.3, g.position.z);
        this.setMaterialTint(g, li, li, li);
        continue;
      }
      v.yaw += angleDiff(v.tYaw, v.yaw) * k;
      g.rotation.y = v.yaw;
      animateLimbs(v, Math.hypot(g.position.x - bx, g.position.z - bz), dt);
      v.hurt = Math.max(0, v.hurt - dt);
      const lm = this.lightAt(g.position.x, g.position.y + 1, g.position.z);
      if (v.hurt > 0) this.setMaterialTint(g, Math.max(lm, 0.3), lm * 0.2, lm * 0.2);
      else this.setMaterialTint(g, lm, lm, lm);
    }
  }

  clear() {
    for (const id of [...this.players.keys()]) this.removePlayer(id);
    for (const id of [...this.entities.keys()]) this.removeEntity(id);
  }
}

function animateLimbs(v, moved, dt) {
  const speed = moved / Math.max(dt, 1e-3);
  v.walk += moved * 3.2;
  const swing = Math.min(1, speed / 3) * Math.sin(v.walk) * 0.7;
  const legs = v.model.legs;
  if (legs.length === 2) {
    legs[0].rotation.x = swing;
    legs[1].rotation.x = -swing;
  } else if (legs.length === 4) {
    legs[0].rotation.x = legs[3].rotation.x = swing;
    legs[1].rotation.x = legs[2].rotation.x = -swing;
  }
  if (v.model.arms.length === 2) {
    v.model.arms[0].rotation.x = -swing;
    v.model.arms[1].rotation.x = swing;
  }
}

function angleDiff(a, b) {
  const d = a - b;
  return Math.atan2(Math.sin(d), Math.cos(d));
}

// Slab test: distance along the ray to the box, or null.
function rayBox(o, d, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = Infinity;
  for (const [oa, da, a0, a1] of [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]]) {
    if (Math.abs(da) < 1e-9) {
      if (oa < a0 || oa > a1) return null;
    } else {
      let t0 = (a0 - oa) / da, t1 = (a1 - oa) / da;
      if (t0 > t1) [t0, t1] = [t1, t0];
      tmin = Math.max(tmin, t0);
      tmax = Math.min(tmax, t1);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}
