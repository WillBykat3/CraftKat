// Calm, generated piano music in the spirit of Minecraft's soundtrack: a
// slow piece now and then, with long quiet gaps in between. Every piece is
// composed on the spot from a random key, scale and melody.

import { audioContext } from './sound.js';

const SCALES = [
  [0, 2, 4, 7, 9],         // major pentatonic
  [0, 2, 4, 6, 7, 9, 11],  // lydian
  [0, 2, 3, 7, 9],         // dorian-ish pentatonic
  [0, 2, 4, 5, 7, 9, 11],  // major
  [0, 3, 5, 7, 10],        // minor pentatonic
];
const ROOTS = [48, 50, 53, 55, 57]; // C3 D3 F3 G3 A3 (MIDI)
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

let volume = 0.5;
let out = null;        // music gain node
let playing = false;
let nextPieceAt = 0;   // audio time
let notes = [];        // queued [time, midi, velocity, length]
let timer = null;

export function setMusicVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (out) out.gain.value = volume * 0.5;
}

function setup(ctx) {
  if (out) return;
  out = ctx.createGain();
  out.gain.value = volume * 0.5;
  // a soft reverb from decaying noise
  const len = ctx.sampleRate * 3;
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  const verb = ctx.createConvolver();
  verb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.45;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 3200;
  out.connect(tone);
  tone.connect(ctx.destination);
  tone.connect(verb).connect(wet).connect(ctx.destination);
}

// One piano-like note: a few harmonics with a soft attack and a long decay.
function pianoNote(ctx, time, midi, velocity, length) {
  const f = midiHz(midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, time);
  g.gain.exponentialRampToValueAtTime(0.22 * velocity, time + 0.012);
  g.gain.exponentialRampToValueAtTime(0.06 * velocity, time + 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, time + length);
  g.connect(out);
  for (const [mult, amp, type] of [[1, 1, 'sine'], [2, 0.35, 'sine'], [3, 0.1, 'sine'], [1.002, 0.25, 'triangle']]) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = f * mult;
    const og = ctx.createGain();
    og.gain.value = amp;
    osc.connect(og).connect(g);
    osc.start(time);
    osc.stop(time + length + 0.05);
  }
}

// Writes a whole piece as a list of notes starting at `start`.
function compose(start) {
  const scale = SCALES[Math.floor(Math.random() * SCALES.length)];
  const root = ROOTS[Math.floor(Math.random() * ROOTS.length)];
  const beat = 0.75 + Math.random() * 0.45;
  const bars = 16 + Math.floor(Math.random() * 12);
  const degree = (d) => root + 12 * Math.floor(d / scale.length) + scale[((d % scale.length) + scale.length) % scale.length];
  // a short chord progression (scale degrees of the bass), repeated
  const progression = [0, 3, 4, 2, 0, 5, 3, 4].slice(0, 4 + Math.floor(Math.random() * 5));
  const list = [];
  let melody = scale.length * 2 + Math.floor(Math.random() * scale.length); // around the octave above
  let t = start;
  for (let bar = 0; bar < bars; bar++) {
    const chord = progression[bar % progression.length];
    const fadeIn = Math.min(1, (bar + 1) / 3), fadeOut = Math.min(1, (bars - bar) / 3);
    const dyn = 0.55 + 0.45 * Math.min(fadeIn, fadeOut);
    // left hand: a low root and a spread chord, softly
    list.push([t, degree(chord) - 12, 0.5 * dyn, beat * 4.5]);
    list.push([t + beat * 0.5, degree(chord + 2), 0.32 * dyn, beat * 3.5]);
    list.push([t + beat, degree(chord + 4), 0.3 * dyn, beat * 3]);
    // right hand: a wandering melody with plenty of rests
    for (let b = 0; b < 4; b++) {
      if (Math.random() < (b === 0 ? 0.25 : 0.45)) continue;
      melody += [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
      melody = Math.max(scale.length, Math.min(scale.length * 4, melody));
      const swing = b % 2 ? beat * 0.06 : 0;
      list.push([t + b * beat + swing, degree(melody), (0.45 + Math.random() * 0.25) * dyn, beat * 3]);
      if (Math.random() < 0.15) list.push([t + b * beat + beat * 0.5, degree(melody + 1), 0.3 * dyn, beat * 2]);
    }
    t += beat * 4;
  }
  list.sort((a, b) => a[0] - b[0]);
  return { list, end: t + beat * 4 };
}

function pump() {
  const ctx = audioContext();
  if (!ctx || !playing) return;
  setup(ctx);
  const now = ctx.currentTime;
  if (!notes.length && now >= nextPieceAt) {
    const piece = compose(now + 0.5);
    notes = piece.list;
    // then a quiet gap of 2-6 minutes, like Minecraft
    nextPieceAt = piece.end + 120 + Math.random() * 240;
  }
  // schedule what falls within the next 2 seconds
  while (notes.length && notes[0][0] < now + 2) {
    const [time, midi, vel, len] = notes.shift();
    if (volume > 0) pianoNote(ctx, Math.max(time, now), midi, vel, len);
  }
}

export const music = {
  // starts the music after a short wait (needs a user gesture first)
  start(delaySeconds = 20 + Math.random() * 40) {
    const ctx = audioContext();
    if (!ctx || playing) return;
    playing = true;
    nextPieceAt = ctx.currentTime + delaySeconds;
    timer = setInterval(pump, 500);
  },
  stop() {
    playing = false;
    notes = [];
    clearInterval(timer);
  },
  get playing() { return playing; },
  // for testing: play a piece right away
  playNow() {
    const ctx = audioContext();
    if (!ctx) return;
    if (!playing) this.start(0);
    notes = [];
    nextPieceAt = ctx.currentTime;
  },
};
