// Звуковые эффекты, синтезированные Web Audio: без файлов, весят ноль байт.
// Каждый эффект — короткая сборка из тонов, шума и огибающих.

import { getMix, type Mix } from './engine';

export type Cue =
  | 'click'
  | 'select'
  | 'step'
  | 'hooves'
  | 'jump'
  | 'claim'
  | 'coins'
  | 'build'
  | 'found'
  | 'melee'
  | 'arrow'
  | 'death'
  | 'capture'
  | 'merge'
  | 'war'
  | 'peace'
  | 'diplomacy'
  | 'ability'
  | 'wonder'
  | 'epoch'
  | 'turn'
  | 'alarm'
  | 'error'
  | 'victory'
  | 'defeat';

interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  /** Частота в конце (глиссандо). */
  to?: number;
  at?: number;
  attack?: number;
  decay: number;
  gain: number;
  /** Доля в реверберацию. */
  wet?: number;
  /** Срез фильтра низких частот (для «медных» и мягких тембров). */
  lowpass?: number;
  vibrato?: number;
}

function tone(m: Mix, o: ToneOpts): void {
  const { ctx } = m;
  const t = ctx.currentTime + (o.at ?? 0);
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.attack ?? 0.005) + o.decay);
  let node: AudioNode = osc;
  if (o.lowpass) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.lowpass;
    node.connect(f);
    node = f;
  }
  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 5.5;
    depth.gain.value = o.vibrato;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + (o.attack ?? 0.005) + o.decay + 0.1);
  }
  const env = ctx.createGain();
  const attack = o.attack ?? 0.005;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(o.gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + attack + o.decay);
  node.connect(env);
  env.connect(m.sfx);
  if (o.wet) {
    const send = ctx.createGain();
    send.gain.value = o.wet;
    env.connect(send).connect(m.sfxReverb);
  }
  osc.start(t);
  osc.stop(t + attack + o.decay + 0.05);
}

interface NoiseOpts {
  at?: number;
  attack?: number;
  decay: number;
  gain: number;
  filter: BiquadFilterType;
  freq: number;
  /** Частота фильтра в конце (свист, взмах). */
  to?: number;
  q?: number;
  wet?: number;
}

function noise(m: Mix, o: NoiseOpts): void {
  const { ctx } = m;
  const t = ctx.currentTime + (o.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = m.noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = o.filter;
  f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.freq, t);
  const attack = o.attack ?? 0.003;
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + attack + o.decay);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(o.gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + attack + o.decay);
  src.connect(f).connect(env).connect(m.sfx);
  if (o.wet) {
    const send = ctx.createGain();
    send.gain.value = o.wet;
    env.connect(send).connect(m.sfxReverb);
  }
  src.start(t, (o.at ?? 0) % 0.5);
  src.stop(t + attack + o.decay + 0.05);
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** Колокол: негармонические обертоны с долгим затуханием. */
function bell(m: Mix, note: number, at: number, gain: number, decay = 2.2): void {
  const f = midi(note);
  for (const [ratio, g, d] of [
    [1, 1, 1],
    [2.76, 0.45, 0.6],
    [5.4, 0.25, 0.35],
    [8.93, 0.12, 0.2],
  ]) {
    tone(m, { freq: f * ratio, at, decay: decay * d, gain: gain * g, wet: 0.5 });
  }
}

/** Щипок струны (арфа, лютня). */
function pluck(m: Mix, note: number, at: number, gain: number, decay = 0.9): void {
  const f = midi(note);
  tone(m, { type: 'triangle', freq: f, at, decay, gain, lowpass: 2600, wet: 0.35 });
  tone(m, { freq: f * 2, at, decay: decay * 0.4, gain: gain * 0.3, wet: 0.35 });
}

/** Медный рог: пила через фильтр, мягкая атака, лёгкое вибрато. */
function horn(m: Mix, note: number, at: number, dur: number, gain: number): void {
  const f = midi(note);
  tone(m, { type: 'sawtooth', freq: f, at, attack: 0.06, decay: dur, gain, lowpass: 1100, vibrato: f * 0.006, wet: 0.4 });
  tone(m, { type: 'sawtooth', freq: f * 1.003, at, attack: 0.08, decay: dur, gain: gain * 0.6, lowpass: 900, wet: 0.4 });
}

