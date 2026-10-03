// Слоты сохранений в localStorage: автосохранение (в конце каждого хода) и несколько ручных.
// Список слотов с описаниями лежит отдельно, чтобы не распаковывать партии ради меню.

import type { GameState } from '../core';
import { SaveError, compress, decompress, readSaveFile, saveMeta, writeSaveFile, type SaveMeta } from './format';

export const AUTO_SLOT = 'auto';
export const MANUAL_SLOTS = ['1', '2', '3', '4', '5'] as const;
export type SlotId = typeof AUTO_SLOT | (typeof MANUAL_SLOTS)[number];

const PREFIX = 'civ.save.';
const INDEX = 'civ.saves';

/** Хранилище с интерфейсом localStorage (в тестах — подмена). */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // доступ к хранилищу запрещён настройками браузера
  }
}

export class SaveStore {
  constructor(private store: KeyValueStore | null = defaultStore()) {}

  get available(): boolean {
    return !!this.store;
  }

  /** Описания занятых слотов. */
  list(): Partial<Record<SlotId, SaveMeta>> {
    if (!this.store) return {};
    try {
      return JSON.parse(this.store.getItem(INDEX) ?? '{}') as Partial<Record<SlotId, SaveMeta>>;
    } catch {
      return {};
    }
  }

  private writeIndex(index: Partial<Record<SlotId, SaveMeta>>): void {
    this.store?.setItem(INDEX, JSON.stringify(index));
  }

  /** Сохраняет партию в слот. Ошибка (например, нет места) — понятным текстом. */
  async save(slot: SlotId, state: GameState, now = Date.now()): Promise<void> {
    if (!this.store) throw new SaveError('Браузер не даёт сохранять данные на этом сайте');
    const data = await compress(writeSaveFile(state, now));
    try {
      this.store.setItem(PREFIX + slot, data);
    } catch {
      throw new SaveError('Не хватает места в хранилище браузера — удалите старые сохранения');
    }
    const index = this.list();
    index[slot] = saveMeta(state, now);
    this.writeIndex(index);
  }

  async load(slot: SlotId): Promise<GameState> {
    const data = this.store?.getItem(PREFIX + slot);
    if (!data) throw new SaveError('Слот пуст');
    return readSaveFile(await decompress(data));
  }

  remove(slot: SlotId): void {
    if (!this.store) return;
    this.store.removeItem(PREFIX + slot);
    const index = this.list();
    delete index[slot];
    this.writeIndex(index);
  }

  /** Размер слота в байтах (для подсказки о месте). */
  size(slot: SlotId): number {
    return this.store?.getItem(PREFIX + slot)?.length ?? 0;
  }
}
