// All artwork is drawn here with code: block textures (packed into one atlas),
// item icons, inventory block icons and block-breaking cracks.

import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { TILE as S, ATLAS_TILES, TILE_NAMES, tileIndex, uvOf } from './atlas-layout.js';
import { COLORS, DYE_RGB, TERRACOTTA_RGB, PLAIN_TERRACOTTA_RGB } from './colors.js';
import { FACES } from './mesher.js';
import { BLOCKS, ITEMS, ITEM, isBlockId } from './blocks.js';
import { potionColor } from './effects.js';
import { DEFAULT_GRASS, DEFAULT_FOLIAGE, BIOMES, BIOME } from './biomes.js';
import { shapeBoxes } from './shapes.js';

// A 3D model of a block for your hand and for dropped items: its boxes, centred,
// with each face's texture cropped like in the world.
export function blockGeometry(id, size) {
  const b = BLOCKS[id];
  const pos = [], uv = [], idx = [];
  for (const box of iconBoxes(id)) {
    FACES.forEach((face, f) => {
      const n = face.dir.findIndex((d) => d !== 0);
      const others = [0, 1, 2].filter((a) => a !== n);
      const axis = (k) => {
        for (const a of others) {
          if (face.corners.every((c) => c[a] === c[k])) return [a, 1];
          if (face.corners.every((c) => c[a] === 1 - c[k])) return [a, -1];
        }
        return [others[0], 1];
      };
      const [ua, us] = axis(3), [va, vs] = axis(4);
      const t = box[6];
      const [u0, v0, u1, v1] = uvOf(t === undefined ? b.tex[face.slot] : Array.isArray(t) ? t[f] : t);
      const base = pos.length / 3;
      for (const c of face.corners) {
        const p = [c[0] ? box[3] : box[0], c[1] ? box[4] : box[1], c[2] ? box[5] : box[2]];
        pos.push((p[0] - 0.5) * size, (p[1] - 0.5) * size, (p[2] - 0.5) * size);
        const uf = us > 0 ? p[ua] : 1 - p[ua], vf = vs > 0 ? p[va] : 1 - p[va];
        uv.push(u0 + (u1 - u0) * uf, v0 + (v1 - v0) * vf);
      }
      idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

// Whether a block is held/dropped as a 3D model (otherwise as a flat picture).
export function hasBlockModel(id) {
  const b = BLOCKS[id];
  return !!b && (b.render === 'cube' || (b.render === 'shape' && b.shape !== 'ladder' && b.shape !== 'door' && b.shape !== 'head'));
}

// Boxes shown for a block in icons and in your hand (fences show rails on both sides).
export function iconBoxes(id) {
  const b = BLOCKS[id];
  if (!b.shape) return [[0, 0, 0, 1, 1, 1]];
  if (b.shape === 'fence') return shapeBoxes(id, (dx) => (dx !== 0 ? id : 0));
  const boxes = shapeBoxes(id, () => 0);
  if (b.shape === 'lever' || b.shape === 'button') {
    // small things are drawn bigger in icons so you can see them
    const k = b.shape === 'button' ? 2.2 : 1.6;
    return boxes.map(([x0, y0, z0, x1, y1, z1, t]) => {
      const out = [0.5 + (x0 - 0.5) * k, y0 * k, 0.5 + (z0 - 0.5) * k, 0.5 + (x1 - 0.5) * k, y1 * k, 0.5 + (z1 - 0.5) * k];
      if (t !== undefined) out.push(t);
      return out;
    });
  }
  return boxes;
}

// Which biome colour a tile's marked pixels take on icons and held blocks.
function tileTint(name) {
  if (name === 'water') return BIOMES[BIOME.PLAINS].water;
  if (/^(grass_top|grass_side|tall_grass|fern)$/.test(name)) return DEFAULT_GRASS;
  if (/^(leaves|acacia_leaves|dark_oak_leaves|jungle_leaves)$/.test(name)) return DEFAULT_FOLIAGE;
  return null;
}

function css([r, g, b], a = 1) {
  return `rgba(${Math.round(Math.max(0, Math.min(255, r)))},${Math.round(Math.max(0, Math.min(255, g)))},${Math.round(Math.max(0, Math.min(255, b)))},${a})`;
}
const shade = ([r, g, b], f) => [r * f, g * f, b * f];

// A tiny pixel painter for one 16x16 tile at (ox, oy).
function painter(ctx, ox, oy, rand) {
  const px = (x, y, color, a = 1) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    ctx.clearRect(ox + x, oy + y, 1, 1); // replace the pixel (alpha would otherwise blend)
    ctx.fillStyle = css(color, a);
    ctx.fillRect(ox + x, oy + y, 1, 1);
  };
  return {
    px,
    rand,
    // a grey pixel that the chunk shader colours with the biome (alpha TINT_ALPHA marks it)
    tinted(x, y, grey) {
      px(x, y, [grey, grey, grey], TINT_ALPHA / 255);
    },
    noisy(base, amount) {
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px(x, y, shade(base, 1 - amount + rand() * amount * 2));
    },
    specks(color, count, size = 1) {
      for (let i = 0; i < count; i++) {
        const x = Math.floor(rand() * S), y = Math.floor(rand() * S);
        for (let k = 0; k < size; k++) px(x + (k % 2), y + Math.floor(k / 2), shade(color, 0.85 + rand() * 0.3));
      }
    },
    // ore: clusters of coloured pixels on stone
    ore(color) {
      for (let i = 0; i < 6; i++) {
        const cx = 2 + Math.floor(rand() * 12), cy = 2 + Math.floor(rand() * 12);
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]]) {
          if (rand() < 0.75) px(cx + dx, cy + dy, shade(color, 0.8 + rand() * 0.4));
        }
      }
    },
    // draws a 16-line string pattern; palette maps characters to colors
    pattern(rows, palette) {
      rows.forEach((row, y) => {
        for (let x = 0; x < Math.min(S, row.length); x++) {
          const c = palette[row[x]];
          if (c) px(x, y, typeof c === 'function' ? c() : c);
        }
      });
    },
  };
}

// Pixels with this alpha get the biome's grass/foliage/water colour (see renderer.js).
export const TINT_ALPHA = 250;

const C = {
  dirt: [134, 96, 67], grass: [102, 168, 60], stone: [125, 125, 125], snow: [240, 246, 250],
  oak: [162, 130, 78], oakBark: [102, 81, 51], birch: [196, 179, 123], birchBark: [216, 215, 210],
  sand: [219, 207, 163], sandstone: [216, 203, 155], water: [52, 95, 218],
};

const WOODS = {
  spruce: { bark: [60, 40, 20], inner: [120, 88, 52], planks: [115, 85, 50] },
  acacia: { bark: [105, 98, 88], inner: [175, 95, 52], planks: [170, 92, 50] },
  dark_oak: { bark: [58, 44, 26], inner: [85, 58, 30], planks: [68, 45, 22] },
  jungle: { bark: [88, 70, 28], inner: [165, 120, 82], planks: [160, 115, 80] },
};

