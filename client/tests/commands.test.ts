import { describe, expect, it } from 'vitest';
import { balance } from '../src/core/data';
import { buildingPrice, computeIncome, foundCityPrice } from '../src/core/economy';
import { execute, preview, validate } from '../src/core/commands';
import { cityAt, unitsOf } from '../src/core/state';
import { S_GOLD } from '../src/core/types';
import { addCitizen, addCity, at, blankState } from './helpers';

describe('покупки и ограничители', () => {
  it('житель покупается мгновенно и появляется в городе', () => {
    const s = blankState();
    const city = addCity(s, 0, 5, 5, true);
    const gold = s.powers[0].gold;
    expect(execute(s, { type: 'BuyCitizen', power: 0, cityId: city.id }).ok).toBe(true);
    expect(s.powers[0].gold).toBe(gold - balance.prices.citizen);
    expect(unitsOf(s, 0)[0].tile).toBe(city.tile);
  });

  it('одна покупка на город за ход', () => {
    const s = blankState();
    const city = addCity(s, 0, 5, 5, true);
    execute(s, { type: 'BuyCitizen', power: 0, cityId: city.id });
    expect(validate(s, { type: 'BuyBuilding', power: 0, cityId: city.id, buildingId: 'market' })).toEqual({
      ok: false,
      reason: 'В этом городе уже была покупка в этом ходу',
    });
    execute(s, { type: 'EndTurn', power: 0 });
    expect(validate(s, { type: 'BuyBuilding', power: 0, cityId: city.id, buildingId: 'market' }).ok).toBe(true);
  });

  it('если город занят юнитом, житель появляется рядом', () => {
    const s = blankState();
    const city = addCity(s, 0, 5, 5, true);
    addCitizen(s, 0, 5, 5);
    execute(s, { type: 'BuyCitizen', power: 0, cityId: city.id });
    const fresh = unitsOf(s, 0)[1];
    expect(fresh.tile).not.toBe(city.tile);
  });

  it('зданий не больше, чем слотов', () => {
    const s = blankState();
    const city = addCity(s, 0, 5, 5, true);
    execute(s, { type: 'BuyBuilding', power: 0, cityId: city.id, buildingId: 'market' });
    city.purchasedThisTurn = false;
    expect(validate(s, { type: 'BuyBuilding', power: 0, cityId: city.id, buildingId: 'library' })).toEqual({
      ok: false,
      reason: 'Нет свободных слотов',
    });
    city.level = 2;
    expect(validate(s, { type: 'BuyBuilding', power: 0, cityId: city.id, buildingId: 'library' }).ok).toBe(true);
    expect(validate(s, { type: 'BuyBuilding', power: 0, cityId: city.id, buildingId: 'market' }).ok).toBe(false);
  });

  it('цена здания растёт с каждым однотипным зданием в державе', () => {
    const s = blankState(16, 10);
    const a = addCity(s, 0, 2, 5, true);
    addCity(s, 0, 8, 5);
    const first = buildingPrice(s, 0, 'market');
    execute(s, { type: 'BuyBuilding', power: 0, cityId: a.id, buildingId: 'market' });
    expect(buildingPrice(s, 0, 'market')).toBeGreaterThan(first);
    expect(buildingPrice(s, 0, 'library')).toBe(first);
  });

  it('без золота купить нельзя', () => {
    const s = blankState();
    const city = addCity(s, 0, 5, 5, true);
    s.powers[0].gold = 0;
    expect(validate(s, { type: 'BuyCitizen', power: 0, cityId: city.id }).ok).toBe(false);
  });

  it('чужим городом распоряжаться нельзя', () => {
    const s = blankState();
    const city = addCity(s, 1, 5, 5, true);
    expect(validate(s, { type: 'BuyCitizen', power: 0, cityId: city.id }).ok).toBe(false);
  });
});

