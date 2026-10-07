// Procedurally drawn 16x16 pixel-art textures packed into one atlas.

import * as THREE from 'three';
import { mulberry32 } from './noise.js';

const S = 16; // tile size in pixels

const TILE_NAMES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'sand', 'log_side', 'log_top', 'leaves',
  'planks', 'cobble', 'glass', 'bedrock', 'brick', 'snow', 'snow_side',
];

function shade([r, g, b], f) {
  return [r * f, g * f, b * f];
}

function css([r, g, b], a = 1) {
  return `rgba(${Math.round(Math.min(255, r))},${Math.round(Math.min(255, g))},${Math.round(Math.min(255, b))},${a})`;
}

// Draws one tile at (ox, 0) on the atlas context.
function drawTile(ctx, name, ox, rand) {
  const px = (x, y, color, a = 1) => {
    ctx.fillStyle = css(color, a);
    ctx.fillRect(ox + x, y, 1, 1);
  };
  const noisy = (base, amount) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px(x, y, shade(base, 1 - amount + rand() * amount * 2));
  };

  const DIRT = [134, 96, 67];
  const GRASS = [106, 170, 64];
  const STONE = [125, 125, 125];
  const SNOW = [240, 246, 250];

  switch (name) {
    case 'grass_top':
      noisy(GRASS, 0.14);
      break;
    case 'dirt':
      noisy(DIRT, 0.12);
      for (let i = 0; i < 10; i++) px(Math.floor(rand() * S), Math.floor(rand() * S), shade(DIRT, 0.7));
      break;
    case 'grass_side':
    case 'snow_side': {
      drawTile(ctx, 'dirt', ox, rand);
      const top = name === 'grass_side' ? GRASS : SNOW;
      for (let x = 0; x < S; x++) {
        const depth = 3 + Math.floor(rand() * 3);
        for (let y = 0; y < depth; y++) px(x, y, shade(top, 0.88 + rand() * 0.24));
      }
      break;
    }
    case 'stone':
      noisy(STONE, 0.1);
      for (let i = 0; i < 6; i++) {
        const x = Math.floor(rand() * (S - 3));
        const y = Math.floor(rand() * S);
        const len = 2 + Math.floor(rand() * 3);
        for (let k = 0; k < len; k++) px(x + k, y, shade(STONE, 0.75));
      }
      break;
    case 'sand':
      noisy([219, 207, 163], 0.07);
      break;
    case 'snow':
      noisy(SNOW, 0.04);
      break;
    case 'log_side': {
      const BARK = [102, 81, 51];
      for (let x = 0; x < S; x++) {
        const stripe = 0.8 + rand() * 0.35;
        for (let y = 0; y < S; y++) px(x, y, shade(BARK, stripe * (0.92 + rand() * 0.16)));
      }
      break;
    }
    case 'log_top': {
      const WOOD = [176, 142, 86];
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
          if (d > 6.5) px(x, y, shade([102, 81, 51], 0.9 + rand() * 0.2));
          else px(x, y, shade(WOOD, (Math.floor(d) % 2 ? 0.85 : 1) * (0.95 + rand() * 0.1)));
        }
      }
      break;
    }
    case 'leaves':
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (rand() < 0.18) continue; // see-through gaps
          px(x, y, shade([58, 125, 40], 0.75 + rand() * 0.45));
        }
      }
      break;
    case 'planks': {
      const WOOD = [162, 130, 78];
      for (let y = 0; y < S; y++) {
        const row = Math.floor(y / 4);
        const seam = (row % 2 ? 4 : 11);
        for (let x = 0; x < S; x++) {
          let f = 0.92 + rand() * 0.12;
          if (y % 4 === 3 || x === seam) f = 0.68;
          px(x, y, shade(WOOD, f));
        }
      }
      break;
    }
    case 'cobble': {
      noisy([110, 110, 110], 0.06);
      // irregular stones separated by dark mortar
      const stones = [[0, 0, 6, 5], [6, 0, 5, 4], [11, 0, 5, 6], [0, 5, 4, 6], [4, 4, 7, 6],
        [11, 6, 5, 5], [0, 11, 7, 5], [7, 10, 5, 6], [12, 11, 4, 5]];
      for (const [sx, sy, w, h] of stones) {
        const f = 0.95 + rand() * 0.3;
        for (let y = sy + 1; y < sy + h - 1; y++) {
          for (let x = sx + 1; x < sx + w - 1; x++) px(x, y, shade([135, 135, 135], f * (0.93 + rand() * 0.14)));
        }
      }
      break;
    }
    case 'glass':
      // fully transparent centre (alpha 0) so alphaTest keeps it see-through
      for (let i = 0; i < S; i++) {
        px(i, 0, [220, 240, 245]); px(i, S - 1, [170, 200, 210]);
        px(0, i, [220, 240, 245]); px(S - 1, i, [170, 200, 210]);
      }
      for (let i = 0; i < 4; i++) px(3 + i, 6 - i, [235, 250, 255]);
      px(10, 11, [235, 250, 255]); px(11, 10, [235, 250, 255]);
      break;
    case 'bedrock':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px(x, y, shade([85, 85, 85], 0.4 + rand() * 0.8));
      break;
    case 'brick': {
      const MORTAR = [190, 180, 170];
      for (let y = 0; y < S; y++) {
        const row = Math.floor(y / 4);
        const offset = row % 2 ? 4 : 0;
        for (let x = 0; x < S; x++) {
          if (y % 4 === 3 || (x + offset) % 8 === 7) px(x, y, shade(MORTAR, 0.9 + rand() * 0.1));
          else px(x, y, shade([150, 70, 55], 0.88 + rand() * 0.2));
        }
      }
      break;
    }
    default:
      ctx.fillStyle = '#f0f';
      ctx.fillRect(ox, 0, S, S);
  }
}

export function createAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = S * TILE_NAMES.length;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(1337);
  TILE_NAMES.forEach((name, i) => drawTile(ctx, name, i * S, rand));

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;

  const n = TILE_NAMES.length;
  const inset = 0.01 / n; // tiny inset avoids sampling the neighbouring tile
  const uvs = {};
  TILE_NAMES.forEach((name, i) => {
    uvs[name] = [i / n + inset, 0, (i + 1) / n - inset, 1];
  });

  return {
    canvas,
    texture,
    uv: (name) => uvs[name],
    tileIndex: (name) => TILE_NAMES.indexOf(name),
    tileSize: S,
  };
}
