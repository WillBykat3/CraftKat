// Rain and snow falling around the camera, and lightning bolts. Rain only falls where the
// sky is open above; snow falls in cold biomes; deserts and savannas stay dry.

import * as THREE from 'three';
import { FROZEN } from './biomes.js';
import { BIOME } from './biomes.js';

const DRY = new Set([BIOME.DESERT, BIOME.SAVANNA]);
const COUNT = 1400;
const RADIUS = 14;

export class Precipitation {
  constructor(scene) {
    this.positions = new Float32Array(COUNT * 6);
    this.colors = new Float32Array(COUNT * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }));
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);
    // each drop: x, y, z, ground y, kind (0 none, 1 rain, 2 snow), speed, wobble phase
    this.drops = Array.from({ length: COUNT }, () => ({ x: 0, y: -1e9, z: 0, ground: 0, kind: 0, speed: 0, phase: Math.random() * 6 }));
    this.columns = new Map(); // "x,z" -> [ground y, kind], cached for a moment
    this.columnsAge = 0;
    this.intensity = 0;
  }

  dispose() {
    this.lines.parent?.remove(this.lines);
    this.lines.geometry.dispose();
    this.lines.material.dispose();
  }

  // What falls on a column: [the y it lands on, 0 nothing / 1 rain / 2 snow].
  column(world, x, z) {
    const key = x + ',' + z;
    let c = this.columns.get(key);
    if (!c) {
      const biome = world.biomeAt ? world.biomeAt(x, z) : BIOME.PLAINS;
      c = [world.topBlockY(x, z) + 1, DRY.has(biome) ? 0 : FROZEN.has(biome) ? 2 : 1];
      this.columns.set(key, c);
    }
    return c;
  }

  // target: 0 clear .. 1 raining. Returns how much of the falling is rain near the camera (0-1),
  // for the sound.
  update(dt, cam, world, target, light) {
    this.intensity += (target - this.intensity) * Math.min(1, dt * 0.5);
    this.columnsAge += dt;
    if (this.columnsAge > 2) { this.columns.clear(); this.columnsAge = 0; } // blocks change
    const active = Math.floor(COUNT * this.intensity);
    this.lines.visible = active > 0 && !!world;
    if (!this.lines.visible) return 0;
    let rainNear = 0;
    const P = this.positions, C = this.colors;
    for (let i = 0; i < COUNT; i++) {
      const d = this.drops[i];
      const o = i * 6;
      if (i >= active) { P[o + 1] = P[o + 4] = -1e9; continue; }
      d.y -= d.speed * dt;
      if (d.y < d.ground || d.y < cam.y - 12 || Math.abs(d.x - cam.x) > RADIUS || Math.abs(d.z - cam.z) > RADIUS) {
        // start a new drop somewhere above the camera
        d.x = cam.x + (Math.random() * 2 - 1) * RADIUS;
        d.z = cam.z + (Math.random() * 2 - 1) * RADIUS;
        const [ground, kind] = this.column(world, Math.floor(d.x), Math.floor(d.z));
        d.ground = ground;
        d.kind = kind;
        d.y = Math.max(cam.y + 4 + Math.random() * 14, ground + 1);
        d.speed = kind === 2 ? 2 + Math.random() : 18 + Math.random() * 6;
        if (d.y > cam.y + 40) d.kind = 0; // the sky is far above (under a roof): nothing to see
      }
      if (d.kind === 0) { P[o + 1] = P[o + 4] = -1e9; continue; }
      if (d.kind === 1 && Math.abs(d.x - cam.x) < 6 && Math.abs(d.z - cam.z) < 6 && d.ground <= cam.y + 3) rainNear++;
      const len = d.kind === 1 ? 0.7 : 0.1;
      const wob = d.kind === 2 ? Math.sin(d.phase + d.y * 0.7) * 0.3 : 0;
      P[o] = d.x + wob; P[o + 1] = d.y; P[o + 2] = d.z;
      P[o + 3] = d.x + wob + (d.kind === 2 ? 0.06 : 0); P[o + 4] = d.y + len; P[o + 5] = d.z;
      const [r, g, b] = d.kind === 1 ? [0.55, 0.62, 0.8] : [1, 1, 1];
      for (const k of [0, 3]) { C[o + k] = r * light; C[o + k + 1] = g * light; C[o + k + 2] = b * light; }
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
    return Math.min(1, rainNear / (COUNT * 0.08));
  }
}

// A jagged white bolt from the sky down to (x, y, z), shown for a moment.
export function lightningBolt(scene, x, y, z) {
  const pts = [];
  let px = x, pz = z;
  for (let h = y + 120; h > y; h -= 4) {
    pts.push(new THREE.Vector3(px, h, pz));
    px += (Math.random() - 0.5) * 2.5; pz += (Math.random() - 0.5) * 2.5;
    pts.push(new THREE.Vector3(px, Math.max(y, h - 4), pz));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const bolt = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xf0f4ff, fog: false }));
  bolt.frustumCulled = false;
  scene.add(bolt);
  setTimeout(() => { scene.remove(bolt); geo.dispose(); bolt.material.dispose(); }, 350);
}