describe('основание города', () => {
  it('житель исчезает, город появляется, цена растёт с каждым городом', () => {
    const s = blankState(16, 10);
    addCity(s, 0, 2, 5, true);
    const u = addCitizen(s, 0, 8, 5);
    const price = foundCityPrice(s, 0);
    const gold = s.powers[0].gold;
    expect(execute(s, { type: 'FoundCity', power: 0, unitId: u.id }).ok).toBe(true);
    expect(s.units).toHaveLength(0);
    expect(cityAt(s, at(s, 8, 5))).toBeDefined();
    expect(s.powers[0].gold).toBe(gold - price);
    expect(foundCityPrice(s, 0)).toBeGreaterThan(price);
  });

  it('нельзя основать город слишком близко к другому', () => {
    const s = blankState();
    addCity(s, 0, 5, 5, true);
    const u = addCitizen(s, 0, 7, 5);
    expect(validate(s, { type: 'FoundCity', power: 0, unitId: u.id }).ok).toBe(false);
  });

  it('нельзя основать город на чужой территории', () => {
    const s = blankState(20, 10);
    const enemy = addCity(s, 1, 10, 5, true);
    enemy.level = 5;
    s.territory.owner[at(s, 13, 5)] = 1;
    const u = addCitizen(s, 0, 13, 5);
    expect(validate(s, { type: 'FoundCity', power: 0, unitId: u.id })).toEqual({ ok: false, reason: 'Это чужая территория' });
  });
});

describe('доход, рост и ход', () => {
  it('доход складывается из уровня города, зданий, особых клеток и содержания', () => {
    const s = blankState();
    const city = addCity(s, 0, 5, 5, true);
    s.map.special[at(s, 6, 5)] = S_GOLD;
    city.buildings.push('market', 'library');
    addCitizen(s, 0, 1, 1);
    const income = computeIncome(s, 0);
    const expected =
      balance.city.goldByLevel[0] + 2 + balance.specials.gold.gold - balance.units.upkeepPerPerson;
    expect(income.gold.total).toBe(expected);
    expect(income.gold.items.map((i) => i.label)).toContain('Содержание юнитов');
    expect(income.science.total).toBe(balance.city.sciencePerCity + 2);
  });

  it('город растёт на 1 с каждой клетки и получает уровень по порогу', () => {
    const s = blankState();
    const city = addCity(s, 0, 5, 5, true);
    const threshold = balance.city.growthToNextLevel[0];
    const turns = Math.ceil(threshold / 7);
    for (let i = 0; i < turns; i++) execute(s, { type: 'EndTurn', power: 0 });
    expect(city.level).toBe(2);
    expect(city.growth).toBe(turns * 7 - threshold);
  });

  it('новый ход восстанавливает очки хода с бонусом на своей земле', () => {
    const s = blankState();
    addCity(s, 0, 5, 5, true);
    const home = addCitizen(s, 0, 5, 5, 0);
    const away = addCitizen(s, 0, 1, 1, 0);
    execute(s, { type: 'EndTurn', power: 0 });
    expect(home.mp).toBe(balance.units.citizen.mp + balance.units.ownTerritoryMpBonus);
    expect(away.mp).toBe(balance.units.citizen.mp);
  });

  it('дальняя цель становится маршрутом и продолжается в следующих ходах', () => {
    const s = blankState(30, 6);
    addCity(s, 0, 2, 2, true);
    const u = addCitizen(s, 0, 4, 2, 4);
    const target = at(s, 20, 2);
    expect(execute(s, { type: 'Move', power: 0, unitId: u.id, target }).ok).toBe(true);
    expect(u.routeTarget).toBe(target);
    for (let i = 0; i < 5 && u.tile !== target; i++) execute(s, { type: 'EndTurn', power: 0 });
    expect(u.tile).toBe(target);
    expect(u.routeTarget).toBe(-1);
  });

  it('на клетке один юнит; через свои можно пройти', () => {
    const s = blankState();
    const a = addCitizen(s, 0, 2, 2);
    addCitizen(s, 0, 3, 2);
    expect(validate(s, { type: 'Move', power: 0, unitId: a.id, target: at(s, 3, 2) }).ok).toBe(false);
    expect(validate(s, { type: 'Move', power: 0, unitId: a.id, target: at(s, 4, 2) }).ok).toBe(true);
    addCitizen(s, 1, 4, 3);
    expect(validate(s, { type: 'Move', power: 0, unitId: a.id, target: at(s, 4, 3) }).ok).toBe(false);
  });

  it('прогноз совпадает с результатом и не меняет исходное состояние', () => {
    const s = blankState();
    const city = addCity(s, 0, 5, 5, true);
    const cmd = { type: 'BuyCitizen', power: 0, cityId: city.id } as const;
    const before = structuredClone(s);
    const predicted = preview(s, cmd)!;
    expect(s).toEqual(before);
    execute(s, cmd);
    expect(s).toEqual(predicted);
  });
});
