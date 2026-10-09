// Scene setup: chunk meshes (built by the worker), lighting shader, sky,
// sun/moon, stars, clouds, block highlight and breaking cracks.

import * as THREE from 'three';
import { CHUNK } from './blocks.js';
import { chunkKey } from './world.js';
import { DAY_TICKS, daylight as daylightAt } from './host.js';
import { mulberry32 } from './noise.js';

const CHUNK_VERTEX = /* glsl */ `
attribute float shade;
attribute vec2 light;
attribute vec3 tint;
varying vec3 vTint;
varying vec2 vUv;
varying float vShade;
varying vec2 vLight;
varying float vDist;
void main() {
  vUv = uv;
  vShade = shade;
  vLight = light;
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDist = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const CHUNK_FRAGMENT = /* glsl */ `
uniform sampler2D map;
uniform float skyFactor;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float opacity;
uniform float brightness;
uniform float ambient;
varying vec2 vUv;
varying float vShade;
varying vec2 vLight;
varying float vDist;
varying vec3 vTint;
float curve(float l) {
  // Minecraft's light table: steep falloff so caves get properly dark,
  // lifted by the brightness setting (0 = moody, 1 = bright)
  float f = 1.0 - l;
  float b = (1.0 - f) / (f * 3.0 + 1.0);
  b = ambient + (1.0 - ambient) * b; // the Nether and the End are never pitch black
  return mix(b, sqrt(b), brightness);
}
void main() {
  vec4 tex = texture2D(map, vUv);
  if (tex.a < 0.5) discard;
  if (tex.a < 0.99) tex.rgb *= vTint; // pixels marked for the biome colour (alpha 250)
  float sky = curve(vLight.x * skyFactor);
  float blk = curve(vLight.y);
  vec3 light = max(vec3(sky), vec3(blk) * vec3(1.0, 0.92, 0.78)); // torches are warm
  light = max(light, vec3(0.035));
  vec3 color = tex.rgb * vShade * light;
  float fog = smoothstep(fogNear, fogFar, vDist);
  gl_FragColor = vec4(mix(color, fogColor, fog), opacity);
}`;

// Same curve as the chunk shader, for things drawn with regular materials (mobs, the hand).
// Returns a display-space brightness; regular three.js materials work in linear space,
// so use toLinear() before multiplying a material color with it.
export const lighting = { brightness: 0.5, ambient: 0 };
export function lightCurve(level) {
  const f = 1 - level;
  let b = (1 - f) / (f * 3 + 1);
  b = lighting.ambient + (1 - lighting.ambient) * b;
  return Math.max(0.035, b + (Math.sqrt(b) - b) * lighting.brightness);
}

// Light in total darkness, like Minecraft: the Nether's ambient light is 0.1,
// and the End's light map is forced a quarter of the way to full brightness.
const AMBIENT = { overworld: 0, nether: 0.1, end: 0.25 };
const END_SKY = new THREE.Color(0x120c1a);
const BLACK = new THREE.Color(0x000000);
export const toLinear = (v) => Math.pow(v, 2.2);

// Where fog starts for a view distance in blocks: Java's fog fades in over the last
// clamp(distance / 10, 4, 64) blocks (ending a little short of the edge here, to hide chunks loading in)
export function terrainFogNear(far) {
  return Math.max(0, far * 0.95 - Math.min(64, Math.max(4, far / 10)));
}

function freeArray() {
  this.array = null;
}

const SKY_DAY = new THREE.Color(0x87b8ff);
const SKY_NIGHT = new THREE.Color(0x05070f);
const SKY_SUNSET = new THREE.Color(0xe8865a);
const WATER_FOG = new THREE.Color(0x163a7a);
const LAVA_FOG = new THREE.Color(0xc04a08);

export class Renderer {
  constructor(container, textures) {
    this.textures = textures;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';
    this.fov = 70;

    this.uniforms = {
      map: { value: textures.atlas },
      skyFactor: { value: 1 },
      fogColor: { value: new THREE.Vector3(0.5, 0.7, 1) },
      fogNear: { value: 50 },
      fogFar: { value: 90 },
      opacity: { value: 1 },
      brightness: { value: 0.5 },
      ambient: { value: AMBIENT.overworld },
    };
    this.solidMaterial = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: CHUNK_VERTEX, fragmentShader: CHUNK_FRAGMENT,
    });
    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, opacity: { value: 0.72 } },
      vertexShader: CHUNK_VERTEX, fragmentShader: CHUNK_FRAGMENT,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });

    this.meshes = new Map(); // chunkKey -> {solid, water, version}
    this.versions = new Map();
    this.pending = new Set();
    this.renderDistance = 6;
    this.cloudY = 126;
    this.worker = null;

    this.buildSky();
    this.buildOverlays();

    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ---------- chunks ----------
  startWorld(seed, edits, gen = 1, dim = 'overworld') {
    this.clearChunks();
    this.dim = dim;
    this.uniforms.ambient.value = lighting.ambient = AMBIENT[dim] ?? AMBIENT.overworld;
    this.dimFog = null;
    this.cloudY = gen >= 3 ? 192.33 + 64 : 126; // Minecraft's cloud height in tall worlds
    if (this.worker) this.worker.terminate();
    this.worker = new Worker(new URL('./mesh-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.onMesh(e.data);
    this.worker.onerror = (e) => console.error('mesh worker error', e.message || e);
    this.worker.postMessage({ t: 'init', seed, edits, gen, dim });
  }

  clearChunks() {
    for (const key of [...this.meshes.keys()]) this.disposeChunk(key);
    this.versions.clear();
    this.pending.clear();
  }

  disposeChunk(key) {
    const m = this.meshes.get(key);
    if (m) {
      for (const mesh of [m.solid, m.water]) {
        if (mesh) { this.scene.remove(mesh); mesh.geometry.dispose(); }
      }
    }
    this.meshes.delete(key);
  }

  requestChunk(cx, cz, urgent = false) {
    const key = chunkKey(cx, cz);
    const version = (this.versions.get(key) || 0) + 1;
    this.versions.set(key, version);
    this.pending.add(key);
    this.worker.postMessage({ t: 'mesh', cx, cz, version, urgent });
  }

  makeMesh(data, material, cx, cz) {
    if (!data) return null;
    const geo = new THREE.BufferGeometry();
    // the GPU keeps its own copy, so free the arrays once they're uploaded
    const attr = (array, size, normalized = false) => new THREE.BufferAttribute(array, size, normalized).onUpload(freeArray);
    geo.setAttribute('position', attr(data.positions, 3));
    geo.setAttribute('uv', attr(data.uvs, 2, true));
    geo.setAttribute('shade', attr(data.shade, 1, true));
    geo.setAttribute('light', attr(data.light, 2, true));
    geo.setAttribute('tint', attr(data.tint, 3, true));
    geo.setIndex(attr(data.indices, 1));
    const half = (data.maxY - data.minY) / 2;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(CHUNK / 2, data.minY + half, CHUNK / 2), Math.hypot(CHUNK / 2, half, CHUNK / 2));
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(cx * CHUNK, 0, cz * CHUNK);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    return mesh;
  }

  onMesh({ cx, cz, version, solid, water }) {
    const key = chunkKey(cx, cz);
    // Show any mesh newer than the one on screen, even if a newer one is still on its way:
    // while blocks keep changing (flowing water), waiting for the latest would never show anything.
    const latest = this.versions.get(key);
    if (latest === undefined || version > latest) return; // from before the chunks were cleared
    if (version === latest) this.pending.delete(key);
    if (!this.wanted(cx, cz)) return;
    const shown = this.meshes.get(key);
    if (shown && shown.version > version) return;
    this.disposeChunk(key);
    this.meshes.set(key, {
      solid: this.makeMesh(solid, this.solidMaterial, cx, cz),
      water: this.makeMesh(water, this.waterMaterial, cx, cz),
      version,
    });
  }

  wanted(cx, cz) {
    const r = this.renderDistance + 1;
    return (cx - this.centerX) ** 2 + (cz - this.centerZ) ** 2 <= r * r;
  }

  // Requests missing chunks around the player, nearest first; drops far ones.
  updateChunks(px, pz) {
    if (!this.worker) return;
    const pcx = Math.floor(px / CHUNK);
    const pcz = Math.floor(pz / CHUNK);
    const moved = pcx !== this.centerX || pcz !== this.centerZ;
    this.centerX = pcx;
    this.centerZ = pcz;
    if (!moved && this.pending.size > 0) return;
    const R = this.renderDistance;
    const missing = [];
    const keep = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > R * R) continue;
        const key = chunkKey(pcx + dx, pcz + dz);
        keep.push(key);
        if (!this.meshes.has(key) && !this.pending.has(key)) missing.push([pcx + dx, pcz + dz, d2]);
      }
    }
    if (moved) {
      this.worker.postMessage({ t: 'cancel', keep });
      const keepSet = new Set(keep);
      for (const key of [...this.pending]) if (!keepSet.has(key)) this.pending.delete(key);
      for (const key of [...this.meshes.keys()]) {
        const [cx, cz] = key.split(',').map(Number);
        if (!this.wanted(cx, cz)) this.disposeChunk(key);
      }
      this.worker.postMessage({ t: 'unload', cx: pcx, cz: pcz, radius: R + 3 });
    }
    missing.sort((a, b) => a[2] - b[2]);
    for (const [cx, cz] of missing) this.requestChunk(cx, cz);
  }

  // A block changed: tell the worker and rebuild affected chunks (light spreads up to 15 blocks,
  // so neighbouring chunks are rebuilt too).
  blockChanged(x, y, z, id) {
    if (!this.worker) return;
    this.worker.postMessage({ t: 'set', x, y, z, id });
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    this.requestChunk(cx, cz, true);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dz) && this.meshes.has(chunkKey(cx + dx, cz + dz))) this.requestChunk(cx + dx, cz + dz, true);
      }
    }
  }

  setBrightness(v) {
    this.uniforms.brightness.value = v;
    lighting.brightness = v;
  }

  setRenderDistance(chunks) {
    this.renderDistance = chunks;
    this.centerX = undefined;
  }

  // ---------- sky ----------
  buildSky() {
    const sunTex = this.squareTexture('#fff6b0', '#ffd84a');
    const moonTex = this.squareTexture('#e8ecf5', '#b9bfcc');
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ map: sunTex, fog: false, depthWrite: false }));
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(28, 28), new THREE.MeshBasicMaterial({ map: moonTex, fog: false, depthWrite: false }));
    this.sun.renderOrder = this.moon.renderOrder = -10;
    this.scene.add(this.sun, this.moon);

    const rand = mulberry32(5);
    const starPos = [];
    for (let i = 0; i < 900; i++) {
      const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      if (u < -0.1) continue;
      starPos.push(Math.cos(a) * r * 400, u * 400, Math.sin(a) * r * 400);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
    this.stars.renderOrder = -11;
    this.scene.add(this.stars);

    // blocky clouds drawn on a repeating texture
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const v = Math.sin(x * 0.31) + Math.sin(y * 0.27) + Math.sin((x + y) * 0.13) + Math.sin(x * 0.07 - y * 0.11) * 1.5 + rand() * 0.6;
      if (v > 1.6) { ctx.fillStyle = '#fff'; ctx.fillRect(x, y, 1, 1); }
    }
    const cloudTex = new THREE.CanvasTexture(c);
    cloudTex.magFilter = THREE.NearestFilter;
    cloudTex.minFilter = THREE.NearestFilter;
    cloudTex.generateMipmaps = false;
    cloudTex.wrapS = cloudTex.wrapT = THREE.RepeatWrapping;
    this.cloudTex = cloudTex;
    // clouds fade out with distance, otherwise far-away clouds merge into a white band at the horizon
    this.cloudUniforms = {
      map: { value: cloudTex },
      offset: { value: new THREE.Vector2() },
      brightness: { value: 1 },
    };
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.ShaderMaterial({
      uniforms: this.cloudUniforms,
      vertexShader: /* glsl */ `
        uniform vec2 offset;
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vUv = world.xz / 768.0 + offset;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform float brightness;
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          if (texture2D(map, vUv).a < 0.5) discard;
          float d = length(vWorld.xz - cameraPosition.xz);
          float alpha = 0.8 * (1.0 - smoothstep(180.0, 560.0, d));
          gl_FragColor = vec4(vec3(brightness), alpha);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.clouds.rotation.x = -Math.PI / 2;
    this.scene.add(this.clouds);
    this.buildFancyClouds(c);
    this.setClouds('fancy');
  }

  // 3D clouds: every cloud pixel of the pattern becomes a 12 x 4 x 12 box, with
  // the faces between neighbouring boxes left out. The 768-block pattern repeats,
  // so 3 x 3 copies follow the camera.
  buildFancyClouds(patternCanvas) {
    const N = 64, CELL = 12, H = 4;
    const data = patternCanvas.getContext('2d').getImageData(0, 0, N, N).data;
    const cloud = (x, z) => data[((((z % N) + N) % N) * N + (((x % N) + N) % N)) * 4 + 3] > 127;
    const pos = [], shade = [];
    const quad = (corners, b) => {
      // corners in counter-clockwise order seen from outside
      const [a, b1, c, d] = corners;
      for (const v of [a, b1, c, a, c, d]) { pos.push(...v); shade.push(b); }
    };
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        if (!cloud(x, z)) continue;
        const x0 = x * CELL, x1 = x0 + CELL, z0 = z * CELL, z1 = z0 + CELL;
        quad([[x0, H, z1], [x1, H, z1], [x1, H, z0], [x0, H, z0]], 1.0);           // top
        quad([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], 0.7);           // bottom
        if (!cloud(x + 1, z)) quad([[x1, 0, z1], [x1, 0, z0], [x1, H, z0], [x1, H, z1]], 0.9);
        if (!cloud(x - 1, z)) quad([[x0, 0, z0], [x0, 0, z1], [x0, H, z1], [x0, H, z0]], 0.9);
        if (!cloud(x, z + 1)) quad([[x0, 0, z1], [x1, 0, z1], [x1, H, z1], [x0, H, z1]], 0.8);
        if (!cloud(x, z - 1)) quad([[x1, 0, z0], [x0, 0, z0], [x0, H, z0], [x1, H, z0]], 0.8);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('shade', new THREE.Float32BufferAttribute(shade, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(384, 2, 384), 560);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.cloudUniforms,
      vertexShader: /* glsl */ `
        attribute float shade;
        varying float vShade;
        varying vec3 vWorld;
        void main() {
          vShade = shade;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */ `
        uniform float brightness;
        varying float vShade;
        varying vec3 vWorld;
        void main() {
          float d = length(vWorld.xz - cameraPosition.xz);
          float alpha = 0.8 * (1.0 - smoothstep(200.0, 600.0, d));
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(vec3(brightness * vShade), alpha);
        }`,
      transparent: true,
    });
    this.fancyClouds = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.userData.tile = [(i % 3) - 1, Math.floor(i / 3) - 1];
      this.fancyClouds.add(m);
    }
    this.scene.add(this.fancyClouds);
  }

  setClouds(mode) {
    this.cloudMode = mode;
    if (this.clouds) this.clouds.visible = mode === 'fast';
    if (this.fancyClouds) this.fancyClouds.visible = mode === 'fancy';
  }

  squareTexture(inner, outer) {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = c.getContext('2d');
    ctx.fillStyle = outer; ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = inner; ctx.fillRect(3, 3, 10, 10);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // ---------- overlays ----------
  buildOverlays() {
    this.highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }),
    );
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.006, 1.006, 1.006),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, fog: false }),
    );
    this.crack.visible = false;
    this.scene.add(this.crack);
  }

  setTarget(hit, breakProgress) {
    this.highlight.visible = !!hit;
    if (hit) {
      // the outline hugs the block's shape (slabs, doors...)
      const [x0, y0, z0, x1, y1, z1] = hit.box || [0, 0, 0, 1, 1, 1];
      this.highlight.position.set(hit.x + (x0 + x1) / 2, hit.y + (y0 + y1) / 2, hit.z + (z0 + z1) / 2);
      this.highlight.scale.set(x1 - x0, y1 - y0, z1 - z0);
    }
    const stage = Math.min(9, Math.floor(breakProgress * 10));
    this.crack.visible = !!hit && breakProgress > 0;
    if (this.crack.visible) {
      this.crack.position.copy(this.highlight.position);
      this.crack.scale.copy(this.highlight.scale);
      this.crack.material.map = this.textures.cracks[stage];
      this.crack.material.needsUpdate = true;
    }
  }

  // ---------- per frame ----------
  // time: world ticks; medium: 'water' or 'lava' when the camera is inside one, else null
  // fogTint: [r, g, b] (0-255) of the Nether biome the camera is in
  updateEnvironment(time, medium, sprintFov, fogTint) {
    if (this.dim && this.dim !== 'overworld') return this.otherEnvironment(medium, sprintFov, fogTint);
    if (!this.sun.visible) {
      // back from another dimension
      this.sun.visible = this.moon.visible = this.stars.visible = true;
      this.setClouds(this.cloudMode);
    }
    const underwater = medium === 'water';
    const t = ((time % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
    // rain makes it darker (thunderstorms even more), and lightning lights it up for a moment
    const wet = this.rain ?? 0, storm = this.thunder ?? 0;
    this.flash = Math.max(0, (this.flash ?? 0) - 0.08);
    const day = Math.min(1, daylightAt(t) * (1 - wet * 0.3 - storm * 0.45) + this.flash);
    const skyFactor = 4 / 15 + day * 11 / 15; // night sky light ~4, like Minecraft
    this.uniforms.skyFactor.value = skyFactor;
    this.skyFactor = skyFactor;

    const sky = SKY_NIGHT.clone().lerp(SKY_DAY, day);
    const sunsetAmount = Math.max(0, 1 - Math.abs(t - 12900) / 1300) + Math.max(0, 1 - Math.abs(t - 23100) / 1300);
    sky.lerp(SKY_SUNSET, Math.min(0.55, sunsetAmount * 0.55) * (1 - wet));
    if (wet > 0) { const grey = (sky.r + sky.g + sky.b) / 3 * 0.85; sky.lerp(new THREE.Color(grey, grey, grey * 1.05), wet * 0.8); }
    const fog = medium === 'lava' ? LAVA_FOG : underwater ? WATER_FOG : sky;
    this.scene.background = sky;
    const srgb = {};
    fog.getRGB(srgb, THREE.SRGBColorSpace);
    this.uniforms.fogColor.value.set(srgb.r, srgb.g, srgb.b);
    const far = this.renderDistance * CHUNK;
    // like Java Edition, fog only covers the last stretch before the edge of the world you can see
    // (starting it earlier washed nearby trees out to a pale blue at low render distances)
    this.uniforms.fogNear.value = medium === 'lava' ? 0 : underwater ? 2 : terrainFogNear(far);
    this.uniforms.fogFar.value = medium === 'lava' ? 1.5 : underwater ? 18 : far * 0.95;

    // sun travels east to west; t=0 is sunrise
    const angle = (t / DAY_TICKS) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0.15).normalize();
    const cam = this.camera.position;
    this.sun.position.copy(cam).addScaledVector(dir, 300);
    this.moon.position.copy(cam).addScaledVector(dir, -300);
    this.sun.lookAt(cam);
    this.moon.lookAt(cam);
    this.stars.position.copy(cam);
    this.stars.rotation.z = angle;
    this.stars.material.opacity = Math.max(0, 1 - day * 1.5) * (1 - wet);
    this.sun.material.opacity = this.moon.material.opacity = 1 - wet;
    this.sun.material.transparent = this.moon.material.transparent = true;
    const drift = performance.now() / 1000 * 0.6; // blocks; clouds drift slowly west to east
    this.clouds.position.set(cam.x, this.cloudY, cam.z);
    this.cloudUniforms.offset.value.set(drift / 768, 0);
    if (this.fancyClouds?.visible) {
      const baseX = Math.floor((cam.x - drift) / 768) * 768 + drift;
      const baseZ = Math.floor(cam.z / 768) * 768;
      for (const m of this.fancyClouds.children) {
        m.position.set(baseX + m.userData.tile[0] * 768, this.cloudY, baseZ + m.userData.tile[1] * 768);
      }
    }
    this.cloudUniforms.brightness.value = 0.25 + day * 0.75;

    this.updateFov(sprintFov);
    this.applyEffects();
    return day;
  }

  // Night vision lights everything up; blindness closes the fog in.
  applyEffects() {
    const base = AMBIENT[this.dim] ?? AMBIENT.overworld;
    const amb = this.nightVision ? 0.9 : base;
    if (this.uniforms.ambient.value !== amb) this.uniforms.ambient.value = lighting.ambient = amb;
    if (this.blind) {
      this.uniforms.fogNear.value = 1;
      this.uniforms.fogFar.value = 6;
      this.uniforms.fogColor.value.set(0, 0, 0);
      this.scene.background = BLACK;
    }
  }

  updateFov(sprintFov) {
    const fov = (this.fov + (sprintFov ? 8 : 0)) * (this.zoom ?? 1); // drawing a bow zooms in
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * 0.2;
      this.camera.updateProjectionMatrix();
    }
  }

  // The Nether: no sky, thick fog coloured by the biome. The End: a dark purple void.
  otherEnvironment(medium, sprintFov, fogTint) {
    for (const o of [this.sun, this.moon, this.stars, this.clouds, this.fancyClouds]) if (o) o.visible = false;
    this.uniforms.skyFactor.value = 0;
    this.skyFactor = 0;
    const nether = this.dim === 'nether';
    let target = END_SKY;
    if (nether) {
      const [r, g, b] = fogTint || [0x33, 0x08, 0x08];
      target = new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    }
    // biome fog blends over a couple of seconds as you walk between biomes
    this.dimFog = this.dimFog ? this.dimFog.lerp(target, 0.03) : target.clone();
    const fog = medium === 'lava' ? LAVA_FOG : medium === 'water' ? WATER_FOG : this.dimFog;
    this.scene.background = this.dimFog;
    const srgb = {};
    fog.getRGB(srgb, THREE.SRGBColorSpace);
    this.uniforms.fogColor.value.set(srgb.r, srgb.g, srgb.b);
    const far = this.renderDistance * CHUNK;
    // like Minecraft, the Nether's fog starts almost at your feet and ends halfway to the view distance
    this.uniforms.fogNear.value = medium === 'lava' ? 0 : medium === 'water' ? 2 : nether ? far * 0.05 : terrainFogNear(far);
    this.uniforms.fogFar.value = medium === 'lava' ? 1.5 : medium === 'water' ? 18 : nether ? Math.min(far, 192) * 0.5 : far * 0.95;
    this.updateFov(sprintFov);
    this.applyEffects();
    return 0;
  }

  render(extraScene, extraCamera) {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (extraScene) {
      this.renderer.clearDepth();
      this.renderer.render(extraScene, extraCamera);
    }
  }
}
