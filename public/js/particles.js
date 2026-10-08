// Little bits of block that fly off when a block is broken or hit, like
// Minecraft's. Each particle is a point sprite showing a random 4x4-pixel
// corner of the block's texture, falling with gravity and landing on blocks.

import * as THREE from 'three';
import { BLOCKS } from './blocks.js';
import { uvOf } from './atlas-layout.js';

const MAX = 600;

const VERTEX = /* glsl */ `
attribute vec4 uvRect;
attribute float size;
attribute float bright;
varying vec4 vRect;
varying float vBright;
uniform float scale;
void main() {
  vRect = uvRect;
  vBright = bright;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
varying vec4 vRect;
varying float vBright;
void main() {
  vec2 uv = vec2(mix(vRect.x, vRect.z, gl_PointCoord.x), mix(vRect.w, vRect.y, gl_PointCoord.y));
  vec4 tex = texture2D(map, uv);
  if (tex.a < 0.5) discard;
  gl_FragColor = vec4(tex.rgb * vBright, 1.0);
}`;

export class Particles {
  constructor(scene, textures) {
    this.list = [];
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.rect = new Float32Array(MAX * 4);
    this.size = new Float32Array(MAX);
    this.bright = new Float32Array(MAX);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uvRect', new THREE.BufferAttribute(this.rect, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('bright', new THREE.BufferAttribute(this.bright, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.uniforms = { map: { value: textures.atlasTinted }, scale: { value: 600 } };
    this.points = new THREE.Points(this.geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  // A block broke: a 4x4x4 burst of pieces from the whole block.
  breakBlock(x, y, z, id, light = 1) {
    const def = BLOCKS[id];
    if (!def || !def.tex) return;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) {
      if (Math.random() < 0.45) continue;
      const px = x + (i + 0.5) / 4, py = y + (j + 0.5) / 4, pz = z + (k + 0.5) / 4;
      this.add(def, px, py, pz, (px - x - 0.5) * 3 + (Math.random() - 0.5), (py - y - 0.5) * 3 + 1.5 + Math.random(), (pz - z - 0.5) * 3 + (Math.random() - 0.5), light);
    }
  }

  // Hitting a block: a couple of pieces from the face being mined.
  hitBlock(hit, light = 1) {
    const def = BLOCKS[hit.id];
    if (!def || !def.tex) return;
    const [nx, ny, nz] = hit.normal || [0, 1, 0];
    for (let n = 0; n < 2; n++) {
      const px = hit.x + (nx ? (nx > 0 ? 1.05 : -0.05) : Math.random());
      const py = hit.y + (ny ? (ny > 0 ? 1.05 : -0.05) : Math.random());
      const pz = hit.z + (nz ? (nz > 0 ? 1.05 : -0.05) : Math.random());
      this.add(def, px, py, pz, nx * 1.5 + (Math.random() - 0.5), ny * 1.5 + Math.random() * 1.5, nz * 1.5 + (Math.random() - 0.5), light);
    }
  }

  add(def, x, y, z, vx, vy, vz, light) {
    if (this.list.length >= MAX) this.list.shift();
    const [u0, v0, u1, v1] = uvOf(def.tex[1]);
    // a random 4x4 pixel square of the 16x16 texture
    const du = (u1 - u0) / 4, dv = (v1 - v0) / 4;
    const cu = u0 + Math.floor(Math.random() * 4) * du, cv = v0 + Math.floor(Math.random() * 4) * dv;
    this.list.push({ x, y, z, vx, vy, vz, life: 0.6 + Math.random() * 0.6, rect: [cu, cv, cu + du, cv + dv], size: 0.08 + Math.random() * 0.06, light });
  }

  update(dt, world, lightAt) {
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      p.vy -= 16 * dt;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      const solid = (x, y, z) => BLOCKS[world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))]?.solid;
      if (solid(nx, ny, nz)) {
        if (!solid(p.x, ny, p.z) || p.vy > 0) { p.vx *= 0.3; p.vz *= 0.3; }
        if (solid(p.x, ny, p.z)) { p.vy = 0; p.vx *= 0.6; p.vz *= 0.6; } else p.y = ny;
        if (!solid(nx, p.y, p.z)) p.x = nx;
        if (!solid(p.x, p.y, nz)) p.z = nz;
      } else {
        p.x = nx; p.y = ny; p.z = nz;
      }
    }
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.rect.set(p.rect, i * 4);
      this.size[i] = p.size;
      // particles are drawn without the chunk shader's curve, so use the light where they are
      this.bright[i] = (i & 7) === 0 || p.bright === undefined ? (p.bright = Math.pow(lightAt(p.x, p.y, p.z), 1 / 2.2)) : p.bright;
    }
    this.geo.setDrawRange(0, n);
    for (const name of ['position', 'uvRect', 'size', 'bright']) this.geo.attributes[name].needsUpdate = true;
  }

  setViewportHeight(h) {
    this.uniforms.scale.value = h * 0.9;
  }

  clear() {
    this.list.length = 0;
    this.geo.setDrawRange(0, 0);
  }
}
