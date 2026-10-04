// Формат сохранения: версия, краткое описание партии (для списка слотов) и само состояние.
// В localStorage файл хранится сжатым (deflate + base64), при экспорте — обычным JSON.
// Старые сохранения проходят цепочку миграций до текущей версии.

import { STATE_VERSION, nationDef, type GameState } from '../core';

export const SAVE_FORMAT = 'web-civ-save';
/** Текущая версия формата состояния. */
export const SAVE_VERSION = STATE_VERSION;

/** То, что видно в списке сохранений без распаковки состояния. */
export interface SaveMeta {
  /** Имя державы игрока. */
  power: string;
  nationId: string;
  color: string;
  turn: number;
  seed: number;
  powers: number;
  difficulty: string;
  /** Партия закончена (победа или выбывание). */
  finished: boolean;
  savedAt: number;
}

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: number;
  meta: SaveMeta;
  state: GameState;
}

export class SaveError extends Error {}

export function saveMeta(state: GameState, now = Date.now()): SaveMeta {
  const p = state.powers[state.humanPower];
  return {
    power: p.name,
    nationId: p.nationId,
    color: p.color,
    turn: state.turn,
    seed: state.settings.seed,
    powers: state.settings.powers,
    difficulty: state.settings.difficulty,
    finished: !!state.winner || !p.alive,
    savedAt: now,
  };
}

export function toSaveFile(state: GameState, now = Date.now()): SaveFile {
  return { format: SAVE_FORMAT, version: SAVE_VERSION, meta: saveMeta(state, now), state };
}

/** Миграция состояния с версии N на N + 1 (ключ — N). */
export type Migration = (state: Record<string, unknown>) => Record<string, unknown>;

/**
 * Миграции формата: ключ — версия, с которой поднимаем.
 * 1 → 2: специалисты в городах и сооружения на особых клетках.
 * 2 → 3: влияние на народы, культурная гегемония и подстрекательства; Мировое наследие убрано;
 *        наука: модерация вместо фортификации, саботаж сети вместо саботажа здания, нет оружия сдерживания.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  1: (s) => ({
    ...s,
    version: 2,
    improvements: [],
    cities: ((s.cities as Record<string, unknown>[] | undefined) ?? []).map((c) => ({ ...c, specialists: { scientist: 0, artisan: 0, merchant: 0 } })),
  }),
  2: (s) => ({
    ...s,
    version: 3,
    intrigues: [],
    powers: ((s.powers as Record<string, unknown>[] | undefined) ?? []).map(({ deterrent: _d, ...p }) => ({
      ...p,
      influence: [],
      hegemonySince: 0,
    })),
    cities: ((s.cities as Record<string, unknown>[] | undefined) ?? []).map(({ fortifyTurns: _f, disabledBuilding: _b, ...c }) => ({
      ...c,
      moderationTurns: 0,
      disabledTurns: 0,
      project: (c.project as { kind?: string } | null)?.kind === 'culture' ? null : (c.project ?? null),
    })),
  }),
};

/** Поднимает состояние до текущей версии или объясняет, почему это невозможно. */
export function migrate(
  raw: Record<string, unknown>,
  from: number,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  target = SAVE_VERSION,
): Record<string, unknown> {
  if (!Number.isInteger(from) || from < 1) throw new SaveError('Неизвестная версия сохранения');
  if (from > target) throw new SaveError('Сохранение сделано более новой версией игры — обновите страницу');
  let state = raw;
  for (let v = from; v < target; v++) {
    const step = migrations[v];
    if (!step) throw new SaveError(`Сохранение версии ${from} больше не поддерживается`);
    state = step(state);
  }
  return state;
}

/** Грубая проверка, что это похоже на состояние партии, — чтобы не упасть посреди игры. */
function checkState(s: Record<string, unknown>): GameState {
  const map = s.map as GameState['map'] | undefined;
  const ok =
    typeof s.turn === 'number' &&
    map &&
    Array.isArray(map.terrain) &&
    map.terrain.length === map.width * map.height &&
    Array.isArray(s.powers) &&
    s.powers.length >= 2 &&
    Array.isArray(s.cities) &&
    Array.isArray(s.units) &&
    typeof s.humanPower === 'number';
  if (!ok) throw new SaveError('Файл повреждён или это не сохранение игры');
  const state = s as unknown as GameState;
  for (const p of state.powers) {
    try {
      nationDef(p.nationId);
    } catch {
      throw new SaveError(`В сохранении неизвестная нация: ${p.nationId}`);
    }
  }
  return state;
}

/** Разбирает файл сохранения (JSON) и поднимает его до текущей версии. */
export function readSaveFile(json: string): GameState {
  let file: Partial<SaveFile>;
  try {
    file = JSON.parse(json) as Partial<SaveFile>;
  } catch {
    throw new SaveError('Это не файл сохранения (не JSON)');
  }
  if (!file || file.format !== SAVE_FORMAT || !file.state) throw new SaveError('Это не файл сохранения игры');
  const state = migrate(file.state as unknown as Record<string, unknown>, file.version ?? 0);
  return checkState({ ...state, version: SAVE_VERSION });
}

export function writeSaveFile(state: GameState, now = Date.now()): string {
  return JSON.stringify(toSaveFile(state, now));
}

// ---------- Сжатие ----------

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

export async function compress(text: string): Promise<string> {
  return toBase64(await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw')));
}

export async function decompress(b64: string): Promise<string> {
  try {
    return new TextDecoder().decode(await pipe(fromBase64(b64), new DecompressionStream('deflate-raw')));
  } catch {
    throw new SaveError('Сохранение повреждено');
  }
}
