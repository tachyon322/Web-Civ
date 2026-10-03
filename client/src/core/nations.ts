// Черты наций: у каждой нации одна пассивная поправка к общим правилам. Числа — в data/traits.json,
// здесь — только доступ к черте державы; сами поправки применяются там, где считается правило.

import { nationDef, traitDef, unitDef, type TraitDef } from './data';
import type { GameState, UnitType } from './types';

const cache = new Map<string, TraitDef>();

/** Черта нации державы. */
export function nationTrait(state: GameState, power: number): TraitDef {
  const nationId = state.powers[power].nationId;
  let t = cache.get(nationId);
  if (!t) {
    t = traitDef(nationDef(nationId).trait);
    cache.set(nationId, t);
  }
  return t;
}

/** Базовые очки хода юнита этого типа у державы (без эпохи и бонуса своей земли). */
export function unitTypeMp(state: GameState, power: number, type: UnitType): number {
  return unitDef(type).mp + (type === 'horseman' ? (nationTrait(state, power).cavalryMp ?? 0) : 0);
}
