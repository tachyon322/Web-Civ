// Настройки игрока (только в этом браузере): простая графика и звук.

const KEY = 'civ.settings';

export interface Settings {
  /** Плоские гексы без граней, теней и объёмных деталей. */
  simpleGraphics: boolean;
  /** Громкость эффектов и музыки, 0…1. */
  sfxVolume: number;
  musicVolume: number;
  /** Весь звук выключен (клавиша M). */
  muted: boolean;
}

const DEFAULTS: Settings = { simpleGraphics: false, sfxVolume: 0.6, musicVolume: 0.35, muted: false };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // хранилище недоступно — настройка действует до перезагрузки
  }
}