function drawBlockTile(p, name) {
  const { px, rand } = p;
  switch (name) {
    case 'grass_top':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) p.tinted(x, y, 150 + rand() * 50);
      break;
    case 'dirt': p.noisy(C.dirt, 0.12); p.specks(shade(C.dirt, 0.7), 10); break;
    case 'grass_side':
    case 'snow_side': {
      drawBlockTile(p, 'dirt');
      for (let x = 0; x < S; x++) {
        const depth = 3 + Math.floor(rand() * 3);
        for (let y = 0; y < depth; y++) {
          if (name === 'grass_side') p.tinted(x, y, 150 + rand() * 50);
          else px(x, y, shade(C.snow, 0.88 + rand() * 0.24));
        }
      }
      break;
    }
    case 'stone':
      p.noisy(C.stone, 0.1);
      for (let i = 0; i < 6; i++) {
        const x = Math.floor(rand() * 13), y = Math.floor(rand() * S), len = 2 + Math.floor(rand() * 3);
        for (let k = 0; k < len; k++) px(x + k, y, shade(C.stone, 0.75));
      }
      break;
    case 'cobble': {
      p.noisy([95, 95, 95], 0.06);
      const stones = [[0, 0, 6, 5], [6, 0, 5, 4], [11, 0, 5, 6], [0, 5, 4, 6], [4, 4, 7, 6],
        [11, 6, 5, 5], [0, 11, 7, 5], [7, 10, 5, 6], [12, 11, 4, 5]];
      for (const [sx, sy, w, h] of stones) {
        const f = 0.95 + rand() * 0.3;
        for (let y = sy + 1; y < sy + h - 1; y++) for (let x = sx + 1; x < sx + w - 1; x++) px(x, y, shade([135, 135, 135], f * (0.93 + rand() * 0.14)));
      }
      break;
    }
    case 'sand': p.noisy(C.sand, 0.07); break;
    case 'gravel':
      p.noisy([130, 124, 122], 0.12);
      for (let i = 0; i < 14; i++) {
        const x = Math.floor(rand() * 15), y = Math.floor(rand() * 15), c = rand() < 0.5 ? [90, 85, 85] : [165, 160, 158];
        px(x, y, c); px(x + 1, y, c); px(x, y + 1, shade(c, 0.85));
      }
      break;
    case 'snow': p.noisy(C.snow, 0.04); break;
    case 'log_side':
    case 'birch_log_side': {
      const birch = name === 'birch_log_side';
      const bark = birch ? C.birchBark : C.oakBark;
      for (let x = 0; x < S; x++) {
        const stripe = 0.85 + rand() * 0.3;
        for (let y = 0; y < S; y++) px(x, y, shade(bark, stripe * (0.94 + rand() * 0.12)));
      }
      if (birch) {
        for (let i = 0; i < 9; i++) {
          const x = Math.floor(rand() * 14), y = Math.floor(rand() * S), len = 1 + Math.floor(rand() * 3);
          for (let k = 0; k < len; k++) px(x + k, y, [45, 45, 40]);
        }
      }
      break;
    }
    case 'log_top':
    case 'birch_log_top': {
      const birch = name === 'birch_log_top';
      const wood = birch ? [209, 192, 140] : [176, 142, 86];
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        if (d > 6.5) px(x, y, shade(birch ? C.birchBark : C.oakBark, 0.9 + rand() * 0.2));
        else px(x, y, shade(wood, (Math.floor(d) % 2 ? 0.85 : 1) * (0.95 + rand() * 0.1)));
      }
      break;
    }
    case 'leaves': case 'acacia_leaves': case 'dark_oak_leaves': case 'jungle_leaves':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        if (rand() < (name === 'dark_oak_leaves' ? 0.1 : name === 'acacia_leaves' ? 0.24 : 0.18)) continue; // see-through gaps
        p.tinted(x, y, (name === 'jungle_leaves' ? 120 : 105) + rand() * 90);
      }
      break;
    case 'birch_leaves':
    case 'spruce_leaves': {
      const base = name === 'birch_leaves' ? [112, 150, 70] : [80, 120, 80];
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        if (rand() < (name === 'spruce_leaves' ? 0.14 : 0.18)) continue;
        px(x, y, shade(base, 0.72 + rand() * 0.5));
      }
      break;
    }
    case 'planks':
    case 'birch_planks': {
      const wood = name === 'planks' ? C.oak : C.birch;
      for (let y = 0; y < S; y++) {
        const seam = Math.floor(y / 4) % 2 ? 4 : 11;
        for (let x = 0; x < S; x++) {
          let f = 0.92 + rand() * 0.12;
          if (y % 4 === 3 || x === seam) f = 0.68;
          px(x, y, shade(wood, f));
        }
      }
      break;
    }
    case 'glass':
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
    case 'brick':
      for (let y = 0; y < S; y++) {
        const offset = Math.floor(y / 4) % 2 ? 4 : 0;
        for (let x = 0; x < S; x++) {
          if (y % 4 === 3 || (x + offset) % 8 === 7) px(x, y, shade([190, 180, 170], 0.9 + rand() * 0.1));
          else px(x, y, shade([150, 70, 55], 0.88 + rand() * 0.2));
        }
      }
      break;
    case 'stone_bricks':
      for (let y = 0; y < S; y++) {
        const offset = Math.floor(y / 8) % 2 ? 8 : 0;
        for (let x = 0; x < S; x++) {
          const edge = y % 8 === 7 || (x + offset) % 16 === 15;
          px(x, y, edge ? [80, 80, 80] : shade([122, 122, 122], 0.9 + rand() * 0.15));
        }
      }
      break;
    case 'mossy_stone_bricks':
      drawBlockTile(p, 'stone_bricks');
      for (let i = 0; i < 70; i++) {
        const x = Math.floor(rand() * S), y = Math.floor(rand() * S);
        if ((x + y * 3) % 5 < 3) px(x, y, shade([84, 110, 52], 0.8 + rand() * 0.35));
      }
      break;
    case 'cracked_stone_bricks':
      drawBlockTile(p, 'stone_bricks');
      for (const [x0, y0, len] of [[3, 1, 6], [11, 9, 5], [6, 10, 4]]) {
        let x = x0, y = y0;
        for (let i = 0; i < len; i++) { px(x, y, [70, 70, 70]); x += rand() < 0.5 ? 1 : 0; y += 1; }
      }
      break;
    case 'coal_ore': drawBlockTile(p, 'stone'); p.ore([30, 30, 30]); break;
    case 'iron_ore': drawBlockTile(p, 'stone'); p.ore([216, 175, 147]); break;
    case 'gold_ore': drawBlockTile(p, 'stone'); p.ore([250, 220, 60]); break;
    case 'diamond_ore': drawBlockTile(p, 'stone'); p.ore([95, 230, 225]); break;
    case 'water':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const wave = Math.sin((x + y * 0.5) * 0.8) * 0.05;
        p.tinted(x, y, 255 * (0.84 + wave + rand() * 0.08));
      }
      break;
    case 'table_top':
      drawBlockTile(p, 'planks');
      for (let i = 0; i < S; i++) { px(i, 0, [90, 60, 30]); px(i, 15, [90, 60, 30]); px(0, i, [90, 60, 30]); px(15, i, [90, 60, 30]); }
      for (let i = 3; i < 13; i++) { px(i, 7, [110, 75, 40]); px(7, i, [110, 75, 40]); }
      break;
    case 'table_side':
    case 'table_front':
      drawBlockTile(p, 'planks');
      for (let x = 0; x < S; x++) for (let y = 0; y < 3; y++) px(x, y, shade([120, 85, 45], 0.9 + rand() * 0.2));
      if (name === 'table_front') {
        // a saw and a hammer hanging on the front
        for (let y = 5; y < 13; y++) px(4, y, [140, 140, 140]);
        for (let y = 5; y < 10; y++) px(5, y, [170, 170, 170]);
        for (let y = 6; y < 14; y++) px(11, y, [90, 60, 30]);
        for (let x = 9; x < 14; x++) px(x, 5, [110, 110, 110]);
      } else {
        for (let y = 5; y < 14; y++) { px(3, y, [90, 60, 30]); px(12, y, [90, 60, 30]); }
      }
      break;
    case 'furnace_top':
    case 'furnace_side':
      p.noisy([118, 118, 118], 0.1);
      for (let i = 0; i < S; i++) { px(i, 0, [80, 80, 80]); px(i, 15, [80, 80, 80]); px(0, i, [80, 80, 80]); px(15, i, [80, 80, 80]); }
      break;
    case 'furnace_front':
      drawBlockTile(p, 'furnace_side');
      for (let y = 8; y < 13; y++) for (let x = 4; x < 12; x++) px(x, y, [30, 30, 30]);
      for (let x = 3; x < 13; x++) { px(x, 7, [70, 70, 70]); px(x, 13, [70, 70, 70]); }
      for (let x = 4; x < 12; x++) px(x, 4, [60, 60, 60]);
      break;
    // ---- villages ----
    case 'dirt_path_top': p.noisy([150, 122, 70], 0.1); p.specks([120, 95, 55], 14); break;
    case 'dirt_path_side':
      drawBlockTile(p, 'dirt');
      for (let x = 0; x < S; x++) { px(x, 0, [0, 0, 0], 0); px(x, 1, shade([150, 122, 70], 0.9 + rand() * 0.2)); px(x, 2, shade([140, 112, 62], 0.9 + rand() * 0.2)); }
      break;
    case 'hay_top':
      p.noisy([190, 160, 40], 0.12);
      for (let i = 0; i < S; i++) { px(i, 0, [120, 70, 30]); px(i, 15, [120, 70, 30]); px(0, i, [120, 70, 30]); px(15, i, [120, 70, 30]); }
      break;
    case 'hay_side':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px(x, y, shade([195, 165, 45], (x % 3 ? 0.95 : 0.8) + rand() * 0.15));
      for (const y of [3, 12]) for (let x = 0; x < S; x++) px(x, y, [130, 75, 30]);
      break;
    case 'bookshelf': {
      drawBlockTile(p, 'planks');
      const colors = [[150, 40, 40], [40, 70, 150], [50, 120, 50], [130, 100, 40], [110, 50, 120], [180, 160, 120]];
      for (const y0 of [1, 9]) {
        for (let x = 1; x < 15;) {
          const w = 1 + Math.floor(rand() * 2), h = 5 + Math.floor(rand() * 2), c = colors[Math.floor(rand() * colors.length)];
          for (let dx = 0; dx < w && x + dx < 15; dx++) for (let y = y0 + 6 - h; y < y0 + 6; y++) px(x + dx, y, shade(c, dx ? 0.8 : 1));
          x += w;
        }
      }
      break;
    }
    case 'composter_top':
      drawBlockTile(p, 'planks');
      for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) px(x, y, shade([90, 70, 40], 0.8 + rand() * 0.3));
      break;
    case 'composter_side':
      drawBlockTile(p, 'planks');
      for (let y = 0; y < S; y++) { px(0, y, [100, 70, 35]); px(15, y, [100, 70, 35]); }
      for (let x = 0; x < S; x++) for (const y of [0, 7, 15]) px(x, y, [100, 70, 35]);
      break;
    case 'lectern_top':
      drawBlockTile(p, 'planks');
      for (let y = 3; y < 13; y++) for (let x = 2; x < 14; x++) px(x, y, x === 7 || x === 8 ? [180, 170, 150] : [235, 225, 200]);
      for (let y = 5; y < 12; y += 2) for (let x = 3; x < 13; x++) if (x !== 7 && x !== 8 && rand() < 0.7) px(x, y, [90, 80, 70]);
      break;
    case 'lectern_side':
      drawBlockTile(p, 'planks');
      for (let y = 4; y < S; y++) for (let x = 5; x < 11; x++) px(x, y, shade([150, 110, 60], 0.85 + rand() * 0.2));
      break;
    case 'blast_furnace_top': p.noisy([110, 110, 112], 0.08); for (let i = 3; i < 13; i++) { px(i, 3, [70, 70, 70]); px(i, 12, [70, 70, 70]); } break;
    case 'blast_furnace_side':
      p.noisy([120, 120, 122], 0.08);
      for (let i = 0; i < S; i++) { px(i, 0, [80, 80, 82]); px(i, 15, [80, 80, 82]); px(i, 5, [150, 150, 155]); px(i, 10, [150, 150, 155]); }
      break;
    case 'blast_furnace_front':
      drawBlockTile(p, 'blast_furnace_side');
      for (let y = 7; y < 13; y++) for (let x = 4; x < 12; x++) px(x, y, (x + y) % 2 ? [40, 40, 42] : [70, 70, 75]);
      break;
    case 'smoker_top': p.noisy([90, 80, 70], 0.1); for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) px(x, y, [40, 35, 30]); break;
    case 'smoker_side':
      drawBlockTile(p, 'furnace_side');
      for (let x = 0; x < S; x++) for (const y of [0, 1, 14, 15]) px(x, y, shade([110, 80, 50], 0.85 + rand() * 0.2));
      break;
    case 'smoker_front':
      drawBlockTile(p, 'smoker_side');
      for (let y = 7; y < 13; y++) for (let x = 4; x < 12; x++) px(x, y, [30, 30, 30]);
      for (let x = 3; x < 13; x++) px(x, 6, [110, 80, 50]);
      break;
    case 'smithing_table_top':
      p.noisy([60, 60, 70], 0.1);
      for (let i = 0; i < S; i++) { px(i, 0, [110, 80, 50]); px(i, 15, [110, 80, 50]); px(0, i, [110, 80, 50]); px(15, i, [110, 80, 50]); }
      break;
    case 'smithing_table_side':
      drawBlockTile(p, 'planks');
      for (let x = 0; x < S; x++) for (const y of [0, 1, 2]) px(x, y, shade([60, 60, 70], 0.9 + rand() * 0.2));
      for (let y = 6; y < 11; y++) for (let x = 5; x < 11; x++) px(x, y, [70, 70, 80]);
      break;
    case 'grindstone': p.noisy([140, 140, 140], 0.1); for (let i = 0; i < S; i += 3) for (let x = 0; x < S; x++) px(x, i, [115, 115, 115]); break;
    case 'grindstone_side':
      p.noisy([140, 140, 140], 0.08);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (Math.hypot(x - 7.5, y - 7.5) < 3) px(x, y, [100, 100, 100]);
      break;
    case 'fletching_table_top':
      drawBlockTile(p, 'birch_planks');
      for (let i = 2; i < 14; i++) px(i, i, [120, 90, 60]);
      px(12, 12, [230, 230, 230]); px(13, 13, [230, 230, 230]); px(3, 3, [100, 100, 100]);
      break;
    case 'fletching_table_side':
      drawBlockTile(p, 'birch_planks');
      for (let y = 6; y < 10; y++) for (let x = 3; x < 13; x++) px(x, y, [170, 150, 110]);
      break;
    case 'loom_top':
      drawBlockTile(p, 'planks');
      for (let x = 2; x < 14; x += 2) for (let y = 1; y < 15; y++) px(x, y, [230, 230, 230]);
      break;
    case 'loom_side':
      drawBlockTile(p, 'planks');
      for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) px(x, y, (x + y) % 2 ? [200, 60, 60] : [230, 220, 200]);
      break;
    case 'cartography_table_top':
      drawBlockTile(p, 'dark_oak_planks');
      for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) px(x, y, shade([220, 205, 160], 0.92 + rand() * 0.1));
      for (let i = 0; i < 9; i++) px(4 + i, 5 + Math.round(Math.sin(i) * 2), [80, 120, 200]);
      break;
    case 'cartography_table_side':
      drawBlockTile(p, 'dark_oak_planks');
      for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) px(x, y, [220, 205, 160]);
      break;
    case 'stonecutter_top':
      drawBlockTile(p, 'stone');
      for (let x = 2; x < 14; x++) { px(x, 7, [180, 180, 190]); px(x, 8, [150, 150, 160]); }
      break;
    case 'stonecutter_side': drawBlockTile(p, 'stone'); for (let x = 0; x < S; x++) px(x, 0, [110, 80, 50]); break;
    case 'cauldron_top':
    case 'cauldron_side':
      p.noisy([60, 60, 64], 0.1);
      for (let i = 0; i < S; i++) { px(i, 0, [85, 85, 90]); px(0, i, [45, 45, 48]); }
      break;
    case 'barrel_top':
      drawBlockTile(p, 'spruce_planks');
      for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) if (Math.hypot(x - 7.5, y - 7.5) < 5.5) px(x, y, shade([110, 75, 40], 0.9 + rand() * 0.15));
      for (let i = 0; i < S; i++) { px(i, 0, [70, 70, 70]); px(i, 15, [70, 70, 70]); px(0, i, [70, 70, 70]); px(15, i, [70, 70, 70]); }
      break;
    case 'barrel_side':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px(x, y, shade([115, 80, 45], (x % 4 === 3 ? 0.7 : 0.92) + rand() * 0.1));
      for (const y of [2, 13]) for (let x = 0; x < S; x++) px(x, y, [75, 75, 78]);
      break;
    case 'bell': p.noisy([240, 200, 60], 0.1); break;
    case 'fire':
      // flickering tongues of flame, transparent between them
      for (let x = 0; x < S; x++) {
        const h = 6 + Math.floor((Math.sin(x * 1.7) + Math.sin(x * 0.6 + 1) + 2) * 2.4 + rand() * 2);
        for (let y = S - h; y < S; y++) {
          const t = (y - (S - h)) / h;
          px(x, y, t < 0.25 ? [255, 230, 120] : t < 0.6 ? [255, 160, 30] : [220, 80, 10]);
        }
      }
      break;
    case 'torch':
      for (let y = 6; y < 16; y++) { px(7, y, [110, 80, 45]); px(8, y, [90, 65, 35]); }
      px(7, 5, [255, 230, 120]); px(8, 5, [255, 200, 60]); px(7, 4, [255, 250, 200]); px(8, 4, [255, 220, 90]);
      px(7, 6, [255, 160, 40]); px(8, 6, [230, 120, 30]);
      break;
    case 'dandelion':
      for (let y = 9; y < 16; y++) px(8, y, [70, 140, 40]);
      px(7, 12, [70, 140, 40]); px(6, 11, [70, 140, 40]); px(9, 13, [70, 140, 40]); px(10, 12, [70, 140, 40]);
      for (const [x, y] of [[7, 6], [8, 6], [9, 6], [7, 7], [8, 7], [9, 7], [8, 5], [7, 8], [8, 8], [9, 8], [6, 7], [10, 7]]) px(x, y, [250, 220, 40]);
      px(8, 7, [230, 160, 20]);
      break;
    case 'poppy':
      for (let y = 9; y < 16; y++) px(8, y, [70, 140, 40]);
      px(9, 12, [70, 140, 40]); px(10, 11, [70, 140, 40]);
      for (const [x, y] of [[7, 5], [8, 5], [9, 5], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [6, 7], [7, 7], [9, 7], [10, 7], [7, 8], [8, 8], [9, 8]]) px(x, y, [200, 30, 30]);
      px(8, 7, [40, 20, 20]);
      break;
    case 'tall_grass':
      for (let i = 0; i < 9; i++) {
        const x = 1 + Math.floor(rand() * 14);
        const h = 5 + Math.floor(rand() * 9);
        for (let y = 15; y > 15 - h; y--) p.tinted(x + (y < 8 && rand() < 0.3 ? 1 : 0), y, 140 + rand() * 70);
      }
      break;
    case 'fern':
      for (const [bx, lean] of [[4, -1], [8, 0], [11, 1]]) {
        for (let y = 15; y > 3; y--) {
          const x = bx + Math.round(lean * (15 - y) / 6);
          p.tinted(x, y, 120 + rand() * 50);
          if (y % 2 === 0 && y < 14) { p.tinted(x - 1, y, 150 + rand() * 60); p.tinted(x + 1, y - 1, 150 + rand() * 60); }
        }
      }
      break;
    case 'dead_bush':
      for (const [x0, dx] of [[8, -1], [8, 1], [7, -0.5], [9, 0.6]]) {
        for (let k = 0; k < 9; k++) px(Math.round(x0 + dx * k * 0.6), 15 - k, shade([140, 95, 40], 0.8 + rand() * 0.3));
      }
      px(4, 8, [120, 80, 35]); px(12, 7, [120, 80, 35]); px(5, 6, [120, 80, 35]); px(11, 9, [120, 80, 35]);
      break;
    case 'sugar_cane':
      for (const x of [3, 8, 12]) {
        for (let y = 0; y < S; y++) {
          const joint = (y + x) % 5 === 0;
          px(x, y, joint ? [120, 160, 70] : shade([170, 215, 105], 0.9 + rand() * 0.15));
          px(x + 1, y, joint ? [100, 140, 60] : shade([140, 190, 85], 0.9 + rand() * 0.15));
        }
        px(x + 2, (x * 3) % 12 + 2, [120, 180, 70]); px(x + 3, (x * 3) % 12 + 1, [120, 180, 70]);
      }
      break;
    case 'cornflower':
      for (let y = 9; y < 16; y++) px(8, y, [70, 140, 40]);
      px(7, 13, [70, 140, 40]); px(9, 11, [70, 140, 40]);
      for (const [x, y] of [[8, 4], [7, 5], [8, 5], [9, 5], [6, 6], [7, 6], [9, 6], [10, 6], [7, 7], [8, 7], [9, 7], [8, 8]]) px(x, y, [80, 120, 235]);
      px(8, 6, [230, 230, 120]);
      break;
    case 'sandstone_top': p.noisy(C.sandstone, 0.05); break;
    case 'sandstone_side':
      p.noisy(C.sandstone, 0.05);
      for (let x = 0; x < S; x++) { px(x, 3, shade(C.sandstone, 0.85)); px(x, 11, shade(C.sandstone, 0.85)); }
      break;
    case 'wool': drawWool(p, DYE_RGB[0]); break;
    case 'obsidian':
      p.noisy([20, 16, 30], 0.3);
      p.specks([70, 50, 110], 12);
      break;
    case 'clay': p.noisy([160, 166, 179], 0.06); break;
    case 'deepslate':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px(x, y, shade([80, 80, 86], (y % 4 === 0 ? 0.8 : 1) * (0.88 + rand() * 0.2)));
      break;
    case 'deepslate_top':
      p.noisy([80, 80, 86], 0.12);
      for (let i = 0; i < 5; i++) { const cx = 2 + Math.floor(rand() * 12), cy = 2 + Math.floor(rand() * 12); px(cx, cy, [60, 60, 66]); px(cx + 1, cy, [60, 60, 66]); }
      break;
    case 'cobbled_deepslate': {
      p.noisy([55, 55, 60], 0.06);
      for (let by = 0; by < 4; by++) for (let bx = 0; bx < 4; bx++) {
        const f = 0.9 + rand() * 0.35;
        for (let y = by * 4 + 1; y < by * 4 + 4; y++) for (let x = bx * 4 + (by % 2) + 1; x < bx * 4 + (by % 2) + 4; x++) px(x % S, y, shade([88, 88, 94], f));
      }
      break;
    }
    case 'deepslate_coal_ore': drawBlockTile(p, 'deepslate'); p.ore([25, 25, 25]); break;
    case 'deepslate_iron_ore': drawBlockTile(p, 'deepslate'); p.ore([216, 175, 147]); break;
    case 'deepslate_gold_ore': drawBlockTile(p, 'deepslate'); p.ore([250, 220, 60]); break;
    case 'deepslate_diamond_ore': drawBlockTile(p, 'deepslate'); p.ore([95, 230, 225]); break;
    case 'copper_ore': drawBlockTile(p, 'stone'); p.ore([224, 128, 80]); p.ore([90, 170, 130]); break;
    case 'deepslate_copper_ore': drawBlockTile(p, 'deepslate'); p.ore([224, 128, 80]); p.ore([90, 170, 130]); break;
    case 'granite': p.noisy([154, 106, 89], 0.12); p.specks([190, 140, 120], 18); p.specks([110, 75, 65], 12); break;
    case 'diorite': p.noisy([200, 200, 200], 0.06); p.specks([120, 120, 120], 22); p.specks([240, 240, 240], 10); break;
    case 'andesite': p.noisy([132, 134, 133], 0.08); p.specks([105, 107, 106], 20); p.specks([160, 162, 161], 12); break;
    case 'cherry_log_side':
      for (let x = 0; x < S; x++) {
        const stripe = 0.85 + rand() * 0.3;
        for (let y = 0; y < S; y++) px(x, y, shade([55, 30, 40], stripe * (0.9 + rand() * 0.2)));
      }
      break;
    case 'cherry_log_top':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        px(x, y, d > 6.5 ? shade([55, 30, 40], 0.9 + rand() * 0.2) : shade([215, 150, 150], (Math.floor(d) % 2 ? 0.88 : 1) * (0.95 + rand() * 0.1)));
      }
      break;
    case 'cherry_leaves':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        if (rand() < 0.16) continue;
        px(x, y, rand() < 0.15 ? [255, 220, 235] : shade([238, 158, 196], 0.8 + rand() * 0.35));
      }
      break;
    case 'cherry_planks':
      for (let y = 0; y < S; y++) {
        const seam = Math.floor(y / 4) % 2 ? 4 : 11;
        for (let x = 0; x < S; x++) px(x, y, shade([226, 178, 172], y % 4 === 3 || x === seam ? 0.72 : 0.93 + rand() * 0.1));
      }
      break;
    case 'chest_top':
    case 'chest_side':
    case 'chest_front': {
      const wood = [160, 105, 45];
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const edge = x === 0 || y === 0 || x === S - 1 || y === S - 1;
        px(x, y, edge ? [70, 45, 20] : shade(wood, (y % 5 === 0 ? 0.8 : 1) * (0.9 + rand() * 0.15)));
      }
      if (name !== 'chest_top') for (let x = 1; x < S - 1; x++) px(x, 6, [70, 45, 20]);
      if (name === 'chest_front') { for (const [x, y] of [[7, 5], [8, 5], [7, 6], [8, 6], [7, 7], [8, 7]]) px(x, y, [200, 200, 200]); px(7, 7, [60, 60, 60]); }
      break;
    }
    case 'bed_top':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        if (y < 5 && x > 1 && x < 14) px(x, y, shade([235, 235, 235], 0.92 + rand() * 0.1)); // pillow
        else px(x, y, shade([175, 35, 35], 0.9 + rand() * 0.15));
      }
      break;
    case 'bed_side':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        if (y < 7) px(x, y, [0, 0, 0], 0); // the top 7 rows are above the bed's 9/16 height
        else if (y < 11) px(x, y, shade([175, 35, 35], 0.85 + rand() * 0.15));
        else px(x, y, (x < 3 || x > 12) ? shade(C.oak, 0.8) : shade(C.oak, 0.95 + rand() * 0.1));
      }
      break;
    case 'iron_block': case 'gold_block': case 'diamond_block': case 'emerald_block': case 'lapis_block': case 'coal_block': {
      const base = { iron_block: [220, 220, 222], gold_block: [245, 205, 60], diamond_block: [100, 225, 215], emerald_block: [60, 200, 100], lapis_block: [40, 70, 180], coal_block: [28, 28, 30] }[name];
      p.noisy(base, 0.06);
      for (let i = 0; i < S; i++) { px(i, 0, shade(base, 1.18)); px(0, i, shade(base, 1.18)); px(i, 15, shade(base, 0.72)); px(15, i, shade(base, 0.72)); }
      if (name === 'diamond_block' || name === 'emerald_block') for (let i = 3; i < 13; i += 4) for (let j = 3; j < 13; j += 4) px(i, j, shade(base, 1.3));
      break;
    }
    case 'brewing_stand_base': p.noisy([110, 110, 110], 0.12); break;
    case 'brewing_stand_rod': p.noisy([150, 110, 50], 0.1); break;
    case 'brewing_stand':
      for (let y = 2; y < 15; y++) px(7, y, [150, 110, 50]), px(8, y, [130, 95, 40]);
      for (const bx of [2, 11]) for (let y = 8; y < 14; y++) for (let x = bx; x < bx + 3; x++) px(x, y, y === 8 ? [200, 200, 210] : [170, 190, 230], 0.85);
      break;
    case 'nether_wart_0': case 'nether_wart_1': case 'nether_wart_2': case 'nether_wart_3': {
      const stage = Number(name.slice(-1));
      for (let i = 0; i < 4 + stage * 2; i++) {
        const x = 2 + Math.floor(rand() * 12), top = 15 - (3 + stage * 3) + Math.floor(rand() * 2);
        for (let y = top; y < 16; y++) px(x, y, y === top ? [200, 40, 50] : shade([140, 25, 35], 0.85 + rand() * 0.3));
      }
      break;
    }
    case 'brown_mushroom':
      for (let y = 9; y < 16; y++) px(7, y, [220, 210, 190]), px(8, y, [200, 190, 170]);
      for (let y = 5; y < 9; y++) for (let x = 4 + (8 - y); x < 12 - (8 - y); x++) px(x, y, shade([150, 110, 80], 0.9 + rand() * 0.15));
      break;
    case 'red_mushroom':
      for (let y = 9; y < 16; y++) px(7, y, [220, 210, 190]), px(8, y, [200, 190, 170]);
      for (let y = 4; y < 9; y++) for (let x = 4 + (8 - y) / 2; x < 12 - (8 - y) / 2; x++) px(Math.floor(x), y, rand() < 0.15 ? [240, 240, 240] : [200, 30, 30]);
      break;
    case 'slime_block':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const inner = x > 2 && x < 13 && y > 2 && y < 13;
        px(x, y, inner ? shade([110, 200, 90], 0.95 + rand() * 0.1) : shade([90, 180, 70], 0.9 + rand() * 0.1), inner ? 0.75 : 0.85);
      }
      break;
    case 'melon_top':
      p.noisy([110, 150, 40], 0.1);
      for (let x = 0; x < S; x++) for (let y = 0; y < S; y++) if (Math.hypot(x - 7.5, y - 7.5) < 2) px(x, y, [90, 120, 30]);
      break;
    case 'melon_side':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px(x, y, shade(x % 4 < 2 ? [120, 165, 40] : [70, 115, 25], 0.9 + rand() * 0.15));
      break;
    case 'enchanting_table_top':
      drawBlockTile(p, 'obsidian');
      for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) px(x, y, shade([150, 30, 30], 0.8 + rand() * 0.25));
      for (let y = 4; y < 12; y++) for (let x = 3; x < 13; x++) px(x, y, x === 7 || x === 8 ? [140, 120, 90] : [235, 225, 200]);
      break;
    case 'enchanting_table_side':
      drawBlockTile(p, 'obsidian');
      for (let x = 0; x < S; x++) for (let y = 0; y < 4; y++) px(x, y, shade([150, 30, 30], 0.8 + rand() * 0.25));
      for (let x = 0; x < S; x++) px(x, 4, [90, 220, 210]);
      break;
    case 'anvil': p.noisy([65, 65, 68], 0.1); break;
    case 'anvil_top': case 'anvil_top_chipped': case 'anvil_top_damaged': {
      p.noisy([70, 70, 74], 0.1);
      for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) px(x, y, shade([95, 95, 100], 0.9 + rand() * 0.15));
      const cracks = name === 'anvil_top' ? 0 : name === 'anvil_top_chipped' ? 2 : 5;
      for (let c = 0; c < cracks; c++) { let x = 3 + Math.floor(rand() * 10), y = 3 + Math.floor(rand() * 3); for (let i = 0; i < 6; i++) { px(x, y, [40, 40, 42]); y++; x += rand() < 0.5 ? 1 : -1; } }
      break;
    }
    case 'copper_block':
      p.noisy([200, 110, 75], 0.08);
      for (let i = 0; i < S; i++) { px(i, 0, [230, 140, 100]); px(0, i, [230, 140, 100]); px(i, 15, [150, 80, 55]); px(15, i, [150, 80, 55]); }
      break;
    case 'spruce_log_side': case 'acacia_log_side': case 'dark_oak_log_side': case 'jungle_log_side': {
      const bark = WOODS[name.replace('_log_side', '')].bark;
      for (let x = 0; x < S; x++) {
        const stripe = 0.82 + rand() * 0.3;
        for (let y = 0; y < S; y++) px(x, y, shade(bark, stripe * (0.92 + rand() * 0.14)));
      }
      if (name === 'jungle_log_side') for (let i = 0; i < 6; i++) { const x = Math.floor(rand() * 15), y = Math.floor(rand() * 15); px(x, y, [120, 110, 50]); px(x + 1, y + 1, [120, 110, 50]); }
      break;
    }
    case 'spruce_log_top': case 'acacia_log_top': case 'dark_oak_log_top': case 'jungle_log_top': {
      const w = WOODS[name.replace('_log_top', '')];
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        px(x, y, d > 6.5 ? shade(w.bark, 0.9 + rand() * 0.2) : shade(w.inner, (Math.floor(d) % 2 ? 0.85 : 1) * (0.95 + rand() * 0.1)));
      }
      break;
    }
    case 'spruce_planks': case 'acacia_planks': case 'dark_oak_planks': case 'jungle_planks': {
      const wood = WOODS[name.replace('_planks', '')].planks;
      for (let y = 0; y < S; y++) {
        const seam = Math.floor(y / 4) % 2 ? 4 : 11;
        for (let x = 0; x < S; x++) px(x, y, shade(wood, y % 4 === 3 || x === seam ? 0.68 : 0.92 + rand() * 0.12));
      }
      break;
    }
    case 'cactus_side':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const edge = x === 0 || x === 15;
        const stripe = x % 4 === 1 ? 0.8 : 1;
        px(x, y, edge ? [40, 75, 20] : shade([85, 135, 40], stripe * (0.9 + rand() * 0.15)));
      }
      for (let i = 0; i < 10; i++) px(1 + Math.floor(rand() * 14), Math.floor(rand() * S), [220, 220, 180]);
      break;
    case 'cactus_top':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        px(x, y, d > 6.5 ? [40, 75, 20] : shade([100, 150, 50], (Math.floor(d) % 3 ? 1 : 0.82) * (0.92 + rand() * 0.12)));
      }
      break;
    case 'ice':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px(x, y, shade([150, 190, 250], 0.92 + rand() * 0.1));
      for (let i = 0; i < 5; i++) { const x = Math.floor(rand() * 12), y = Math.floor(rand() * 12); for (let k = 0; k < 4; k++) px(x + k, y + k, [220, 235, 255]); }
      break;
    case 'lava':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const v = Math.sin(x * 0.9 + Math.sin(y * 0.7) * 2) + Math.sin(y * 0.8 - x * 0.3);
        px(x, y, v > 1.1 ? [255, 210, 70] : v > 0.2 ? shade([240, 120, 20], 0.95 + rand() * 0.1) : shade([200, 70, 10], 0.9 + rand() * 0.15));
      }
      break;
    case 'redstone_ore': drawBlockTile(p, 'stone'); p.ore([230, 20, 20]); break;
    case 'deepslate_redstone_ore': drawBlockTile(p, 'deepslate'); p.ore([230, 20, 20]); break;
    case 'lapis_ore': drawBlockTile(p, 'stone'); p.ore([35, 75, 190]); break;
    case 'deepslate_lapis_ore': drawBlockTile(p, 'deepslate'); p.ore([35, 75, 190]); break;
    case 'emerald_ore': drawBlockTile(p, 'stone'); p.ore([40, 210, 100]); break;
    case 'farmland':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const furrow = y % 4 === 0 || y % 4 === 3;
        px(x, y, shade([92, 60, 38], (furrow ? 0.72 : 1) * (0.88 + rand() * 0.2)));
      }
      for (let x = 0; x < S; x++) { px(x, 0, [70, 46, 28]); px(x, 15, [70, 46, 28]); }
      break;
    case 'smooth_stone':
      p.noisy([160, 160, 160], 0.04);
      for (let i = 0; i < S; i++) { px(i, 0, [120, 120, 120]); px(0, i, [120, 120, 120]); px(i, 15, [120, 120, 120]); px(15, i, [120, 120, 120]); }
      break;
    case 'smooth_stone_slab_side':
      p.noisy([160, 160, 160], 0.04);
      for (let i = 0; i < S; i++) { px(i, 0, [120, 120, 120]); px(i, 7, [120, 120, 120]); px(i, 8, [120, 120, 120]); px(i, 15, [120, 120, 120]); px(0, i, [120, 120, 120]); px(15, i, [120, 120, 120]); }
      break;
    case 'door_top': case 'door_bottom': {
      const top = name === 'door_top';
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const frame = x < 2 || x > 13 || y === (top ? 0 : 15) || (!top && y === 7);
        const window = top && x > 2 && x < 13 && y > 1 && y < 10 && x !== 7 && x !== 8 && y !== 5;
        if (window) continue; // see-through panes
        px(x, y, shade(C.oak, frame ? 0.78 : (x % 4 === 1 ? 0.88 : 1) * (0.9 + rand() * 0.15)));
      }
      if (!top) { px(11, 2, [60, 60, 60]); px(11, 3, [60, 60, 60]); px(12, 2, [90, 90, 90]); }
      break;
    }
    case 'netherrack':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const v = Math.sin(x * 1.3 + y * 0.7) + Math.sin(y * 1.9 - x * 0.4);
        px(x, y, shade([111, 54, 53], (v > 1 ? 1.15 : v < -1 ? 0.75 : 0.95) + rand() * 0.12));
      }
      break;
    case 'nether_quartz_ore':
      drawBlockTile(p, 'netherrack');
      for (let i = 0; i < 7; i++) { const x = 2 + Math.floor(rand() * 12), y = 2 + Math.floor(rand() * 12); px(x, y, [236, 230, 222]); px(x + 1, y, [210, 200, 190]); px(x, y + 1, [250, 248, 244]); }
      break;
    case 'nether_gold_ore': drawBlockTile(p, 'netherrack'); p.ore([250, 205, 60]); break;
    case 'soul_sand':
      p.noisy([84, 64, 51], 0.15);
      for (let i = 0; i < 4; i++) { const x = 2 + Math.floor(rand() * 11), y = 3 + Math.floor(rand() * 10); px(x, y, [45, 32, 25]); px(x + 2, y, [45, 32, 25]); px(x + 1, y + 2, [45, 32, 25]); } // faces
      break;
    case 'glowstone':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const v = rand();
        px(x, y, v < 0.2 ? [140, 100, 50] : v < 0.6 ? [230, 180, 100] : [255, 230, 150]);
      }
      break;
    case 'nether_bricks':
      for (let y = 0; y < S; y++) {
        const offset = Math.floor(y / 4) % 2 ? 4 : 0;
        for (let x = 0; x < S; x++) {
          if (y % 4 === 3 || (x + offset) % 8 === 7) px(x, y, [32, 15, 18]);
          else px(x, y, shade([68, 34, 40], 0.85 + rand() * 0.25));
        }
      }
      break;
    case 'nether_portal':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const v = Math.sin((x + y) * 0.9 + Math.sin(x * 0.5) * 2) + Math.sin(y * 1.1 - x * 0.7);
        px(x, y, v > 0.8 ? [190, 110, 255] : v > -0.4 ? shade([110, 30, 200], 0.9 + rand() * 0.2) : [70, 10, 140]);
      }
      break;
    case 'magma':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const crack = Math.sin(x * 1.1 + Math.sin(y * 0.9) * 2) > 0.85 || Math.sin(y * 1.3 + Math.sin(x) * 2) > 0.9;
        px(x, y, crack ? [255, 150, 40] : shade([90, 35, 20], 0.85 + rand() * 0.3));
      }
      break;
    case 'basalt_side':
      for (let x = 0; x < S; x++) { const f = 0.8 + rand() * 0.3; for (let y = 0; y < S; y++) px(x, y, shade([78, 78, 84], f * (0.92 + rand() * 0.12))); }
      break;
    case 'basalt_top':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        px(x, y, shade([90, 90, 96], (Math.floor(d) % 3 ? 1 : 0.75) * (0.9 + rand() * 0.15)));
      }
      break;
    case 'end_stone':
      p.noisy([220, 222, 160], 0.06);
      for (let i = 0; i < 8; i++) { const x = Math.floor(rand() * 15), y = Math.floor(rand() * 15); px(x, y, [190, 192, 130]); px(x + 1, y, [200, 202, 140]); }
      break;
    case 'end_portal_frame_side':
      drawBlockTile(p, 'end_stone');
      for (let x = 0; x < S; x++) for (let y = 0; y < 4; y++) px(x, y, shade([60, 110, 90], 0.85 + rand() * 0.25));
      break;
    case 'end_portal_frame_top':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const ring = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) > 5.5;
        px(x, y, ring ? shade([60, 110, 90], 0.85 + rand() * 0.25) : shade([40, 70, 60], 0.85 + rand() * 0.2));
      }
      break;
    case 'end_portal_frame_eye':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        px(x, y, d < 2.5 ? [20, 40, 30] : d < 6 ? shade([40, 160, 120], 0.85 + rand() * 0.3) : [25, 70, 55]);
      }
      break;
    case 'end_portal':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const r = rand();
        px(x, y, r < 0.06 ? [160, 220, 200] : r < 0.12 ? [60, 120, 160] : shade([8, 12, 22], 0.8 + rand() * 0.4));
      }
      break;
    case 'dragon_egg':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px(x, y, rand() < 0.1 ? [100, 40, 140] : shade([16, 10, 20], 0.8 + rand() * 0.5));
      break;
    case 'redstone_dust_dot':
      for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) {
        if ((x - 7.5) ** 2 + (y - 7.5) ** 2 > 14 + rand() * 6) continue;
        p.tinted(x, y, 170 + rand() * 85);
      }
      break;
    case 'redstone_dust_line':
      for (let y = 0; y < S; y++) for (let x = 6; x < 10; x++) if (rand() < 0.9) p.tinted(x, y, 160 + rand() * 95);
      break;
    case 'redstone_torch': case 'redstone_torch_off': {
      const on = name === 'redstone_torch';
      for (let y = 6; y < 16; y++) { px(7, y, [110, 80, 45]); px(8, y, [90, 65, 35]); }
      const tip = on ? [[255, 60, 40], [200, 20, 10], [255, 160, 140]] : [[110, 20, 15], [80, 15, 10], [140, 40, 30]];
      px(7, 5, tip[0]); px(8, 5, tip[1]); px(7, 4, tip[2]); px(8, 4, tip[0]); px(7, 6, tip[1]); px(8, 6, tip[1]);
      if (on) { px(6, 5, [255, 120, 100]); px(9, 4, [255, 120, 100]); }
      break;
    }
    case 'lever_handle': for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px(x, y, shade([110, 80, 45], 0.85 + rand() * 0.3)); break;
    case 'torch_tip_on': p.noisy([230, 40, 30], 0.2); break;
    case 'torch_tip_off': p.noisy([110, 25, 20], 0.2); break;
    case 'repeater':
      drawBlockTile(p, 'smooth_stone');
      for (let y = 2; y < 14; y++) { px(7, y, [120, 20, 15]); px(8, y, [150, 25, 20]); }
      for (let i = 0; i < 4; i++) { px(7 - i, 2 + i, [150, 25, 20]); px(8 + i, 2 + i, [150, 25, 20]); } // arrow pointing to the output
      break;
    case 'redstone_lamp': case 'redstone_lamp_on': {
      const on = name === 'redstone_lamp_on';
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const frame = x === 0 || y === 0 || x === 15 || y === 15 || ((x === 5 || x === 10) && (y < 3 || y > 12)) || ((y === 5 || y === 10) && (x < 3 || x > 12));
        const glow = on ? shade([250, 200, 120], 0.85 + rand() * 0.2) : shade([95, 60, 35], 0.8 + rand() * 0.3);
        px(x, y, frame ? (on ? [150, 110, 60] : [60, 40, 25]) : glow);
      }
      break;
    }
    case 'redstone_block':
      p.noisy([175, 25, 15], 0.15);
      for (let i = 0; i < S; i++) { px(i, 0, [210, 50, 35]); px(0, i, [210, 50, 35]); px(i, 15, [120, 15, 10]); px(15, i, [120, 15, 10]); }
      for (let i = 0; i < 6; i++) px(3 + Math.floor(rand() * 10), 3 + Math.floor(rand() * 10), [255, 90, 70]);
      break;
    case 'tnt_side':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const band = y >= 5 && y <= 10;
        px(x, y, band ? (y === 5 || y === 10 ? [200, 200, 200] : [235, 235, 235]) : shade(x % 4 === 3 ? [150, 30, 20] : [210, 50, 35], 0.9 + rand() * 0.15));
      }
      for (const [x, w] of [[2, 1], [5, 1], [8, 1], [11, 1]]) for (let y = 6; y < 10; y++) for (let k = 0; k < w + 1; k++) px(x + k, y, [40, 40, 40]); // "TNT" marks
      break;
    case 'tnt_top': case 'tnt_bottom':
      p.noisy([200, 45, 30], 0.12);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if ((x % 5 === 2) && (y % 5 === 2)) { px(x, y, [70, 70, 70]); }
      if (name === 'tnt_top') for (let i = 6; i < 10; i++) { px(i, 7, [235, 235, 235]); px(7, i, [235, 235, 235]); }
      break;
    case 'piston_side':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        if (y < 4) px(x, y, shade(C.oak, (y === 3 ? 0.7 : 0.95) + rand() * 0.1));
        else px(x, y, shade([115, 115, 115], (x === 0 || x === 15 || y === 15 ? 0.7 : 0.9) + rand() * 0.15));
      }
      break;
    case 'piston_top': case 'piston_inner':
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        if (name === 'piston_inner') { px(x, y, shade([105, 105, 105], 0.85 + rand() * 0.2)); continue; }
        const edge = x === 0 || y === 0 || x === 15 || y === 15;
        px(x, y, edge ? shade(C.oak, 0.7) : shade(C.oak, 0.92 + rand() * 0.12));
      }
      if (name === 'piston_inner') for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) px(x, y, shade(C.oak, 0.9));
      break;
    case 'piston_bottom':
      p.noisy([110, 110, 110], 0.15);
      for (let i = 0; i < S; i++) { px(i, 0, [80, 80, 80]); px(0, i, [80, 80, 80]); px(i, 15, [80, 80, 80]); px(15, i, [80, 80, 80]); }
      break;
    case 'ladder':
      for (let y = 0; y < S; y++) for (const x of [2, 3, 12, 13]) px(x, y, shade(C.oak, x === 2 || x === 13 ? 0.7 : 0.95 + rand() * 0.1));
      for (const y of [1, 5, 9, 13]) for (let x = 4; x < 12; x++) { px(x, y, shade(C.oak, 0.95 + rand() * 0.1)); px(x, y + 1, shade(C.oak, 0.7)); }
      break;
    default:
      if (/^(wheat|carrots|potatoes)_\d$/.test(name)) { drawCrop(p, name); break; }
      if (name.startsWith('wool_')) { drawWool(p, DYE_RGB[COLORS.indexOf(name.slice(5))]); break; }
      if (name.startsWith('stained_glass_')) {
        // a pane of tinted glass: see-through, with a darker frame
        const c = DYE_RGB[COLORS.indexOf(name.slice(14))];
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          const edge = x === 0 || y === 0 || x === S - 1 || y === S - 1;
          px(x, y, shade(c, edge ? 0.8 : 1), edge ? 0.9 : 0.5);
        }
        for (let i = 0; i < 4; i++) px(3 + i, 6 - i, shade(c, 1.4), 0.7);
        break;
      }
      if (name === 'rail' || name === 'rail_corner' || name.startsWith('powered_rail')) { drawRail(p, name); break; }
      if (name === 'terracotta' || name.startsWith('terracotta_')) {
        p.noisy(name === 'terracotta' ? PLAIN_TERRACOTTA_RGB : TERRACOTTA_RGB[COLORS.indexOf(name.slice(11))], 0.05);
        break;
      }
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px(x, y, (x < 8) === (y < 8) ? [255, 0, 255] : [0, 0, 0]);
  }
}

