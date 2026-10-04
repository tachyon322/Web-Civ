import { describe, expect, it } from 'vitest';
import { execute } from '../src/core/commands';
import { computeNetwork, networkCities } from '../src/core/network';
import { findPath, reachableTiles } from '../src/core/pathfinding';
import { NONE } from '../src/core/types';
import { addCitizen, addCity, addUnit, at, blankState, declareWar } from './helpers';

function bridge(s: ReturnType<typeof blankState>, power: number, cityId: number, from: number, to: number, row: number) {
  for (let c = from; c <= to; c++) {
    s.territory.owner[at(s, c, row)] = power;
    s.territory.city[at(s, c, row)] = cityId;
  }
}

describe('сеть городов и переброска', () => {
  it('города без общей территории — разные сети', () => {
    const s = blankState(16, 10);
    const a = addCity(s, 0, 2, 5, true);
    const b = addCity(s, 0, 10, 5);
    expect(networkCities(s, 0, a.tile)).toEqual([a.id]);
    expect(networkCities(s, 0, b.tile)).toEqual([b.id]);
  });

  it('непрерывная цепочка своей территории связывает города', () => {
    const s = blankState(16, 10);
    const a = addCity(s, 0, 2, 5, true);
    const b = addCity(s, 0, 10, 5);
    bridge(s, 0, a.id, 4, 8, 5);
    expect(networkCities(s, 0, a.tile).sort()).toEqual([a.id, b.id].sort());
  });

  it('потеря клетки посередине разрезает сеть', () => {
    const s = blankState(16, 10);
    const a = addCity(s, 0, 2, 5, true);
    const b = addCity(s, 0, 10, 5);
    bridge(s, 0, a.id, 4, 8, 5);
    s.territory.owner[at(s, 6, 5)] = NONE;
    const label = computeNetwork(s, 0);
    expect(label[a.tile]).not.toBe(label[b.tile]);
  });

  it('переброска за 1 очко хода между связанными городами', () => {
    const s = blankState(16, 10);
    const a = addCity(s, 0, 2, 5, true);
    const b = addCity(s, 0, 10, 5);
    bridge(s, 0, a.id, 4, 8, 5);
    const u = addCitizen(s, 0, 2, 5, 4);
    expect(execute(s, { type: 'Move', power: 0, unitId: u.id, target: b.tile }).ok).toBe(true);
    expect(u.tile).toBe(b.tile);
    expect(u.mp).toBe(3);
  });

  it('переброска с любой клетки сети на любую клетку сети, не только между городами', () => {
    const s = blankState(16, 10);
    const a = addCity(s, 0, 2, 5, true);
    addCity(s, 0, 10, 5);
    bridge(s, 0, a.id, 4, 8, 5);
    const u = addUnit(s, 0, 'warrior', 4, 5, 2, 4);
    const target = at(s, 8, 5);
    const path = findPath(s, u, target)!;
    expect(path).toEqual([target]);
    expect(execute(s, { type: 'Move', power: 0, unitId: u.id, target }).ok).toBe(true);
    expect(u.tile).toBe(target);
    expect(u.mp).toBe(3);
    expect(u.moved).toBe(true);
  });

  it('после переброски юнит идёт дальше за пределы сети', () => {
    const s = blankState(16, 10);
    const a = addCity(s, 0, 2, 5, true);
    addCity(s, 0, 10, 5);
    bridge(s, 0, a.id, 4, 8, 5);
    const u = addUnit(s, 0, 'warrior', 2, 5, 2, 4);
    expect(execute(s, { type: 'Move', power: 0, unitId: u.id, target: at(s, 13, 5) }).ok).toBe(true);
    // Переброска на край сети (11,5) за 1, затем 2 клетки пешком.
    expect(u.tile).toBe(at(s, 13, 5));
    expect(u.mp).toBe(1);
  });

  it('в зоне досягаемости — вся сеть', () => {
    const s = blankState(16, 10);
    const a = addCity(s, 0, 2, 5, true);
    const b = addCity(s, 0, 10, 5);
    bridge(s, 0, a.id, 4, 8, 5);
    const u = addUnit(s, 0, 'warrior', 2, 5, 2, 1);
    const reach = reachableTiles(s, u);
    expect(reach.get(b.tile)).toBe(1);
    expect(reach.get(at(s, 7, 5))).toBe(1);
    expect(reach.has(at(s, 12, 5))).toBe(false);
  });

  it('без связи переброски нет: юнит идёт пешком', () => {
    const s = blankState(16, 10);
    addCity(s, 0, 2, 5, true);
    const b = addCity(s, 0, 10, 5);
    const u = addUnit(s, 0, 'warrior', 2, 5, 2, 4);
    expect(execute(s, { type: 'Move', power: 0, unitId: u.id, target: b.tile }).ok).toBe(true);
    expect(u.tile).toBe(at(s, 6, 5));
    expect(u.routeTarget).toBe(b.tile);
  });

  it('вражеский юнит на клетке разрывает сеть и переброску', () => {
    const s = blankState(16, 10);
    const a = addCity(s, 0, 2, 5, true);
    const b = addCity(s, 0, 10, 5);
    bridge(s, 0, a.id, 4, 8, 5);
    declareWar(s, 0, 1);
    addUnit(s, 1, 'warrior', 6, 5);
    const u = addUnit(s, 0, 'warrior', 2, 5, 2, 4);
    expect(reachableTiles(s, u).has(b.tile)).toBe(false);
  });

  it('без очков хода переброски нет', () => {
    const s = blankState(16, 10);
    const a = addCity(s, 0, 2, 5, true);
    const b = addCity(s, 0, 10, 5);
    bridge(s, 0, a.id, 4, 8, 5);
    const u = addUnit(s, 0, 'warrior', 2, 5, 2, 0);
    expect(execute(s, { type: 'Move', power: 0, unitId: u.id, target: b.tile }).ok).toBe(true);
    expect(u.tile).toBe(at(s, 2, 5));
    expect(u.routeTarget).toBe(b.tile);
  });
});
