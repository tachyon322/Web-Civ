// Настройки игрока (только в этом браузере): простая графика, громкость музыки и звуков.

const KEY = 'civ.settings';

export interface Settings {
  /** Плоские гексы без граней, теней и объёмных деталей. */
  simpleGraphics: boolean;
  /** Громкость фоновой музыки, 0..1. */
  musicVolume: number;
  /** Громкость звуковых эффектов, 0..1. */
  sfxVolume: number;
}

const DEFAULTS: Settings = { simpleGraphics: false, musicVolume: 0.5, sfxVolume: 0.8 };

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