// A compass needle pointing at frame/16 of a turn (0 = straight up), or a clock face with the
// sun and moon going round (0 = noon at the top), drawn on a 32px icon.
function drawDial(ctx, compass, frame) {
  const a = (frame / 16) * Math.PI * 2, c = 16, s = Math.sin(a), co = -Math.cos(a);
  const dot = (x, y, color) => { ctx.fillStyle = color; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2); };
  if (compass) {
    for (let t = 0; t <= 8; t += 1) dot(c + s * t, c + co * t, '#e02020');
    for (let t = 1; t <= 6; t += 1) dot(c - s * t, c - co * t, '#d0d0d0');
    return;
  }
  // the clock's face: the upper half is day (blue sky, sun), the lower night (dark, moon)
  ctx.save();
  ctx.beginPath(); ctx.arc(c, c, 10, 0, Math.PI * 2); ctx.clip();
  ctx.translate(c, c); ctx.rotate(a);
  ctx.fillStyle = '#5a9be0'; ctx.fillRect(-12, -12, 24, 12);
  ctx.fillStyle = '#1a2050'; ctx.fillRect(-12, 0, 24, 12);
  ctx.fillStyle = '#ffe040'; ctx.fillRect(-3, -9, 6, 6);
  ctx.fillStyle = '#e8e8f0'; ctx.fillRect(-3, 3, 6, 6);
  ctx.restore();
  ctx.fillStyle = '#202020'; ctx.fillRect(c - 1, 4, 2, 5); // the marker at the top
}

