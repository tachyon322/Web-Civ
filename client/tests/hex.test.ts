import { describe, expect, it } from 'vitest';
import { axialOfIndex, axialRound, distance, indexOfAxial, neighbors, range, ring } from '../src/core/hex';

const size = { width: 10, height: 8 };

describe('гексы', () => {
  it('у внутренней клетки 6 соседей на расстоянии 1', () => {
    for (const center of [33, 34, 44, 45]) {
      const nb = neighbors(size, center);
      expect(nb).toHaveLength(6);
      for (const n of nb) expect(distance(size, center, n)).toBe(1);
    }
  });

  it('у угловой клетки соседей меньше', () => {
    expect(neighbors(size, 0).length).toBeLessThan(6);
  });

  it('индексы и осевые координаты взаимно обратны', () => {
    for (let i = 0; i < 80; i++) expect(indexOfAxial(size, axialOfIndex(size, i))).toBe(i);
  });

  it('радиус 1 — 7 клеток, радиус 2 — 19, кольцо 2 — 12', () => {
    expect(range(size, 44, 1)).toHaveLength(7);
    expect(range(size, 44, 2)).toHaveLength(19);
    expect(ring(size, 44, 2)).toHaveLength(12);
  });

  it('округление дробных координат даёт ближайший гекс', () => {
    expect(axialRound(1.1, 0.9)).toEqual({ q: 1, r: 1 });
    expect(axialRound(-0.4, 0.2)).toEqual({ q: 0, r: 0 });
  });
});
