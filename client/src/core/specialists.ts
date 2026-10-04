// Специалисты: учёный, мастер, купец. Покупаются в городе (это его покупка за ход), слот не занимают,
// содержания нет; в городе их не больше, чем его уровень. Учёного можно купить за золото или науку,
// мастера — за золото или культуру, купца — только за золото. Цена растёт с каждым таким же в державе.

import { balance, specialistDefs, type Currency } from './data';
import { citiesOf, specialistCount } from './state';
import type { City, GameState, SpecialistKind } from './types';

/** Цена следующего специалиста этого вида для державы (одна и та же в любой валюте). */
export function specialistPrice(state: GameState, power: number, kind: SpecialistKind): number {
  const owned = citiesOf(state, power).reduce((sum, c) => sum + c.specialists[kind], 0);
  return balance.specialists.basePrice + balance.specialists.priceStep * owned;
}

/** Почему специалиста нельзя купить в городе (кроме покупки за ход); null — можно. */
export function specialistBlocker(state: GameState, power: number, city: City, kind: SpecialistKind, currency: Currency): string | null {
  const def = specialistDefs[kind];
  if (!def.currencies.includes(currency)) return `${def.name} не покупается за эту валюту`;
  if (specialistCount(city) >= city.level) return `В городе ${city.level}-го уровня не больше ${city.level} специалистов`;
  const price = specialistPrice(state, power, kind);
  const have = state.powers[power][currency];
  if (have < price) return `Нужно ${price} ${CURRENCY_GENITIVE[currency]}`;
  return null;
}

export const CURRENCY_GENITIVE: Record<Currency, string> = { gold: 'золота', science: 'науки', culture: 'культуры' };
