// Настройки игрока (только в этом браузере): простая графика.

const KEY = 'civ.settings';

export interface Settings {
  /** Плоские гексы без граней, теней и объёмных деталей. */
  simpleGraphics: boolean;
}

const DEFAULTS: Settings = { simpleGraphics: false };

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
