// Типизированный доступ к JSON-данным. Все числа баланса живут в src/data.

import aiJson from '../data/ai.json';
import balanceJson from '../data/balance.json';
import buildingsJson from '../data/buildings.json';
import mapgenJson from '../data/mapgen.json';
import nationsJson from '../data/nations.json';
import terrainJson from '../data/terrain.json';
import type { Character, SpecialId, TerrainId, UnitType } from './types';

export type Yields = Partial<Record<'gold' | 'science' | 'culture', number>>;

export interface BuildingDef {
  id: string;
  name: string;
  basePrice: number;
  priceStep: number;
  yields: Yields;
  /** Особый эффект: казармы, стены. */
  effect?: 'barracks' | 'walls';
  /** Прибавка к прочности города (стены). */
  durability?: number;
  /** Прибавка к силе города в защите и при выстреле (стены). */
  strength?: number;
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
  cities: string[];
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
/** Настройки ботов: характеры и веса решений. */
export const aiConfig = aiJson;
export const terrainDefs: Readonly<Record<TerrainId, TerrainDef>> = terrainJson;
export const specialYields: Readonly<Record<SpecialId, Yields>> = balance.specials;

export function unitDef(type: UnitType): UnitDef {
  return balance.units[type];
}

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

export function characterDef(id: Character): (typeof aiJson.characters)[Character] {
  return aiJson.characters[id];
}
