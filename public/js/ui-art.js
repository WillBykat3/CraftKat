// Pixel art for the interface (hearts, hunger, bubbles, hotbar, buttons and
// the logo), drawn with code and handed to CSS as images.

import { GLYPHS } from './pixel-glyphs.js';
import { mulberry32 } from './noise.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Draws a bitmap (rows of characters) with a palette {char: css colour}.
function bitmap(rows, palette) {
  const c = canvas(Math.max(...rows.map((r) => r.length)), rows.length);
  const ctx = c.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = palette[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return c.toDataURL();
}

const HEART = [
  '.oo...oo.',
  'orwo.orro',
  'owrrorrro',
  'orrrrrrro',
  '.orrrrro.',
  '..orrro..',
  '...oro...',
  '....o....',
];
const HEART_HALF = HEART.map((row) => row.split('').map((c, x) => (x > 4 && c !== 'o' && c !== '.' ? 'e' : c)).join(''));
const HEART_EMPTY = HEART.map((row) => row.replace(/[rw]/g, 'e'));

const FOOD = [
  '.....oo..',
  '....obbo.',
  '...obwbbo',
  '...obbbbo',
  '..oobbbo.',
  '.owoooo..',
  'owo......',
  '.o.......',
];
const FOOD_HALF = FOOD.map((row) => row.split('').map((c, x) => (x < 5 && (c === 'b' || c === 'w') ? 'e' : c)).join(''));
const FOOD_EMPTY = FOOD.map((row) => row.replace(/[bw]/g, 'e'));

const ARMOR = [
  '.oo...oo.',
  'oaaoooaao',
  'oaaaaaaao',
  '.oaaaaao.',
  '.oaaaaao.',
  '.oaaaaao.',
  '.oaaaaao.',
  '..ooooo..',
];
const ARMOR_HALF = ARMOR.map((row) => row.split('').map((c, x) => (x > 4 && c === 'a' ? 'e' : c)).join(''));
const ARMOR_EMPTY = ARMOR.map((row) => row.replace(/a/g, 'e'));
// faint outlines in empty armor slots
const SLOT_ICONS = {
  Helmet: ['', '', '', '...oooooooo...', '..o........o..', '..o..oooo..o..', '..o.o....o.o..', '..oo......oo..'],
  Chestplate: ['', '..ooo....ooo..', '.o..oooooo..o.', '.o..........o.', '..oo......oo..', '...o......o...', '...o......o...', '...o......o...', '...o......o...', '...oooooooo...'],
  Leggings: ['', '...oooooooo...', '...o......o...', '...o..oo..o...', '...o..oo..o...', '...o..oo..o...', '...o..oo..o...', '...o..oo..o...', '...oooooooo...'],
  Boots: ['', '', '', '', '', '...ooo..ooo...', '...o.o..o.o...', '...o.o..o.o...', '..oo.o..o.oo..', '..oooo..oooo..'],
};

const BUBBLE = [
  '..ooooo..',
  '.oaaaaao.',
  'oawwaaaao',
  'oawaaaaao',
  'oaaaaaaao',
  'oaaaaaaao',
  '.oaaaaao.',
  '..ooooo..',
];

export function createUIArt() {
  const art = {};
  const heartPal = { o: '#000', r: '#e01818', w: '#ff9a9a', e: '#2a0000' };
  const flashPal = { o: '#fff', r: '#ff4848', w: '#ffd0d0', e: '#5a2020' };
  art.heartFull = bitmap(HEART, heartPal);
  art.heartHalf = bitmap(HEART_HALF, heartPal);
  art.heartEmpty = bitmap(HEART_EMPTY, heartPal);
  art.heartFullFlash = bitmap(HEART, flashPal);
  art.heartHalfFlash = bitmap(HEART_HALF, flashPal);
  art.heartEmptyFlash = bitmap(HEART_EMPTY, flashPal);
  const foodPal = { o: '#2b1607', b: '#b5651d', w: '#f4e9d8', e: '#3a2a1e' };
  art.foodFull = bitmap(FOOD, foodPal);
  art.foodHalf = bitmap(FOOD_HALF, foodPal);
  art.foodEmpty = bitmap(FOOD_EMPTY, foodPal);
  art.bubble = bitmap(BUBBLE, { o: '#0d3b8f', a: '#3a86e8', w: '#d4ecff' });
  const armorPal = { o: '#1a1a1a', a: '#d8d8d8', e: '#3a3a3a' };
  art.armorFull = bitmap(ARMOR, armorPal);
  art.armorHalf = bitmap(ARMOR_HALF, armorPal);
  art.armorEmpty = bitmap(ARMOR_EMPTY, armorPal);
  for (const [name, rows] of Object.entries(SLOT_ICONS)) art['slot' + name] = bitmap(rows.map((r) => r.padEnd(14, '.')), { o: '#373737' });

  // hotbar: 182 x 22, nine 20-pixel cells
  {
    const c = canvas(182, 22);
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, 182, 22);
    for (let i = 0; i < 9; i++) {
      const x = 1 + i * 20;
      ctx.fillStyle = '#4e4e4e'; ctx.fillRect(x, 1, 20, 20);
      ctx.fillStyle = '#2a2a2a'; ctx.fillRect(x + 1, 2, 18, 18);
      ctx.fillStyle = 'rgba(139,139,139,0.55)'; ctx.fillRect(x + 2, 3, 16, 16);
    }
    art.hotbar = c.toDataURL();
  }
  // selected-slot frame: 24 x 24
  {
    const c = canvas(24, 24);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 24, 24);
    ctx.fillStyle = '#fff';
    ctx.fillRect(1, 1, 22, 22);
    ctx.fillStyle = '#9a9a9a';
    ctx.fillRect(3, 3, 18, 18);
    ctx.clearRect(4, 4, 16, 16);
    art.selector = c.toDataURL();
  }
  // button faces: noisy grey stone, 200 x 20 (drawn twice as large)
  const buttonFace = (base) => {
    const c = canvas(200, 20);
    const ctx = c.getContext('2d');
    const rand = mulberry32(base[0] * 7 + 3);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 200; x++) {
        const f = 0.92 + rand() * 0.16;
        ctx.fillStyle = `rgb(${base[0] * f | 0},${base[1] * f | 0},${base[2] * f | 0})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return c.toDataURL();
  };
  art.button = buttonFace([111, 111, 111]);
  art.buttonHover = buttonFace([126, 132, 160]);
  art.buttonDisabled = buttonFace([60, 60, 60]);
  return art;
}

// Puts the art into CSS custom properties, so style.css can use it.
export function applyUIArt(art) {
  const root = document.documentElement.style;
  for (const [name, url] of Object.entries(art)) root.setProperty('--art-' + name, `url(${url})`);
}

// The title logo: the text built from stone blocks, one block per font pixel,
// with a dark 3D edge underneath, like Minecraft's logo.
export function drawLogo(text, block = 7) {
  const glyphs = [...text].map((ch) => (ch === ' ' ? ['...'] : GLYPHS[ch] || ['#']));
  const widths = glyphs.map((g) => Math.max(...g.map((r) => r.length)));
  const cols = widths.reduce((a, w) => a + w + 1, -1);
  const depth = 3; // extrusion, in pixels of a block
  const c = canvas(cols * block + depth * 2 + 4, 7 * block + depth * 2 + 4);
  const ctx = c.getContext('2d');
  const rand = mulberry32(42);
  const cells = [];
  let ox = 0;
  glyphs.forEach((g, i) => {
    g.slice(0, 7).forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === '#') cells.push([ox + x, y]);
    });
    ox += widths[i] + 1;
  });
  const at = (x, y, d) => [2 + x * block + d, 2 + y * block + d];
  // black outline, then the dark extruded sides, then the stone faces
  ctx.fillStyle = '#000';
  for (const [x, y] of cells) { const [px, py] = at(x, y, 0); ctx.fillRect(px - 2, py - 2, block + 4 + depth * 2, block + 4 + depth * 2); }
  for (let d = depth * 2; d > 0; d--) {
    for (const [x, y] of cells) {
      const [px, py] = at(x, y, d);
      ctx.fillStyle = d > depth ? '#2c2c2c' : '#454545';
      ctx.fillRect(px, py, block, block);
    }
  }
  for (const [x, y] of cells) {
    const [px, py] = at(x, y, 0);
    for (let yy = 0; yy < block; yy++) {
      for (let xx = 0; xx < block; xx++) {
        let v = 150 + rand() * 50 - yy * 6;
        if (yy === 0 || xx === 0) v += 30;
        if (yy === block - 1 || xx === block - 1) v -= 35;
        v = Math.max(0, Math.min(255, v));
        ctx.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
        ctx.fillRect(px + xx, py + yy, 1, 1);
      }
    }
  }
  return c;
}
