// All artwork is drawn here with code: block textures (packed into one atlas),
// item icons, inventory block icons and block-breaking cracks.

import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { TILE as S, ATLAS_TILES, TILE_NAMES, tileIndex } from './atlas-layout.js';
import { BLOCKS, ITEMS, isBlockId } from './blocks.js';
import { DEFAULT_GRASS, DEFAULT_FOLIAGE, BIOMES, BIOME } from './biomes.js';

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
    case 'wool': p.noisy([235, 235, 235], 0.06); break;
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
    default:
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) px(x, y, (x < 8) === (y < 8) ? [255, 0, 255] : [0, 0, 0]);
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

function drawItem(p, icon) {
  const { px, rand } = p;
  const tool = icon.match(/^(wood|stone|iron|diamond)_(pickaxe|axe|shovel|sword)$/);
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
  switch (icon) {
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
    case 'bucket':
    case 'water_bucket':
      for (let y = 4; y < 14; y++) for (let x = 4 + (y - 4) / 5; x < 12 - (y - 4) / 5; x++) px(Math.floor(x), y, shade([200, 200, 205], y === 4 ? 1.15 : 0.85 + rand() * 0.15));
      for (let x = 5; x < 11; x++) px(x, 2, [150, 150, 155]);
      px(4, 3, [150, 150, 155]); px(11, 3, [150, 150, 155]);
      if (icon === 'water_bucket') for (let x = 5; x < 11; x++) { px(x, 4, [60, 100, 230]); px(x, 5, [50, 85, 210]); }
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
    case 'string':
      for (let i = 0; i < 12; i++) px(2 + i, 8 + Math.round(Math.sin(i * 0.9) * 2), [235, 235, 235]);
      break;
    default: px(8, 8, [255, 0, 255]);
  }
}

// ---------- public API ----------
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
  function iconURL(id) {
    if (iconCache.has(id)) return iconCache.get(id);
    const size = 32;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (isBlockId(id)) {
      const b = BLOCKS[id];
      if (b.render === 'cross') {
        const [sx, sy] = tileRect(b.tex[0]);
        ctx.drawImage(tintedCanvas, sx, sy, S, S, 0, 0, size, size);
      } else {
        drawIsoCube(ctx, size, b);
      }
    } else {
      ctx.drawImage(itemCanvases[ITEMS[id].icon], 0, 0, size, size);
    }
    const url = c.toDataURL();
    iconCache.set(id, url);
    return url;
  }

  // Isometric cube: top face plus two shaded side faces.
  function drawIsoCube(ctx, size, b) {
    const h = size / 2;
    const q = size / 4;
    const face = (tex, transform, darken) => {
      const [sx, sy] = tileRect(tex);
      ctx.save();
      ctx.setTransform(...transform);
      ctx.drawImage(tintedCanvas, sx, sy, S, S, 0, 0, S, S);
      if (darken > 0) {
        ctx.fillStyle = `rgba(0,0,0,${darken})`;
        ctx.fillRect(0, 0, S, S);
      }
      ctx.restore();
    };
    const k = 1 / S;
    // top: maps the tile onto the rhombus (h,0) (size,q) (h,h) (0,q)
    face(b.tex[0], [h * k, q * k, -h * k, q * k, h, 0.5], 0);
    // left side: (0,q) -> (h,h) across, down to (0,3q)
    face(b.tex[1], [h * k, q * k, 0, h * k, 0, q], 0.2);
    // right side: (h,h) -> (size,q) across
    face(b.tex[3], [h * k, -q * k, 0, h * k, h, h], 0.4);
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

  return { atlas, atlasSRGB, atlasCanvas, iconURL, itemTexture, tileTexture, cracks };
}
