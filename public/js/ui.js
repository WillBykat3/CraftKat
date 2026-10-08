// Inventory screens (survival inventory, crafting table, furnace, creative)
// and the in-game HUD (hotbar, hearts, hunger, air).

import { itemName, ITEMS, maxDurability, armorOf, CREATIVE_BLOCKS, CREATIVE_ITEMS, maxStack } from './blocks.js';
import {
  HOTBAR_SIZE, clickSlot, quickMove, findRecipe, consumeGrid, makeStack, addItem,
  RECIPES, recipeFits, craftableTimes, fillGrid, recipeResult, countItem,
} from './inventory.js';
import { LEVELS } from './trades.js';
import { sound } from './sound.js';

const $ = (id) => document.getElementById(id);

function el(tag, className, parent) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (parent) parent.appendChild(e);
  return e;
}

// Draws a stack into a slot element.
export function paintSlot(slotEl, stack, iconURL) {
  slotEl.innerHTML = '';
  slotEl.dataset.name = stack ? itemName(stack.id) : '';
  if (!stack) return;
  const img = el('img', 'icon', slotEl);
  img.src = iconURL(stack.id);
  img.draggable = false;
  if (stack.count > 1) el('span', 'count', slotEl).textContent = stack.count;
  const max = maxDurability(stack.id);
  if (max && stack.dur !== undefined && stack.dur < max) {
    const bar = el('div', 'dur', slotEl);
    const f = stack.dur / max;
    const fill = el('div', '', bar);
    fill.style.width = `${Math.max(0, f) * 100}%`;
    fill.style.background = `hsl(${f * 120}, 90%, 45%)`;
  }
}

export class InventoryScreen {
  // game: {inv (36 slots), iconURL, mode, onInventoryChange(), dropStack(stack), furnaceClick(slot, button, cursor)}
  constructor(game) {
    this.game = game;
    this.root = $('screen');
    this.cursor = null;
    this.kind = null;
    this.grid = [];
    this.furnace = null;
    this.cursorEl = $('cursor-stack');
    this.tooltip = $('tooltip');
    document.addEventListener('mousemove', (e) => {
      this.cursorEl.style.left = e.clientX + 'px';
      this.cursorEl.style.top = e.clientY + 'px';
      // item name tooltip, like Minecraft's, when hovering a filled slot with nothing held
      const slot = this.isOpen && !this.cursor && e.target.closest?.('#screen .slot');
      const name = slot ? slot.dataset.name : '';
      this.tooltip.classList.toggle('hidden', !name);
      if (name) {
        this.tooltip.textContent = name;
        const right = e.clientX + 18 + this.tooltip.offsetWidth > window.innerWidth;
        this.tooltip.style.left = (right ? e.clientX - 18 - this.tooltip.offsetWidth : e.clientX + 18) + 'px';
        this.tooltip.style.top = Math.max(4, e.clientY - 30) + 'px';
      }
    });
  }

  get isOpen() {
    return this.kind !== null;
  }

  // kind: 'inventory' | 'crafting' | 'furnace' | 'chest' | 'creative'
  open(kind, data = {}) {
    this.kind = kind;
    this.title = data.name; // e.g. Smoker or Barrel instead of Furnace or Chest
    this.gridSize = kind === 'crafting' ? 3 : 2;
    this.grid = new Array(this.gridSize * this.gridSize).fill(null);
    this.furnace = kind === 'furnace' ? { at: data.at, slots: [null, null, null], burn: 0, burnMax: 0, progress: 0 } : null;
    this.chest = kind === 'chest' ? { at: data.at, slots: new Array(27).fill(null), loaded: false } : null;
    this.trade = kind === 'trade' ? data : null;
    this.creativeTab = this.creativeTab || 'blocks';
    this.root.classList.remove('hidden');
    this.render();
  }

  close() {
    if (!this.kind) return;
    // give back anything left in the crafting grid or on the cursor
    for (const s of this.grid) if (s) this.returnStack(s);
    this.grid = [];
    if (this.cursor) this.returnStack(this.cursor);
    this.cursor = null;
    this.kind = null;
    this.tooltip.classList.add('hidden');
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
    this.paintCursor();
    this.game.onInventoryChange();
  }

  returnStack(s) {
    const left = addItem(this.game.inv, s.id, s.count, s.dur);
    if (left > 0) this.game.dropStack({ ...s, count: left });
  }

