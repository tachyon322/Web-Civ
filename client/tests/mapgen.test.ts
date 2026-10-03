import { describe, expect, it } from 'vitest';
import { distance, neighbors, range } from '../src/core/hex';
import { T_MOUNTAIN, T_PLAINS, T_ROUGH, T_WATER } from '../src/core/types';
import { generateMap, mapSizeFor } from '../src/mapgen/generate';

describe('генерация карты', () => {
  it('один сид — одна и та же карта', () => {
    expect(generateMap(123, 12)).toEqual(generateMap(123, 12));
  });

  it('разные сиды — разные карты', () => {
    expect(generateMap(1, 12).terrain).not.toEqual(generateMap(2, 12).terrain);
  });

  it('для 12 держав карта около 60×40', () => {
    expect(mapSizeFor(12)).toEqual({ width: 60, height: 40 });
  });

  for (const powers of [2, 6, 12]) {
    for (const seed of [7, 99, 2024]) {
      it(`честные старты: ${powers} держав, сид ${seed}`, () => {
        const m = generateMap(seed, powers);
        expect(m.starts).toHaveLength(powers);

        // Одинаковое расстояние до ближайшего соседа (допуск в 1 клетку).
        const nn = m.starts.map((a, i) =>
          Math.min(...m.starts.filter((_, j) => j !== i).map((b) => distance(m, a, b))),
        );
        expect(Math.max(...nn) - Math.min(...nn)).toBeLessThanOrEqual(1);

        for (const s of m.starts) {
          // Одинаковая земля вокруг: радиус 2 — суша без гор, в нём одинаково пересечённых клеток.
          const area = range(m, s, 2);
          expect(area.every((t) => m.terrain[t] === T_PLAINS || m.terrain[t] === T_ROUGH)).toBe(true);
          expect(area.filter((t) => m.terrain[t] === T_ROUGH)).toHaveLength(3);
          // Своих особых клеток — по две на одинаковом расстоянии.
          expect(range(m, s, 3).filter((t) => m.special[t] !== 0)).toHaveLength(2);
        }

        // Все старты связаны сушей без гор.
        const seen = new Set([m.starts[0]]);
        const stack = [m.starts[0]];
        while (stack.length) {
          const t = stack.pop()!;
          for (const n of neighbors(m, t)) {
            if (!seen.has(n) && m.terrain[n] !== T_WATER && m.terrain[n] !== T_MOUNTAIN) {
              seen.add(n);
              stack.push(n);
            }
          }
        }
        expect(m.starts.every((s) => seen.has(s))).toBe(true);
      });
    }
  }

  it('на карте есть горы и вода', () => {
    const m = generateMap(5, 12);
    expect(m.terrain.filter((t) => t === T_MOUNTAIN).length).toBeGreaterThan(20);
    expect(m.terrain.filter((t) => t === T_WATER).length).toBeGreaterThan(m.terrain.length / 4);
  });
});
