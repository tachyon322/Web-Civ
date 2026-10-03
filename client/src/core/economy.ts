// Доходы и цены. Каждая цифра собирается из слагаемых, чтобы интерфейс мог показать разбивку.

import { balance, buildingDef, buildings, specialYields } from './data';
import { citiesOf, isLand, unitPeople, unitsOf } from './state';
import { SPECIALS, type City, type GameState } from './types';

export type ResourceId = 'gold' | 'science' | 'culture';

export interface BreakdownItem {
  label: string;
  value: number;
}

export interface Breakdown {
  total: number;
  items: BreakdownItem[];
}

export type Income = Record<ResourceId, Breakdown>;

function add(b: Breakdown, label: string, value: number): void {
  if (value === 0) return;
  const existing = b.items.find((i) => i.label === label);
  if (existing) existing.value += value;
  else b.items.push({ label, value });
  b.total += value;
}

export function computeIncome(state: GameState, power: number): Income {
  const income: Income = {
    gold: { total: 0, items: [] },
    science: { total: 0, items: [] },
    culture: { total: 0, items: [] },
  };
  const cities = citiesOf(state, power);
  for (const city of cities) {
    add(income.gold, 'Города по уровню', balance.city.goldByLevel[city.level - 1]);
    add(income.science, 'Города', balance.city.sciencePerCity);
    for (const id of city.buildings) {
      const def = buildingDef(id);
      for (const res of ['gold', 'science', 'culture'] as const) add(income[res], def.name, def.yields[res] ?? 0);
    }
  }
  const { owner } = state.territory;
  const specialNames: Record<string, string> = { gold: 'Золотые жилы', marble: 'Мрамор', ruins: 'Древние руины' };
  for (let t = 0; t < owner.length; t++) {
    if (owner[t] !== power) continue;
    const special = SPECIALS[state.map.special[t]];
    if (!special) continue;
    const y = specialYields[special];
    for (const res of ['gold', 'science', 'culture'] as const) add(income[res], specialNames[special], y[res] ?? 0);
  }
  // Сложность меняет только доход ботов: процент от прихода до вычета содержания.
  const p = state.powers[power];
  const bonus = p.isHuman ? 0 : balance.difficulty[state.settings.difficulty].botIncomeBonus;
  if (bonus) {
    for (const res of ['gold', 'science', 'culture'] as const) add(income[res], 'Сложность', Math.round(income[res].total * bonus));
  }
  const people = unitsOf(state, power).reduce((sum, u) => sum + unitPeople(u), 0);
  add(income.gold, 'Содержание юнитов', -people * balance.units.upkeepPerPerson);
  return income;
}

/** Прирост роста города за ход: +1 с каждой привязанной клетки суши. */
export function cityGrowthPerTurn(state: GameState, city: City): number {
  const { city: cityOf } = state.territory;
  let tiles = 0;
  for (let t = 0; t < cityOf.length; t++) if (cityOf[t] === city.id && isLand(state, t)) tiles++;
  return tiles * balance.city.growthPerLandTile;
}

export function citizenPrice(_state: GameState, _power: number): number {
  return balance.prices.citizen;
}

/** Военный юнит из казарм стоит как несколько жителей. */
export function militaryPrice(state: GameState, power: number): number {
  return citizenPrice(state, power) * balance.units.barracksPriceInCitizens;
}

/** Цена основания растёт с каждым городом державы. */
export function foundCityPrice(state: GameState, power: number): number {
  const count = citiesOf(state, power).length;
  return balance.prices.foundCityBase + balance.prices.foundCityStep * Math.max(0, count - 1);
}

/** Цена растёт с каждым однотипным зданием в державе. */
export function buildingPrice(state: GameState, power: number, buildingId: string): number {
  const def = buildingDef(buildingId);
  const owned = citiesOf(state, power).filter((c) => c.buildings.includes(buildingId)).length;
  return def.basePrice + def.priceStep * owned;
}

export function availableBuildings(): readonly string[] {
  return buildings.map((b) => b.id);
}