  setFurnaceState(state) {
    if (!this.furnace) return;
    Object.assign(this.furnace, state);
    this.render();
  }

  setChestState(state) {
    if (!this.chest) return;
    const [x, y, z] = this.chest.at;
    if (state.x !== x || state.y !== y || state.z !== z) return;
    this.chest.slots = state.slots;
    this.chest.loaded = true;
    this.render();
  }

  setCursor(stack) {
    this.cursor = stack;
    this.paintCursor();
  }

  paintCursor() {
    paintSlot(this.cursorEl, this.cursor, this.game.iconURL);
    this.cursorEl.classList.toggle('hidden', !this.cursor);
  }

  slot(parent, stack, onClick, extraClass = '') {
    const s = el('div', 'slot ' + extraClass, parent);
    paintSlot(s, stack, this.game.iconURL);
    s.addEventListener('mousedown', (e) => {
      e.preventDefault();
      onClick(e.button, e.shiftKey);
      sound.click();
      this.render();
      this.game.onInventoryChange();
    });
    return s;
  }

  // Helmet, chestplate, leggings and boots: each slot takes only its own kind of armor.
  armorSlots(parent) {
    const armor = this.game.armor;
    const col = el('div', 'armor-col', parent);
    ['helmet', 'chestplate', 'leggings', 'boots'].forEach((piece, i) => {
      this.slot(col, armor[i], (button, shift) => {
        if (shift) {
          if (armor[i] && addItem(this.game.inv, armor[i].id, armor[i].count, armor[i].dur) === 0) armor[i] = null;
        } else if (this.cursor) {
          const a = armorOf(this.cursor.id);
          if (!a || a.slot !== i || this.cursor.count !== 1) return;
          [armor[i], this.cursor] = [this.cursor, armor[i]];
        } else {
          this.cursor = armor[i];
          armor[i] = null;
        }
        this.game.armorChanged();
      }, armor[i] ? '' : 'armor-empty armor-' + piece);
    });
  }

  // inventory grid + hotbar, shared by every screen
  playerSlots(panel) {
    const inv = this.game.inv;
    const click = (i) => (button, shift) => {
      if (shift && this.kind === 'chest') {
        // straight into the chest (the host sends back anything that doesn't fit)
        const stack = inv[i];
        if (!stack) return;
        inv[i] = null;
        this.game.chestPut(this.chest.at, stack);
        return;
      }
      if (shift && this.kind !== 'creative') {
        const stack = inv[i];
        if (!stack) return;
        // armor goes straight into its slot when that's empty
        const a = armorOf(stack.id);
        if (a && this.kind === 'inventory' && !this.game.armor[a.slot]) {
          this.game.armor[a.slot] = stack;
          inv[i] = null;
          this.game.armorChanged();
          return;
        }
        // move between hotbar and backpack
        inv[i] = null;
        const targets = i < HOTBAR_SIZE ? range(HOTBAR_SIZE, 36) : range(0, HOTBAR_SIZE);
        const left = quickMove(stack, inv, targets);
        if (left) inv[i] = left;
        return;
      }
      if (shift && this.kind === 'creative') { inv[i] = null; return; }
      this.cursor = clickSlot(inv, i, this.cursor, button === 2 ? 2 : 0);
    };
    if (this.kind !== 'creative') {
      const main = el('div', 'grid9', panel);
      for (let i = HOTBAR_SIZE; i < 36; i++) this.slot(main, inv[i], click(i));
    }
    const bar = el('div', 'grid9 hotbar-row', panel);
    for (let i = 0; i < HOTBAR_SIZE; i++) this.slot(bar, inv[i], click(i));
  }

