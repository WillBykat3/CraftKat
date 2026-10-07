// Other players: blocky avatars with floating name tags, smoothly interpolated.

import * as THREE from 'three';

const SHIRT_COLORS = [0x3b82f6, 0xef4444, 0x22c55e, 0xf59e0b, 0xa855f7, 0x14b8a6, 0xec4899, 0xf97316];

function box(w, h, d, color) {
  const geo = new THREE.BoxGeometry(w, h, d);
  // darker sides/bottom so the shape reads without scene lighting
  const shades = [0.8, 0.8, 1.0, 0.5, 0.65, 0.65]; // +x -x +y -y +z -z
  const base = new THREE.Color(color);
  const colors = [];
  for (let face = 0; face < 6; face++) {
    for (let v = 0; v < 4; v++) colors.push(base.r * shades[face], base.g * shades[face], base.b * shades[face]);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }));
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
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false }));
  sprite.scale.set(width / 96, 0.5, 1);
  return sprite;
}

function makeAvatar(id, name) {
  const group = new THREE.Group();
  const shirt = SHIRT_COLORS[id % SHIRT_COLORS.length];

  const legs = box(0.5, 0.75, 0.25, 0x2c3e7a);
  legs.position.y = 0.375;
  const body = box(0.6, 0.75, 0.3, shirt);
  body.position.y = 1.125;
  const armL = box(0.2, 0.7, 0.25, shirt);
  armL.position.set(-0.4, 1.15, 0);
  const armR = armL.clone();
  armR.position.x = 0.4;

  const head = new THREE.Group();
  head.position.y = 1.5;
  const skull = box(0.5, 0.5, 0.5, 0xd8a47f);
  skull.position.y = 0.25;
  head.add(skull);
  // eyes on the front (-z is "forward", matching the camera)
  for (const ex of [-0.12, 0.12]) {
    const eye = box(0.08, 0.08, 0.02, 0x222244);
    eye.position.set(ex, 0.28, -0.26);
    head.add(eye);
  }

  const tag = nameTag(name);
  tag.position.y = 2.35;

  group.add(legs, body, armL, armR, head, tag);
  return { group, head, armL, armR, legs };
}

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.players = new Map(); // id -> state
  }

  get count() {
    return this.players.size;
  }

  add(id, name, pos, rot) {
    if (this.players.has(id)) this.remove(id);
    const avatar = makeAvatar(id, name);
    avatar.group.position.set(pos[0], pos[1], pos[2]);
    this.scene.add(avatar.group);
    this.players.set(id, {
      name,
      avatar,
      target: new THREE.Vector3(pos[0], pos[1], pos[2]),
      yaw: rot[0], pitch: rot[1],
      targetYaw: rot[0], targetPitch: rot[1],
      walk: 0,
    });
  }

  remove(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.scene.remove(p.avatar.group);
    p.avatar.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
    this.players.delete(id);
  }

  setTarget(id, pos, rot) {
    const p = this.players.get(id);
    if (!p) return;
    p.target.set(pos[0], pos[1], pos[2]);
    p.targetYaw = rot[0];
    p.targetPitch = rot[1];
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 12);
    for (const p of this.players.values()) {
      const g = p.avatar.group;
      const before = g.position.clone();
      g.position.lerp(p.target, k);
      let dy = p.targetYaw - p.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy)); // shortest way round
      p.yaw += dy * k;
      p.pitch += (p.targetPitch - p.pitch) * k;
      g.rotation.y = p.yaw;
      p.avatar.head.rotation.x = p.pitch;

      // swing arms while moving horizontally
      const moved = Math.hypot(g.position.x - before.x, g.position.z - before.z);
      p.walk += moved * 4;
      const swing = Math.min(1, moved / Math.max(dt, 1e-3) / 4) * Math.sin(p.walk) * 0.6;
      p.avatar.armL.rotation.x = swing;
      p.avatar.armR.rotation.x = -swing;
    }
  }

  clear() {
    for (const id of [...this.players.keys()]) this.remove(id);
  }
}
