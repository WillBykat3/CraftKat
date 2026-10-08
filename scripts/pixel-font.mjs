// Builds CraftKat's blocky pixel font (public/vendor/craftkat-font.otf) from
// the hand-drawn glyphs in public/js/pixel-glyphs.js.

import opentype from 'opentype.js';
import { GLYPHS } from '../public/js/pixel-glyphs.js';


const PX = 128;          // font units per pixel
const SPACE_ADVANCE = 4; // pixels

function glyphPath(rows) {
  const p = new opentype.Path();
  rows.forEach((row, r) => {
    // merge horizontal runs of pixels into rectangles
    let x = 0;
    while (x < row.length) {
      if (row[x] !== '#') { x++; continue; }
      let end = x;
      while (end < row.length && row[end] === '#') end++;
      const top = (7 - r) * PX, bottom = (6 - r) * PX;
      // clockwise outline (TrueType convention, also fine for CFF with non-zero filling)
      p.moveTo(x * PX, bottom);
      p.lineTo(x * PX, top);
      p.lineTo(end * PX, top);
      p.lineTo(end * PX, bottom);
      p.close();
      x = end;
    }
  });
  return p;
}

export function buildPixelFont() {
  const glyphs = [
    new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 6 * PX, path: glyphPath(['#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#####']) }),
    new opentype.Glyph({ name: 'space', unicode: 32, advanceWidth: SPACE_ADVANCE * PX, path: new opentype.Path() }),
    new opentype.Glyph({ name: 'nbsp', unicode: 0xa0, advanceWidth: SPACE_ADVANCE * PX, path: new opentype.Path() }),
  ];
  for (const [ch, rows] of Object.entries(GLYPHS)) {
    const width = Math.max(...rows.map((r) => r.length));
    glyphs.push(new opentype.Glyph({
      name: 'u' + ch.codePointAt(0).toString(16).padStart(4, '0'),
      unicode: ch.codePointAt(0),
      advanceWidth: (width + 1) * PX,
      path: glyphPath(rows),
    }));
  }
  const font = new opentype.Font({
    familyName: 'CraftKat Pixel',
    styleName: 'Regular',
    unitsPerEm: 8 * PX,  // font-size 8px = 1 screen pixel per font pixel
    ascender: 8 * PX,
    descender: -2 * PX,
    glyphs,
  });
  return Buffer.from(font.toArrayBuffer());
}
