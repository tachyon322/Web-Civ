import { describe, expect, it } from 'vitest';
import { NO_TARGET, abilityCost } from '../src/core/abilities';
import { buildingPrice } from '../src/core/buildings';
import { starBonus } from '../src/core/combat';
import { execute } from '../src/core/commands';
import { balance, buildings, nations, traits } from '../src/core/data';
import { giftForecast } from '../src/core/diplomacy';
import { cityGrowthPerTurn, computeIncome, tradeGold } from '../src/core/economy';
import { pressureGain } from '../src/core/culture';
import { nationTrait } from '../src/core/nations';
import { addPact } from '../src/core/relations';
import { freeCities } from '../src/core/stability';
import { cityTileLimit } from '../src/core/state';
import type { GameState } from '../src/core/types';
import { addCity, addUnit, at, blankState, declareWar, meetAll, setNation } from './helpers';

const end = (s: GameState) => execute(s, { type: 'EndTurn', power: 0 });

/** Значение для державы до и после смены нации. */
function compare<T>(s: GameState, power: number, nation: string, f: () => T): [T, T] {
  const before = f();
  setNation(s, power, nation);
  return [before, f()];
}

describe('черты наций', () => {
  it('у каждой нации есть черта с описанием', () => {
    expect(nations).toHaveLength(13);
    for (const n of nations) {
      expect(traits[n.trait], n.id).toBeDefined();
      expect(traits[n.trait].description.length).toBeGreaterThan(0);
    }
    expect(new Set(nations.map((n) => n.trait)).size).toBe(13);
  });

  it('Рим: юнит при слиянии получает звезду ветерана (не больше потолка)', () => {
    const s = blankState();
    setNation(s, 0, 'rome');
    const a = addUnit(s, 0, 'warrior', 3, 3, 2);
    const b = addUnit(s, 0, 'warrior', 4, 3, 2);
    execute(s, { type: 'Merge', power: 0, unitId: a.id, targetId: b.id, into: 'warrior' });
    expect(b.stars).toBe(1);
    const c = addUnit(s, 0, 'warrior', 6, 3, 3);
    b.stars = balance.combat.maxStars;
    b.mp = 4;
    c.mp = 4;
    execute(s, { type: 'Merge', power: 0, unitId: c.id, targetId: b.id, into: 'warrior' });
    expect(b.stars).toBe(balance.combat.maxStars);
  });

  it('Монголы: всадники ходят на 1 клетку дальше, остальные — как обычно', () => {
    const s = blankState();
    addCity(s, 0, 2, 2, true);
    const h = addUnit(s, 0, 'horseman', 6, 6, 2);
    const w = addUnit(s, 0, 'warrior', 8, 6, 2);
    end(s);
    const [hBefore, wBefore] = [h.mp, w.mp];
    setNation(s, 0, 'mongols');
    end(s);
    expect(h.mp).toBe(hBefore + 1);
    expect(w.mp).toBe(wBefore);
  });

  it('Япония: звезда ветерана даёт +20% вместо +10%', () => {
    const s = blankState();
    expect(compare(s, 0, 'japan', () => starBonus(s, 0))).toEqual([balance.combat.starBonus, 0.2]);
  });

  it('Китай: +20% науки; Греция: +20% культуры', () => {
    const s = blankState();
    const c = addCity(s, 0, 5, 5, true);
    c.level = 5;
    c.buildings = ['library', 'temple'];
    setNation(s, 0, 'rome');
    const [sci, sciChina] = compare(s, 0, 'china', () => computeIncome(s, 0).science.total);
    expect(sciChina).toBe(sci + Math.round(sci * 0.2));
    setNation(s, 0, 'rome');
    const [cul, culGreece] = compare(s, 0, 'greece', () => computeIncome(s, 0).culture.total);
    expect(culGreece).toBe(cul + Math.round(cul * 0.2));
  });

  it('Арабы: научные способности на 30% дешевле, культурные — нет', () => {
    const s = blankState();
    const recon = { ...NO_TARGET, ability: 'recon' as const };
    const holiday = { ...NO_TARGET, ability: 'holiday' as const };
    const [r, rArabs] = compare(s, 0, 'arabia', () => abilityCost(s, 0, recon));
    expect(rArabs).toBe(Math.round(r * 0.7));
    setNation(s, 0, 'greece');
    const [h, hArabs] = compare(s, 0, 'arabia', () => abilityCost(s, 0, holiday));
    expect(hArabs).toBe(h);
  });

  it('Египет: чудеса света на 25% дешевле, обычные здания — нет', () => {
    const s = blankState();
    const city = addCity(s, 0, 5, 5, true);
    const wonder = buildings.find((b) => b.wonder)!;
    const [w, wEgypt] = compare(s, 0, 'egypt', () => buildingPrice(s, 0, wonder.id, city));
    expect(wEgypt).toBe(Math.round(w * 0.75));
    setNation(s, 0, 'greece');
    const [t, tEgypt] = compare(s, 0, 'egypt', () => buildingPrice(s, 0, 'temple', city));
    expect(tEgypt).toBe(t);
  });

  it('Франция: культурное давление вдвое быстрее', () => {
    const s = blankState();
    const [g, gFrance] = compare(s, 0, 'france', () => pressureGain(s, 0, 3));
    expect(gFrance).toBe(g * 2);
  });

  it('Карфаген: торговые договоры дают вдвое больше золота', () => {
    const s = blankState(20, 10);
    addCity(s, 0, 3, 5, true);
    addCity(s, 1, 15, 5, true);
    meetAll(s);
    addPact(s, 0, 1, 'trade');
    const [g, gCarthage] = compare(s, 0, 'carthage', () => tradeGold(s, 0));
    expect(g).toBeGreaterThan(0);
    expect(gCarthage).toBe(g * 2);
    expect(tradeGold(s, 1)).toBe(g);
  });

  it('Индия: города растут на 50% быстрее', () => {
    const s = blankState();
    const city = addCity(s, 0, 5, 5, true);
    const [g, gIndia] = compare(s, 0, 'india', () => cityGrowthPerTurn(s, city));
    expect(gIndia).toBe(Math.round(g * 1.5));
  });

  it('Россия: лимит клеток +5; враги на её земле теряют 10% силы за ход', () => {
    const s = blankState();
    const city = addCity(s, 0, 5, 5, true);
    const [l, lRussia] = compare(s, 0, 'russia', () => cityTileLimit(s, city));
    expect(lRussia).toBe(l + 5);

    addCity(s, 1, 10, 8, true);
    s.territory.owner[at(s, 8, 5)] = 0; // своя земля вне выстрела города
    const enemy = addUnit(s, 1, 'warrior', 8, 5, 3);
    enemy.moved = true;
    end(s);
    const peaceLoss = 4 - enemy.strength; // только снабжение: юнит далеко от своей земли
    enemy.strength = 4;
    declareWar(s, 0, 1);
    end(s);
    expect(4 - enemy.strength).toBeCloseTo(peaceLoss + 0.4);
  });

  it('Персия: +2 города без штрафа к стабильности', () => {
    const s = blankState();
    addCity(s, 0, 5, 5, true);
    const [f, fPersia] = compare(s, 0, 'persia', () => freeCities(s, 0));
    expect(fPersia).toBe(f + 2);
  });

  it('Византия: подарки и культурный обмен в 1,5 раза сильнее, потолок тоже', () => {
    const s = blankState(20, 10);
    addCity(s, 0, 3, 5, true);
    addCity(s, 1, 15, 5, true);
    meetAll(s);
    s.powers[1].character = 'diplomat';
    const [small, smallB] = compare(s, 0, 'byzantium', () => giftForecast(s, 0, 1, 20, 'gold').value);
    expect(smallB).toBe(Math.round(small * 1.5));
    expect(giftForecast(s, 0, 1, 100000, 'gold').value).toBe(45);
    expect(nationTrait(s, 0).name).toBe('Дипломаты');
  });
});
