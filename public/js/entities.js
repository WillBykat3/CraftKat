// Visuals for other players, mobs and dropped items. Positions arrive from the
// host ~10 times a second and are smoothed here.

import * as THREE from 'three';
import { BLOCKS, isBlockId, armorOf } from './blocks.js';
import { blockGeometry, hasBlockModel } from './textures.js';

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
  return { group: g, head, body, legL, legR, armL, armR, legs: [legL, legR], arms: armsForward ? [] : [armL, armR], armsForward };
}

const ARMOR_COLORS = { leather: 0x96643a, iron: 0xd8d8d8, gold: 0xf5cd3c, diamond: 0x5ae1d7 };

// Puts armor pieces (item ids, 0 = none) on a humanoid model as slightly bigger boxes.
function dressModel(model, ids) {
  for (const part of model.armorParts || []) { part.parent?.remove(part); part.geometry.dispose(); part.material.dispose(); }
  model.armorParts = [];
  const add = (parent, w, h, d, color, x, y, z) => {
    const m = box(w, h, d, color);
    m.position.set(x, y, z);
    parent.add(m);
    model.armorParts.push(m);
  };
  ids.forEach((id, slot) => {
    const a = armorOf(id);
    if (!a) return;
    const c = ARMOR_COLORS[a.material];
    if (slot === 0) add(model.head, 0.58, 0.58, 0.58, c, 0, 0.25, 0);
    if (slot === 1) {
      add(model.group, 0.56, 0.8, 0.31, c, 0, 1.125, 0);
      add(model.armL, 0.31, 0.4, 0.31, c, 0, -0.18, 0);
      add(model.armR, 0.31, 0.4, 0.31, c, 0, -0.18, 0);
    }
    if (slot === 2) {
      add(model.group, 0.54, 0.2, 0.29, c, 0, 0.7, 0);
      add(model.legL, 0.29, 0.5, 0.29, c, 0, -0.25, 0);
      add(model.legR, 0.29, 0.5, 0.29, c, 0, -0.25, 0);
    }
    if (slot === 3) {
      add(model.legL, 0.3, 0.28, 0.3, c, 0, -0.62, 0);
      add(model.legR, 0.3, 0.28, 0.3, c, 0, -0.62, 0);
    }
  });
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
  sheep: () => {
    const m = quadruped(0xe6c3b0, 0xe6c3b0, [0.5, 0.45, 0.85, 0.5], {
      legColor: 0xe6c3b0,
      decorate: (head) => { const face = box(0.36, 0.3, 0.04, 0xd8b3a0); face.position.set(0, -0.05, -0.44); head.add(face); },
    });
    // the fleece is a separate, bigger box so shearing can hide it
    m.wool = box(0.72, 0.62, 1.0, 0xf2f2f2);
    m.wool.position.y = 0.5 + 0.22;
    const headWool = box(0.54, 0.3, 0.46, 0xf2f2f2);
    headWool.position.set(0, 0.17, -0.2);
    m.head.add(headWool);
    m.headWool = headWool;
    m.group.add(m.wool);
    return m;
  },
  chicken: () => {
    const g = new THREE.Group();
    const body = box(0.38, 0.38, 0.5, 0xf4f4f4);
    body.position.y = 0.45;
    const legs = [limb(0.06, 0.26, 0.06, 0xe0a020, -0.08, 0.26, 0), limb(0.06, 0.26, 0.06, 0xe0a020, 0.08, 0.26, 0)];
    for (const wx of [-0.22, 0.22]) { const w = box(0.06, 0.24, 0.36, 0xe8e8e8); w.position.set(wx, 0.47, 0); g.add(w); }
    const head = new THREE.Group();
    head.position.set(0, 0.7, -0.25);
    const skull = box(0.25, 0.3, 0.2, 0xf4f4f4);
    head.add(skull);
    const beak = box(0.2, 0.08, 0.12, 0xe8a020); beak.position.set(0, 0.02, -0.15); head.add(beak);
    const wattle = box(0.08, 0.1, 0.06, 0xd02020); wattle.position.set(0, -0.08, -0.12); head.add(wattle);
    eyes(head, 0.06, -0.105, 0x111111);
    g.add(body, ...legs, head);
    return { group: g, head, legs, arms: [] };
  },
  creeper: () => {
    const g = new THREE.Group();
    const green = 0x4fa83a;
    const legs = [];
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const l = limb(0.24, 0.36, 0.24, green, lx * 0.12, 0.36, lz * 0.16);
      legs.push(l);
      g.add(l);
    }
    const body = box(0.5, 0.8, 0.28, green);
    body.position.y = 0.76;
    const head = new THREE.Group();
    head.position.y = 1.16;
    const skull = box(0.5, 0.5, 0.5, green);
    skull.position.y = 0.25;
    head.add(skull);
    for (const [fx, fy, w, h] of [[-0.12, 0.33, 0.12, 0.12], [0.12, 0.33, 0.12, 0.12], [0, 0.2, 0.12, 0.14], [-0.08, 0.1, 0.06, 0.12], [0.08, 0.1, 0.06, 0.12]]) {
      const f = box(w, h, 0.02, 0x112211);
      f.position.set(fx, fy, -0.26);
      head.add(f);
    }
    g.add(body, head);
    return { group: g, head, legs, arms: [] };
  },
  spider: () => {
    const g = new THREE.Group();
    const dark = 0x2e2620;
    const abdomen = box(0.8, 0.6, 0.9, dark); abdomen.position.set(0, 0.55, 0.45);
    const thorax = box(0.5, 0.45, 0.5, 0x3a312a); thorax.position.set(0, 0.5, -0.15);
    const head = new THREE.Group();
    head.position.set(0, 0.52, -0.5);
    const skull = box(0.5, 0.45, 0.4, dark);
    head.add(skull);
    eyes(head, 0.06, -0.21, 0xe02020);
    const legs = [];
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.22, 0.5, -0.32 + i * 0.16);
        const leg = box(0.9, 0.08, 0.08, 0x2a221c);
        leg.position.x = side * 0.45;
        pivot.add(leg);
        pivot.rotation.z = side * 0.45;
        pivot.rotation.y = (i - 1.5) * 0.35 * side;
        g.add(pivot);
        legs.push(pivot);
      }
    }
    g.add(abdomen, thorax, head);
    return { group: g, head, legs: [], spiderLegs: legs, arms: [] };
  },
  husk: () => humanoid(0xa89766, 0x6e5f3e, 0x4f4430, true),
  stray: () => MOB_BUILDERS.skeleton(0xa6b6b4, 0x5d6f78),
  enderman: () => {
    const g = new THREE.Group();
    const black = 0x141414;
    const legL = limb(0.14, 1.5, 0.14, black, -0.1, 1.5, 0);
    const legR = limb(0.14, 1.5, 0.14, black, 0.1, 1.5, 0);
    const body = box(0.5, 0.75, 0.25, black); body.position.y = 1.87;
    const armL = limb(0.14, 1.5, 0.14, black, -0.32, 2.2, 0);
    const armR = limb(0.14, 1.5, 0.14, black, 0.32, 2.2, 0);
    const head = new THREE.Group();
    head.position.y = 2.25;
    const skull = box(0.5, 0.5, 0.5, 0x1a1a1a); skull.position.y = 0.25; head.add(skull);
    for (const ex of [-0.13, 0.13]) {
      const eye = box(0.16, 0.05, 0.02, 0xe079fa); eye.position.set(ex, 0.22, -0.26); head.add(eye);
      const glow = box(0.06, 0.05, 0.02, 0xcc00fa); glow.position.set(ex + (ex < 0 ? 0.05 : -0.05), 0.22, -0.265); head.add(glow);
    }
    g.add(legL, legR, body, armL, armR, head);
    return { group: g, head, legs: [legL, legR], arms: [armL, armR] };
  },
  skeleton: (boneColor = 0xc8c8c0, clothes = null) => {
    const g = new THREE.Group();
    const bone = boneColor;
    const legL = limb(0.12, 0.75, 0.12, bone, -0.12, 0.75, 0);
    const legR = limb(0.12, 0.75, 0.12, bone, 0.12, 0.75, 0);
    const body = box(0.45, 0.75, 0.2, clothes ?? bone); body.position.y = 1.125;
    const armL = limb(0.12, 0.75, 0.12, bone, -0.3, 1.45, 0);
    const armR = limb(0.12, 0.75, 0.12, bone, 0.3, 1.45, 0);
    armL.rotation.x = armR.rotation.x = Math.PI / 2;
    const bow = box(0.04, 0.6, 0.04, 0x6b4a24); bow.position.set(0.3, 1.45, -0.75); g.add(bow);
    const head = new THREE.Group();
    head.position.y = 1.5;
    const skull = box(0.5, 0.5, 0.5, bone); skull.position.y = 0.25; head.add(skull);
    eyes(head, 0.28, -0.26, 0x222222);
    g.add(legL, legR, body, armL, armR, head);
    return { group: g, head, legs: [legL, legR], arms: [] };
  },
};

