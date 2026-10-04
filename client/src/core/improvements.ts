// Сооружения на особых клетках: рудник на золотой жиле, каменоломня на мраморе, раскопки на руинах.
// Покупаются в городе, к которому привязана клетка (его покупка за ход), слот не занимают, одно на клетку.
// Сооружение остаётся на клетке и работает на того, кому клетка принадлежит.

import { improvementDefs, type ImprovementDef } from './data';
import { cityTiles } from './state';
import { SPECIALS, type City, type GameState } from './types';

/** Какое сооружение можно поставить на клетке (по её особенности) или null. */
export function improvementFor(state: GameState, tile: number): ImprovementDef | null {
  const special = SPECIALS[state.map.special[tile]];
  return special ? (improvementDefs[special] ?? null) : null;
}

/** Особые клетки города без сооружения. */
export function improvableTiles(state: GameState, city: City): number[] {
  return cityTiles(state, city.id).filter((t) => improvementFor(state, t) && !state.improvements.includes(t));
}

/** Цена растёт с каждым таким же сооружением на земле державы. */
export function improvementPrice(state: GameState, power: number, tile: number): number {
  const def = improvementFor(state, tile)!;
  const owned = state.improvements.filter((t) => state.territory.owner[t] === power && improvementFor(state, t) === def).length;
  return def.basePrice + def.priceStep * owned;
}

/** Почему сооружение нельзя купить (кроме покупки за ход); null — можно. */
export function improvementBlocker(state: GameState, power: number, city: City, tile: number): string | null {
  if (!improvementFor(state, tile)) return 'Здесь нет особой клетки';
  if (state.territory.city[tile] !== city.id) return 'Клетка не принадлежит этому городу';
  if (state.improvements.includes(tile)) return 'Сооружение уже построено';
  const price = improvementPrice(state, power, tile);
  if (state.powers[power].gold < price) return `Нужно ${price} золота`;
  return null;
}
