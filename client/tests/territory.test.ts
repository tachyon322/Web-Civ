import { describe, expect, it } from 'vitest';
import { execute } from '../src/core/commands';
import { computeIncome } from '../src/core/economy';
import { cityTiles, landLimit, landTiles } from '../src/core/state';
import { LAND_LIMIT_REASON, checkClaim } from '../src/core/territory';
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
    addCity(s, 0, 5, 5, true); // уровень 1: лимит державы 7 уже занят
    const u = addCitizen(s, 0, 6, 5);
    expect(execute(s, { type: 'Move', power: 0, unitId: u.id, target: at(s, 7, 5) }).ok).toBe(true);
    expect(s.territory.owner[at(s, 7, 5)]).toBe(NONE);
    expect(checkClaim(s, 0, at(s, 7, 5))).toEqual({ ok: false, reason: LAND_LIMIT_REASON });
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

  it('лимит земли общий на державу: свободный лимит одного города работает для любого', () => {
    const s = blankState(16, 10);
    const a = addCity(s, 0, 3, 5, true);
    const b = addCity(s, 0, 9, 5);
    expect(landLimit(s, 0)).toBe(14);
    expect(landTiles(s, 0)).toBe(14);
    const nearB = at(s, 11, 5);
    expect(checkClaim(s, 0, nearB)).toEqual({ ok: false, reason: LAND_LIMIT_REASON });
    a.level = 2; // вырос дальний город — у державы +3 клетки
    expect(landLimit(s, 0)).toBe(17);
    // Клетка всё равно привязывается к ближайшему городу.
    expect(checkClaim(s, 0, nearB)).toMatchObject({ ok: true, city: { id: b.id } });
  });

  it('житель размечает до лимита державы, дальше — нет', () => {
    const s = blankState(16, 10);
    const city = addCity(s, 0, 3, 5, true);
    city.level = 2; // лимит 10: свободно 3 клетки
    const u = addCitizen(s, 0, 4, 5, 8);
    expect(execute(s, { type: 'Move', power: 0, unitId: u.id, target: at(s, 10, 5) }).ok).toBe(true);
    expect([5, 6, 7, 8].map((c) => s.territory.owner[at(s, c, 5)])).toEqual([0, 0, 0, NONE]);
    expect(landTiles(s, 0)).toBe(10);
  });

  it('житель размечает клетку, на которой закончил ход, когда освободился лимит', () => {
    const s = blankState(16, 10);
    const city = addCity(s, 0, 3, 5, true);
    const u = addCitizen(s, 0, 4, 5);
    execute(s, { type: 'Move', power: 0, unitId: u.id, target: at(s, 5, 5) });
    expect(s.territory.owner[at(s, 5, 5)]).toBe(NONE);
    city.level = 2;
    execute(s, { type: 'EndTurn', power: 0 });
    expect(s.territory.owner[at(s, 5, 5)]).toBe(0);
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
