// Разметка земли: территория растёт только жителями в пределах общего лимита земли державы,
// клетка привязывается к ближайшему своему городу.

import { balance } from './data';
import { distance, neighbors, range } from './hex';
import { isLand, landLimit, landTiles, mapSize } from './state';
import { NONE, type City, type GameState } from './types';

export type ClaimCheck = { ok: true; city: City } | { ok: false; reason: string };

export const LAND_LIMIT_REASON = 'Исчерпан лимит земли державы';

/** Ближайший свой город (при равенстве — с меньшим id). */
export function nearestOwnCity(state: GameState, power: number, tile: number): City | null {
  const size = mapSize(state);
  let best: City | null = null;
  let bestDist = Infinity;
  for (const city of state.cities) {
    if (city.owner !== power) continue;
    const d = distance(size, city.tile, tile);
    if (d < bestDist || (d === bestDist && best !== null && city.id < best.id)) {
      best = city;
      bestDist = d;
    }
  }
  return best;
}

export function bordersTerritory(state: GameState, power: number, tile: number): boolean {
  return neighbors(mapSize(state), tile).some((n) => state.territory.owner[n] === power);
}

/** Осталось клеток до лимита земли державы. */
export function landLeft(state: GameState, power: number): number {
  return landLimit(state, power) - landTiles(state, power);
}

/** Может ли житель державы разметить клетку, на которую он вошёл. */
export function checkClaim(state: GameState, power: number, tile: number): ClaimCheck {
  if (!isLand(state, tile)) return { ok: false, reason: 'Размечать можно только сушу' };
  if (state.territory.owner[tile] !== NONE) return { ok: false, reason: 'Клетка уже занята' };
  if (!bordersTerritory(state, power, tile)) {
    return { ok: false, reason: 'Клетка не граничит с вашей территорией' };
  }
  if (landLeft(state, power) <= 0) return { ok: false, reason: LAND_LIMIT_REASON };
  const city = nearestOwnCity(state, power, tile);
  if (!city) return { ok: false, reason: 'Нет своих городов' };
  return { ok: true, city };
}

/** Размечает клетку, если правила позволяют. Возвращает город, к которому она привязана. */
export function tryClaim(state: GameState, power: number, tile: number): City | null {
  const check = checkClaim(state, power, tile);
  if (!check.ok) return null;
  state.territory.owner[tile] = power;
  state.territory.city[tile] = check.city.id;
  return check.city;
}

/**
 * Землю нового города: сам центр и нейтральная суша в радиусе основания.
 * Чужие клетки и клетки других своих городов (кроме центра) не трогаются.
 */
export function assignFoundingTiles(state: GameState, city: City): void {
  const { owner, city: cityOf } = state.territory;
  owner[city.tile] = city.owner;
  cityOf[city.tile] = city.id;
  for (const t of range(mapSize(state), city.tile, balance.city.foundRadius)) {
    if (t === city.tile || !isLand(state, t) || owner[t] !== NONE) continue;
    owner[t] = city.owner;
    cityOf[t] = city.id;
  }
}