  // Minecraft's recipe book: every recipe that fits this grid, craftable ones first.
  recipeBook(parent) {
    const book = el('div', 'recipe-book', parent);
    el('h3', '', book).textContent = 'Recipe Book';
    const search = el('input', 'book-search', book);
    search.placeholder = 'Search…';
    search.value = this.bookSearch || '';
    const onlyLabel = el('label', 'book-only', book);
    const only = el('input', '', onlyLabel);
    only.type = 'checkbox';
    only.checked = !!this.bookOnlyCraftable;
    onlyLabel.append(' Only show what I can make');
    const list = el('div', 'book-list', book);
    const stacks = [...this.game.inv, ...this.grid];
    const entries = RECIPES.filter((r) => recipeFits(r, this.gridSize))
      .map((r) => ({ r, result: recipeResult(r), times: craftableTimes(r, stacks) }))
      .filter((e) => !this.bookOnlyCraftable || e.times > 0)
      .filter((e) => !this.bookSearch || itemName(e.result.id).toLowerCase().includes(this.bookSearch.toLowerCase()));
    entries.sort((a, b) => (b.times > 0) - (a.times > 0));
    const seen = new Set();
    for (const e of entries) {
      const key = e.result.id + ':' + (e.times > 0);
      if (seen.has(key)) continue; // e.g. the two plank recipes for one item
      seen.add(key);
      const s = el('div', 'slot book-entry' + (e.times > 0 ? ' can' : ''), list);
      paintSlot(s, e.result, this.game.iconURL);
      s.title = `${itemName(e.result.id)}${e.times > 0 ? '' : ' (missing ingredients)'}\n${describe(e.r)}`;
      s.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        this.useRecipe(e.r, ev.shiftKey);
      });
    }
    if (!entries.length) el('p', 'hint', list).textContent = 'Nothing to show.';
    search.addEventListener('input', () => {
      this.bookSearch = search.value;
      this.render();
      const again = this.root.querySelector('.book-search');
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    });
    search.addEventListener('keydown', (ev) => ev.stopPropagation()); // typing E shouldn't close the screen
    only.addEventListener('change', () => { this.bookOnlyCraftable = only.checked; this.render(); });
  }

  // Put a recipe's ingredients in the grid (shift: as many as possible).
  useRecipe(r, max) {
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i]) { this.returnStack(this.grid[i]); this.grid[i] = null; }
    }
    const times = max ? craftableTimes(r, this.game.inv) : 1;
    if (times > 0 && fillGrid(r, this.game.inv, this.grid, this.gridSize, times)) sound.click();
    this.render();
    this.game.onInventoryChange();
  }

  craftingArea(panel) {
    const size = this.gridSize;
    const toggle = el('button', 'book-toggle' + (this.bookOpen ? ' active' : ''), panel);
    toggle.textContent = '📖 Recipe Book';
    toggle.addEventListener('click', () => { this.bookOpen = !this.bookOpen; this.render(); });
    const row = el('div', 'craft-row', panel);
    if (this.kind === 'inventory' && this.game.armor) this.armorSlots(row);
    const gridEl = el('div', size === 3 ? 'grid3' : 'grid2', row);
    for (let i = 0; i < this.grid.length; i++) {
      this.slot(gridEl, this.grid[i], (button) => {
        this.cursor = clickSlot(this.grid, i, this.cursor, button === 2 ? 2 : 0);
      });
    }
    el('div', 'arrow', row).textContent = '➜';
    const result = findRecipe(this.grid, size);
    this.slot(row, result, (button, shift) => {
      if (!result) return;
      if (shift) {
        // craft as many as possible straight into the inventory
        for (let n = 0; n < 64; n++) {
          const r = findRecipe(this.grid, size);
          if (!r || addItem(this.game.inv, r.id, r.count, r.dur) > 0) break;
          consumeGrid(this.grid);
        }
        return;
      }
      if (!this.cursor) this.cursor = result;
      else if (this.cursor.id === result.id && result.dur === undefined && this.cursor.count + result.count <= maxStack(result.id)) {
        this.cursor = { ...this.cursor, count: this.cursor.count + result.count };
      } else return;
      consumeGrid(this.grid);
    }, 'result');
  }

  chestArea(panel) {
    const grid = el('div', 'grid9', panel);
    this.chest.slots.forEach((stack, i) => {
      this.slot(grid, stack, (button, shift) => {
        if (!this.chest.loaded) return;
        if (shift) { this.game.chestTake(this.chest.at, i); return; }
        this.game.chestClick(this.chest.at, i, button === 2 ? 2 : 0, this.cursor);
        this.cursor = null; // the host sends back what we end up holding
      });
    });
  }

  // A villager's offers: what it wants, and what it gives. Click one to trade.
  tradeArea(panel, title) {
    const t = this.trade;
    const job = t.profession.charAt(0).toUpperCase() + t.profession.slice(1);
    title.textContent = `${job} - ${LEVELS[t.level]}`;
    const bar = el('div', 'trade-xp', panel);
    const fill = el('div', 'trade-xp-fill', bar);
    fill.style.width = t.next ? `${Math.min(100, ((t.xp - t.prev) / (t.next - t.prev)) * 100)}%` : '100%';
    const list = el('div', 'trade-list', panel);
    t.offers.forEach((o, i) => {
      const row = el('div', 'trade-row' + (o.uses >= o.max ? ' sold-out' : ''), list);
      const afford = o.cost.every(([id, n]) => countItem(this.game.inv, id) >= n);
      if (!afford) row.classList.add('cant');
      for (const [id, n] of o.cost) this.slot(row, { id, count: n }, () => this.game.tradeOffer(i));
      el('span', 'trade-arrow', row).textContent = o.uses >= o.max ? '✕' : '→';
      this.slot(row, { id: o.result[0], count: o.result[1] }, () => this.game.tradeOffer(i));
      row.addEventListener('mousedown', (e) => { if (e.target === row) this.game.tradeOffer(i); });
    });
  }

  furnaceArea(panel) {
    const f = this.furnace;
    const row = el('div', 'furnace-row', panel);
    const col = el('div', 'furnace-col', row);
    const click = (slot) => (button) => {
      this.game.furnaceClick(f.at, slot, button === 2 ? 2 : 0, this.cursor);
      this.cursor = null; // the host sends back what we end up holding
    };
    this.slot(col, f.slots[0], click(0));
    const flame = el('div', 'flame', col);
    flame.style.setProperty('--fill', f.burnMax ? f.burn / f.burnMax : 0);
    this.slot(col, f.slots[1], click(1));
    const arrow = el('div', 'progress', row);
    arrow.style.setProperty('--fill', f.progress || 0);
    this.slot(row, f.slots[2], click(2), 'result');
  }

  creativeArea(panel) {
    const tabs = el('div', 'tabs', panel);
    for (const [tab, label] of [['blocks', 'Blocks'], ['items', 'Items']]) {
      const b = el('button', 'tab' + (this.creativeTab === tab ? ' active' : ''), tabs);
      b.textContent = label;
      b.addEventListener('click', () => { this.creativeTab = tab; this.render(); });
    }
    const list = el('div', 'creative-grid', panel);
    const ids = this.creativeTab === 'blocks' ? CREATIVE_BLOCKS : CREATIVE_ITEMS;
    for (const id of ids) {
      this.slot(list, { id, count: 1 }, (button, shift) => {
        if (this.cursor) { this.cursor = null; return; } // clicking the palette deletes what you hold
        const stack = makeStack(id, button === 2 || maxDurability(id) ? 1 : maxStack(id));
        if (shift) addItem(this.game.inv, stack.id, stack.count, stack.dur);
        else this.cursor = stack;
      });
    }
    const trash = el('div', 'trash-row', panel);
    el('span', '', trash).textContent = 'Drop items here to delete them →';
    this.slot(trash, null, () => { this.cursor = null; }, 'trash');
  }

  render() {
    if (!this.kind) return;
    this.root.innerHTML = '';
    this.tooltip.classList.add('hidden'); // the slot under the mouse may have changed
    const wrap = el('div', 'inv-wrap', this.root);
    if (this.bookOpen && (this.kind === 'inventory' || this.kind === 'crafting')) this.recipeBook(wrap);
    const panel = el('div', 'inv-panel', wrap);
    const title = el('h3', '', panel);
    title.textContent = this.title || { inventory: 'Crafting', crafting: 'Crafting Table', furnace: 'Furnace', chest: 'Chest', creative: 'Creative Inventory' }[this.kind];
    if (this.kind === 'inventory' || this.kind === 'crafting') this.craftingArea(panel);
    if (this.kind === 'furnace') this.furnaceArea(panel);
    if (this.kind === 'chest') this.chestArea(panel);
    if (this.kind === 'creative') this.creativeArea(panel);
    if (this.kind === 'trade') this.tradeArea(panel, title);
    el('h3', 'small', panel).textContent = 'Inventory';
    this.playerSlots(panel);
    el('p', 'hint', panel).textContent = this.kind === 'creative'
      ? 'Left click: full stack · Right click: one · Shift-click: straight to hotbar · E to close'
      : 'Left click: pick up/put down · Right click: split/place one · Shift-click: quick move · E to close';
    // clicking outside the panel drops what you hold
    this.root.onmousedown = (e) => {
      if (e.target === this.root && this.cursor) {
        if (e.button === 2 && this.cursor.count > 1) {
          this.game.dropStack({ ...this.cursor, count: 1 });
          this.cursor = { ...this.cursor, count: this.cursor.count - 1 };
        } else {
          this.game.dropStack(this.cursor);
          this.cursor = null;
        }
        this.render();
      }
    };
    this.paintCursor();
  }
}

