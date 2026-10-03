// Доходы и цены. Каждая цифра собирается из слагаемых, чтобы интерфейс мог показать разбивку.

import { balance, buildingDef, buildings, diplomacyConfig, specialYields } from './data';
import { borderTiles } from './relations';
import { citiesOf, isLand, unitPeople, unitsOf, vassalsOf } from './state';
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

/** Доход без дани: города, здания, особые клетки, сложность, торговля, содержание. */
function baseIncome(state: GameState, power: number): Income {
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
  add(income.gold, 'Торговые договоры', tradeGold(state, power));
  const people = unitsOf(state, power).reduce((sum, u) => sum + unitPeople(u), 0);
  add(income.gold, 'Содержание юнитов', -people * balance.units.upkeepPerPerson);
  return income;
}

/** Золото с торговых договоров: каждый даёт обоим, больше при общей границе. */
export function tradeGold(state: GameState, power: number): number {
  const cfg = diplomacyConfig.trade;
  let sum = 0;
  for (const p of state.pacts) {
    if (p.kind !== 'trade' || (p.a !== power && p.b !== power)) continue;
    const partner = p.a === power ? p.b : p.a;
    sum += cfg.goldBase + (borderTiles(state, power, partner) > 0 ? cfg.goldBorder : 0);
  }
  return sum;
}

/** Дань вассала сюзерену: доля его золотого дохода, если он положительный. */
export function vassalTribute(state: GameState, vassal: number): number {
  if (state.powers[vassal].suzerain === -1) return 0;
  const gold = baseIncome(state, vassal).gold.total;
  return Math.floor(Math.max(0, gold) * diplomacyConfig.vassal.tributeShare);
}

export function computeIncome(state: GameState, power: number): Income {
  const income = baseIncome(state, power);
  add(income.gold, 'Дань сюзерену', -vassalTribute(state, power));
  for (const v of vassalsOf(state, power)) add(income.gold, 'Дань вассалов', vassalTribute(state, v));
  return income;
}

/** Приход золота до вычета содержания и дани — мера «дохода» для относительной ценности. */
export function grossGold(state: GameState, power: number): number {
  return baseIncome(state, power)
    .gold.items.filter((i) => i.value > 0)
    .reduce((sum, i) => sum + i.value, 0);
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
