import { describe, expect, it } from 'vitest';
import { execute, validate } from '../src/core/commands';
import { neighbors } from '../src/core/hex';
import { newGame } from '../src/core/game';
import { citiesOf, unitsOf } from '../src/core/state';
import { computeVisible } from '../src/core/visibility';

describe('новая партия', () => {
  it('у каждой державы столица и два жителя', () => {
    const s = newGame({ seed: 11, powers: 12, humanNation: 'russia' });
    expect(s.powers).toHaveLength(12);
    expect(s.powers[0].nationId).toBe('russia');
    expect(new Set(s.powers.map((p) => p.nationId)).size).toBe(12);
    for (const p of s.powers) {
      expect(citiesOf(s, p.id)).toHaveLength(1);
      expect(unitsOf(s, p.id)).toHaveLength(2);
    }
  });

  it('партия детерминирована сидом и сериализуется', () => {
    const a = newGame({ seed: 77, powers: 6, humanNation: null });
    const b = newGame({ seed: 77, powers: 6, humanNation: null });
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it('туман войны: соседи изначально не видны', () => {
    const s = newGame({ seed: 3, powers: 12, humanNation: null });
    const visible = computeVisible(s, 0);
    const others = s.cities.filter((c) => c.owner !== 0);
    expect(others.every((c) => !visible[c.tile] && !s.powers[0].explored[c.tile])).toBe(true);
  });

  it('разведанное остаётся разведанным после ухода юнита', () => {
    const s = newGame({ seed: 3, powers: 4, humanNation: null });
    const u = unitsOf(s, 0)[0];
    const before = s.powers[0].explored.slice();
    // Ведём жителя к свободной клетке у соседней столицы.
    const target = neighbors(s.map, s.map.starts[1]).find(
      (t) => validate(s, { type: 'Move', power: 0, unitId: u.id, target: t }).ok,
    )!;
    expect(execute(s, { type: 'Move', power: 0, unitId: u.id, target }).ok).toBe(true);
    for (let i = 0; i < 3; i++) execute(s, { type: 'EndTurn', power: 0 });
    const after = s.powers[0].explored;
    expect(after.reduce((a, b) => a + b, 0)).toBeGreaterThan(before.reduce((a, b) => a + b, 0));
    expect(before.every((e, t) => !e || after[t])).toBe(true);
  });
});
