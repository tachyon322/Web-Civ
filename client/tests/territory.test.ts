import { describe, expect, it } from 'vitest';
import { execute } from '../src/core/commands';
import { computeIncome } from '../src/core/economy';
import { cityTiles } from '../src/core/state';
import { checkClaim } from '../src/core/territory';
import { NONE, T_WATER } from '../src/core/types';
import { addCitizen, addCity, at, blankState } from './helpers';

describe('разметка земли', () => {
  it('город при основании получает клетки в радиусе 1', () => {
    const s = blankState();
    const city = addCity(s, 0, 5, 5, true);
    expect(cityTiles(s, city.id)).toHaveLength(7);
  });

  it('вода в радиусе основания не размечается', () => {
    const s = blankState();
    s.map.terrain[at(s, 6, 5)] = T_WATER;
    const city = addCity(s, 0, 5, 5, true);
    expect(cityTiles(s, city.id)).toHaveLength(6);
    expect(s.territory.owner[at(s, 6, 5)]).toBe(NONE);
  });

  it('при исчерпанном лимите житель землю не размечает', () => {
    const s = blankState();
    addCity(s, 0, 5, 5, true); // уровень 1: лимит 7 уже занят
    const u = addCitizen(s, 0, 6, 5);
    expect(execute(s, { type: 'Move', power: 0, unitId: u.id, target: at(s, 7, 5) }).ok).toBe(true);
    expect(s.territory.owner[at(s, 7, 5)]).toBe(NONE);
    expect(checkClaim(s, 0, at(s, 7, 5))).toEqual({ ok: false, reason: 'У всех городов исчерпан лимит клеток' });
  });

  it('житель размечает нейтральную клетку у границы, если у города есть лимит', () => {
    const s = blankState();
    const city = addCity(s, 0, 5, 5, true);
    city.level = 2; // лимит 10
    const u = addCitizen(s, 0, 6, 5);
    execute(s, { type: 'Move', power: 0, unitId: u.id, target: at(s, 8, 5) });
    // Первая клетка граничит с территорией — размечена; следующая теперь тоже граничит.
    expect(s.territory.owner[at(s, 7, 5)]).toBe(0);
    expect(s.territory.owner[at(s, 8, 5)]).toBe(0);
    expect(s.territory.city[at(s, 8, 5)]).toBe(city.id);
  });

  it('клетка не у границы не размечается — без «островов»', () => {
    const s = blankState();
    const city = addCity(s, 0, 2, 2, true);
    city.level = 5;
    expect(checkClaim(s, 0, at(s, 8, 8)).ok).toBe(false);
  });

  it('клетка привязывается к ближайшему городу со свободным лимитом', () => {
    const s = blankState(16, 10);
    const a = addCity(s, 0, 3, 5, true);
    const b = addCity(s, 0, 9, 5);
    a.level = 2;
    b.level = 2;
    const nearB = at(s, 11, 5);
    expect(checkClaim(s, 0, nearB)).toMatchObject({ ok: true, city: { id: b.id } });
    b.level = 1; // у B лимит исчерпан — клетка уходит к A, хоть она и дальше
    expect(checkClaim(s, 0, nearB)).toMatchObject({ ok: true, city: { id: a.id } });
  });

  it('чужие клетки не размечаются', () => {
    const s = blankState(16, 10);
    const a = addCity(s, 0, 3, 5, true);
    a.level = 3;
    addCity(s, 1, 6, 5, true);
    expect(checkClaim(s, 0, at(s, 5, 5)).ok).toBe(false);
  });
});

describe('золото с земли', () => {
  it('каждая своя клетка суши даёт +1 золото', () => {
    const s = blankState(16, 10);
    const city = addCity(s, 0, 5, 5, true);
    city.level = 2; // лимит 10 — есть место для новой клетки
    const land = () => computeIncome(s, 0).gold.items.find((i) => i.label === 'Земля')?.value;
    expect(land()).toBe(cityTiles(s, city.id).length);
    const before = land()!;
    const u = addCitizen(s, 0, 6, 5);
    // Житель размечает нейтральную клетку у границы — она сразу приносит золото.
    expect(execute(s, { type: 'Move', power: 0, unitId: u.id, target: at(s, 7, 5) }).ok).toBe(true);
    expect(land()).toBeGreaterThan(before);
  });

  it('вода золота не даёт', () => {
    const s = blankState(16, 10);
    s.map.terrain[at(s, 6, 5)] = T_WATER;
    const city = addCity(s, 0, 5, 5, true);
    const land = computeIncome(s, 0).gold.items.find((i) => i.label === 'Земля')!.value;
    expect(land).toBe(cityTiles(s, city.id).length);
    expect(cityTiles(s, city.id)).not.toContain(at(s, 6, 5));
  });
});