// hitboxes for aiming at mobs: [half width, height]
const HITBOX = {
  pig: [0.5, 0.95], cow: [0.5, 1.4], sheep: [0.5, 1.3], chicken: [0.3, 0.75],
  zombie: [0.35, 1.95], skeleton: [0.35, 1.95], creeper: [0.35, 1.7], spider: [0.75, 0.95],
  husk: [0.35, 1.95], stray: [0.35, 1.95], enderman: [0.35, 2.9],
};

function itemMesh(id, textures) {
  if (isBlockId(id) && hasBlockModel(id)) {
    return new THREE.Mesh(blockGeometry(id, 0.25), new THREE.MeshBasicMaterial({ map: textures.atlasSRGB, alphaTest: 0.5 }));
  }
  const map = isBlockId(id) ? textures.tileTexture(BLOCKS[id].tex[0]) : textures.itemTexture(id);
  return new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35),
    new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide }));
}

let orbTexture = null;
function xpOrbTexture() {
  if (orbTexture) return orbTexture;
  const rows = [
    '..oooo..',
    '.oyyyyo.',
    'oywyyyyo',
    'oyyyyggo',
    'oyyyyggo',
    'oyygggyo',
    '.oyyyyo.',
    '..oooo..',
  ];
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const ctx = c.getContext('2d');
  const pal = { o: '#3a5a00', y: '#d8ff60', g: '#9be03a', w: '#ffffff' };
  rows.forEach((row, y) => { for (let x = 0; x < 8; x++) if (pal[row[x]]) { ctx.fillStyle = pal[row[x]]; ctx.fillRect(x, y, 1, 1); } });
  orbTexture = new THREE.CanvasTexture(c);
  orbTexture.magFilter = THREE.NearestFilter;
  orbTexture.minFilter = THREE.NearestFilter;
  orbTexture.generateMipmaps = false;
  orbTexture.colorSpace = THREE.SRGBColorSpace;
  return orbTexture;
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (o.material.map && o.isSprite && o.material.map !== orbTexture) o.material.map.dispose();
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

  setArmor(id, ids) {
    const v = this.players.get(id);
    if (v && Array.isArray(ids)) dressModel(v.model, ids);
  }

  setSelfArmor(ids) {
    this.selfArmor = ids;
    if (this.self) dressModel(this.self.model, ids);
  }

  // The player's own body, seen in third person (F5).
  setSelf(visible, p, name, dt = 0) {
    if (!visible) {
      if (this.self) this.self.model.group.visible = false;
      return;
    }
    if (!this.self) {
      const model = humanoid(0xd8a47f, SHIRTS[0], 0x2c3e7a, false);
      this.scene.add(model.group);
      this.self = { model, walk: 0, last: [p.x, p.z] };
      if (this.selfArmor) dressModel(model, this.selfArmor);
    }
    const v = this.self;
    const g = v.model.group;
    g.visible = true;
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.yaw;
    v.model.head.rotation.x = p.pitch;
    animateLimbs(v, Math.hypot(p.x - v.last[0], p.z - v.last[1]), Math.max(dt, 1e-3));
    v.last = [p.x, p.z];
    const l = this.lightAt(p.x, p.y + 1.6, p.z);
    this.setMaterialTint(g, l, l, l);
  }

  // ----- mobs & items -----
  // list: [[id, typeOrItemId, x, y, z, yaw], ...] = everything near us right now
  syncEntities(list) {
    const seen = new Set();
    for (const [id, kind, x, y, z, yaw, flags = 0] of list) {
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
      v.flags = flags;
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
    if (kind === 'xp') {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: xpOrbTexture(), transparent: true, depthWrite: false }));
      const group = new THREE.Group();
      group.add(sprite);
      return { xp: true, group, sprite, target: new THREE.Vector3(), yaw: 0, tYaw: 0, spin: Math.random() * 6 };
    }
    if (kind === 'arrow') {
      const group = new THREE.Group();
      const shaft = box(0.04, 0.04, 0.5, 0x8a6a40);
      const tip = box(0.07, 0.07, 0.08, 0x9a9a9a); tip.position.z = -0.27;
      group.add(shaft, tip);
      return { arrow: true, group, target: new THREE.Vector3(), yaw: 0, tYaw: 0 };
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
      const [hw, h] = HITBOX[v.mob] || [0.5, 1];
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
      if (v.xp) {
        // orbs glow, pulse between green and yellow, and are bigger for more experience
        v.spin += dt * 4;
        const size = 0.18 + Math.min(0.22, Math.log2((v.flags || 1) + 1) * 0.04);
        v.sprite.scale.set(size, size, 1);
        v.sprite.position.y = 0.15 + Math.sin(v.spin) * 0.04;
        const t = (Math.sin(v.spin * 1.3) + 1) / 2;
        v.sprite.material.color.setRGB(0.6 + 0.4 * t, 1, 0.25 * (1 - t));
        continue;
      }
      if (v.arrow) {
        g.rotation.y = v.tYaw;
        const la = this.lightAt(g.position.x, g.position.y, g.position.z);
        this.setMaterialTint(g, la, la, la);
        continue;
      }
      v.yaw += angleDiff(v.tYaw, v.yaw) * k;
      g.rotation.y = v.yaw;
      const moved = Math.hypot(g.position.x - bx, g.position.z - bz);
      animateLimbs(v, moved, dt);
      if (v.model.spiderLegs) {
        v.model.spiderLegs.forEach((leg, i) => { leg.rotation.x = Math.sin(v.walk * 1.5 + i) * 0.35 * Math.min(1, moved / Math.max(dt, 1e-3) / 2); });
      }
      if (v.model.wool) {
        const sheared = (v.flags & 1) !== 0;
        v.model.wool.visible = !sheared;
        v.model.headWool.visible = !sheared;
      }
      v.hurt = Math.max(0, v.hurt - dt);
      const lm = this.lightAt(g.position.x, g.position.y + 1, g.position.z);
      if (v.hurt > 0) this.setMaterialTint(g, Math.max(lm, 0.3), lm * 0.2, lm * 0.2);
      else if (v.flags & 2 && Math.sin(performance.now() / 60) > 0) this.setMaterialTint(g, 2, 2, 2); // creeper about to blow
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
