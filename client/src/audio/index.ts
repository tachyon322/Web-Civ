// Звук: фоновая музыка и короткие эффекты. Браузер разрешает звук только после первого
// действия игрока, поэтому всё создаётся лениво — по первому нажатию мыши или клавиши.

import attack1Url from '../assets/sfx/attack-1.mp3';
import attack2Url from '../assets/sfx/attack-2.mp3';
import attack3Url from '../assets/sfx/attack-3.mp3';
import clickUrl from '../assets/sfx/click.mp3';
import cultureUrl from '../assets/sfx/culture.mp3';
import goldUrl from '../assets/sfx/gold.mp3';
import sabotageUrl from '../assets/sfx/sabotage.mp3';
import scienceUrl from '../assets/sfx/science.mp3';

export type Sfx = 'click' | 'attack' | 'gold' | 'science' | 'culture' | 'sabotage';

/** Варианты звука (выбирается случайный) и его громкость относительно остальных. */
const SFX: Record<Sfx, { urls: string[]; gain: number }> = {
  click: { urls: [clickUrl], gain: 0.45 },
  attack: { urls: [attack1Url, attack2Url, attack3Url], gain: 0.8 },
  gold: { urls: [goldUrl], gain: 0.6 },
  science: { urls: [scienceUrl], gain: 0.55 },
  culture: { urls: [cultureUrl], gain: 0.65 },
  sabotage: { urls: [sabotageUrl], gain: 0.8 },
};

/** Фоновая музыка: все файлы из src/assets/music, играют по кругу в случайном порядке. */
const MUSIC = Object.entries(
  import.meta.glob<string>('../assets/music/*.{mp3,ogg,oga,opus,m4a,aac,wav,webm,flac}', {
    eager: true,
    query: '?url',
    import: 'default',
  }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url);

/** Ползунок громкости 0..1 → усиление: слух логарифмический, квадрат ближе к ощущению. */
const loudness = (v: number) => Math.max(0, Math.min(1, v)) ** 2;

class AudioSystem {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private music: HTMLAudioElement | null = null;
  private playlist: string[] = [];
  private track = 0;
  private musicVolume = 0.5;
  private sfxVolume = 0.8;
  private clickTimer = 0;

  /** Слушатели страницы: разблокировка звука и щелчок любой доступной кнопки. */
  install(): void {
    const unlock = () => {
      this.unlock();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    // Отключённые кнопки событие click не получают — щелчок только у доступных.
    document.addEventListener(
      'click',
      (e) => {
        if ((e.target as HTMLElement).closest('button')) this.click();
      },
      true,
    );
    // Свёрнутая вкладка не играет.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.music?.pause();
        void this.ctx?.suspend();
      } else {
        this.resumeMusic();
        void this.ctx?.resume();
      }
    });
  }

  setVolumes(music: number, sfx: number): void {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    if (this.sfxGain) this.sfxGain.gain.value = loudness(sfx);
    if (this.music) {
      this.music.volume = loudness(music);
      if (music > 0) this.resumeMusic();
      else this.music.pause();
    }
  }

  /** Есть ли файлы музыки в сборке. */
  get hasMusic(): boolean {
    return MUSIC.length > 0;
  }

  /**
   * Щелчок кнопки. Откладывается до конца обработки нажатия: если кнопка вызвала свой звук
   * (покупка, атака), щелчок не накладывается на него.
   */
  click(): void {
    window.clearTimeout(this.clickTimer);
    this.clickTimer = window.setTimeout(() => this.playNow('click'), 0);
  }

  play(name: Sfx): void {
    window.clearTimeout(this.clickTimer);
    this.playNow(name);
  }

  private playNow(name: Sfx): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfxGain || this.sfxVolume <= 0) return;
    const def = SFX[name];
    const buffer = this.buffers.get(def.urls[Math.floor(Math.random() * def.urls.length)]);
    if (!buffer) return; // ещё грузится — лучше промолчать, чем опоздать
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // Небольшой разброс высоты, чтобы частые звуки не звучали одинаково.
    if (name !== 'click') source.playbackRate.value = 1 + (Math.random() - 0.5) * 0.06;
    const gain = ctx.createGain();
    gain.gain.value = def.gain;
    source.connect(gain).connect(this.sfxGain);
    source.start();
  }

  private unlock(): void {
    if (this.ctx || typeof AudioContext === 'undefined') return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = loudness(this.sfxVolume);
    this.sfxGain.connect(ctx.destination);
    void ctx.resume();
    const urls = new Set(Object.values(SFX).flatMap((d) => d.urls));
    for (const url of urls) {
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .then((buffer) => this.buffers.set(url, buffer))
        .catch((err: unknown) => console.warn('Звук не загрузился', url, err));
    }
    this.startMusic();
  }

  private startMusic(): void {
    if (!MUSIC.length) return;
    this.playlist = shuffle([...MUSIC]);
    this.track = 0;
    const music = new Audio();
    music.preload = 'auto';
    music.volume = loudness(this.musicVolume);
    music.loop = this.playlist.length === 1;
    music.addEventListener('ended', () => this.nextTrack());
    music.addEventListener('error', () => {
      console.warn('Музыка не загрузилась', music.src);
      if (this.playlist.length > 1) this.nextTrack();
    });
    music.src = this.playlist[0];
    this.music = music;
    this.resumeMusic();
  }

  private nextTrack(): void {
    if (!this.music) return;
    this.track = (this.track + 1) % this.playlist.length;
    if (this.track === 0) this.playlist = shuffle(this.playlist);
    this.music.src = this.playlist[this.track];
    this.resumeMusic();
  }

  private resumeMusic(): void {
    const music = this.music;
    if (!music || this.musicVolume <= 0 || document.hidden) return;
    music.play().catch(() => {
      // браузер ещё не разрешил звук — повторим при следующем нажатии
    });
  }
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export const audio = new AudioSystem();
