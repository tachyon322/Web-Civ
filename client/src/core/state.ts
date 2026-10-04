// Запросы к состоянию: чистые функции чтения, без изменений.

import { balance, buildingDef, pathsConfig, terrainDefs, unitDef } from './data';
import { epochOf } from './epochs';
import { neighbors, type MapSize } from './hex';
import { nationTrait, unitTypeMp } from './nations';
import { NONE, SPECIALIST_KINDS, TERRAINS, type City, type GameState, type Pact, type PactKind, type Power, type Unit } from './types';

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

/** Вклад города в лимит земли державы (по уровню и черте нации). */
export function cityTileLimit(state: GameState, city: City): number {
  return balance.city.tileLimit[city.level - 1] + (nationTrait(state, city.owner).tileLimit ?? 0);
}

/** Лимит земли державы: сумма вкладов всех её городов. */
export function landLimit(state: GameState, power: number): number {
  let sum = 0;
  for (const c of state.cities) if (c.owner === power) sum += cityTileLimit(state, c);
  return sum;
}

/** Сколько клеток у державы (территория — только суша). */
export function landTiles(state: GameState, power: number): number {
  let n = 0;
  for (const o of state.territory.owner) if (o === power) n++;
  return n;
}

/** Слоты зданий: по уровню города и +1 за некоторые эпохи владельца (средневековье, индустрия). */
export function citySlots(state: GameState, city: City): number {
  const epoch = epochOf(state.powers[city.owner]);
  return balance.city.slots[city.level - 1] + pathsConfig.epoch.slotEpochs.filter((e) => e <= epoch).length;
}

/** Здание занимает слот (чудеса и державные здания — нет). */
export function takesSlot(id: string): boolean {
  const def = buildingDef(id);
  return !def.wonder && !def.national;
}

export function usedSlots(city: City): number {
  return city.buildings.filter(takesSlot).length;
}

/** Сколько специалистов в городе всего. */
export function specialistCount(city: City): number {
  return SPECIALIST_KINDS.reduce((sum, k) => sum + city.specialists[k], 0);
}

/** После потери уровня лишние здания (кроме чудес и державных) сносятся с последнего построенного,
 *  лишние специалисты уходят — сначала тех видов, которых больше. */
export function fitCityToLevel(state: GameState, city: City): void {
  for (let i = city.buildings.length - 1; i >= 0 && usedSlots(city) > citySlots(state, city); i--) {
    if (takesSlot(city.buildings[i])) city.buildings.splice(i, 1);
  }
  while (specialistCount(city) > city.level) {
    const most = [...SPECIALIST_KINDS].sort((a, b) => city.specialists[b] - city.specialists[a])[0];
    city.specialists[most]--;
  }
}

/** Город у моря: рядом с ним есть вода. */
export function isCoastal(state: GameState, city: City): boolean {
  return neighbors(mapSize(state), city.tile).some((t) => !isLand(state, t));
}

/** Порог роста до следующего уровня или null на максимальном уровне. */
export function cityGrowthThreshold(city: City): number | null {
  if (city.level >= balance.city.maxLevel) return null;
  return balance.city.growthToNextLevel[city.level - 1];
}

export function unitPeople(unit: Unit): number {
  return peopleAtLevel(unit.level);
}

/** Сколько людей в юните этого уровня: 1, 2, 4, 8. */
export function peopleAtLevel(level: number): number {
  return 2 ** (level - 1);
}

/** Максимальная сила юнита равна числу людей в нём. */
export function unitMaxStrength(unit: Unit): number {
  return unitPeople(unit);
}

export function unitBaseMp(state: GameState, unit: Unit): number {
  return unitTypeMp(state, unit.owner, unit.type);
}

export function isMilitary(unit: Unit): boolean {
  return unitDef(unit.type).military;
}

export function hasBuildingEffect(city: City, effect: 'barracks' | 'walls'): boolean {
  return city.buildings.some((b) => buildingDef(b).effect === effect);
}

/** Уровень военного юнита, которого можно купить в городе (0 — нет казарм). */
export function cityUnitLevel(city: City): number {
  return city.buildings.reduce((max, b) => Math.max(max, buildingDef(b).unitLevel ?? 0), 0);
}

export function cityMaxDurability(city: City): number {
  return city.buildings.reduce((sum, b) => sum + (buildingDef(b).durability ?? 0), balance.cityDefense.durabilityBase);
}

export function atWar(state: GameState, a: number, b: number): boolean {
  return a !== b && state.powers[a].wars.includes(b);
}

export function findPact(state: GameState, a: number, b: number, kind: PactKind): Pact | undefined {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return state.pacts.find((p) => p.a === lo && p.b === hi && p.kind === kind);
}

export function hasPact(state: GameState, a: number, b: number, kind: PactKind): boolean {
  return findPact(state, a, b, kind) !== undefined;
}

/** Сколько ходов ещё действует перемирие (0 — нет перемирия). */
export function truceLeft(state: GameState, a: number, b: number): number {
  const p = findPact(state, a, b, 'truce');
  return p ? Math.max(0, p.until - state.turn) : 0;
}

export function vassalsOf(state: GameState, power: number): number[] {
  return state.powers.filter((p) => p.alive && p.suzerain === power).map((p) => p.id);
}

/** Кто ведёт внешнюю политику за державу: сюзерен вассала или она сама. */
export function principalOf(state: GameState, power: number): number {
  const s = state.powers[power].suzerain;
  return s === NONE ? power : s;
}

/** Связаны ли державы вассалитетом (в любую сторону). */
export function vassalLink(state: GameState, a: number, b: number): boolean {
  return state.powers[a].suzerain === b || state.powers[b].suzerain === a;
}

/** Союзники в широком смысле: союз или вассалитет. У них общая сеть, обзор и снабжение. */
export function allied(state: GameState, a: number, b: number): boolean {
  if (a === b || a === NONE || b === NONE) return false;
  return hasPact(state, a, b, 'alliance') || vassalLink(state, a, b);
}

/** Державы, с которыми у этой общая сеть и обзор (без неё самой). */
export function friendsOf(state: GameState, power: number): number[] {
  return state.powers.filter((p) => p.alive && allied(state, power, p.id)).map((p) => p.id);
}

/** Есть ли снабжение на клетке: своя или союзная территория или клетка рядом с ней. */
export function suppliedAt(state: GameState, power: number, tile: number): boolean {
  const { owner } = state.territory;
  const friends = friendsOf(state, power);
  const ok = (o: number) => o === power || (o !== NONE && friends.includes(o));
  return ok(owner[tile]) || neighbors(mapSize(state), tile).some((n) => ok(owner[n]));
}
