// Фоновая музыка. Если в src/audio/music лежат файлы (mp3/ogg), играют они по кругу
// (файлы с именем на «war» — во время войны). Иначе музыка сочиняется на ходу:
// старинный лад (ре дорийский), подложка аккордами, гудящий бас, арфа и рамочный барабан;
// в войну — минор с напряжённой доминантой, быстрее и с боевыми барабанами.

import { onAudioReady, type Mix } from './engine';

export type Mood = 'peace' | 'war';

const FILES = import.meta.glob('./music/*.{mp3,ogg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** Аккорд: корень (midi) и минорный ли он. */
type Chord = [number, boolean];

const PROGRESSIONS: Record<Mood, Chord[]> = {
  // Dm C Am Dm G C Am Dm
  peace: [
    [50, true],
    [48, false],
    [45, true],
    [50, true],
    [43, false],
    [48, false],
    [45, true],
    [50, true],
  ],
  // Dm B♭ C Dm B♭ Gm A Dm
  war: [
    [50, true],
    [46, false],
    [48, false],
    [50, true],
    [46, false],
    [43, true],
    [45, false],
    [50, true],
  ],
};

/** Ступени мелодии: пентатоника ре минор (D F G A C) в двух октавах. */
const SCALE = [62, 65, 67, 69, 72, 74, 77, 79, 81, 84];

const BEAT: Record<Mood, number> = { peace: 0.78, war: 0.56 };
/** Долей на аккорд. */
const CHORD_BEATS = 8;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function chordNotes([root, minor]: Chord): number[] {
  return [root, root + (minor ? 3 : 4), root + 7];
}

class Synth {
  constructor(private m: Mix) {}

  private out(env: GainNode, wet: number): void {
    env.connect(this.m.music);
    const send = this.m.ctx.createGain();
    send.gain.value = wet;
    env.connect(send).connect(this.m.musicReverb);
  }

  private envelope(t: number, attack: number, hold: number, release: number, gain: number): GainNode {
    const env = this.m.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.setValueAtTime(gain, t + attack + hold);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    return env;
  }

  /** Подложка: мягкая пила и треугольник через фильтр, медленная атака. */
  pad(note: number, t: number, dur: number, gain: number): void {
    const { ctx } = this.m;
    const env = this.envelope(t, 1.4, Math.max(0, dur - 1.4), 2.2, gain);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 750;
    filter.connect(env);
    for (const [type, detune] of [
      ['sawtooth', -7],
      ['triangle', 6],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = midi(note);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + dur + 2.5);
    }
    this.out(env, 0.55);
  }

  /** Гудящий бас: чистый тон с едва заметным биением. */
  drone(note: number, t: number, dur: number, gain: number): void {
    const { ctx } = this.m;
    const env = this.envelope(t, 2, Math.max(0, dur - 2), 2.5, gain);
    for (const detune of [0, 4]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = midi(note);
      osc.detune.value = detune;
      osc.connect(env);
      osc.start(t);
      osc.stop(t + dur + 3);
    }
    this.out(env, 0.3);
  }

  /** Арфа: треугольник с октавным обертоном и быстрым затуханием. */
  harp(note: number, t: number, gain: number): void {
    const { ctx } = this.m;
    const f = midi(note);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, t);
    filter.frequency.exponentialRampToValueAtTime(900, t + 0.6);
    filter.connect(env);
    for (const [ratio, g, type] of [
      [1, 1, 'triangle'],
      [2, 0.35, 'sine'],
      [3, 0.12, 'sine'],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f * ratio;
      const og = ctx.createGain();
      og.gain.value = g;
      osc.connect(og).connect(filter);
      osc.start(t);
      osc.stop(t + 1.9);
    }
    this.out(env, 0.5);
  }

  /** Рамочный барабан: тон с падением высоты и шумовой удар. */
  drum(t: number, gain: number, pitch = 85): void {
    const { ctx } = this.m;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(pitch, t);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.5, t + 0.3);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    osc.connect(env);
    osc.start(t);
    osc.stop(t + 0.5);
    const src = ctx.createBufferSource();
    src.buffer = this.m.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1100;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(gain * 0.35, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    src.connect(filter).connect(ng).connect(this.m.music);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.1);
    this.out(env, 0.25);
  }

  /** Шейкер: короткий высокий шум. */
  shaker(t: number, gain: number): void {
    const { ctx } = this.m;
    const src = ctx.createBufferSource();
    src.buffer = this.m.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6000;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(filter).connect(env);
    src.start(t, Math.random() * 0.5);
    src.stop(t + 0.1);
    this.out(env, 0.2);
  }
}

/** Генеративная музыка: планировщик ставит ноты на ~2 с вперёд. */
class Composer {
  private synth: Synth;
  private rand = rng(Date.now());
  private timer: number | null = null;
  private nextChordAt = 0;
  private chordIndex = 0;
  /** Номер аккорда с начала — для смены частей. */
  private chordCount = 0;
  private degree = 3;
  mood: Mood = 'peace';

  constructor(private m: Mix) {
    this.synth = new Synth(m);
  }

