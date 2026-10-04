// Типизированный доступ к JSON-данным. Все числа баланса живут в src/data.

import aiJson from '../data/ai.json';
import balanceJson from '../data/balance.json';
import buildingsJson from '../data/buildings.json';
import diplomacyJson from '../data/diplomacy.json';
import mapgenJson from '../data/mapgen.json';
import nationsJson from '../data/nations.json';
import pathsJson from '../data/paths.json';
import terrainJson from '../data/terrain.json';
import traitsJson from '../data/traits.json';
import type { Character, MemoryKind, SpecialId, SpecialistKind, TerrainId, UnitType } from './types';

export type Yields = Partial<Record<'gold' | 'science' | 'culture', number>>;
export type Currency = 'gold' | 'science' | 'culture';

export interface BuildingDef {
  id: string;
  name: string;
  basePrice: number;
  priceStep: number;
  yields: Yields;
  /** Особый эффект: казармы (и академия), стены (и их улучшения). */
  effect?: 'barracks' | 'walls';
  /** Уровень военного юнита, которого можно купить в городе (казармы, академия). */
  unitLevel?: number;
  /** Только в городе у моря. */
  coastal?: boolean;
  /** Доход за каждого специалиста этого вида в городе (школа — за учёных). */
  perSpecialist?: { kind: SpecialistKind; yields: Yields };
  /** Державное здание: одно на державу, слот не занимает, даёт процент к доходу. */
  national?: boolean;
  /** Доля к производству державы (державные здания). */
  bonus?: Yields;
  /** Условие: столько городов с этим зданием или его улучшением. */
  requires?: { building: string; count: number };
  /** Прибавка к прочности города (стены). */
  durability?: number;
  /** Прибавка к силе города в защите и при выстреле (стены). */
  strength?: number;
  /** Прибавка к стабильности державы. */
  stability?: number;
  /** Улучшение какого здания (занимает тот же слот). */
  upgradeOf?: string;
  /** С какой эпохи доступно (индекс; только у чудес). */
  epoch?: number;
  /** Чудо света: одно на весь мир, слот не занимает. */
  wonder?: boolean;
}

export interface UnitDef {
  name: string;
  mp: number;
  military: boolean;
  /** Дальность атаки: 1 — ближний бой, 2 — лучник. */
  range: number;
  canCapture: boolean;
}

export interface NationDef {
  id: string;
  name: string;
  color: string;
  /** Характер, который бот этой нации получает чаще. */
  tendency: Character;
  /** Черта нации (ключ в traits.json). */
  trait: string;
  cities: string[];
}

/** Черта нации: одна пассивная поправка к общим правилам; отсутствующее поле — без эффекта. */
export interface TraitDef {
  name: string;
  description: string;
  /** Звёзд ветерана при слиянии (Рим). */
  mergeStar?: number;
  /** Очков хода всадникам (Монголы). */
  cavalryMp?: number;
  /** Бонус за звезду ветерана вместо обычного (Япония). */
  starBonus?: number;
  /** Доля к производству науки и культуры (Китай, Греция). */
  science?: number;
  culture?: number;
  /** Скидка на научные способности (Арабы). */
  scienceAbilityDiscount?: number;
  /** Скидка на чудеса (Египет). */
  wonderDiscount?: number;
  /** Множитель культурного давления державы (Франция). */
  pressureFactor?: number;
  /** Множитель золота с торговых договоров (Карфаген). */
  tradeFactor?: number;
  /** Множитель роста городов (Индия). */
  growthFactor?: number;
  /** Клеток к лимиту каждого города и потери врагов на своей земле (Россия). */
  tileLimit?: number;
  enemyAttrition?: number;
  /** Городов без штрафа к стабильности (Персия). */
  freeCities?: number;
  /** Множитель подарков и культурного обмена (Византия). */
  giftFactor?: number;
}

export interface TerrainDef {
  name: string;
  land: boolean;
  /** null — непроходимо. */
  moveCost: number | null;
  defenseBonus: number;
}

export const balance = balanceJson;
export const mapgenConfig = mapgenJson;
export const buildings: readonly BuildingDef[] = buildingsJson as BuildingDef[];
export const nations: readonly NationDef[] = nationsJson as NationDef[];
export const traits: Readonly<Record<string, TraitDef>> = traitsJson;
/** Настройки ботов: характеры и веса решений. */
export const aiConfig = aiJson;
export const terrainDefs: Readonly<Record<TerrainId, TerrainDef>> = terrainJson;
export const specialYields: Readonly<Record<SpecialId, Yields>> = balance.specials;

export function unitDef(type: UnitType): UnitDef {
  return balance.units[type];
}

export interface SpecialistDef {
  name: string;
  /** Родительный падеж множественного числа: «учёных». */
  plural: string;
  yields: Yields;
  currencies: Currency[];
}

export interface ImprovementDef {
  name: string;
  yields: Yields;
  basePrice: number;
  priceStep: number;
  /** Скидка на чудеса в городе с этим сооружением (каменоломня). */
  wonderDiscount?: number;
}

export const specialistDefs = balance.specialists.kinds as Readonly<Record<SpecialistKind, SpecialistDef>>;
export const improvementDefs = balance.improvements as Readonly<Partial<Record<SpecialId, ImprovementDef>>>;

export function buildingDef(id: string): BuildingDef {
  const def = buildings.find((b) => b.id === id);
  if (!def) throw new Error(`Неизвестное здание: ${id}`);
  return def;
}

export function nationDef(id: string): NationDef {
  const def = nations.find((n) => n.id === id);
  if (!def) throw new Error(`Неизвестная нация: ${id}`);
  return def;
}

export function traitDef(id: string): TraitDef {
  const def = traits[id];
  if (!def) throw new Error(`Неизвестная черта: ${id}`);
  return def;
}

/** Эпохи, стабильность, способности, культура, финальные проекты, победы. */
export const pathsConfig = pathsJson;

export type AbilityId = keyof typeof pathsJson.abilities;

/** Числа дипломатии: отношения, память, подарки, сделки. */
export const diplomacyConfig = diplomacyJson;

export type DiplomacyTraits = (typeof diplomacyJson.characters)['diplomat'];

/** Дипломатические черты: у ботов — по характеру, у игрока — нейтральные. */
const NEUTRAL_TRAITS: DiplomacyTraits = {
  giftFactor: 1,
  borderFactor: 1,
  respectsStrength: false,
  tradeOpinionFactor: 1,
  trade: 0,
  alliance: 0,
  union: 0,
  joinWar: 0,
  tribute: 0,
  peace: 0,
  cultureFactor: 1,
  influenceResist: 1,
  inciteFactor: 1,
};

export function diplomacyTraits(character: Character | null): DiplomacyTraits {
  return character ? diplomacyJson.characters[character] : NEUTRAL_TRAITS;
}

export function memoryDef(kind: MemoryKind): { label: string; hold: number; fade: number } {
  return diplomacyJson.memories[kind];
}

export function characterDef(id: Character): (typeof aiJson.characters)[Character] {
  return aiJson.characters[id];
}