// Rails: wooden ties and two iron (or gold, with a redstone strip) rails running north-south;
// the corner joins south and east.
function drawRail(p, name) {
  const { px, rand } = p;
  const powered = name.startsWith('powered'), on = name.endsWith('_on');
  const metal = powered ? [230, 190, 50] : [160, 160, 165];
  const tie = [110, 80, 45];
  if (name === 'rail_corner') {
    // arcs round the bottom-right corner, meeting the straight rails at the south and east edges
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = 16 - (x + 0.5), dy = 16 - (y + 0.5), r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      if (r > 2 && r < 14 && ((a / (Math.PI / 2)) * 13) % 3.2 < 1.4) px(x, y, shade(tie, 0.85 + rand() * 0.2));
    }
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = Math.hypot(16 - (x + 0.5), 16 - (y + 0.5));
      if (Math.abs(r - 12) < 0.8 || Math.abs(r - 4) < 0.8) px(x, y, r - Math.floor(r) > 0.5 ? shade(metal, 0.8) : metal);
    }
    return;
  }
  for (let y = 1; y < 16; y += 4) for (let x = 2; x < 14; x++) { px(x, y, shade(tie, 0.9 + rand() * 0.2)); px(x, y + 1, shade(tie, 0.75)); }
  for (let y = 0; y < 16; y++) { px(3, y, metal); px(4, y, shade(metal, 0.8)); px(11, y, metal); px(12, y, shade(metal, 0.8)); }
  if (powered) for (let y = 0; y < 16; y++) if (y % 4 !== 3) px(7, y, on ? [255, 60, 40] : [110, 20, 15]), px(8, y, on ? [230, 40, 30] : [90, 15, 10]);
}

