import { describe, expect, it } from 'vitest';
import { execute, validate } from '../src/core/commands';
import { computeNetwork, networkCities } from '../src/core/network';
import { NONE } from '../src/core/types';
import { addCitizen, addCity, at, blankState } from './helpers';

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
    expect(execute(s, { type: 'Transfer', power: 0, unitId: u.id, cityId: b.id }).ok).toBe(true);
    expect(u.tile).toBe(b.tile);
    expect(u.mp).toBe(3);
  });

  it('переброска невозможна без связи, без очков хода и в занятый город', () => {
    const s = blankState(16, 10);
    const a = addCity(s, 0, 2, 5, true);
    const b = addCity(s, 0, 10, 5);
    const u = addCitizen(s, 0, 2, 5, 4);
    expect(validate(s, { type: 'Transfer', power: 0, unitId: u.id, cityId: b.id })).toMatchObject({ ok: false });
    bridge(s, 0, a.id, 4, 8, 5);
    u.mp = 0;
    expect(validate(s, { type: 'Transfer', power: 0, unitId: u.id, cityId: b.id })).toMatchObject({ ok: false });
    u.mp = 4;
    addCitizen(s, 0, 10, 5);
    expect(validate(s, { type: 'Transfer', power: 0, unitId: u.id, cityId: b.id })).toMatchObject({
      ok: false,
      reason: 'В городе назначения уже стоит юнит',
    });
  });

  it('переброска только из города', () => {
    const s = blankState(16, 10);
    addCity(s, 0, 2, 5, true);
    const b = addCity(s, 0, 10, 5);
    const u = addCitizen(s, 0, 3, 5, 4);
    expect(validate(s, { type: 'Transfer', power: 0, unitId: u.id, cityId: b.id }).ok).toBe(false);
  });
});
