// Tiny synthesized sound effects (no audio files needed).

import { BLOCK } from './blocks.js';

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

function material(id) {
  switch (id) {
    case BLOCK.STONE: case BLOCK.COBBLE: case BLOCK.BRICK: case BLOCK.STONE_BRICKS: case BLOCK.COAL_ORE:
    case BLOCK.IRON_ORE: case BLOCK.GOLD_ORE: case BLOCK.DIAMOND_ORE: case BLOCK.FURNACE: case BLOCK.SANDSTONE:
    case BLOCK.OBSIDIAN: case BLOCK.BEDROCK:
      return { freq: 1800, q: 1.5, duration: 0.12, gain: 0.35 };
    case BLOCK.LOG: case BLOCK.PLANKS: case BLOCK.BIRCH_LOG: case BLOCK.BIRCH_PLANKS: case BLOCK.CRAFTING_TABLE:
      return { freq: 700, q: 3, duration: 0.14, gain: 0.5 };
    case BLOCK.SAND: case BLOCK.SNOW: case BLOCK.SNOWY_GRASS:
      return { freq: 3500, q: 0.5, duration: 0.16, gain: 0.2, type: 'highpass' };
    case BLOCK.GLASS:
      return { freq: 4500, q: 8, duration: 0.25, gain: 0.3 };
    case BLOCK.LEAVES: case BLOCK.BIRCH_LEAVES: case BLOCK.TALL_GRASS: case BLOCK.DANDELION: case BLOCK.POPPY:
      return { freq: 2500, q: 0.7, duration: 0.15, gain: 0.25 };
    case BLOCK.WOOL:
      return { freq: 600, q: 0.5, duration: 0.12, gain: 0.25, type: 'lowpass' };
    default: // dirt, grass, gravel, clay
      return { freq: 1000, q: 0.8, duration: 0.15, gain: 0.35, type: 'lowpass' };
  }
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
  mobHurt(kind) {
    if (kind === 'zombie') tone({ freq: 140, endFreq: 90, duration: 0.3, gain: 0.3, type: 'sawtooth' });
    else if (kind === 'cow') tone({ freq: 220, endFreq: 160, duration: 0.35, gain: 0.3, type: 'sawtooth' });
    else tone({ freq: 520, endFreq: 300, duration: 0.2, gain: 0.25, type: 'square' });
  },
};