// Wool: soft noise with a faint woven pattern.
function drawWool(p, c) {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) p.px(x, y, shade(c, 0.92 + p.rand() * 0.12 - ((x + y * 3) % 4 === 0 ? 0.06 : 0)));
}

// Growing crops: stalks that get taller with each stage; wheat ripens to gold,
// carrots and potatoes show their crop at the bottom when ready.
function drawCrop(p, name) {
  const { px, rand } = p;
  const [kind, stageText] = name.split('_');
  const stage = Number(stageText);
  const max = kind === 'wheat' ? 7 : 3;
  const f = stage / max;
  const height = Math.round(3 + f * 11);
  const ripe = kind === 'wheat' ? [[60, 140, 30], [200, 180, 60]] : [[50, 150, 40], [60, 160, 45]];
  const color = [0, 1, 2].map((k) => ripe[0][k] + (ripe[1][k] - ripe[0][k]) * f);
  const stalks = kind === 'wheat' ? [1, 3, 5, 7, 9, 11, 13, 14] : [2, 5, 8, 11, 13];
  for (const x0 of stalks) {
    const h = height - Math.floor(rand() * 3);
    for (let k = 0; k < h; k++) {
      const x = x0 + (k > h / 2 && rand() < 0.3 ? (rand() < 0.5 ? -1 : 1) : 0);
      px(x, 15 - k, shade(color, 0.8 + rand() * 0.35));
    }
    if (kind === 'wheat' && stage >= 4) {
      for (let k = h - 3; k < h; k++) px(x0, 15 - k, shade([220, 190, 80].map((v, i) => color[i] + (v - color[i]) * f), 0.85 + rand() * 0.3));
    } else if (kind !== 'wheat') {
      // leafy tops
      px(x0 - 1, 15 - h, shade(color, 1.1)); px(x0 + 1, 15 - h, shade(color, 1.1)); px(x0, 14 - h, shade(color, 1.15));
    }
  }
  if (kind !== 'wheat' && stage === max) {
    const crop = kind === 'carrots' ? [235, 130, 30] : [200, 160, 90];
    for (const x of [3, 7, 11]) { px(x, 14, crop); px(x + 1, 14, crop); px(x, 15, shade(crop, 0.85)); px(x + 1, 15, shade(crop, 0.85)); }
  }
}

// ---------- items ----------
const TOOL_HEAD = { wood: [150, 116, 65], stone: [130, 130, 130], iron: [216, 216, 216], diamond: [80, 230, 220] };
const STICK = [104, 76, 40];
const TOOL_PATTERNS = {
  pickaxe: [
    '................',
    '.....HHHHHH.....',
    '...HHHHHHHHHH...',
    '..HH....S...HH..',
    '.HH.....S....HH.',
    '.H......S.....H.',
    '........S.......',
    '........S.......',
    '........S.......',
    '........S.......',
    '........S.......',
    '........S.......',
    '........S.......',
    '........S.......',
    '........S.......',
    '................',
  ],
  axe: [
    '................',
    '.......HHH......',
    '......HHHHS.....',
    '.....HHHHHS.....',
    '.....HHHH.S.....',
    '......HH..S.....',
    '..........S.....',
    '..........S.....',
    '..........S.....',
    '..........S.....',
    '..........S.....',
    '..........S.....',
    '..........S.....',
    '..........S.....',
    '..........S.....',
    '................',
  ],
  shovel: [
    '.......HH.......',
    '......HHHH......',
    '......HHHH......',
    '......HHHH......',
    '.......HH.......',
    '.......SS.......',
    '.......SS.......',
    '.......SS.......',
    '.......SS.......',
    '.......SS.......',
    '.......SS.......',
    '.......SS.......',
    '......SSSS......',
    '......S..S......',
    '......SSSS......',
    '................',
  ],
  hoe: [
    '................',
    '.....HHHH.......',
    '......HHHS......',
    '..........S.....',
    '..........S.....',
    '.........S......',
    '.........S......',
    '........S.......',
    '........S.......',
    '.......S........',
    '.......S........',
    '......S.........',
    '......S.........',
    '.....S..........',
    '.....S..........',
    '................',
  ],
  sword: [
    '.......HH.......',
    '......HHHH......',
    '......HHHH......',
    '......HHHH......',
    '......HHHH......',
    '......HHHH......',
    '......HHHH......',
    '......HHHH......',
    '......HHHH......',
    '......HHHH......',
    '...GGGGGGGGGG...',
    '.......SS.......',
    '.......SS.......',
    '.......SS.......',
    '.......SS.......',
    '................',
  ],
};

