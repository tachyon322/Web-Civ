// Здания. У каждой линии цепочка улучшений в том же слоте (рынок → ярмарка → банк → биржа и т. д.),
// доступных в любой момент; всё покупается за золото. Чудо света одно на весь мир и открывается с эпохой,
// державное здание — одно на державу и требует нескольких улучшений; ни то ни другое слот не занимает.
// Саботаж на время отключает здание.

import { buildingDef, buildings, improvementDefs, pathsConfig, type BuildingDef } from './data';
import { epochName, epochOf } from './epochs';
import { nationTrait } from './nations';
import { citiesOf, cityTiles, citySlots, isCoastal, usedSlots } from './state';
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

/** Цепочка улучшений вверх от здания: library → university → observatory → laboratory. */
function upgradesOf(id: string): string[] {
  const chain: string[] = [];
  for (let next = buildings.find((b) => b.upgradeOf === id); next; next = buildings.find((b) => b.upgradeOf === next!.id)) {
    chain.push(next.id);
  }
  return chain;
}

/** Город с этим зданием или его улучшением. */
function hasAtLeast(city: City, id: string): boolean {
  return city.buildings.includes(id) || upgradesOf(id).some((u) => city.buildings.includes(u));
}

/** Сколько городов державы с этим зданием или его улучшением (для державных зданий). */
export function citiesWith(state: GameState, power: number, id: string): number {
  return citiesOf(state, power).filter((c) => hasAtLeast(c, id)).length;
}

/** Город державы, где стоит это державное здание или его улучшение. */
export function nationalCity(state: GameState, power: number, id: string): City | null {
  return citiesOf(state, power).find((c) => hasAtLeast(c, id)) ?? null;
}

/** Скидка на чудеса в городе: мрамор и каменоломня на нём. */
function wonderSiteDiscount(state: GameState, city: City): number {
  let discount = 0;
  for (const t of cityTiles(state, city.id)) {
    if (state.map.special[t] !== S_MARBLE) continue;
    discount = Math.max(discount, pathsConfig.culture.wonderMarbleDiscount + (state.improvements.includes(t) ? (improvementDefs.marble?.wonderDiscount ?? 0) : 0));
  }
  return discount;
}

/** Цена растёт с каждым однотипным зданием в державе; чудо дешевле в городе с мрамором. */
export function buildingPrice(state: GameState, power: number, buildingId: string, city?: City): number {
  const def = buildingDef(buildingId);
  const owned = citiesOf(state, power).filter((c) => c.buildings.includes(buildingId)).length;
  let price = def.basePrice + def.priceStep * owned;
  if (def.wonder && city) price = Math.round(price * (1 - wonderSiteDiscount(state, city)));
  if (def.wonder) price = Math.round(price * (1 - (nationTrait(state, power).wonderDiscount ?? 0)));
  return price;
}

/** Почему здание нельзя купить в городе (кроме денег и покупки за ход); null — можно. */
export function buildingBlocker(state: GameState, power: number, city: City, def: BuildingDef): string | null {
  const epoch = epochOf(state.powers[power]);
  if ((def.epoch ?? 0) > epoch) return `Откроется в эпоху «${epochName(def.epoch!)}»`;
  if (city.buildings.includes(def.id)) return 'Здание уже построено';
  if (upgradesOf(def.id).some((u) => city.buildings.includes(u))) return 'Уже есть улучшенное здание';
  if (def.national) {
    const root = def.upgradeOf ?? def.id;
    const where = nationalCity(state, power, root);
    if (where && where.id !== city.id) return `Уже есть в державе: ${where.name}`;
  }
  if (def.upgradeOf && !city.buildings.includes(def.upgradeOf)) return `Сначала нужно здание «${buildingDef(def.upgradeOf).name}»`;
  if (def.requires) {
    const have = citiesWith(state, power, def.requires.building);
    if (have < def.requires.count) {
      return `Нужно городов с «${buildingDef(def.requires.building).name}» (или лучше): ${def.requires.count}, сейчас ${have}`;
    }
  }
  if (def.coastal && !isCoastal(state, city)) return 'Только в городе у моря';
  if (def.wonder) {
    const owner = wonderCity(state, def.id);
    return owner ? `Чудо уже построено: ${owner.name}` : null;
  }
  if (def.national || def.upgradeOf) return null;
  if (usedSlots(city) >= citySlots(state, city)) return 'Нет свободных слотов';
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

/** Державные здания пропадают, когда город переходит к другой державе. */
export function dropNationalBuildings(city: City): void {
  city.buildings = city.buildings.filter((b) => !buildingDef(b).national);
  if (city.disabledBuilding && !city.buildings.includes(city.disabledBuilding)) city.disabledBuilding = null;
}