/** Барабан: тон с падением высоты и шумовой удар. */
function drum(m: Mix, at: number, gain: number, pitch = 90): void {
  tone(m, { freq: pitch, to: pitch * 0.45, at, decay: 0.35, gain, wet: 0.25 });
  noise(m, { at, decay: 0.08, gain: gain * 0.5, filter: 'lowpass', freq: 900 });
}

function thud(m: Mix, at: number, gain: number): void {
  noise(m, { at, decay: 0.07, gain, filter: 'lowpass', freq: 700, q: 0.7 });
  tone(m, { freq: 140, to: 70, at, decay: 0.09, gain: gain * 0.5 });
}

function coin(m: Mix, at: number, pitch: number, gain: number): void {
  tone(m, { freq: pitch, at, decay: 0.25, gain, wet: 0.25 });
  tone(m, { freq: pitch * 1.5, at, decay: 0.18, gain: gain * 0.5, wet: 0.25 });
  tone(m, { freq: pitch * 2.42, at, decay: 0.12, gain: gain * 0.3 });
}

const CUES: Record<Cue, (m: Mix) => void> = {
  click: (m) => noise(m, { decay: 0.025, gain: 0.12, filter: 'bandpass', freq: 2600, q: 3 }),
  select: (m) => {
    noise(m, { decay: 0.03, gain: 0.1, filter: 'bandpass', freq: 1800, q: 4 });
    tone(m, { type: 'triangle', freq: 660, at: 0.01, decay: 0.12, gain: 0.07 });
  },
  step: (m) => {
    for (const at of [0, 0.16, 0.32]) noise(m, { at, decay: 0.07, gain: 0.16, filter: 'lowpass', freq: 650, q: 0.8 });
  },
  hooves: (m) => {
    for (const at of [0, 0.09, 0.24, 0.33, 0.48, 0.57]) thud(m, at, 0.18);
  },
  jump: (m) => {
    noise(m, { attack: 0.15, decay: 0.4, gain: 0.14, filter: 'bandpass', freq: 400, to: 2400, q: 2, wet: 0.4 });
    tone(m, { freq: midi(81), to: midi(93), attack: 0.1, decay: 0.45, gain: 0.04, wet: 0.6 });
  },
  claim: (m) => {
    pluck(m, 76, 0, 0.12);
    pluck(m, 83, 0.09, 0.1);
  },
  coins: (m) => {
    [2100, 2500, 2300, 2700].forEach((p, i) => coin(m, i * 0.06, p, 0.07));
  },
  build: (m) => {
    // Стук молотка по дереву и монеты.
    for (const at of [0, 0.18, 0.36]) noise(m, { at, decay: 0.05, gain: 0.25, filter: 'bandpass', freq: 900, q: 2 });
    [2100, 2500].forEach((p, i) => coin(m, 0.45 + i * 0.07, p, 0.06));
  },
  found: (m) => {
    drum(m, 0, 0.35, 80);
    horn(m, 62, 0.05, 0.35, 0.09);
    horn(m, 69, 0.4, 0.35, 0.09);
    horn(m, 74, 0.75, 0.9, 0.1);
    bell(m, 86, 0.75, 0.05);
  },
  melee: (m) => {
    // Звон клинков: высокий шум и металлические обертоны, удар.
    noise(m, { decay: 0.12, gain: 0.3, filter: 'highpass', freq: 3000 });
    for (const [f, g] of [
      [2480, 0.08],
      [3710, 0.06],
      [5150, 0.04],
    ]) {
      tone(m, { freq: f, decay: 0.35, gain: g, wet: 0.3 });
    }
    thud(m, 0.02, 0.3);
    noise(m, { at: 0.16, decay: 0.1, gain: 0.18, filter: 'highpass', freq: 3500 });
    tone(m, { freq: 3100, at: 0.16, decay: 0.25, gain: 0.05, wet: 0.3 });
  },
  arrow: (m) => {
    tone(m, { type: 'triangle', freq: 220, to: 200, decay: 0.25, gain: 0.14 });
    noise(m, { at: 0.03, attack: 0.05, decay: 0.3, gain: 0.12, filter: 'bandpass', freq: 2200, to: 700, q: 3 });
    thud(m, 0.38, 0.2);
  },
  death: (m) => {
    tone(m, { freq: 110, to: 40, decay: 0.6, gain: 0.25 });
    noise(m, { decay: 0.3, gain: 0.2, filter: 'lowpass', freq: 500 });
  },
  capture: (m) => {
    for (const at of [0, 0.12, 0.24]) drum(m, at, 0.3, 75);
    horn(m, 62, 0.3, 0.25, 0.09);
    horn(m, 66, 0.55, 0.25, 0.09);
    horn(m, 69, 0.8, 0.25, 0.09);
    horn(m, 74, 1.05, 1.0, 0.11);
  },
  merge: (m) => {
    [67, 71, 74].forEach((n, i) => pluck(m, n, i * 0.08, 0.1));
    thud(m, 0.25, 0.15);
  },
  war: (m) => {
    drum(m, 0, 0.45, 70);
    drum(m, 0.45, 0.45, 70);
    horn(m, 43, 0.2, 1.4, 0.13);
    horn(m, 50, 0.2, 1.4, 0.08);
    drum(m, 0.9, 0.5, 65);
  },
  peace: (m) => {
    bell(m, 74, 0, 0.07);
    bell(m, 78, 0.15, 0.06);
    bell(m, 81, 0.3, 0.06);
  },
  diplomacy: (m) => {
    bell(m, 79, 0, 0.05, 1.4);
    pluck(m, 74, 0.05, 0.08);
  },
  ability: (m) => {
    [74, 78, 81, 86, 90].forEach((n, i) => tone(m, { freq: midi(n), at: i * 0.05, decay: 0.8, gain: 0.04, wet: 0.8 }));
    noise(m, { attack: 0.2, decay: 0.6, gain: 0.06, filter: 'highpass', freq: 5000, wet: 0.6 });
  },
  wonder: (m) => {
    drum(m, 0, 0.4, 60);
    [50, 57, 62, 66, 69].forEach((n) => tone(m, { type: 'triangle', freq: midi(n), attack: 0.4, decay: 2.2, gain: 0.05, lowpass: 1800, wet: 0.6 }));
    bell(m, 81, 0.5, 0.06, 3);
    bell(m, 86, 0.9, 0.05, 3);
  },
  epoch: (m) => {
    drum(m, 0, 0.4, 70);
    drum(m, 0.3, 0.3, 70);
    horn(m, 62, 0.3, 0.3, 0.09);
    horn(m, 66, 0.6, 0.3, 0.09);
    horn(m, 69, 0.9, 1.2, 0.1);
    horn(m, 74, 0.9, 1.2, 0.08);
    bell(m, 86, 0.9, 0.05, 3);
  },
  turn: (m) => {
    bell(m, 50, 0, 0.06, 3);
    tone(m, { freq: midi(38), decay: 1.5, gain: 0.05, wet: 0.5 });
  },
  alarm: (m) => {
    horn(m, 57, 0, 0.35, 0.11);
    horn(m, 56, 0.45, 0.6, 0.11);
    drum(m, 0, 0.3, 70);
  },
  error: (m) => tone(m, { type: 'square', freq: 150, decay: 0.12, gain: 0.04, lowpass: 600 }),
  victory: (m) => {
    for (const at of [0, 0.15, 0.3, 0.45]) drum(m, at, 0.3, 75);
    [
      [62, 0.5, 0.3],
      [66, 0.8, 0.3],
      [69, 1.1, 0.3],
      [74, 1.4, 0.6],
      [69, 2.0, 0.3],
      [74, 2.3, 1.6],
    ].forEach(([n, at, d]) => horn(m, n, at, d, 0.1));
    bell(m, 86, 2.3, 0.06, 3);
  },
  defeat: (m) => {
    drum(m, 0, 0.35, 60);
    [
      [62, 0.2, 0.6],
      [60, 0.9, 0.6],
      [58, 1.6, 0.6],
      [57, 2.3, 1.8],
    ].forEach(([n, at, d]) => horn(m, n, at, d, 0.09));
  },
};

/** Не повторять один эффект чаще этого (мс): серия команд бота не превращается в треск. */
const MIN_GAP: Partial<Record<Cue, number>> = { click: 40, select: 60, step: 150, hooves: 200, coins: 120 };
const lastPlayed = new Map<Cue, number>();

export function playCue(cue: Cue): void {
  const m = getMix();
  if (!m) return;
  const now = performance.now();
  const gap = MIN_GAP[cue] ?? 80;
  if (now - (lastPlayed.get(cue) ?? -Infinity) < gap) return;
  lastPlayed.set(cue, now);
  CUES[cue](m);
}
