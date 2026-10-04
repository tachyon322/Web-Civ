// Звуковой движок: один AudioContext, громкость эффектов и музыки, общая реверберация.
// Браузер разрешает звук только после действия игрока, поэтому контекст создаётся и
// запускается по первому клику или клавише (unlock).

export interface Mix {
  ctx: AudioContext;
  /** Вход для эффектов (сухой сигнал). */
  sfx: GainNode;
  /** Вход для музыки (сухой сигнал). */
  music: GainNode;
  /** Посыл в реверберацию; сам ревербератор уже подключён к выходу своей группы. */
  sfxReverb: GainNode;
  musicReverb: GainNode;
  noise: AudioBuffer;
}

let mix: Mix | null = null;
const readyHandlers: ((m: Mix) => void)[] = [];

/** Импульс реверберации: стереошум с экспоненциальным затуханием. */
function impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, length, ctx.sampleRate);
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (rand() * 2 - 1) * Math.pow(1 - i / length, decay);
  }
  return buf;
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let seed = 987654;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return buf;
}

function group(ctx: AudioContext, out: AudioNode, reverbSeconds: number): { dry: GainNode; send: GainNode } {
  const dry = ctx.createGain();
  dry.connect(out);
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, reverbSeconds, 3);
  const send = ctx.createGain();
  send.connect(reverb);
  reverb.connect(out);
  return { dry, send };
}

function create(): Mix {
  const ctx = new AudioContext();
  // Мягкий лимитер на выходе: несколько громких эффектов разом не дают перегруз.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 8;
  limiter.ratio.value = 6;
  limiter.connect(ctx.destination);
  const sfxOut = ctx.createGain();
  const musicOut = ctx.createGain();
  sfxOut.connect(limiter);
  musicOut.connect(limiter);
  const sfx = group(ctx, sfxOut, 1.6);
  const music = group(ctx, musicOut, 3.2);
  volumes.sfxNode = sfxOut;
  volumes.musicNode = musicOut;
  applyVolumes();
  return { ctx, sfx: sfx.dry, music: music.dry, sfxReverb: sfx.send, musicReverb: music.send, noise: noiseBuffer(ctx) };
}

const volumes = {
  sfx: 0.6,
  music: 0.35,
  sfxNode: null as GainNode | null,
  musicNode: null as GainNode | null,
};

/** Усиление групп при ползунке на максимуме: синтез тихий, запас до перегруза держит лимитер. */
const SFX_BOOST = 2.6;
const MUSIC_BOOST = 5;

function applyVolumes(): void {
  // Громкость воспринимается логарифмически: квадрат ползунка звучит ровнее линейного.
  if (volumes.sfxNode) volumes.sfxNode.gain.value = volumes.sfx * volumes.sfx * SFX_BOOST;
  if (volumes.musicNode) volumes.musicNode.gain.value = volumes.music * volumes.music * MUSIC_BOOST;
}

export function setVolumes(sfx: number, music: number): void {
  volumes.sfx = sfx;
  volumes.music = music;
  applyVolumes();
}

/** Микшер, если звук уже разрешён браузером. */
export function getMix(): Mix | null {
  return mix && mix.ctx.state === 'running' ? mix : null;
}

/** Вызвать, когда звук станет доступен (сразу, если уже доступен). */
export function onAudioReady(handler: (m: Mix) => void): void {
  if (getMix()) handler(mix!);
  else readyHandlers.push(handler);
}

/** Разрешить звук по первому действию игрока; на скрытой вкладке звук на паузе. */
export function installAudioUnlock(): void {
  if (typeof AudioContext === 'undefined') return;
  const unlock = () => {
    if (!mix) mix = create();
    void mix.ctx.resume().then(() => {
      for (const h of readyHandlers.splice(0)) h(mix!);
    });
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => {
    if (!mix) return;
    if (document.hidden) void mix.ctx.suspend();
    else void mix.ctx.resume();
  });
}
