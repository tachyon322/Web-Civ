// Доходы и цены. Каждая цифра собирается из слагаемых, чтобы интерфейс мог показать разбивку.

import { activeBuildings, buildingPrice } from './buildings';
import { balance, buildingDef, buildings, diplomacyConfig, pathsConfig, specialistDefs, specialYields } from './data';
import { throughCurtain } from './curtain';
import { improvementFor } from './improvements';
import { nationTrait } from './nations';
import { borderTiles } from './relations';
import { stabilityLevel } from './stability';
import { citiesOf, isLand, peopleAtLevel, unitPeople, unitsOf, vassalsOf } from './state';
import { SPECIALIST_KINDS, SPECIALS, type City, type GameState } from './types';

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

function emptyIncome(): Income {
  return { gold: { total: 0, items: [] }, science: { total: 0, items: [] }, culture: { total: 0, items: [] } };
}

const RESOURCES = ['gold', 'science', 'culture'] as const;

/** Производство: города, земля, работающие здания, специалисты, особые клетки и сооружения на них;
 *  проценты — черта нации, державные здания, сложность (у ботов) и стабильность. */
function production(state: GameState, power: number): Income {
  const income = emptyIncome();
  const cities = citiesOf(state, power);
  for (const city of cities) {
    add(income.gold, 'Города по уровню', balance.city.goldByLevel[city.level - 1]);
    add(income.science, 'Города', balance.city.sciencePerCity);
    for (const kind of SPECIALIST_KINDS) {
      const def = specialistDefs[kind];
      for (const res of RESOURCES) add(income[res], `Специалисты: ${def.plural}`, city.specialists[kind] * (def.yields[res] ?? 0));
    }
    for (const id of activeBuildings(city)) {
      const def = buildingDef(id);
      for (const res of RESOURCES) add(income[res], def.name, def.yields[res] ?? 0);
      const per = def.perSpecialist;
      if (per) for (const res of RESOURCES) add(income[res], def.name, city.specialists[per.kind] * (per.yields[res] ?? 0));
    }
  }
  const { owner } = state.territory;
  let land = 0;
  for (let t = 0; t < owner.length; t++) if (owner[t] === power && isLand(state, t)) land++;
  add(income.gold, 'Земля', land * balance.city.goldPerLandTile);
  const specialNames: Record<string, string> = { gold: 'Золотые жилы', marble: 'Мрамор', ruins: 'Древние руины' };
  for (let t = 0; t < owner.length; t++) {
    if (owner[t] !== power) continue;
    const special = SPECIALS[state.map.special[t]];
    if (!special) continue;
    const y = specialYields[special];
    for (const res of RESOURCES) add(income[res], specialNames[special], y[res] ?? 0);
  }
  for (const t of state.improvements) {
    if (owner[t] !== power) continue;
    const def = improvementFor(state, t);
    if (def) for (const res of RESOURCES) add(income[res], def.name, def.yields[res] ?? 0);
  }
  // Черта нации и державные здания: доли к производству (обе от одной базы, не друг от друга).
  const base = { gold: income.gold.total, science: income.science.total, culture: income.culture.total };
  const trait = nationTrait(state, power);
  if (trait.science) add(income.science, trait.name, Math.round(base.science * trait.science));
  if (trait.culture) add(income.culture, trait.name, Math.round(base.culture * trait.culture));
  for (const city of cities) {
    for (const id of activeBuildings(city)) {
      const bonus = buildingDef(id).bonus;
      if (bonus) for (const res of RESOURCES) add(income[res], buildingDef(id).name, Math.round(Math.max(0, base[res]) * (bonus[res] ?? 0)));
    }
  }
  // Сложность меняет только доход ботов: процент от прихода до вычета содержания.
  const p = state.powers[power];
  const bonus = p.isHuman ? 0 : balance.difficulty[state.settings.difficulty].botIncomeBonus;
  if (bonus) {
    for (const res of RESOURCES) add(income[res], 'Сложность', Math.round(income[res].total * bonus));
  }
  // Стабильность: расцвет прибавляет, недовольство и мятежи убавляют.
  const level = stabilityLevel(p.stability);
  if (level.income) {
    for (const res of RESOURCES) add(income[res], `Стабильность: ${level.name.toLowerCase()}`, Math.round(income[res].total * level.income));
  }
  return income;
}

/** Кто забирает науку у державы утечкой мозгов: соседи по границе с намного более сильной культурой. */
export function brainDrainTakers(state: GameState, victim: number): number[] {
  const cfg = pathsConfig.culture;
  const theirs = Math.max(1, state.powers[victim].cultureTotal);
  return state.powers
    .filter((p) => p.alive && p.id !== victim && p.cultureTotal >= theirs * cfg.brainDrainRatio && borderTiles(state, p.id, victim) > 0)
    .map((p) => p.id);
}

/** Сколько науки уходит от victim к забирающему taker (цифровой занавес victim режет утечку). */
function brainDrainEach(state: GameState, victim: number, takers: number[], taker: number): number {
  const cfg = pathsConfig.culture;
  if (!takers.length) return 0;
  const share = Math.min(cfg.brainDrainMaxShare, cfg.brainDrainShare * takers.length) / takers.length;
  return Math.floor(throughCurtain(state, victim, taker, Math.max(0, production(state, victim).science.total) * share));
}

/** Доход без дани: производство, утечка мозгов, торговля, содержание. */
function baseIncome(state: GameState, power: number): Income {
  const income = production(state, power);
  const takers = brainDrainTakers(state, power);
  add(income.science, 'Утечка мозгов', -takers.reduce((sum, t) => sum + brainDrainEach(state, power, takers, t), 0));
  let gained = 0;
  for (const other of state.powers) {
    if (!other.alive || other.id === power || state.powers[power].cultureTotal <= other.cultureTotal) continue;
    const t = brainDrainTakers(state, other.id);
    if (t.includes(power)) gained += brainDrainEach(state, other.id, t, power);
  }
  add(income.science, 'Утечка мозгов к нам', gained);
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
  return sum * (nationTrait(state, power).tradeFactor ?? 1);
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
  return Math.round(tiles * balance.city.growthPerLandTile * (nationTrait(state, city.owner).growthFactor ?? 1));
}

export function citizenPrice(_state: GameState, _power: number): number {
  return balance.prices.citizen;
}

/** Военный юнит из казарм или академии стоит как столько жителей, сколько в нём людей. */
export function militaryPrice(state: GameState, power: number, level: number): number {
  return citizenPrice(state, power) * peopleAtLevel(level) * balance.units.militaryPricePerPerson;
}

/** Цена основания растёт с каждым городом державы. */
export function foundCityPrice(state: GameState, power: number): number {
  const count = citiesOf(state, power).length;
  return balance.prices.foundCityBase + balance.prices.foundCityStep * Math.max(0, count - 1);
}

export { buildingPrice };

export function availableBuildings(): readonly string[] {
  return buildings.map((b) => b.id);
}
