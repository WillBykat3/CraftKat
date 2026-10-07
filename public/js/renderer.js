// Scene setup: chunk meshes (built by the worker), lighting shader, sky,
// sun/moon, stars, clouds, block highlight and breaking cracks.

import * as THREE from 'three';
import { CHUNK, HEIGHT } from './blocks.js';
import { chunkKey } from './world.js';
import { DAY_TICKS, daylight as daylightAt } from './host.js';
import { mulberry32 } from './noise.js';

const CHUNK_VERTEX = /* glsl */ `
attribute float shade;
attribute vec2 light;
varying vec2 vUv;
varying float vShade;
varying vec2 vLight;
varying float vDist;
void main() {
  vUv = uv;
  vShade = shade;
  vLight = light;
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
varying vec2 vUv;
varying float vShade;
varying vec2 vLight;
varying float vDist;
float curve(float l) {
  // Minecraft's light table: steep falloff so caves get properly dark,
  // lifted by the brightness setting (0 = moody, 1 = bright)
  float f = 1.0 - l;
  float b = (1.0 - f) / (f * 3.0 + 1.0);
  return mix(b, sqrt(b), brightness);
}
void main() {
  vec4 tex = texture2D(map, vUv);
  if (tex.a < 0.5) discard;
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
export const lighting = { brightness: 0.5 };
export function lightCurve(level) {
  const f = 1 - level;
  const b = (1 - f) / (f * 3 + 1);
  return Math.max(0.035, b + (Math.sqrt(b) - b) * lighting.brightness);
}
export const toLinear = (v) => Math.pow(v, 2.2);

const SKY_DAY = new THREE.Color(0x87b8ff);
const SKY_NIGHT = new THREE.Color(0x05070f);
const SKY_SUNSET = new THREE.Color(0xe8865a);
const WATER_FOG = new THREE.Color(0x163a7a);

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
  startWorld(seed, edits) {
    this.clearChunks();
    if (this.worker) this.worker.terminate();
    this.worker = new Worker(new URL('./mesh-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.onMesh(e.data);
    this.worker.onerror = (e) => console.error('mesh worker error', e.message || e);
    this.worker.postMessage({ t: 'init', seed, edits });
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
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    geo.setAttribute('shade', new THREE.BufferAttribute(data.shade, 1));
    geo.setAttribute('light', new THREE.BufferAttribute(data.light, 2));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(CHUNK / 2, HEIGHT / 2, CHUNK / 2), Math.hypot(CHUNK, HEIGHT, CHUNK) / 2);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(cx * CHUNK, 0, cz * CHUNK);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    return mesh;
  }

  onMesh({ cx, cz, version, solid, water }) {
    const key = chunkKey(cx, cz);
    if (version !== this.versions.get(key)) return; // a newer version is on its way
    this.pending.delete(key);
    if (!this.wanted(cx, cz)) return;
    this.disposeChunk(key);
    this.meshes.set(key, {
      solid: this.makeMesh(solid, this.solidMaterial, cx, cz),
      water: this.makeMesh(water, this.waterMaterial, cx, cz),
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
    if (hit) this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    const stage = Math.min(9, Math.floor(breakProgress * 10));
    this.crack.visible = !!hit && breakProgress > 0;
    if (this.crack.visible) {
      this.crack.position.copy(this.highlight.position);
      this.crack.material.map = this.textures.cracks[stage];
      this.crack.material.needsUpdate = true;
    }
  }

  // ---------- per frame ----------
  // time: world ticks; underwater: camera is in water
  updateEnvironment(time, underwater, sprintFov) {
    const t = ((time % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
    const day = daylightAt(t);
    const skyFactor = 4 / 15 + day * 11 / 15; // night sky light ~4, like Minecraft
    this.uniforms.skyFactor.value = skyFactor;
    this.skyFactor = skyFactor;

    const sky = SKY_NIGHT.clone().lerp(SKY_DAY, day);
    const sunsetAmount = Math.max(0, 1 - Math.abs(t - 12900) / 1300) + Math.max(0, 1 - Math.abs(t - 23100) / 1300);
    sky.lerp(SKY_SUNSET, Math.min(0.55, sunsetAmount * 0.55));
    const fog = underwater ? WATER_FOG : sky;
    this.scene.background = sky;
    const srgb = {};
    fog.getRGB(srgb, THREE.SRGBColorSpace);
    this.uniforms.fogColor.value.set(srgb.r, srgb.g, srgb.b);
    const far = this.renderDistance * CHUNK;
    this.uniforms.fogNear.value = underwater ? 2 : far * 0.6;
    this.uniforms.fogFar.value = underwater ? 18 : far * 0.95;

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
    this.stars.material.opacity = Math.max(0, 1 - day * 1.5);
    this.clouds.position.set(cam.x, HEIGHT + 30, cam.z);
    this.cloudUniforms.offset.value.set(performance.now() / 768000, 0); // slow drift
    this.cloudUniforms.brightness.value = 0.25 + day * 0.75;

    const fov = this.fov + (sprintFov ? 8 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * 0.2;
      this.camera.updateProjectionMatrix();
    }
    return day;
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