const ARMOR_COLORS = { leather: [150, 90, 50], iron: [215, 215, 215], gold: [245, 205, 60], diamond: [90, 225, 215] };
const ARMOR_PATTERNS = {
  helmet: ['', '', '', '....LAAAAAAL....', '...LAAAAAAAAL...', '...AAAAAAAAAA...', '...AAD....DAA...', '...AAD....DAA...', '...AD......DA...'],
  chestplate: ['', '..LAA....AAL....', '..AAAA..AAAA....', '..AAAAAAAAAA....', '...AAAAAAAA.....', '....AAAAAA......', '....AAAAAA......', '....AAAAAA......', '....AADDAA......', '....AAAAAA......', '....AAAAAA......', '.....DDDD.......'].map((r) => '..' + r),
  leggings: ['', '', '....LAAAAAAL....', '....AAAAAAAA....', '....AAADDAAA....', '....AAA..AAA....', '....AAA..AAA....', '....AAA..AAA....', '....AAA..AAA....', '....AAA..AAA....', '....AAA..AAA....', '....DDD..DDD....'],
  boots: ['', '', '', '', '', '', '', '...LAA....AAL...', '...AAA....AAA...', '...AAA....AAA...', '..AAAA....AAAA..', '..DDDD....DDDD..'],
};

