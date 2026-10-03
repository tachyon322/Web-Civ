// Создание и удаление городов и юнитов внутри apply-функций.

import { balance, nationDef } from './data';
import { neighbors } from './hex';
import { canStop } from './pathfinding';
import { cityMaxDurability, isLand, mapSize } from './state';
import { assignFoundingTiles } from './territory';
import { NONE, type City, type GameState, type Unit, type UnitType } from './types';
import { reveal } from './visibility';

export function log(state: GameState, power: number, text: string): void {
  state.log.push({ turn: state.turn, power, text });
}

function nextCityName(state: GameState, power: number): string {
  const p = state.powers[power];
  const names = nationDef(p.nationId).cities;
  const i = p.cityNamesUsed++;
  return i < names.length ? names[i] : `${p.name} ${i + 1}`;
}

export function createCity(state: GameState, power: number, tile: number, isCapital: boolean): City {
  const city: City = {
    id: state.nextId++,
    owner: power,
    name: nextCityName(state, power),
    tile,
    level: 1,
    growth: 0,
    buildings: [],
    purchasedThisTurn: false,
    isCapital,
    durability: 0,
    attackedThisTurn: false,
    founder: power,
    plunderBlockedUntil: 0,
  };
  city.durability = cityMaxDurability(city);
  state.cities.push(city);
  if (isCapital) state.powers[power].capitalId = city.id;
  assignFoundingTiles(state, city);
  reveal(state, power, tile, balance.vision.city);
  return city;
}

/** Юнит без места в состоянии — для проверок «можно ли сюда встать». */
export function probeUnit(owner: number, tile: number, type: UnitType = 'citizen'): Unit {
  return {
    id: NONE,
    owner,
    type,
    level: 1,
    strength: 1,
    stars: 0,
    tile,
    mp: 0,
    routeTarget: NONE,
    moved: false,
    fortified: false,
  };
}

export function createUnit(
  state: GameState,
  power: number,
  type: UnitType,
  tile: number,
  mp: number,
  level = 1,
): Unit {
  const unit: Unit = {
    ...probeUnit(power, tile, type),
    id: state.nextId++,
    level,
    strength: 2 ** (level - 1),
    mp,
  };
  state.units.push(unit);
  reveal(state, power, tile, balance.vision.unit);
  return unit;
}

export function removeUnit(state: GameState, unitId: number): void {
  state.units = state.units.filter((u) => u.id !== unitId);
}

/** Клетка появления купленного юнита: сам город, иначе свободный сосед (суша раньше воды). */
export function spawnTile(state: GameState, city: City): number | null {
  const probe = probeUnit(city.owner, city.tile);
  if (canStop(state, probe, city.tile)) return city.tile;
  const around = neighbors(mapSize(state), city.tile).filter((n) => canStop(state, probe, n));
  return around.find((n) => isLand(state, n)) ?? around[0] ?? null;
}
