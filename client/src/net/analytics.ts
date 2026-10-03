// Вход по логину без пароля и события партии для статистики. Сервер принимает только это;
// ходы, правила и сохранения на сервер не уходят. Без сервера (разработка, офлайн) игра работает так же.

const IDENTITY_KEY = 'civ.player';

export interface Identity {
  login: string;
  browserId: string;
}

/** Логин: 3–20 символов, буквы (любого алфавита), цифры и «_»; регистр не различается. */
export const LOGIN_PATTERN = /^[\p{L}\p{N}_]{3,20}$/u;

/** Почему логин не подходит; null — подходит. */
export function loginProblem(login: string): string | null {
  const s = login.trim();
  if (s.length < 3) return 'Не короче 3 символов';
  if (s.length > 20) return 'Не длиннее 20 символов';
  if (!LOGIN_PATTERN.test(s)) return 'Только буквы, цифры и «_»';
  return null;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadIdentity(): Identity | null {
  try {
    const raw = JSON.parse(storage()?.getItem(IDENTITY_KEY) ?? 'null') as Identity | null;
    return raw && typeof raw.login === 'string' && typeof raw.browserId === 'string' && !loginProblem(raw.login) ? raw : null;
  } catch {
    return null;
  }
}

function newBrowserId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Запоминает логин; browserId сохраняется прежний, чтобы видеть один браузер под разными именами. */
export function saveIdentity(login: string): Identity {
  const identity = { login: login.trim(), browserId: loadIdentity()?.browserId ?? newBrowserId() };
  try {
    storage()?.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // хранилище недоступно — вход спросят снова в следующий раз
  }
  return identity;
}

export type LoginResult = { status: 'ok' } | { status: 'offline' } | { status: 'rejected'; reason: string };

/** Вход: сервер создаёт игрока или отмечает визит. Нет сервера — игра продолжается без статистики. */
export async function apiLogin(identity: Identity): Promise<LoginResult> {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(identity),
    });
    if (res.ok) return { status: 'ok' };
    if (res.status === 400) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { status: 'rejected', reason: body?.error ?? 'Логин не подходит' };
    }
    return { status: 'offline' };
  } catch {
    return { status: 'offline' };
  }
}

export type GameEvent =
  | { type: 'game_start'; data: { nation: string; powers: number; difficulty: string; seed: number } }
  | { type: 'game_end'; data: { result: 'win' | 'loss'; victory: string | null; turns: number } }
  | { type: 'game_abandon'; data: { turn: number } };

/** Отправляет событие партии; ошибки молча игнорируются. keepalive — чтобы ушло и при закрытии вкладки. */
export function sendEvent(event: GameEvent): void {
  const identity = loadIdentity();
  if (!identity) return;
  try {
    void fetch('/api/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...identity, ...event }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // нет сети — статистика не важнее игры
  }
}
