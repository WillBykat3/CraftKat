// Visuals for other players, mobs and dropped items. Positions arrive from the
// host ~10 times a second and are smoothed here.

import { DYE_RGB } from './colors.js';
import * as THREE from 'three';
import { BLOCKS, isBlockId, armorOf, ITEM } from './blocks.js';

const EYE_OF_ENDER = ITEM.EYE_OF_ENDER;
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

// Changes the colour of a box made by box().
function recolor(mesh, color) {
  const c = new THREE.Color(color);
  const attr = mesh.geometry.getAttribute('color');
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) attr.setXYZ(f * 4 + v, c.r * FACE_SHADE[f], c.g * FACE_SHADE[f], c.b * FACE_SHADE[f]);
  attr.needsUpdate = true;
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

// villager profession (index in trades.js PROFESSIONS) -> [robe colour, hat colour or null]
const PROFESSION_LOOK = [
  [0x6b4a33, null], [0x4f7a3a, null], [0x8a6a3a, 0xd8c060], [0xe8e0d0, 0x8a2020], [0x3a3a40, 0x505058], [0xe8e8e8, 0x8a2020],
  [0x2a2a2a, null], [0x2a2a2a, 0x202020], [0x6b4a33, 0x6a9a3a], [0xe8e8e8, 0x8a6a3a], [0x3a5a8a, null], [0x5a4a40, null],
  [0x8a5a30, 0x5a3a20], [0x2a4a6a, 0xd8c060], [0x6a2a8a, 0xd8c060],
];

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
  // the Nether
  zombified_piglin: () => {
    const m = humanoid(0xe9a3a0, 0x6d8a3e, 0x4f3a2a, false);
    // a rotting pig face: wider head, snout, an exposed green patch, tusks and a golden sword
    const snout = box(0.25, 0.15, 0.08, 0xd98a85); snout.position.set(0, 0.16, -0.29); m.head.add(snout);
    const rot = box(0.22, 0.32, 0.04, 0x6aa04a); rot.position.set(0.15, 0.3, -0.27); m.head.add(rot);
    for (const ex of [-0.28, 0.28]) { const ear = box(0.06, 0.2, 0.14, 0xe9a3a0); ear.position.set(ex, 0.28, -0.05); m.head.add(ear); }
    for (const tx of [-0.1, 0.1]) { const tusk = box(0.04, 0.08, 0.04, 0xf0e6c8); tusk.position.set(tx, 0.08, -0.3); m.head.add(tusk); }
    const sword = box(0.05, 0.7, 0.05, 0xf5cd3c); sword.position.set(0, -0.75, -0.25); sword.rotation.x = Math.PI / 2; m.armR.add(sword);
    return m;
  },
  ghast: () => {
    const g = new THREE.Group();
    const body = box(4, 4, 4, 0xf0f0f0); body.position.y = 2.2;
    const head = new THREE.Group();
    head.position.y = 2.2;
    // closed eyes and mouth; the open ones show while it's about to shoot
    const shut = new THREE.Group();
    for (const ex of [-0.9, 0.9]) { const e = box(0.6, 0.1, 0.05, 0x888888); e.position.set(ex, 0.6, -2.02); shut.add(e); }
    const mouthShut = box(0.6, 0.1, 0.05, 0x888888); mouthShut.position.set(0, -0.5, -2.02); shut.add(mouthShut);
    const open = new THREE.Group();
    for (const ex of [-0.9, 0.9]) { const e = box(0.6, 0.5, 0.05, 0x222222); e.position.set(ex, 0.6, -2.02); open.add(e); const t = box(0.2, 0.3, 0.06, 0xb02020); t.position.set(ex, 0.3, -2.03); open.add(t); }
    const mouth = box(0.8, 0.6, 0.05, 0x222222); mouth.position.set(0, -0.6, -2.02); open.add(mouth);
    open.visible = false;
    head.add(shut, open);
    const legs = [];
    for (let i = 0; i < 9; i++) {
      const l = limb(0.3, 1.2 + ((i * 7) % 5) * 0.25, 0.3, 0xe6e6e6, ((i % 3) - 1) * 1.2, 0.25, (Math.floor(i / 3) - 1) * 1.2);
      legs.push(l);
      g.add(l);
    }
    g.add(body, head);
    return { group: g, head, legs: [], tentacles: legs, arms: [], faces: { shut, open } };
  },
  blaze: () => {
    const g = new THREE.Group();
    const head = new THREE.Group();
    head.position.y = 1.4;
    const skull = box(0.5, 0.5, 0.5, 0xf6c33b, [0xf6c33b, 0xf6c33b, 0xffdc5a, 0xd9a020, 0xf6c33b, 0xf6c33b]); skull.position.y = 0.25; head.add(skull);
    eyes(head, 0.28, -0.26, 0x3a1a00);
    // rings of glowing rods spinning around a smoky core
    const rods = new THREE.Group();
    for (let ring = 0; ring < 3; ring++) {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + ring * 0.6;
        const r = box(0.12, 0.45, 0.12, 0xe8a020);
        r.position.set(Math.cos(a) * (0.55 - ring * 0.1), 1.1 - ring * 0.42, Math.sin(a) * (0.55 - ring * 0.1));
        r.userData.ring = ring;
        rods.add(r);
      }
    }
    const smoke = box(0.2, 0.9, 0.2, 0x5a4a40); smoke.position.y = 0.75;
    g.add(head, rods, smoke);
    return { group: g, head, legs: [], arms: [], rods };
  },
  wither_skeleton: () => {
    const m = MOB_BUILDERS.skeleton(0x2a2a2a, 0x202020);
    m.group.scale.setScalar(1.2);
    // a stone sword instead of a bow
    m.group.children.filter((c) => c.geometry?.parameters?.height === 0.6).forEach((bow) => { bow.visible = false; });
    const sword = box(0.05, 0.75, 0.05, 0x8a8a8a); sword.position.set(0.3, 1.45, -0.85); sword.rotation.x = Math.PI / 2.4; m.group.add(sword);
    return m;
  },
  // villages
  villager: () => {
    const g = new THREE.Group();
    const skin = 0xbd8b72, robe = 0x6b4a33;
    const legL = limb(0.24, 0.75, 0.24, 0x4a3324, -0.12, 0.75, 0);
    const legR = limb(0.24, 0.75, 0.24, 0x4a3324, 0.12, 0.75, 0);
    const body = box(0.5, 0.95, 0.3, robe); body.position.y = 1.05;
    // arms folded across the chest
    const arms = box(0.62, 0.22, 0.24, robe); arms.position.set(0, 1.25, -0.22);
    const hands = box(0.26, 0.2, 0.2, skin); hands.position.set(0, 1.25, -0.26);
    const head = new THREE.Group();
    head.position.y = 1.52;
    const skull = box(0.5, 0.6, 0.5, skin); skull.position.y = 0.3; head.add(skull);
    const nose = box(0.12, 0.22, 0.12, 0xa8735c); nose.position.set(0, 0.2, -0.31); head.add(nose);
    const brow = box(0.4, 0.06, 0.02, 0x3a2a20); brow.position.set(0, 0.44, -0.26); head.add(brow);
    eyes(head, 0.36, -0.26, 0x2a7a2a);
    const hat = box(0.56, 0.1, 0.56, 0x000000); hat.position.y = 0.62; hat.visible = false; head.add(hat);
    g.add(legL, legR, body, arms, hands, head);
    return { group: g, head, legs: [legL, legR], arms: [], robe: body, hat, foldedArms: arms };
  },
  iron_golem: () => {
    const g = new THREE.Group();
    const iron = 0xd8d0c8;
    const legL = limb(0.4, 1.0, 0.4, iron, -0.3, 1.0, 0);
    const legR = limb(0.4, 1.0, 0.4, iron, 0.3, 1.0, 0);
    const body = box(1.3, 0.85, 0.75, iron); body.position.y = 1.55;
    const hips = box(0.85, 0.35, 0.5, iron); hips.position.y = 1.0;
    const vines = box(1.32, 0.4, 0.77, 0x5a8a2a); vines.position.y = 1.4; vines.scale.set(1, 1, 1);
    const armL = limb(0.4, 1.5, 0.4, iron, -0.85, 2.0, 0);
    const armR = limb(0.4, 1.5, 0.4, iron, 0.85, 2.0, 0);
    const head = new THREE.Group();
    head.position.y = 2.0;
    const skull = box(0.5, 0.6, 0.5, iron); skull.position.set(0, 0.3, -0.15); head.add(skull);
    const nose = box(0.12, 0.25, 0.12, iron); nose.position.set(0, 0.2, -0.45); head.add(nose);
    const brow = box(0.5, 0.08, 0.04, 0xa8a098); brow.position.set(0, 0.45, -0.41); head.add(brow);
    eyes(head, 0.35, -0.41, 0x8a1010);
    g.add(legL, legR, body, hips, vines, armL, armR, head);
    return { group: g, head, legs: [legL, legR], arms: [armL, armR] };
  },
  // the End
  ender_dragon: () => {
    const g = new THREE.Group();
    const black = 0x1b1b1b, dark = 0x2a2a2a;
    const body = box(3, 2.4, 6, black); body.position.y = 1.8;
    g.add(body);
    for (let i = 0; i < 4; i++) { const sp = box(0.3, 0.6, 0.6, 0x3a3a3a); sp.position.set(0, 3.2, -2 + i * 1.4); g.add(sp); }
    // neck and head, reaching forwards (-z)
    const neck = [];
    for (let i = 0; i < 3; i++) { const n = box(1.2, 1.2, 1.5, black); n.position.set(0, 2.3 + i * 0.15, -3.75 - i * 1.5); g.add(n); neck.push(n); }
    const head = new THREE.Group();
    head.position.set(0, 2.7, -8.4);
    const skull = box(2, 1.4, 2.4, black); head.add(skull);
    const snout = box(1.4, 0.7, 1.8, dark); snout.position.set(0, -0.2, -2); head.add(snout);
    const jaw = box(1.3, 0.35, 1.8, dark); jaw.position.set(0, -0.75, -1.9); head.add(jaw);
    for (const ex of [-0.75, 0.75]) {
      const eye = box(0.1, 0.25, 0.6, 0xe070ff); eye.position.set(ex * 1.35, 0.25, -0.6); head.add(eye);
      const horn = box(0.25, 0.25, 0.9, 0x555555); horn.position.set(ex * 0.8, 0.85, 0.6); horn.rotation.x = 0.5; head.add(horn);
    }
    g.add(head);
    // a long tail with little spikes
    const tail = [];
    for (let i = 0; i < 8; i++) {
      const tl = box(1, 1, 1.4, black); tl.position.set(0, 1.8 - i * 0.08, 3.7 + i * 1.4); g.add(tl); tail.push(tl);
      const sp = box(0.2, 0.4, 0.4, 0x3a3a3a); sp.position.set(0, 2.4 - i * 0.08, 3.7 + i * 1.4); g.add(sp); tail.push(sp);
    }
    // huge wings that flap
    const wings = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 1.5, 2.8, -1);
      const bone = box(8, 0.35, 0.35, black); bone.position.set(side * 4, 0, -1.8); pivot.add(bone);
      const skin = box(8, 0.12, 4.6, 0x353535); skin.position.set(side * 4, 0, 0.5); pivot.add(skin);
      pivot.userData.side = side;
      g.add(pivot);
      wings.push(pivot);
    }
    const legs = [];
    for (const [lx, lz] of [[-1, -1.8], [1, -1.8], [-1, 2], [1, 2]]) { const l = limb(0.6, 1.4, 0.6, black, lx * 1.1, 1.1, lz); g.add(l); legs.push(l); }
    return { group: g, head, legs: [], arms: [], wings, tail };
  },
  end_crystal: () => {
    const g = new THREE.Group();
    const base = box(1.6, 0.3, 1.6, 0x3a3a3a); base.position.y = 0.15;
    const spin = new THREE.Group();
    spin.position.y = 1.3;
    const core = box(0.55, 0.55, 0.55, 0xff7ae6);
    const glass = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.1, 1.1, 1.1)), new THREE.LineBasicMaterial({ color: 0xffffff }));
    const glass2 = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.85, 0.85, 0.85)), new THREE.LineBasicMaterial({ color: 0xe0c8ff }));
    spin.add(core, glass, glass2);
    // the healing beam to the dragon (shown while it's in use)
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1), new THREE.MeshBasicMaterial({ color: 0xf0b0ff, transparent: true, opacity: 0.8 }));
    beam.visible = false;
    g.add(base, spin, beam);
    return { group: g, head: new THREE.Group(), legs: [], arms: [], spin, glass2, beam };
  },
  // more mobs
  wolf: () => {
    const m = quadruped(0xd6d2cc, 0xd6d2cc, [0.38, 0.38, 0.85, 0.42], {
      decorate: (head) => {
        const snout = box(0.2, 0.18, 0.2, 0xc8c2ba); snout.position.set(0, -0.08, -0.5); head.add(snout);
        const nose = box(0.08, 0.06, 0.04, 0x222222); nose.position.set(0, -0.02, -0.61); head.add(nose);
        for (const ex of [-0.15, 0.15]) { const ear = box(0.1, 0.14, 0.06, 0xd6d2cc); ear.position.set(ex, 0.3, -0.2); head.add(ear); }
      },
    });
    m.head.scale.setScalar(0.8);
    const tail = box(0.12, 0.12, 0.45, 0xd6d2cc); tail.position.set(0, 0.72, 0.58); tail.rotation.x = 0.6; m.group.add(tail);
    // a red collar shows once it's tamed
    m.collar = box(0.42, 0.1, 0.12, 0xc02020); m.collar.position.set(0, 0.72, -0.38); m.collar.visible = false; m.group.add(m.collar);
    m.body = m.group.children.find((c) => c.geometry?.parameters?.depth === 0.85);
    m.tail = tail;
    m.wolf = true;
    return m;
  },
  slime: (color = 0x6fc35a, core = 0x4f9a3a, magma = false) => {
    // a cube 0.52 blocks wide at size 1; the view scales it up for bigger slimes
    const g = new THREE.Group();
    const outer = box(0.52, 0.52, 0.52, color);
    outer.position.y = 0.26;
    if (!magma) { outer.material.transparent = true; outer.material.opacity = 0.7; outer.material.depthWrite = false; }
    const inner = box(0.3, 0.3, 0.3, core); inner.position.y = 0.2;
    const head = new THREE.Group(); head.position.y = 0.3;
    for (const ex of [-0.12, 0.12]) { const e = box(0.08, 0.08, 0.02, magma ? 0xffb020 : 0x1a3a1a); e.position.set(ex, 0.04, -0.27); head.add(e); }
    const mouth = box(0.06, 0.04, 0.02, magma ? 0xffb020 : 0x1a3a1a); mouth.position.set(0.04, -0.1, -0.27); head.add(mouth);
    if (magma) for (let i = 0; i < 3; i++) { const band = box(0.53, 0.04, 0.53, 0xff7a10); band.position.y = 0.12 + i * 0.14; g.add(band); }
    g.add(outer, inner, head);
    return { group: g, head, legs: [], arms: [], slime: true, outer };
  },
  magma_cube: () => MOB_BUILDERS.slime(0x4a1a10, 0xff8a20, true),
  witch: () => {
    const m = MOB_BUILDERS.villager();
    recolor(m.robe, 0x3a2a5a);
    recolor(m.foldedArms, 0x3a2a5a);
    // a tall, bent black hat, a green wart on the nose
    const brim = box(0.7, 0.06, 0.7, 0x2a2a2a); brim.position.y = 0.63; m.head.add(brim);
    const crown = box(0.42, 0.25, 0.42, 0x2a2a2a); crown.position.y = 0.78; m.head.add(crown);
    const tip = box(0.24, 0.22, 0.24, 0x2a2a2a); tip.position.set(0, 0.98, 0.06); tip.rotation.x = 0.3; m.head.add(tip);
    const wart = box(0.04, 0.04, 0.04, 0x4a8a2a); wart.position.set(0.05, 0.14, -0.38); m.head.add(wart);
    delete m.robe; // (not a villager: no profession colours)
    return m;
  },
  drowned: () => {
    const m = humanoid(0x5aa596, 0x4a8a7a, 0x3a5a7a, true);
    const weed = box(0.2, 0.3, 0.02, 0x3a7a2a); weed.position.set(-0.15, 0.2, -0.27); m.head.add(weed);
    return m;
  },
  phantom: () => {
    const g = new THREE.Group();
    const body = box(0.5, 0.2, 0.9, 0x43507a); body.position.y = 0.25;
    const head = new THREE.Group(); head.position.set(0, 0.28, -0.5);
    const skull = box(0.45, 0.2, 0.3, 0x43507a); head.add(skull);
    for (const ex of [-0.12, 0.12]) { const e = box(0.1, 0.06, 0.02, 0x6aff5a); e.position.set(ex, 0.02, -0.16); head.add(e); }
    const tail = box(0.25, 0.08, 0.6, 0x3a456a); tail.position.set(0, 0.25, 0.7);
    const flap = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(side * 0.25, 0.3, 0); pivot.userData.side = side;
      const wing = box(0.9, 0.04, 0.6, 0x5a6a9a); wing.position.x = side * 0.45; pivot.add(wing);
      flap.push(pivot); g.add(pivot);
    }
    g.add(body, head, tail);
    return { group: g, head, legs: [], arms: [], flap, flapSpeed: 6 };
  },
  rabbit: () => {
    const m = quadruped(0x9a7a5a, 0x9a7a5a, [0.32, 0.3, 0.45, 0.14], {
      decorate: (head) => {
        for (const ex of [-0.08, 0.08]) { const ear = box(0.08, 0.3, 0.04, 0x9a7a5a); ear.position.set(ex, 0.35, -0.12); head.add(ear); }
      },
    });
    m.head.scale.setScalar(0.55);
    m.head.position.y = 0.42;
    const tail = box(0.12, 0.12, 0.08, 0xf0f0f0); tail.position.set(0, 0.34, 0.26); m.group.add(tail);
    return m;
  },
  squid: () => {
    const g = new THREE.Group();
    const body = box(0.6, 0.75, 0.6, 0x2a3a6a); body.position.y = 0.85;
    const head = new THREE.Group(); head.position.y = 0.55;
    for (const ex of [-0.18, 0.18]) { const e = box(0.08, 0.1, 0.02, 0xd8e0f0); e.position.set(ex, 0.05, -0.31); head.add(e); }
    const tentacles = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const t = limb(0.1, 0.7, 0.1, 0x24345e, Math.cos(a) * 0.22, 0.5, Math.sin(a) * 0.22);
      tentacles.push(t); g.add(t);
    }
    g.add(body, head);
    return { group: g, head, legs: [], arms: [], tentacles };
  },
  bat: () => {
    const g = new THREE.Group();
    const body = box(0.2, 0.3, 0.15, 0x4a3a2a); body.position.y = 0.5;
    const head = new THREE.Group(); head.position.y = 0.72;
    head.add(box(0.2, 0.18, 0.18, 0x4a3a2a));
    for (const ex of [-0.07, 0.07]) { const ear = box(0.05, 0.08, 0.03, 0x3a2a1a); ear.position.set(ex, 0.12, 0); head.add(ear); }
    const flap = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group(); pivot.position.set(side * 0.1, 0.58, 0); pivot.userData.side = side;
      const wing = box(0.4, 0.25, 0.02, 0x2a2018); wing.position.x = side * 0.2; pivot.add(wing);
      flap.push(pivot); g.add(pivot);
    }
    g.add(body, head);
    return { group: g, head, legs: [], arms: [], flap, flapSpeed: 25 };
  },
  piglin: () => {
    const m = humanoid(0xeaa6a0, 0x8a6a3a, 0x5a3a20, false);
    const snout = box(0.25, 0.15, 0.08, 0xd98a85); snout.position.set(0, 0.16, -0.29); m.head.add(snout);
    for (const ex of [-0.28, 0.28]) { const ear = box(0.06, 0.2, 0.14, 0xeaa6a0); ear.position.set(ex, 0.28, -0.05); m.head.add(ear); }
    for (const tx of [-0.1, 0.1]) { const tusk = box(0.04, 0.08, 0.04, 0xf0e6c8); tusk.position.set(tx, 0.08, -0.3); m.head.add(tusk); }
    const sword = box(0.05, 0.7, 0.05, 0xf5cd3c); sword.position.set(0, -0.75, -0.25); sword.rotation.x = Math.PI / 2; m.armR.add(sword);
    return m;
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
  villager: [0.35, 1.95], iron_golem: [0.75, 2.7],
  zombified_piglin: [0.35, 1.95], ghast: [2, 4.2], blaze: [0.35, 1.8], wither_skeleton: [0.42, 2.4],
  fireball: [0.5, 1], ender_dragon: [3.5, 3.5], end_crystal: [1, 2.2],
  wolf: [0.35, 0.9], rabbit: [0.25, 0.55], witch: [0.35, 1.95], drowned: [0.35, 1.95], phantom: [0.5, 0.5],
  squid: [0.45, 0.95], bat: [0.3, 0.9], piglin: [0.35, 1.95], slime: [0.26, 0.52], magma_cube: [0.26, 0.52],
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

let fireTexture = null;
function fireballTexture() {
  if (fireTexture) return fireTexture;
  const rows = [
    '..oooo..',
    '.oyyyyo.',
    'oywwyyro',
    'oywyyyro',
    'oyyyyrro',
    'oyyyrrro',
    '.orrrro.',
    '..oooo..',
  ];
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const ctx = c.getContext('2d');
  const pal = { o: '#c03a00', y: '#ffd040', r: '#ff7a10', w: '#fff8c0' };
  rows.forEach((row, y) => { for (let x = 0; x < 8; x++) if (pal[row[x]]) { ctx.fillStyle = pal[row[x]]; ctx.fillRect(x, y, 1, 1); } });
  fireTexture = new THREE.CanvasTexture(c);
  fireTexture.magFilter = THREE.NearestFilter;
  fireTexture.minFilter = THREE.NearestFilter;
  fireTexture.generateMipmaps = false;
  fireTexture.colorSpace = THREE.SRGBColorSpace;
  return fireTexture;
}

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (o.material.map && o.isSprite && o.material.map !== orbTexture && o.material.map !== fireTexture && !o.material.map.userData.shared) o.material.map.dispose();
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

  // flags: 1 = invisible
  movePlayer(id, p, r, flags = 0) {
    const v = this.players.get(id);
    if (!v) return;
    v.model.group.visible = !(flags & 1);
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
    if (kind === 'tnt') {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(blockGeometry(197, 0.98), new THREE.MeshBasicMaterial({ map: this.textures.atlasSRGB }));
      mesh.position.y = 0.49;
      group.add(mesh);
      return { tnt: true, group, mesh, target: new THREE.Vector3(), yaw: 0, tYaw: 0 };
    }
    if (kind === 'xp') {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: xpOrbTexture(), transparent: true, depthWrite: false }));
      const group = new THREE.Group();
      group.add(sprite);
      return { xp: true, group, sprite, target: new THREE.Vector3(), yaw: 0, tYaw: 0, spin: Math.random() * 6 };
    }
    if (kind === 'breath') {
      // a lingering purple cloud of dragon's breath
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 0.6, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xb040ff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
      mesh.position.y = 0.3;
      const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 20), new THREE.MeshBasicMaterial({ color: 0xc060ff, transparent: true, opacity: 0.3, depthWrite: false }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.05;
      group.add(mesh, floor);
      return { breath: true, group, mesh, target: new THREE.Vector3(), yaw: 0, tYaw: 0, spin: 0 };
    }
    if (kind === 'fireball' || kind === 'small_fireball' || kind === 'dragon_fireball') {
      // a glowing ball of fire, always facing you
      const big = kind !== 'small_fireball';
      const group = new THREE.Group();
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireballTexture(), transparent: true, depthWrite: false, fog: false }));
      sprite.scale.set(big ? 1 : 0.35, big ? 1 : 0.35, 1);
      if (kind === 'dragon_fireball') sprite.material.color.setRGB(0.75, 0.35, 1);
      sprite.position.y = big ? 0.5 : 0.16;
      group.add(sprite);
      // only a ghast's fireball can be punched back
      return { fireball: true, mob: kind === 'fireball' ? 'fireball' : undefined, group, sprite, target: new THREE.Vector3(), yaw: 0, tYaw: 0, spin: 0 };
    }
    if (kind === 'potion' || kind === 'xp_bottle' || kind === 'egg') {
      // a thrown splash potion, bottle o' enchanting or egg, tumbling through the air
      const map = this.textures.itemTexture(kind === 'potion' ? ITEM.SPLASH_POTION : kind === 'egg' ? ITEM.EGG : ITEM.EXPERIENCE_BOTTLE);
      map.userData.shared = true;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, alphaTest: 0.5 }));
      sprite.scale.set(0.35, 0.35, 1);
      const group = new THREE.Group();
      group.add(sprite);
      return { fireball: true, group, sprite, target: new THREE.Vector3(), yaw: 0, tYaw: 0, spin: 0 };
    }
    if (kind === 'eye') {
      // a thrown eye of ender, with a trail of purple sparks
      const group = new THREE.Group();
      const map = this.textures.itemTexture(EYE_OF_ENDER);
      map.userData.shared = true; // cached by the texture code, so not disposed with the eye
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, alphaTest: 0.5 }));
      sprite.scale.set(0.35, 0.35, 1);
      group.add(sprite);
      const sparks = [];
      for (let i = 0; i < 6; i++) {
        const sp = box(0.05, 0.05, 0.05, 0xc070ff);
        group.add(sp);
        sparks.push(sp);
      }
      return { eye: true, group, sprite, sparks, target: new THREE.Vector3(), yaw: 0, tYaw: 0, spin: 0 };
    }
    if (kind === 'bobber') {
      // a red and white float on a fishing line, which runs back to the rod
      const group = new THREE.Group();
      const top = box(0.12, 0.08, 0.12, 0xd02020); top.position.y = 0.12;
      const bottom = box(0.12, 0.08, 0.12, 0xf0f0f0); bottom.position.y = 0.04;
      group.add(top, bottom);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x202020 }));
      line.frustumCulled = false;
      this.scene.add(line);
      return { bobber: true, group, line, target: new THREE.Vector3(), yaw: 0, tYaw: 0 };
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
    if (v.line) { this.scene.remove(v.line); v.line.geometry.dispose(); v.line.material.dispose(); }
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
      let [hw, h] = HITBOX[v.mob] || [0.5, 1];
      const scale = v.group.scale.x; // slimes come in sizes; babies are small
      hw *= scale; h *= scale;
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
    let dragon = null;
    for (const v of this.entities.values()) if (v.mob === 'ender_dragon') dragon = v;
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
      if (v.tnt) {
        // lit TNT flashes white
        const l = this.lightAt(g.position.x, g.position.y + 0.5, g.position.z);
        const flash = (v.flags & 2) ? 2.5 : 1;
        v.mesh.material.color.setRGB(l * flash, l * flash, l * flash);
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
      if (v.eye) {
        v.spin += dt;
        v.sparks.forEach((sp, i) => {
          const t = (v.spin * 2 + i / 6) % 1;
          sp.position.set(Math.sin(i * 2.4 + v.spin * 3) * 0.2 * t, -t * 0.4, Math.cos(i * 2.4 + v.spin * 3) * 0.2 * t);
        });
        continue;
      }
      if (v.breath) {
        v.spin += dt;
        v.mesh.material.opacity = 0.25 + Math.sin(v.spin * 4) * 0.1;
        continue;
      }
      if (v.mob === 'end_crystal') {
        // the crystal bobs and spins; its beam reaches the dragon while it heals it
        v.spin = (v.spin || 0) + dt;
        v.model.spin.rotation.set(v.spin * 1.3, v.spin * 2, 0);
        v.model.glass2.rotation.set(-v.spin * 2, 0, v.spin);
        v.model.spin.position.y = 1.3 + Math.sin(v.spin * 2) * 0.25;
        const beam = v.model.beam;
        beam.visible = !!dragon && (v.flags & 2) !== 0;
        if (beam.visible) {
          const from = new THREE.Vector3(0, v.model.spin.position.y, 0);
          const to = dragon.group.position.clone().sub(g.position).add(new THREE.Vector3(0, 1.8, 0));
          beam.position.copy(from).add(to).multiplyScalar(0.5);
          beam.scale.set(1, 1, from.distanceTo(to));
          beam.lookAt(to.clone().add(g.position));
        }
        continue;
      }
      if (v.fireball) {
        v.spin += dt * 8;
        v.sprite.material.rotation = v.spin;
        continue;
      }
      if (v.bobber) {
        // dips under when a fish bites; the line goes to the owner's rod
        g.children.forEach((c, i) => { c.position.y = (i ? 0.04 : 0.12) - ((v.flags & 2) ? 0.15 : 0); });
        const owner = v.flags >> 2;
        let from = null;
        if (owner === this.selfId && this.selfRodTip) from = this.selfRodTip();
        else {
          const pv = this.players.get(owner);
          if (pv) {
            const q = pv.model.group.position, yaw = pv.yaw;
            from = new THREE.Vector3(q.x - Math.sin(yaw) * 0.9 + Math.cos(yaw) * 0.35, q.y + 1.9, q.z - Math.cos(yaw) * 0.9 - Math.sin(yaw) * 0.35);
          }
        }
        const pos = v.line.geometry.attributes.position;
        if (from) { pos.setXYZ(0, from.x, from.y, from.z); pos.setXYZ(1, g.position.x, g.position.y + 0.1, g.position.z); pos.needsUpdate = true; }
        v.line.visible = !!from;
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
      if (v.model.wings) {
        const t = performance.now() / 1000;
        for (const w of v.model.wings) w.rotation.z = Math.sin(t * 2.6) * 0.55 * w.userData.side;
        v.model.tail.forEach((s, i) => { s.position.x = Math.sin(t * 1.5 - i * 0.25) * 0.15 * i; });
      }
      if (v.model.robe && v.prof !== ((v.flags >> 4) & 15)) {
        // robe and hat colours by profession
        v.prof = (v.flags >> 4) & 15;
        const [robe, hat] = PROFESSION_LOOK[v.prof] || PROFESSION_LOOK[0];
        recolor(v.model.robe, robe);
        recolor(v.model.foldedArms, robe);
        v.model.hat.visible = hat !== null;
        if (hat !== null) recolor(v.model.hat, hat);
      }
      // sizes: slimes by flag bits 9-10, babies (flag 256) at half size
      const scale = v.model.slime ? [1, 2, 4][(v.flags >> 9) & 3] || 1 : (v.flags & 256) ? 0.5 : 1;
      if (g.scale.x !== scale) g.scale.setScalar(scale);
      if (v.model.slime) {
        // squish while hopping
        const dy = v.target.y - g.position.y;
        v.model.outer.scale.y = 1 + Math.max(-0.25, Math.min(0.25, dy * 2));
      }
      if (v.model.flap) {
        const t = performance.now() / 1000;
        for (const w of v.model.flap) w.rotation.z = Math.sin(t * v.model.flapSpeed) * 0.6 * w.userData.side;
      }
      if (v.model.wolf) {
        v.model.collar.visible = (v.flags & 4096) !== 0;
        const sitting = (v.flags & 2048) !== 0;
        v.model.body.rotation.x = sitting ? -0.45 : 0;
        if (sitting) { v.model.legs[2].rotation.x = v.model.legs[3].rotation.x = -1.3; v.model.legs[0].rotation.x = v.model.legs[1].rotation.x = 0; }
        v.model.tail.rotation.x = sitting ? 1.2 : (v.flags & 8192) ? 0.1 : 0.6;
        const angry = (v.flags & 8192) !== 0;
        if (v.angry !== angry) { v.angry = angry; v.model.head.children.forEach((c) => { if (c.geometry?.parameters?.depth === 0.02) recolor(c, angry ? 0xc02020 : 0x111111); }); } // angry eyes
      }
      if (v.mob === 'creeper' && (v.flags & 2048) && !v.aura) {
        // a charged creeper crackles with a blue glow
        v.aura = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.95, 0.85), new THREE.MeshBasicMaterial({ color: 0x60a0ff, transparent: true, opacity: 0.35, depthWrite: false }));
        v.aura.position.y = 0.95;
        g.add(v.aura);
      }
      if (v.aura) v.aura.material.opacity = 0.25 + Math.sin(performance.now() / 90) * 0.12;
      if (v.model.faces) {
        v.model.faces.open.visible = (v.flags & 2) !== 0;
        v.model.faces.shut.visible = !v.model.faces.open.visible;
      }
      if (v.model.tentacles) v.model.tentacles.forEach((t, i) => { t.rotation.x = Math.sin(performance.now() / 400 + i) * 0.25; });
      if (v.model.rods) {
        const t = performance.now() / 1000;
        for (const r of v.model.rods.children) {
          const ring = r.userData.ring, dir = ring % 2 ? -1 : 1;
          const a = Math.atan2(r.position.z, r.position.x) + dir * 0.03;
          const rad = Math.hypot(r.position.x, r.position.z);
          r.position.x = Math.cos(a) * rad; r.position.z = Math.sin(a) * rad;
          r.position.y = 1.1 - ring * 0.42 + Math.sin(t * 2 + ring) * 0.05;
        }
      }
      if (v.model.wool) {
        const woolColor = (v.flags >> 14) & 15;
        if (v.woolColor !== woolColor) {
          v.woolColor = woolColor;
          const [r, g, b] = DYE_RGB[woolColor];
          recolor(v.model.wool, (r << 16) | (g << 8) | b);
          recolor(v.model.headWool, (r << 16) | (g << 8) | b);
        }
        const sheared = (v.flags & 1) !== 0;
        v.model.wool.visible = !sheared;
        v.model.headWool.visible = !sheared;
      }
      v.hurt = Math.max(0, v.hurt - dt);
      const lm = this.lightAt(g.position.x, g.position.y + 1, g.position.z);
      if (v.hurt > 0) this.setMaterialTint(g, Math.max(lm, 0.3), lm * 0.2, lm * 0.2);
      else if (v.flags & 2 && Math.sin(performance.now() / 60) > 0) this.setMaterialTint(g, 2, 2, 2); // creeper about to blow
      else if (v.flags & 4) { const f = 1.4 + Math.sin(performance.now() / 50) * 0.4; this.setMaterialTint(g, f, f * 0.55, f * 0.15); } // on fire
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
