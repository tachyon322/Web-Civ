// Запросы к состоянию: чистые функции чтения, без изменений.

import { balance, buildingDef, terrainDefs, unitDef } from './data';
import { neighbors, type MapSize } from './hex';
import { NONE, TERRAINS, type City, type GameState, type Power, type Unit } from './types';

export function mapSize(state: GameState): MapSize {
  return state.map;
}

export function tileCount(state: GameState): number {
  return state.map.width * state.map.height;
}

export function isLand(state: GameState, tile: number): boolean {
  return terrainDefs[TERRAINS[state.map.terrain[tile]]].land;
}

/** Стоимость входа в клетку по местности; null — непроходимо. */
export function terrainMoveCost(state: GameState, tile: number): number | null {
  return terrainDefs[TERRAINS[state.map.terrain[tile]]].moveCost;
}

export function getPower(state: GameState, id: number): Power {
  const p = state.powers[id];
  if (!p) throw new Error(`Нет державы ${id}`);
  return p;
}

export function findUnit(state: GameState, id: number): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

export function findCity(state: GameState, id: number): City | undefined {
  return state.cities.find((c) => c.id === id);
}

export function unitAt(state: GameState, tile: number): Unit | undefined {
  return state.units.find((u) => u.tile === tile);
}

export function cityAt(state: GameState, tile: number): City | undefined {
  return state.cities.find((c) => c.tile === tile);
}

export function citiesOf(state: GameState, power: number): City[] {
  return state.cities.filter((c) => c.owner === power);
}

export function unitsOf(state: GameState, power: number): Unit[] {
  return state.units.filter((u) => u.owner === power);
}

export function cityTiles(state: GameState, cityId: number): number[] {
  const result: number[] = [];
  const cityOf = state.territory.city;
  for (let i = 0; i < cityOf.length; i++) if (cityOf[i] === cityId) result.push(i);
  return result;
}

export function cityTileCountAll(state: GameState): Map<number, number> {
  const counts = new Map<number, number>();
  for (const c of state.territory.city) if (c !== NONE) counts.set(c, (counts.get(c) ?? 0) + 1);
  return counts;
}

export function cityTileLimit(city: City): number {
  return balance.city.tileLimit[city.level - 1];
}

export function citySlots(city: City): number {
  return balance.city.slots[city.level - 1];
}

/** Порог роста до следующего уровня или null на максимальном уровне. */
export function cityGrowthThreshold(city: City): number | null {
  if (city.level >= balance.city.maxLevel) return null;
  return balance.city.growthToNextLevel[city.level - 1];
}

export function unitPeople(unit: Unit): number {
  return 2 ** (unit.level - 1);
}

/** Максимальная сила юнита равна числу людей в нём. */
export function unitMaxStrength(unit: Unit): number {
  return unitPeople(unit);
}

export function unitBaseMp(unit: Unit): number {
  return unitDef(unit.type).mp;
}

export function isMilitary(unit: Unit): boolean {
  return unitDef(unit.type).military;
}

export function hasBuildingEffect(city: City, effect: 'barracks' | 'walls'): boolean {
  return city.buildings.some((b) => buildingDef(b).effect === effect);
}

export function cityMaxDurability(city: City): number {
  return city.buildings.reduce((sum, b) => sum + (buildingDef(b).durability ?? 0), balance.cityDefense.durabilityBase);
}

export function atWar(state: GameState, a: number, b: number): boolean {
  return a !== b && state.powers[a].wars.includes(b);
}

/**
 * Есть ли снабжение на клетке: своя территория или клетка рядом с ней.
 * Союзная территория добавится на этапе 4.
 */
export function suppliedAt(state: GameState, power: number, tile: number): boolean {
  const { owner } = state.territory;
  return owner[tile] === power || neighbors(mapSize(state), tile).some((n) => owner[n] === power);
}