function drawItem(p, icon) {
  const { px, rand } = p;
  const tool = icon.match(/^(wood|stone|iron|diamond)_(pickaxe|axe|shovel|sword|hoe)$/);
  if (tool) {
    const head = TOOL_HEAD[tool[1]];
    p.pattern(TOOL_PATTERNS[tool[2]], {
      H: () => shade(head, 0.85 + rand() * 0.3),
      S: () => shade(STICK, 0.9 + rand() * 0.2),
      G: () => [60, 50, 40],
    });
    return;
  }
  const blob = (color, cx, cy, rx, ry, varied = 0.2) => {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d < 1) px(x, y, shade(color, 1 - varied / 2 + rand() * varied - d * 0.15));
    }
  };
  const armor = icon.match(/^(leather|iron|gold|diamond)_(helmet|chestplate|leggings|boots)$/);
  if (armor) {
    const base = ARMOR_COLORS[armor[1]];
    p.pattern(ARMOR_PATTERNS[armor[2]], { A: () => shade(base, 0.85 + rand() * 0.3), D: () => shade(base, 0.6), L: () => shade(base, 1.25) });
    return;
  }
  switch (icon) {
    case 'bow':
      for (let i = 0; i < 12; i++) {
        const t = i / 11, x = Math.round(3 + t * 9 + Math.sin(t * Math.PI) * -2.5), y = Math.round(12 - t * 9 - Math.sin(t * Math.PI) * 2.5);
        px(x, y, shade([120, 80, 40], 0.9 + rand() * 0.2)); px(x + 1, y, shade([90, 60, 30], 1));
      }
      for (let i = 0; i < 10; i++) px(3 + i, 12 - i, [220, 220, 220]);
      break;
    case 'wheat_seeds':
      for (const [x, y] of [[5, 6], [9, 5], [7, 9], [11, 9], [4, 11], [8, 12], [10, 7]]) { px(x, y, [70, 140, 40]); px(x + 1, y, [110, 170, 60]); px(x, y + 1, [50, 110, 30]); }
      break;
    case 'wheat':
      for (let i = 0; i < 11; i++) { px(4 + i, 14 - i, [190, 160, 60]); px(5 + i, 14 - i, [150, 120, 40]); }
      for (const [x, y] of [[10, 3], [12, 2], [13, 4], [11, 5], [9, 6], [12, 6], [8, 4]]) px(x, y, [230, 200, 90]);
      break;
    case 'carrot':
      for (let i = 0; i < 9; i++) for (let w = 0; w < 3 - Math.floor(i / 4); w++) px(4 + i + w, 13 - i + w, shade([235, 130, 30], 0.85 + rand() * 0.3));
      for (const [x, y] of [[12, 3], [13, 2], [11, 2], [13, 4], [14, 3]]) px(x, y, [60, 160, 40]);
      break;
    case 'potato': blob([200, 160, 90], 8, 9, 5, 4, 0.3); p.specks([140, 110, 60], 5); break;
    case 'baked_potato': blob([215, 160, 60], 8, 9, 5, 4, 0.3); blob([250, 225, 150], 8, 8, 2.5, 1.5, 0.1); break;
    case 'bone_meal':
      for (let i = 0; i < 26; i++) { const a = rand() * 6.28, r = Math.sqrt(rand()) * 4.5; px(Math.round(8 + Math.cos(a) * r), Math.round(9 + Math.sin(a) * r * 0.7), shade([240, 240, 230], 0.8 + rand() * 0.25)); }
      break;
    case 'ender_pearl':
      blob([20, 90, 80], 8, 8, 5, 5, 0.2); blob([40, 160, 140], 8, 8, 3, 3, 0.2); px(6, 6, [180, 255, 240]);
      break;
    case 'flint':
      for (let y = 3; y < 14; y++) for (let x = 4 + Math.abs(8 - y) / 2; x < 12 - Math.abs(6 - y) / 3; x++) px(Math.floor(x), y, shade([60, 60, 65], 0.8 + rand() * 0.4));
      px(7, 5, [130, 130, 135]);
      break;
    case 'glowstone_dust':
      for (let i = 0; i < 26; i++) { const a = rand() * 6.28, r = Math.sqrt(rand()) * 4.5; px(Math.round(8 + Math.cos(a) * r), Math.round(9 + Math.sin(a) * r * 0.7), rand() < 0.5 ? [255, 220, 120] : [220, 170, 70]); }
      break;
    case 'quartz':
      for (let y = 4; y < 13; y++) for (let x = 5 + Math.abs(8 - y) / 3; x < 11 - Math.abs(8 - y) / 3; x++) px(Math.floor(x), y, shade([238, 232, 224], 0.85 + rand() * 0.2));
      px(7, 6, [255, 255, 255]);
      break;
    case 'blaze_rod': case 'blaze_powder':
      if (icon === 'blaze_rod') for (let i = 0; i < 11; i++) { px(3 + i, 13 - i, [250, 200, 50]); px(4 + i, 13 - i, [220, 140, 30]); }
      else for (let i = 0; i < 26; i++) { const a = rand() * 6.28, r = Math.sqrt(rand()) * 4.5; px(Math.round(8 + Math.cos(a) * r), Math.round(9 + Math.sin(a) * r * 0.7), rand() < 0.5 ? [255, 200, 40] : [240, 120, 20]); }
      break;
    case 'eye_of_ender':
      blob([40, 120, 90], 8, 8, 5, 5, 0.2); blob([60, 180, 130], 8, 8, 3.2, 3.2, 0.2);
      for (let y = 5; y < 11; y++) px(8, y, [20, 30, 25]); px(7, 7, [20, 30, 25]); px(9, 9, [20, 30, 25]);
      break;
    case 'nether_brick':
      for (let y = 6; y < 11; y++) for (let x = 3 + (10 - y) / 2; x < 13 - (10 - y) / 2; x++) px(Math.floor(x), y, shade([80, 40, 46], y === 6 ? 1.2 : 0.9 + rand() * 0.1));
      break;
    case 'ghast_tear':
      for (let y = 3; y < 13; y++) { const w = y < 8 ? (y - 3) / 2.5 : 3 - (y - 8) / 2.5; for (let x = Math.round(8 - w); x <= Math.round(8 + w); x++) px(x, y, shade([200, 230, 235], 0.9 + rand() * 0.15)); }
      break;
    case 'gold_nugget': blob([250, 210, 60], 8, 9, 3, 2.5, 0.3); px(7, 8, [255, 245, 170]); break;
    case 'flint_and_steel':
      for (let i = 0; i < 6; i++) { px(3 + i, 12 - i, [200, 200, 205]); px(4 + i, 12 - i, [150, 150, 155]); }
      px(3, 11, [200, 200, 205]); px(2, 12, [200, 200, 205]); px(3, 13, [150, 150, 155]);
      for (let y = 3; y < 8; y++) for (let x = 9; x < 14 - Math.abs(5 - y) / 2; x++) px(x, y, shade([60, 60, 65], 0.8 + rand() * 0.4));
      break;
    case 'oak_door':
      for (let y = 1; y < 15; y++) for (let x = 4; x < 12; x++) {
        const window = y > 2 && y < 7 && x > 4 && x < 11 && x !== 7;
        px(x, y, window ? [190, 210, 220] : shade(C.oak, x === 4 || x === 11 || y === 1 || y === 14 || y === 8 ? 0.75 : 0.95 + rand() * 0.1));
      }
      px(10, 10, [60, 60, 60]);
      break;
    case 'stick':
      for (let i = 0; i < 12; i++) { px(3 + i, 13 - i, STICK); px(3 + i, 14 - i, shade(STICK, 0.75)); }
      break;
    case 'coal': blob([40, 40, 45], 8, 8, 5, 4.5, 0.4); break;
    case 'diamond':
      blob([90, 235, 225], 8, 8, 5, 5, 0.3);
      px(6, 6, [220, 255, 255]); px(7, 5, [220, 255, 255]);
      break;
    case 'raw_iron': blob([200, 160, 130], 8, 8.5, 5, 4.5, 0.4); break;
    case 'raw_gold': blob([240, 200, 60], 8, 8.5, 5, 4.5, 0.4); break;
    case 'iron_ingot':
    case 'gold_ingot': {
      const c = icon === 'iron_ingot' ? [220, 220, 220] : [250, 215, 70];
      for (let y = 6; y < 11; y++) for (let x = 3 + (10 - y) / 2; x < 13 - (10 - y) / 2; x++) px(Math.floor(x), y, shade(c, y === 6 ? 1.1 : 0.9 + rand() * 0.1));
      break;
    }
    case 'apple':
      blob([200, 30, 30], 8, 9, 5, 5, 0.25);
      px(8, 3, [100, 70, 30]); px(8, 4, [100, 70, 30]); px(9, 3, [60, 150, 40]); px(10, 2, [60, 150, 40]);
      px(6, 7, [255, 150, 150]);
      break;
    case 'raw_porkchop': blob([240, 150, 150], 8, 8, 6, 4, 0.2); blob([255, 230, 225], 11, 7, 2, 2); break;
    case 'cooked_porkchop': blob([190, 120, 70], 8, 8, 6, 4, 0.2); blob([230, 200, 150], 11, 7, 2, 2); break;
    case 'raw_beef': blob([200, 50, 50], 8, 8, 6, 4.5, 0.3); blob([250, 230, 220], 5, 7, 1.5, 1.5); break;
    case 'steak': blob([130, 75, 40], 8, 8, 6, 4.5, 0.3); blob([220, 190, 150], 5, 7, 1.5, 1.5); break;
    case 'rotten_flesh': blob([130, 100, 60], 8, 8, 6, 4, 0.5); p.specks([80, 110, 50], 8); break;
    case 'bread': blob([200, 150, 70], 8, 8, 6.5, 3.5, 0.2); for (let x = 5; x < 12; x += 3) px(x, 7, [150, 100, 40]); break;
    case 'leather': blob([150, 90, 50], 8, 8, 5.5, 5, 0.3); break;
    case 'raw_copper': blob([210, 120, 80], 8, 8.5, 5, 4.5, 0.4); p.specks([90, 170, 130], 4); break;
    case 'copper_ingot':
      for (let y = 6; y < 11; y++) for (let x = 3 + (10 - y) / 2; x < 13 - (10 - y) / 2; x++) px(Math.floor(x), y, shade([225, 125, 85], y === 6 ? 1.1 : 0.9 + rand() * 0.1));
      break;
    case 'glass_bottle': case 'potion': case 'splash_potion': {
      // the liquid is tinted by the potion (alpha 250 marks pixels the slot colours, see iconURL)
      const neck = icon === 'splash_potion' ? [[6, 3], [9, 3]] : [];
      for (let y = 6; y < 14; y++) for (let x = 4 + (y > 12 ? 1 : 0); x < 12 - (y > 12 ? 1 : 0); x++) {
        const edge = x === 4 || x === 11 || y === 13;
        if (icon === 'glass_bottle' || edge || y < 8) px(x, y, edge ? [200, 220, 240] : [220, 235, 250], edge ? 1 : 0.4);
        else px(x, y, [255, 255, 255], 250 / 255);
      }
      for (let y = 3; y < 6; y++) { px(7, y, [200, 220, 240]); px(8, y, [200, 220, 240]); }
      px(7, 2, [150, 110, 70]); px(8, 2, [150, 110, 70]);
      for (const [x, y] of neck) px(x, y, [200, 220, 240]);
      break;
    }
    case 'nether_wart': for (let i = 0; i < 6; i++) { const x = 4 + i * 1.5 | 0, y = 6 + (i % 3) * 2; px(x, y, [170, 30, 40]); px(x + 1, y, [140, 25, 35]); px(x, y + 1, [120, 20, 30]); } break;
    case 'spider_eye': blob([150, 30, 50], 8, 8, 4, 3.5, 0.3); px(7, 7, [230, 120, 130]); break;
    case 'fermented_spider_eye': blob([150, 30, 50], 8, 9, 4, 3.5, 0.3); for (let x = 4; x < 12; x++) px(x, 5, [190, 150, 110]); px(6, 4, [190, 150, 110]); break;
    case 'sugar': for (let i = 0; i < 26; i++) px(4 + Math.floor(rand() * 8), 6 + Math.floor(rand() * 7), [245, 245, 250]); break;
    case 'melon_slice':
      for (let y = 4; y < 13; y++) for (let x = 3; x < 13; x++) { const d = Math.hypot(x - 8, y - 13); if (d < 9 && d > 0 && y < 12) px(x, y, d > 7.5 ? [80, 140, 40] : d > 6.5 ? [230, 230, 200] : rand() < 0.08 ? [30, 30, 30] : [230, 60, 60]); }
      break;
    case 'glistering_melon_slice':
      for (let y = 4; y < 13; y++) for (let x = 3; x < 13; x++) { const d = Math.hypot(x - 8, y - 13); if (d < 9 && d > 0 && y < 12) px(x, y, d > 7.5 ? [240, 200, 60] : rand() < 0.15 ? [255, 240, 150] : [230, 70, 60]); }
      break;
    case 'golden_carrot': for (let i = 0; i < 9; i++) { px(4 + i, 12 - i, [240, 200, 50]); px(5 + i, 12 - i, [210, 170, 40]); } px(12, 3, [120, 180, 60]); px(13, 2, [120, 180, 60]); break;
    case 'magma_cream': blob([200, 90, 30], 8, 8, 4, 4, 0.3); p.specks([255, 200, 60], 6); break;
    case 'rabbit_foot': blob([180, 140, 100], 8, 9, 3, 4.5, 0.3); break;
    case 'pufferfish': blob([230, 200, 60], 8, 8, 5, 4, 0.2); p.specks([255, 250, 200], 6); px(5, 7, [20, 20, 20]); break;
    case 'phantom_membrane': for (let y = 4; y < 13; y++) for (let x = 3 + (y % 2); x < 13; x += 2) px(x, y, [190, 180, 160], 0.9); break;
    case 'golden_apple': blob([240, 200, 50], 8, 9, 4.5, 4.5, 0.25); px(8, 3, [100, 70, 40]); px(9, 4, [100, 170, 60]); break;
    case 'milk_bucket':
      drawItem(p, 'bucket');
      for (let x = 5; x < 11; x++) { px(x, 4, [245, 245, 245]); px(x, 5, [230, 230, 230]); }
      break;
    case 'enchanted_book':
      for (let y = 3; y < 13; y++) for (let x = 4; x < 12; x++) px(x, y, x === 4 ? [70, 20, 90] : shade([120, 40, 150], 0.9 + rand() * 0.15));
      for (let y = 4; y < 12; y++) px(11, y, [235, 230, 210]);
      px(7, 6, [255, 230, 120]); px(8, 7, [255, 230, 120]); px(6, 8, [255, 230, 120]);
      break;
    case 'experience_bottle':
      for (let y = 5; y < 14; y++) for (let x = 5; x < 11; x++) px(x, y, shade([120, 220, 90], 0.8 + rand() * 0.3), 0.85);
      for (let x = 6; x < 10; x++) { px(x, 4, [180, 180, 190]); px(x, 3, [150, 110, 70]); }
      break;
    case 'egg': blob([235, 220, 190], 8, 8.5, 3.5, 4.5, 0.15); p.specks([200, 180, 150], 3); break;
    case 'slimeball': blob([110, 200, 80], 8, 8, 4, 4, 0.2); px(7, 6, [200, 255, 180]); break;
    case 'ink_sac': blob([40, 40, 55], 8, 9, 4, 4, 0.2); px(8, 4, [40, 40, 55]); px(8, 5, [40, 40, 55]); break;
    case 'raw_rabbit': blob([230, 150, 140], 8, 8, 5, 3.5, 0.3); break;
    case 'cooked_rabbit': blob([180, 110, 60], 8, 8, 5, 3.5, 0.3); break;
    case 'rabbit_hide': for (let y = 4; y < 13; y++) for (let x = 4; x < 12; x++) px(x, y, shade([170, 130, 90], 0.85 + rand() * 0.3)); break;
    case 'paper':
      for (let y = 3; y < 13; y++) for (let x = 3 + (y % 3 === 0 ? 1 : 0); x < 13; x++) px(x, y, shade([240, 240, 235], 0.92 + rand() * 0.08));
      break;
    case 'book':
      for (let y = 3; y < 13; y++) for (let x = 4; x < 12; x++) px(x, y, x === 4 ? [90, 40, 20] : shade([130, 60, 30], 0.9 + rand() * 0.15));
      for (let y = 4; y < 12; y++) px(11, y, [235, 230, 210]);
      break;
    case 'bucket':
    case 'lava_bucket':
    case 'water_bucket':
      for (let y = 4; y < 14; y++) for (let x = 4 + (y - 4) / 5; x < 12 - (y - 4) / 5; x++) px(Math.floor(x), y, shade([200, 200, 205], y === 4 ? 1.15 : 0.85 + rand() * 0.15));
      for (let x = 5; x < 11; x++) px(x, 2, [150, 150, 155]);
      px(4, 3, [150, 150, 155]); px(11, 3, [150, 150, 155]);
      if (icon === 'water_bucket') for (let x = 5; x < 11; x++) { px(x, 4, [60, 100, 230]); px(x, 5, [50, 85, 210]); }
      else if (icon === 'lava_bucket') for (let x = 5; x < 11; x++) { px(x, 4, [255, 150, 30]); px(x, 5, [220, 90, 10]); }
      else for (let x = 5; x < 11; x++) px(x, 5, [70, 70, 75]);
      break;
    case 'shears':
      for (let i = 0; i < 7; i++) { px(4 + i, 4 + i, [215, 215, 220]); px(11 - i, 4 + i, [190, 190, 195]); }
      for (const [x, y] of [[3, 11], [4, 12], [3, 12], [12, 11], [11, 12], [12, 12]]) px(x, y, [150, 40, 40]);
      break;
    case 'raw_chicken': blob([245, 200, 185], 8, 8, 5, 4, 0.2); break;
    case 'cooked_chicken': blob([205, 140, 70], 8, 8, 5, 4, 0.25); break;
    case 'raw_mutton': blob([215, 70, 70], 8, 8, 5.5, 4, 0.3); blob([245, 230, 225], 11, 7, 1.5, 1.5); break;
    case 'cooked_mutton': blob([150, 85, 50], 8, 8, 5.5, 4, 0.3); blob([225, 200, 160], 11, 7, 1.5, 1.5); break;
    case 'feather':
      for (let i = 0; i < 10; i++) { px(4 + i, 13 - i, [200, 200, 200]); px(5 + i, 13 - i, [240, 240, 240]); px(4 + i, 12 - i, [235, 235, 235]); }
      break;
    case 'bone':
      for (let i = 0; i < 10; i++) px(3 + i, 12 - i, [235, 232, 220]);
      for (const [x, y] of [[2, 12], [3, 13], [2, 13], [13, 2], [12, 1], [13, 1]]) px(x, y, [235, 232, 220]);
      break;
    case 'arrow':
      for (let i = 0; i < 10; i++) px(3 + i, 12 - i, STICK);
      for (const [x, y] of [[12, 2], [13, 2], [13, 3], [12, 1]]) px(x, y, [170, 170, 175]);
      for (const [x, y] of [[2, 12], [3, 13], [2, 13], [4, 13], [2, 11]]) px(x, y, [230, 230, 230]);
      break;
    case 'gunpowder': blob([90, 90, 90], 8, 9, 5, 3.5, 0.6); break;
    case 'redstone':
      for (let i = 0; i < 26; i++) {
        const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 4.5;
        px(Math.round(8 + Math.cos(a) * r), Math.round(9 + Math.sin(a) * r * 0.7), shade([200, 10, 10], 0.7 + rand() * 0.5));
      }
      break;
    case 'lapis':
      blob([40, 80, 200], 8, 8, 4.5, 5, 0.35);
      px(6, 6, [120, 160, 255]); px(10, 10, [20, 40, 120]);
      break;
    case 'emerald':
      for (let y = 3; y < 14; y++) {
        const w = 5 - Math.abs(y - 8) * 0.8;
        for (let x = Math.ceil(8 - w); x < 8 + w; x++) px(x, y, shade([50, 215, 110], x < 8 ? 1.1 : 0.85));
      }
      px(6, 6, [200, 255, 220]); px(7, 5, [200, 255, 220]);
      break;
    case 'cocoa_beans': blob([110, 65, 35], 8, 8.5, 3.5, 4.5, 0.25); for (let y = 5; y < 12; y++) px(8, y, [80, 45, 25]); break;
    case 'clay_ball': blob([160, 166, 179], 8, 8.5, 4, 3.5, 0.15); break;
    case 'brick_item':
      for (let y = 6; y < 11; y++) for (let x = 3; x < 13; x++) px(x, y, shade([150, 75, 55], y === 6 ? 1.15 : y === 10 ? 0.75 : 0.9 + rand() * 0.2));
      break;
    case 'shield':
      for (let y = 2; y < 15; y++) for (let x = 3; x < 13; x++) {
        if (y > 10 && Math.abs(x - 7.5) > 15 - y) continue;
        const rim = x === 3 || x === 12 || y === 2 || (y > 10 && Math.abs(x - 7.5) >= 14 - y);
        px(x, y, rim ? [150, 150, 155] : shade([140, 100, 55], 0.85 + rand() * 0.2));
      }
      for (let y = 6; y < 9; y++) for (let x = 6; x < 10; x++) px(x, y, [170, 170, 175]);
      break;
    case 'compass': case 'clock': {
      // the dial; the needle (or the turning day/night face) is drawn on top for each frame
      const rimC = icon === 'compass' ? [120, 120, 125] : [230, 190, 50];
      for (let y = 2; y < 14; y++) for (let x = 2; x < 14; x++) {
        const d = Math.hypot(x - 7.5, y - 7.5);
        if (d < 6.2) px(x, y, d > 5 ? shade(rimC, 0.9 + rand() * 0.2) : icon === 'compass' ? [70, 70, 75] : [60, 90, 160]);
      }
      break;
    }
    case 'boat':
      for (let x = 2; x < 14; x++) { px(x, 9, [110, 80, 45]); px(x, 10, shade([150, 115, 70], 0.9 + rand() * 0.2)); px(x, 11, shade([150, 115, 70], 0.9 + rand() * 0.2)); }
      for (let x = 4; x < 12; x++) px(x, 12, [110, 80, 45]);
      px(1, 8, [150, 115, 70]); px(14, 8, [150, 115, 70]); px(2, 8, [150, 115, 70]); px(13, 8, [150, 115, 70]);
      for (let i = 0; i < 6; i++) px(4 + i, 7 - Math.floor(i / 2), [110, 80, 45]);
      break;
    case 'carrot_on_a_stick':
      for (let i = 0; i < 11; i++) { px(3 + i, 13 - i, shade([120, 80, 40], 0.9 + rand() * 0.2)); px(4 + i, 13 - i, [90, 60, 30]); }
      for (let y = 3; y < 9; y++) px(14, y, [220, 220, 220]);
      for (let i = 0; i < 4; i++) { px(13 - i, 9 + i, [240, 140, 40]); px(14 - i, 9 + i, [220, 120, 30]); }
      px(14, 8, [90, 170, 60]); px(15, 7, [90, 170, 60]);
      break;
    case 'minecart':
      for (let y = 6; y < 11; y++) for (let x = 2; x < 14; x++) px(x, y, y === 6 ? [170, 170, 175] : x === 2 || x === 13 ? [110, 110, 115] : shade([140, 140, 145], 0.9 + rand() * 0.15));
      for (let x = 3; x < 13; x++) px(x, 7, [60, 60, 65]);
      for (const cx of [4, 11]) { px(cx, 11, [40, 40, 40]); px(cx + 1, 11, [40, 40, 40]); px(cx, 12, [40, 40, 40]); px(cx + 1, 12, [40, 40, 40]); }
      break;
    case 'fishing_rod':
      for (let i = 0; i < 11; i++) { px(3 + i, 13 - i, shade([120, 80, 40], 0.9 + rand() * 0.2)); px(4 + i, 13 - i, [90, 60, 30]); }
      for (let y = 3; y < 12; y++) px(14, y, [220, 220, 220]);
      px(13, 12, [150, 150, 150]); px(14, 12, [150, 150, 150]); px(13, 11, [150, 150, 150]);
      break;
    case 'raw_cod': case 'cooked_cod': case 'raw_salmon': case 'cooked_salmon': case 'tropical_fish': {
      const body = { raw_cod: [190, 170, 130], cooked_cod: [200, 160, 100], raw_salmon: [200, 80, 70], cooked_salmon: [190, 110, 70], tropical_fish: [240, 120, 40] }[icon];
      blob(body, 7.5, 8, 5, 3, 0.2);
      for (let y = 5; y < 12; y++) if (Math.abs(y - 8) <= (y < 8 ? 8 - y : y - 8) + 0) px(13, y, shade(body, 0.8));
      px(12, 6, shade(body, 0.8)); px(12, 10, shade(body, 0.8)); px(13, 5, shade(body, 0.8)); px(13, 11, shade(body, 0.8));
      px(4, 7, [20, 20, 20]);
      if (icon === 'tropical_fish') for (let y = 6; y < 11; y++) px(8, y, [250, 250, 250]);
      if (icon.startsWith('cooked')) p.specks(shade(body, 0.7), 5);
      break;
    }
    case 'name_tag':
      for (let y = 5; y < 11; y++) for (let x = 4; x < 13; x++) if (!(x === 4 && (y === 5 || y === 10))) px(x, y, shade([210, 180, 130], 0.9 + rand() * 0.15));
      px(5, 7, [60, 50, 40]); px(5, 8, [60, 50, 40]);
      for (let i = 0; i < 4; i++) px(3 - (i % 2), 4 - i, [230, 230, 230]);
      break;
    case 'saddle':
      for (let y = 4; y < 10; y++) for (let x = 3; x < 13; x++) if ((x - 8) ** 2 / 30 + (y - 7) ** 2 / 9 < 1) px(x, y, shade([140, 80, 40], 0.85 + rand() * 0.2));
      for (let y = 9; y < 14; y++) { px(4, y, [90, 55, 30]); px(11, y, [90, 55, 30]); }
      px(4, 13, [180, 180, 180]); px(11, 13, [180, 180, 180]);
      break;
    case 'string':
      for (let i = 0; i < 12; i++) px(2 + i, 8 + Math.round(Math.sin(i * 0.9) * 2), [235, 235, 235]);
      break;
    default:
      if (icon.startsWith('dye_')) {
        // a little pile of powder in the dye's colour
        const c = DYE_RGB[COLORS.indexOf(icon.slice(4))];
        for (let y = 5; y < 14; y++) for (let x = 3; x < 13; x++) {
          const d = ((x - 8) / 5) ** 2 + ((y - 13) / 7.5) ** 2;
          if (d < 1 && y > 5 + Math.abs(x - 8) * 0.9) px(x, y, shade(c, 1.15 - d * 0.35 + rand() * 0.1));
        }
        break;
      }
      px(8, 8, [255, 0, 255]);
  }
}

