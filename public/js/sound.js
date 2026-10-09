// Tiny synthesized sound effects (no audio files needed).

import { BLOCK, BLOCKS } from './blocks.js';

let ctx = null;
let noise = null;
let volume = 0.5;

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function audioContext() {
  return audio();
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
}

// filtered noise burst
function burst({ freq, q = 1, duration, gain, type = 'bandpass' }) {
  const a = audio();
  if (!a || volume === 0) return;
  const src = a.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const filter = a.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq * (0.9 + Math.random() * 0.2);
  filter.Q.value = q;
  const g = a.createGain();
  const t = a.currentTime;
  g.gain.setValueAtTime(gain * volume, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t, Math.random() * 0.5, duration + 0.05);
}

function tone({ freq, endFreq = freq, duration, gain, type = 'sine' }) {
  const a = audio();
  if (!a || volume === 0) return;
  const osc = a.createOscillator();
  osc.type = type;
  const t = a.currentTime;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
  const g = a.createGain();
  g.gain.setValueAtTime(gain * volume, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

// What a block sounds like, from its properties.
function material(id) {
  const b = BLOCKS[id] || BLOCKS[0];
  if (id === BLOCK.GLASS || id === BLOCK.ICE) return { freq: 4500, q: 8, duration: 0.25, gain: 0.3 };
  if (id === BLOCK.WOOL) return { freq: 600, q: 0.5, duration: 0.12, gain: 0.25, type: 'lowpass' };
  if (id === BLOCK.SAND || id === BLOCK.SNOW || id === BLOCK.SNOWY_GRASS) return { freq: 3500, q: 0.5, duration: 0.16, gain: 0.2, type: 'highpass' };
  if (b.tool === 'pickaxe' || id === BLOCK.BEDROCK) return { freq: 1800, q: 1.5, duration: 0.12, gain: 0.35 };
  if (b.tool === 'axe') return { freq: 700, q: 3, duration: 0.14, gain: 0.5 };
  if (b.render === 'cross' || /Leaves/.test(b.name || '')) return { freq: 2500, q: 0.7, duration: 0.15, gain: 0.25 };
  return { freq: 1000, q: 0.8, duration: 0.15, gain: 0.35, type: 'lowpass' }; // dirt, grass, gravel, clay
}

export const sound = {
  unlock() { audio(); },
  dig(id) { burst({ ...material(id), duration: material(id).duration * 0.7, gain: material(id).gain * 0.6 }); },
  broke(id) { const m = material(id); burst(m); burst({ ...m, freq: m.freq * 0.7, duration: m.duration * 1.5 }); },
  place(id) { burst(material(id)); },
  step(id) { const m = material(id); burst({ ...m, duration: 0.07, gain: m.gain * 0.35 }); },
  pop() { tone({ freq: 500, endFreq: 1200, duration: 0.08, gain: 0.15 }); },
  hurt() { tone({ freq: 300, endFreq: 140, duration: 0.18, gain: 0.35, type: 'square' }); },
  eat() { burst({ freq: 900, q: 2, duration: 0.09, gain: 0.3 }); },
  splash() { burst({ freq: 900, q: 0.4, duration: 0.4, gain: 0.35, type: 'lowpass' }); },
  boom() {
    burst({ freq: 120, q: 0.5, duration: 1.2, gain: 0.9, type: 'lowpass' });
    burst({ freq: 400, q: 0.5, duration: 0.6, gain: 0.5, type: 'lowpass' });
  },
  click() { tone({ freq: 900, duration: 0.04, gain: 0.08, type: 'triangle' }); },
  // a wooden door: a creak opening, a thud closing
  door(open) {
    if (open) { tone({ freq: 240, endFreq: 380, duration: 0.25, gain: 0.12, type: 'sawtooth' }); burst({ freq: 600, q: 3, duration: 0.12, gain: 0.3 }); }
    else burst({ freq: 300, q: 1.5, duration: 0.18, gain: 0.6, type: 'lowpass' });
  },
  // a lit fuse
  hiss() { burst({ freq: 5000, q: 0.6, duration: 1.2, gain: 0.25, type: 'highpass' }); },
  // a bow being released
  shieldBlock() { burst({ freq: 700, q: 2, duration: 0.15, gain: 0.4, type: 'lowpass' }); tone({ freq: 260, endFreq: 200, duration: 0.12, gain: 0.15, type: 'square' }); },
  cast() { burst({ freq: 1500, q: 1, duration: 0.2, gain: 0.15, type: 'highpass' }); },
  bow() { burst({ freq: 2200, q: 2, duration: 0.15, gain: 0.25 }); tone({ freq: 500, endFreq: 200, duration: 0.12, gain: 0.08, type: 'triangle' }); },
  // menu button: a short wooden "tock"
  button() { burst({ freq: 1400, q: 4, duration: 0.05, gain: 0.35 }); tone({ freq: 700, endFreq: 500, duration: 0.05, gain: 0.08, type: 'triangle' }); },
  // experience orb: a bright ding at a random pitch
  xp() {
    const f = 1500 * (0.7 + Math.random() * 0.6);
    tone({ freq: f, duration: 0.25, gain: 0.12 });
    tone({ freq: f * 2.01, duration: 0.15, gain: 0.04 });
  },
  levelUp() {
    [0, 0.12, 0.24].forEach((delay, i) => setTimeout(() => tone({ freq: [660, 880, 1320][i], duration: 0.5, gain: 0.12, type: 'triangle' }), delay * 1000));
  },
  // a ghast's screech before it spits a fireball
  ghast() {
    tone({ freq: 700, endFreq: 1500, duration: 0.5, gain: 0.18, type: 'sawtooth' });
    tone({ freq: 1050, endFreq: 1900, duration: 0.45, gain: 0.1, type: 'square' });
    setTimeout(() => burst({ freq: 500, q: 0.6, duration: 0.4, gain: 0.35, type: 'lowpass' }), 450);
  },
  // an eye of ender: thrown with a whoosh, or breaking like glass
  eye() { burst({ freq: 1800, q: 1, duration: 0.3, gain: 0.25 }); tone({ freq: 400, endFreq: 900, duration: 0.3, gain: 0.08, type: 'triangle' }); },
  shatter() { burst({ freq: 4500, q: 8, duration: 0.25, gain: 0.3 }); burst({ freq: 3000, q: 4, duration: 0.3, gain: 0.2 }); },
  // the End portal opening: a deep, rising chord heard everywhere
  endPortal() {
    [110, 165, 220, 330].forEach((f, i) => setTimeout(() => tone({ freq: f, endFreq: f * 1.5, duration: 2.5, gain: 0.1, type: 'sawtooth' }), i * 150));
    burst({ freq: 200, q: 0.5, duration: 2, gain: 0.4, type: 'lowpass' });
  },
  // the Ender Dragon: a deep growl, and its long death roar
  dragonGrowl() { tone({ freq: 90, endFreq: 60, duration: 1.2, gain: 0.35, type: 'sawtooth' }); burst({ freq: 300, q: 0.7, duration: 1, gain: 0.3, type: 'lowpass' }); },
  dragonDeath() {
    tone({ freq: 160, endFreq: 50, duration: 4, gain: 0.35, type: 'sawtooth' });
    tone({ freq: 240, endFreq: 70, duration: 4, gain: 0.2, type: 'square' });
    burst({ freq: 200, q: 0.4, duration: 4, gain: 0.5, type: 'lowpass' });
  },
  // water meeting lava
  fizz() { burst({ freq: 3500, q: 0.6, duration: 0.6, gain: 0.25, type: 'highpass' }); },
  // a villager's "hmm" (no, when they have nothing to trade)
  villagerNo() { tone({ freq: 220, endFreq: 160, duration: 0.25, gain: 0.25, type: 'triangle' }); setTimeout(() => tone({ freq: 200, endFreq: 150, duration: 0.2, gain: 0.2, type: 'triangle' }), 220); },
  // an anvil: a ringing clang (or a crash when it breaks)
  anvil() { tone({ freq: 1250, endFreq: 1180, duration: 0.6, gain: 0.15, type: 'triangle' }); tone({ freq: 2520, duration: 0.4, gain: 0.06 }); burst({ freq: 3000, q: 4, duration: 0.08, gain: 0.3 }); },
  anvilBreak() { burst({ freq: 400, q: 0.6, duration: 0.6, gain: 0.6, type: 'lowpass' }); burst({ freq: 2500, q: 2, duration: 0.3, gain: 0.3 }); },
  // drinking a potion, and a brewing stand finishing
  drink() { burst({ freq: 500, q: 3, duration: 0.12, gain: 0.25, type: 'lowpass' }); },
  brew() { tone({ freq: 700, endFreq: 1100, duration: 0.3, gain: 0.08 }); burst({ freq: 1500, q: 6, duration: 0.2, gain: 0.15 }); },
  // flint and steel: a scratchy strike
  ignite() { burst({ freq: 3200, q: 1.2, duration: 0.12, gain: 0.3 }); burst({ freq: 6000, q: 0.8, duration: 0.08, gain: 0.15, type: 'highpass' }); },
  // a portal: a wobbling hum when you step in (trip = false), a whoosh when you arrive (trip = true)
  portal(trip) {
    const a = audio();
    if (!a || volume === 0) return;
    const t = a.currentTime, len = trip ? 1.6 : 3;
    const osc = a.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(trip ? 300 : 70, t);
    osc.frequency.exponentialRampToValueAtTime(trip ? 60 : 160, t + len);
    const lfo = a.createOscillator();
    lfo.frequency.value = 6;
    const wobble = a.createGain();
    wobble.gain.value = 18;
    lfo.connect(wobble).connect(osc.frequency);
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 * volume, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(f).connect(g).connect(a.destination);
    osc.start(t); lfo.start(t);
    osc.stop(t + len + 0.05); lfo.stop(t + len + 0.05);
  },
  // a distant, eerie rumble deep in caves
  cave() {
    const a = audio();
    if (!a || volume === 0) return;
    const t = a.currentTime;
    const src = a.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 6;
    f.frequency.setValueAtTime(260 + Math.random() * 200, t);
    f.frequency.exponentialRampToValueAtTime(60, t + 4);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5 * volume, t + 1.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
    src.connect(f).connect(g).connect(a.destination);
    src.start(t);
    src.stop(t + 4.6);
    const osc = a.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110 + Math.random() * 40, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 4);
    const og = a.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.12 * volume, t + 1.5);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
    osc.connect(og).connect(a.destination);
    osc.start(t);
    osc.stop(t + 4.6);
  },
  // animals in love, a wolf being tamed (or not), and a piglin looking at gold
  love() { tone({ freq: 880, endFreq: 1320, duration: 0.15, gain: 0.12, type: 'triangle' }); setTimeout(() => tone({ freq: 1100, endFreq: 1500, duration: 0.15, gain: 0.1, type: 'triangle' }), 140); },
  smoke() { burst({ freq: 1200, q: 0.7, duration: 0.25, gain: 0.15, type: 'lowpass' }); },
  piglinAdmire() { tone({ freq: 300, endFreq: 420, duration: 0.3, gain: 0.25, type: 'sawtooth' }); },
  slime() { burst({ freq: 300, q: 2, duration: 0.15, gain: 0.3, type: 'lowpass' }); },
  mobHurt(kind) {
    if (kind === 'zombie' || kind === 'husk') tone({ freq: 140, endFreq: 90, duration: 0.3, gain: 0.3, type: 'sawtooth' });
    else if (kind === 'enderman') { tone({ freq: 900, endFreq: 300, duration: 0.6, gain: 0.25, type: 'sawtooth' }); tone({ freq: 1250, endFreq: 420, duration: 0.6, gain: 0.15, type: 'square' }); }
    else if (kind === 'ender_dragon') { tone({ freq: 120, endFreq: 70, duration: 0.6, gain: 0.35, type: 'sawtooth' }); burst({ freq: 400, q: 0.5, duration: 0.5, gain: 0.3, type: 'lowpass' }); }
    else if (kind === 'end_crystal') return;
    else if (kind === 'villager') tone({ freq: 260, endFreq: 190, duration: 0.25, gain: 0.3, type: 'triangle' });
    else if (kind === 'iron_golem') burst({ freq: 900, q: 3, duration: 0.25, gain: 0.4 });
    else if (kind === 'ghast') tone({ freq: 1200, endFreq: 500, duration: 0.6, gain: 0.2, type: 'sawtooth' });
    else if (kind === 'zombified_piglin') { tone({ freq: 260, endFreq: 120, duration: 0.3, gain: 0.3, type: 'sawtooth' }); burst({ freq: 700, q: 2, duration: 0.15, gain: 0.2 }); }
    else if (kind === 'blaze') { burst({ freq: 300, q: 0.5, duration: 0.4, gain: 0.3, type: 'lowpass' }); tone({ freq: 180, endFreq: 120, duration: 0.3, gain: 0.15, type: 'square' }); }
    else if (kind === 'slime' || kind === 'magma_cube') this.slime();
    else if (kind === 'wolf') tone({ freq: 700, endFreq: 500, duration: 0.15, gain: 0.25, type: 'square' });
    else if (kind === 'witch') tone({ freq: 500, endFreq: 380, duration: 0.3, gain: 0.25, type: 'sawtooth' });
    else if (kind === 'drowned') tone({ freq: 120, endFreq: 80, duration: 0.35, gain: 0.3, type: 'sawtooth' });
    else if (kind === 'phantom') tone({ freq: 900, endFreq: 1300, duration: 0.3, gain: 0.2, type: 'sawtooth' });
    else if (kind === 'piglin') tone({ freq: 280, endFreq: 160, duration: 0.25, gain: 0.3, type: 'sawtooth' });
    else if (kind === 'bat' || kind === 'rabbit') tone({ freq: 1800, endFreq: 1400, duration: 0.1, gain: 0.15, type: 'square' });
    else if (kind === 'squid') return;
    else if (kind === 'cow') tone({ freq: 220, endFreq: 160, duration: 0.35, gain: 0.3, type: 'sawtooth' });
    else tone({ freq: 520, endFreq: 300, duration: 0.2, gain: 0.25, type: 'square' });
  },
};