function describe(r) {
  const names = new Map();
  for (const [k, ids] of Object.entries(r.keys)) names.set(k, ids.map(itemName).join(' or '));
  const parts = [...new Set(r.pattern.join('').replace(/[. ]/g, ''))].map((k) => {
    const n = r.pattern.join('').split(k).length - 1;
    return `${n}× ${names.get(k)}`;
  });
  return 'Needs: ' + parts.join(', ');
}

function range(a, b) {
  const out = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

// ---------- HUD ----------
export class HUD {
  constructor(iconURL) {
    this.iconURL = iconURL;
    this.hotbarEl = $('hotbar');
    this.slots = [];
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const slot = el('div', 'slot', this.hotbarEl);
      slot.style.left = (6 + i * 40) + 'px';
      this.slots.push(slot);
    }
    this.selector = el('div', '', this.hotbarEl);
    this.selector.id = 'selector';
    // 10 hearts, 10 drumsticks and 10 bubbles, built once and updated by class
    const row = (id, cls) => Array.from({ length: 10 }, () => el('i', cls, $(id)));
    this.hearts = row('hearts', 'heart');
    this.food = row('food', 'food');
    this.air = row('air', 'bubble');
    this.armorIcons = row('armor', 'armor');
    this.lastName = '';
    this.lastStats = '';
  }

  render(inv, selected, stats, mode) {
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const key = JSON.stringify(inv[i]);
      if (this.slots[i].dataset.key !== key) {
        this.slots[i].dataset.key = key;
        paintSlot(this.slots[i], inv[i], this.iconURL);
      }
    }
    this.selector.style.left = (-2 + selected * 40) + 'px';
    const survival = mode === 'survival';
    const name = inv[selected] ? itemName(inv[selected].id) : '';
    if (name !== this.lastName) {
      this.lastName = name;
      const n = $('itemname');
      n.textContent = name;
      n.classList.remove('fade');
      void n.offsetWidth;
      if (name) n.classList.add('fade');
    }
    $('itemname').classList.toggle('creative', !survival);
    const key = [mode, Math.ceil(stats.health), stats.food, Math.ceil(stats.air / 15), stats.hurtFlash, stats.xpLevel, stats.xpProgress, stats.armorPoints].join();
    if (key === this.lastStats) return;
    this.lastStats = key;
    $('stats').classList.toggle('hidden', !survival);
    $('xp').classList.toggle('hidden', !survival);
    if (!survival) return;
    setIcons(this.hearts, Math.ceil(stats.health));
    setIcons(this.armorIcons, stats.armorPoints || 0);
    $('armor').classList.toggle('hidden', !stats.armorPoints);
    setIcons(this.food, stats.food);
    setIcons(this.air, stats.air < 300 ? Math.ceil(stats.air / 15) : 0, true);
    $('hearts').classList.toggle('flash', !!stats.hurtFlash);
    $('hearts').classList.toggle('low', Math.ceil(stats.health) <= 4);
    $('xp-fill').style.width = `${Math.round((stats.xpProgress || 0) * 100)}%`;
    $('xp-level').textContent = stats.xpLevel > 0 ? stats.xpLevel : '';
  }
}

// value 0-20: two points per icon, like Minecraft. Bubbles have no "empty" look.
function setIcons(icons, value, hideEmpty = false) {
  icons.forEach((icon, i) => {
    const v = value - i * 2;
    const state = v >= 2 ? 'full' : v === 1 ? (hideEmpty ? 'full' : 'half') : 'empty';
    if (icon.dataset.state !== state) {
      icon.dataset.state = state;
      icon.className = icon.className.split(' ')[0] + ' ' + state;
      icon.style.visibility = hideEmpty && state === 'empty' ? 'hidden' : '';
    }
  });
}

export function foodName(id) {
  return ITEMS[id]?.food ? itemName(id) : null;
}