// ---------- public API ----------
// Colours the pixels drawn with alpha 250 (a potion's liquid) and makes them opaque.
function tintLiquid(ctx, size, hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 245 || d[i + 3] === 255) continue;
    d[i] = (d[i] * r) / 255; d[i + 1] = (d[i + 1] * g) / 255; d[i + 2] = (d[i + 2] * b) / 255; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

export function createTextures() {
  const rand = mulberry32(1337);

  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = atlasCanvas.height = S * ATLAS_TILES;
  const actx = atlasCanvas.getContext('2d', { willReadFrequently: true });
  TILE_NAMES.forEach((name, i) => {
    drawBlockTile(painter(actx, (i % ATLAS_TILES) * S, Math.floor(i / ATLAS_TILES) * S, rand), name);
  });
  // The same atlas with the default (plains) biome colours applied, for icons,
  // held blocks and dropped items, which aren't in any particular biome.
  const tintedCanvas = document.createElement('canvas');
  tintedCanvas.width = tintedCanvas.height = atlasCanvas.width;
  const tctx = tintedCanvas.getContext('2d');
  tctx.drawImage(atlasCanvas, 0, 0);
  TILE_NAMES.forEach((name, i) => {
    const color = tileTint(name);
    if (!color) return;
    const x = (i % ATLAS_TILES) * S, y = Math.floor(i / ATLAS_TILES) * S;
    const img = actx.getImageData(x, y, S, S);
    const d = img.data;
    for (let k = 0; k < d.length; k += 4) {
      if (d[k + 3] !== TINT_ALPHA) continue;
      d[k] = d[k] * color[0] / 255; d[k + 1] = d[k + 1] * color[1] / 255; d[k + 2] = d[k + 2] * color[2] / 255;
      d[k + 3] = 255;
    }
    tctx.putImageData(img, x, y);
  });

  const atlas = new THREE.CanvasTexture(atlasCanvas);
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  atlas.colorSpace = THREE.NoColorSpace; // shaders treat colors as already display-ready
  // the same pixels for regular three.js materials (held and dropped blocks)
  // tinted pixels as they are, for shaders that output colours directly (particles)
  const atlasTinted = new THREE.CanvasTexture(tintedCanvas);
  atlasTinted.magFilter = THREE.NearestFilter;
  atlasTinted.minFilter = THREE.NearestFilter;
  atlasTinted.generateMipmaps = false;
  atlasTinted.colorSpace = THREE.NoColorSpace;
  const atlasSRGB = new THREE.CanvasTexture(tintedCanvas);
  atlasSRGB.magFilter = THREE.NearestFilter;
  atlasSRGB.minFilter = THREE.NearestFilter;
  atlasSRGB.generateMipmaps = false;
  atlasSRGB.colorSpace = THREE.SRGBColorSpace;

  const tileRect = (name) => {
    const i = tileIndex(name);
    return [(i % ATLAS_TILES) * S, Math.floor(i / ATLAS_TILES) * S];
  };

  // 16x16 canvases for items
  const itemCanvases = {};
  for (const item of Object.values(ITEMS)) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    drawItem(painter(c.getContext('2d'), 0, 0, mulberry32(item.icon.length * 977 + item.icon.charCodeAt(0))), item.icon);
    itemCanvases[item.icon] = c;
  }

  // Inventory icon (data URL) for a block or item, cached.
  const iconCache = new Map();
  // potion: for potions, the liquid takes that potion's colour
  function iconURL(id, potion) {
    const key = potion ? `${id}|${potion}` : id;
    if (iconCache.has(key)) return iconCache.get(key);
    const size = 32;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (isBlockId(id)) {
      const b = BLOCKS[id];
      if (b.render === 'cross' || b.render === 'crop' || b.render === 'torch' || b.render === 'rail' || b.shape === 'ladder' || b.shape === 'door') {
        const [sx, sy] = tileRect(b.tex[0]);
        ctx.drawImage(tintedCanvas, sx, sy, S, S, 0, 0, size, size);
      } else {
        drawIsoCube(ctx, size, b, iconBoxes(id));
      }
    } else {
      ctx.drawImage(itemCanvases[ITEMS[id].icon], 0, 0, size, size);
      if (typeof potion === 'number' && (id === ITEM.COMPASS || id === ITEM.CLOCK)) drawDial(ctx, id === ITEM.COMPASS, potion);
      if (potion || id === ITEM.POTION || id === ITEM.SPLASH_POTION) tintLiquid(ctx, size, potionColor(potion || 'water'));
    }
    const url = c.toDataURL();
    iconCache.set(key, url);
    return url;
  }

  // Isometric view of a block's boxes (a full cube for most blocks): for each box the top
  // and the two front faces, with the texture cropped to the box, drawn back to front.
  function drawIsoCube(ctx, size, b, boxes = [[0, 0, 0, 1, 1, 1]]) {
    const h = size / 2, q = size / 4;
    const P = (x, y, z) => [h * (x - z) + h, q * (x + z) - h * y + h];
    const face = (tex, O, A, B, sub, darken) => {
      const [sx, sy] = tileRect(tex);
      const [u0, v0, u1, v1] = sub; // fractions of the tile, v from the top
      const sw = Math.max(1e-3, (u1 - u0) * S), sh = Math.max(1e-3, (v1 - v0) * S);
      ctx.save();
      ctx.setTransform((A[0] - O[0]) / sw, (A[1] - O[1]) / sw, (B[0] - O[0]) / sh, (B[1] - O[1]) / sh, O[0], O[1]);
      ctx.drawImage(tintedCanvas, sx + u0 * S, sy + v0 * S, sw, sh, 0, 0, sw, sh);
      if (darken > 0) {
        ctx.fillStyle = `rgba(0,0,0,${darken})`;
        ctx.fillRect(0, 0, sw, sh);
      }
      ctx.restore();
    };
    const sorted = [...boxes].sort((m, n) => m[1] - n[1] || (m[0] + m[2]) - (n[0] + n[2]));
    for (const box of sorted) {
      const [x0, y0, z0, x1, y1, z1, t] = box;
      const tex = (f, slot) => (t === undefined ? b.tex[slot] : Array.isArray(t) ? t[f] : t);
      face(tex(3, 0), P(x0, y1, z0), P(x1, y1, z0), P(x0, y1, z1), [x0, z0, x1, z1], 0);
      face(tex(5, 1), P(x0, y1, z1), P(x1, y1, z1), P(x0, y0, z1), [x0, 1 - y1, x1, 1 - y0], 0.2);
      face(tex(1, 3), P(x1, y1, z1), P(x1, y1, z0), P(x1, y0, z1), [1 - z1, 1 - y1, 1 - z0, 1 - y0], 0.4);
    }
  }

  // Item texture for the held item / dropped item sprites.
  const itemTextureCache = new Map();
  function itemTexture(id) {
    if (itemTextureCache.has(id)) return itemTextureCache.get(id);
    const tex = new THREE.CanvasTexture(itemCanvases[ITEMS[id].icon]);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    itemTextureCache.set(id, tex);
    return tex;
  }

  // Tile texture for cross blocks shown as flat items (flowers, torches).
  function tileTexture(name) {
    const key = 'tile:' + name;
    if (itemTextureCache.has(key)) return itemTextureCache.get(key);
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const [sx, sy] = tileRect(name);
    c.getContext('2d').drawImage(tintedCanvas, sx, sy, S, S, 0, 0, S, S);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    itemTextureCache.set(key, tex);
    return tex;
  }

  // 10 crack stages for blocks being broken.
  const cracks = [];
  const crackRand = mulberry32(99);
  const lines = [];
  for (let i = 0; i < 40; i++) {
    let x = 8 + (crackRand() - 0.5) * 6, y = 8 + (crackRand() - 0.5) * 6;
    const pts = [];
    for (let k = 0; k < 5; k++) { pts.push([Math.floor(x), Math.floor(y)]); x += (crackRand() - 0.5) * 5; y += (crackRand() - 0.5) * 5; }
    lines.push(pts);
  }
  for (let stage = 0; stage < 10; stage++) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    for (let i = 0; i < (stage + 1) * 4; i++) {
      for (const [x, y] of lines[i]) ctx.fillRect(Math.max(0, Math.min(15, x)), Math.max(0, Math.min(15, y)), 1, 1);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    cracks.push(tex);
  }

  // A block tile as a data URL (for CSS, like the portal overlay).
  function tileURL(name) {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const [sx, sy] = tileRect(name);
    c.getContext('2d').drawImage(tintedCanvas, sx, sy, S, S, 0, 0, S, S);
    return c.toDataURL();
  }

  return { atlas, atlasSRGB, atlasTinted, atlasCanvas, iconURL, itemTexture, tileTexture, tileURL, cracks };
}