  start(): void {
    if (this.timer !== null) return;
    this.nextChordAt = this.m.ctx.currentTime + 0.3;
    this.timer = window.setInterval(() => this.schedule(), 250);
    this.schedule();
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    while (this.nextChordAt < this.m.ctx.currentTime + 2) this.playChord(this.nextChordAt);
  }

  private playChord(t: number): void {
    const mood = this.mood;
    const beat = BEAT[mood];
    const prog = PROGRESSIONS[mood];
    const chord = prog[this.chordIndex % prog.length];
    const dur = beat * CHORD_BEATS;
    const notes = chordNotes(chord);
    // Части по 8 аккордов: A — подложка и мелодия; B — арпеджио и барабаны; C — тихо, бас и редкая арфа.
    const section = ['A', 'B', 'A', 'C'][Math.floor(this.chordCount / 8) % 4];
    const war = mood === 'war';

    this.synth.drone(chord[0] - 12, t, dur, war ? 0.07 : 0.06);
    if (section !== 'C') for (const n of notes) this.synth.pad(n + 12, t, dur, war ? 0.026 : 0.022);

    for (let b = 0; b < CHORD_BEATS; b++) {
      const bt = t + b * beat;
      // Барабаны: в мире — мягкая первая доля в части B, в войне — всегда и настойчивее.
      if (war) {
        if (b % 4 === 0 || b % 4 === 2 || (b % 4 === 3 && this.rand() < 0.5)) this.synth.drum(bt, b % 4 === 0 ? 0.32 : 0.2, 70);
        this.synth.shaker(bt + beat / 2, 0.025);
      } else if (section === 'B' && b % 4 === 0) {
        this.synth.drum(bt, 0.16, 90);
      }
      // Арпеджио по аккорду восьмыми.
      if (section === 'B') {
        const arp = [...notes.map((n) => n + 24), notes[0] + 36];
        this.synth.harp(arp[(b * 2) % arp.length], bt, 0.05);
        this.synth.harp(arp[(b * 2 + 1) % arp.length], bt + beat / 2, 0.04);
      }
    }

    // Мелодия: случайное блуждание по пентатонике, на сильной доле — к звуку аккорда.
    if (section === 'A' || (section === 'C' && this.rand() < 0.5)) {
      const rest = section === 'C' ? 0.75 : war ? 0.35 : 0.45;
      for (let step = 0; step < CHORD_BEATS * 2; step++) {
        if (step === 0) {
          this.degree = this.nearestChordDegree(notes, this.degree);
        } else {
          if (this.rand() < rest) continue;
          this.degree = Math.max(0, Math.min(SCALE.length - 1, this.degree + Math.floor(this.rand() * 5) - 2));
        }
        const accent = step % 4 === 0 ? 1 : 0.75;
        this.synth.harp(SCALE[this.degree], t + (step * beat) / 2, (war ? 0.08 : 0.07) * accent);
      }
    }

    this.nextChordAt = t + dur;
    this.chordIndex++;
    this.chordCount++;
  }

  private nearestChordDegree(notes: number[], from: number): number {
    const classes = new Set(notes.map((n) => n % 12));
    let best = from;
    let bestDist = Infinity;
    SCALE.forEach((n, i) => {
      if (!classes.has(n % 12)) return;
      const d = Math.abs(i - from);
      if (d < bestDist) {
        best = i;
        bestDist = d;
      }
    });
    return best;
  }
}

/** Плейлист из файлов: играет по кругу, во время войны — «военные» треки, если есть. */
class Playlist {
  private audio = new Audio();
  private index = 0;
  mood: Mood = 'peace';

  constructor(
    m: Mix,
    private tracks: { url: string; war: boolean }[],
  ) {
    this.audio.crossOrigin = 'anonymous';
    m.ctx.createMediaElementSource(this.audio).connect(m.music);
    this.audio.addEventListener('ended', () => this.next());
  }

  start(): void {
    if (!this.audio.src) this.next();
    else void this.audio.play().catch(() => {});
  }

  stop(): void {
    this.audio.pause();
  }

  next(): void {
    const pool = this.tracks.filter((t) => t.war === (this.mood === 'war'));
    const list = pool.length ? pool : this.tracks;
    this.audio.src = list[this.index++ % list.length].url;
    void this.audio.play().catch(() => {});
  }
}

let player: Composer | Playlist | null = null;
let wanted: Mood = 'peace';
let enabled = true;

/** Запустить музыку, когда браузер разрешит звук. */
export function startMusic(): void {
  onAudioReady((m) => {
    if (!player) {
      const tracks = Object.entries(FILES).map(([path, url]) => ({ url, war: /\/war[^/]*$/i.test(path) }));
      player = tracks.length ? new Playlist(m, tracks) : new Composer(m);
    }
    player.mood = wanted;
    if (enabled) player.start();
  });
}

/** Настроение музыки: меняется со следующего аккорда (или трека). */
export function setMusicMood(mood: Mood): void {
  if (mood === wanted) return;
  wanted = mood;
  if (!player) return;
  player.mood = mood;
  if (player instanceof Playlist) player.next();
}

export function setMusicEnabled(on: boolean): void {
  enabled = on;
  if (!player) return;
  if (on) player.start();
  else player.stop();
}
