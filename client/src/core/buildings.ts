// Здания: улучшения (библиотека → университет → лаборатория, храм → театр → музей) занимают тот же слот
// и открываются с эпохами; чудо света одно на весь мир; саботаж на время отключает здание.

import { buildingDef, buildings, pathsConfig, type BuildingDef } from './data';
import { epochName, epochOf } from './epochs';
import { nationTrait } from './nations';
import { citiesOf, cityTiles, citySlots } from './state';
import { S_MARBLE, type City, type GameState } from './types';

/** Работающие здания города (без отключённого саботажем). */
export function activeBuildings(city: City): string[] {
  if (city.disabledTurns <= 0 || !city.disabledBuilding) return city.buildings;
  return city.buildings.filter((b) => b !== city.disabledBuilding);
}

/** Кто в мире уже построил это чудо (город) или null. */
export function wonderCity(state: GameState, id: string): City | null {
  return state.cities.find((c) => c.buildings.includes(id)) ?? null;
}

/** Цепочка улучшений вверх от здания: library → university → laboratory. */
function upgradesOf(id: string): string[] {
  const chain: string[] = [];
  for (let next = buildings.find((b) => b.upgradeOf === id); next; next = buildings.find((b) => b.upgradeOf === next!.id)) {
    chain.push(next.id);
  }
  return chain;
}

function cityHasMarble(state: GameState, city: City): boolean {
  return cityTiles(state, city.id).some((t) => state.map.special[t] === S_MARBLE);
}

/** Цена растёт с каждым однотипным зданием в державе; чудо дешевле в городе с мрамором. */
export function buildingPrice(state: GameState, power: number, buildingId: string, city?: City): number {
  const def = buildingDef(buildingId);
  const owned = citiesOf(state, power).filter((c) => c.buildings.includes(buildingId)).length;
  let price = def.basePrice + def.priceStep * owned;
  if (def.wonder && city && cityHasMarble(state, city)) price = Math.round(price * (1 - pathsConfig.culture.wonderMarbleDiscount));
  if (def.wonder) price = Math.round(price * (1 - (nationTrait(state, power).wonderDiscount ?? 0)));
  return price;
}

/** Почему здание нельзя купить в городе (кроме денег и покупки за ход); null — можно. */
export function buildingBlocker(state: GameState, power: number, city: City, def: BuildingDef): string | null {
  const epoch = epochOf(state.powers[power]);
  if ((def.epoch ?? 0) > epoch) return `Откроется в эпоху «${epochName(def.epoch!)}»`;
  if (city.buildings.includes(def.id)) return 'Здание уже построено';
  if (upgradesOf(def.id).some((u) => city.buildings.includes(u))) return 'Уже есть улучшенное здание';
  if (def.upgradeOf) {
    if (!city.buildings.includes(def.upgradeOf)) return `Сначала нужно здание «${buildingDef(def.upgradeOf).name}»`;
    return null;
  }
  if (def.wonder) {
    const owner = wonderCity(state, def.id);
    if (owner) return `Чудо уже построено: ${owner.name}`;
  }
  if (city.buildings.length >= citySlots(city)) return 'Нет свободных слотов';
  return null;
}

/** Добавляет здание: улучшение заменяет предыдущее в том же слоте. */
export function addBuilding(city: City, def: BuildingDef): void {
  if (def.upgradeOf) {
    const i = city.buildings.indexOf(def.upgradeOf);
    if (i >= 0) {
      city.buildings[i] = def.id;
      return;
    }
  }
  city.buildings.push(def.id);
}

/** Сколько чудес света у державы. */
export function wondersOwned(state: GameState, power: number): number {
  return citiesOf(state, power).reduce((n, c) => n + c.buildings.filter((b) => buildingDef(b).wonder).length, 0);
}
