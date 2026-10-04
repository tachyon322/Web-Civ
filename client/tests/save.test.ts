import { describe, expect, it } from 'vitest';
import { execute } from '../src/core/commands';
import { newGame } from '../src/core/game';
import type { GameState } from '../src/core/types';
import {
  SAVE_VERSION,
  SaveError,
  compress,
  decompress,
  migrate,
  readSaveFile,
  writeSaveFile,
  type Migration,
} from '../src/save/format';
import { SaveStore, type KeyValueStore } from '../src/save/storage';

function memoryStore(limit = Infinity): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (v.length > limit) throw new Error('QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k) => void data.delete(k),
  };
}

function played(turns: number): GameState {
  const s = newGame({ seed: 7, powers: 4, humanNation: 'rome' });
  for (let i = 0; i < turns; i++) execute(s, { type: 'EndTurn', power: 0 });
  return s;
}

describe('сохранения', () => {
  it('файл сохранения читается обратно в то же состояние', () => {
    const s = played(3);
    const back = readSaveFile(writeSaveFile(s));
    expect(back).toEqual(s);
  });

  it('загруженная партия продолжается так же, как исходная (детерминизм)', () => {
    const a = played(2);
    const b = readSaveFile(writeSaveFile(a));
    for (let i = 0; i < 5; i++) {
      execute(a, { type: 'EndTurn', power: 0 });
      execute(b, { type: 'EndTurn', power: 0 });
    }
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('сжатие обратимо, полная партия на 12 держав укладывается в 2 МБ', async () => {
    const s = newGame({ seed: 3, powers: 12, humanNation: null });
    const json = writeSaveFile(s);
    const packed = await compress(json);
    expect(await decompress(packed)).toBe(json);
    expect(packed.length).toBeLessThan(json.length / 3);
    expect(packed.length).toBeLessThan(2_000_000);
  });

  it('миграции поднимают старую версию по цепочке', () => {
    const steps: Record<number, Migration> = {
      1: (s) => ({ ...s, version: 2, a: 1 }),
      2: (s) => ({ ...s, version: 3, b: (s.a as number) + 1 }),
    };
    expect(migrate({ version: 1 }, 1, steps, 3)).toEqual({ version: 3, a: 1, b: 2 });
    expect(() => migrate({}, 4, steps, 3)).toThrow('более новой версией');
    expect(() => migrate({}, 1, {}, 2)).toThrow('не поддерживается');
    expect(SAVE_VERSION).toBe(2);
  });

  it('сохранение версии 1 получает специалистов и сооружения', () => {
    const s = played(1);
    const old = JSON.parse(writeSaveFile(s));
    old.version = 1;
    delete old.state.improvements;
    for (const c of old.state.cities) delete c.specialists;
    const loaded = readSaveFile(JSON.stringify(old));
    expect(loaded.improvements).toEqual([]);
    expect(loaded.cities[0].specialists).toEqual({ scientist: 0, artisan: 0, merchant: 0 });
  });

  it('мусор вместо сохранения — понятная ошибка, а не падение', async () => {
    expect(() => readSaveFile('не json')).toThrow(SaveError);
    expect(() => readSaveFile('{"format":"web-civ-save","version":1,"state":{"turn":1}}')).toThrow('повреждён');
    await expect(decompress('!!!')).rejects.toThrow(SaveError);
  });

  it('слоты: сохранение, список с описанием, загрузка, удаление', async () => {
    const store = new SaveStore(memoryStore());
    const s = played(2);
    await store.save('auto', s, 1000);
    await store.save('2', s, 2000);
    expect(store.list().auto).toMatchObject({ power: 'Рим', turn: 3, finished: false, savedAt: 1000 });
    expect(Object.keys(store.list()).sort()).toEqual(['2', 'auto']);
    expect(await store.load('2')).toEqual(s);
    store.remove('2');
    expect(Object.keys(store.list())).toEqual(['auto']);
    await expect(store.load('2')).rejects.toThrow('Слот пуст');
  });

  it('нет места в хранилище — понятная ошибка, список не портится', async () => {
    const store = new SaveStore(memoryStore(10));
    await expect(store.save('1', played(0))).rejects.toThrow('Не хватает места');
    expect(store.list()).toEqual({});
  });
});
