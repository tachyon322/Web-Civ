// Минимум дипломатии для этапа 2: встречи на карте и объявление войны.
// Отношения, договоры и мир — этап 4.

import { computeVisible } from './visibility';
import { NONE, type GameState } from './types';

function meet(state: GameState, a: number, b: number): void {
  if (a === b || a === NONE || b === NONE) return;
  const pa = state.powers[a];
  const pb = state.powers[b];
  if (!pa.met.includes(b)) pa.met.push(b);
  if (!pb.met.includes(a)) pb.met.push(a);
}

/** Держава встречает всех, чьи клетки, города или юниты сейчас видит. Встреча взаимна. */
export function updateContacts(state: GameState, power: number): void {
  const visible = computeVisible(state, power);
  const { owner } = state.territory;
  for (let t = 0; t < visible.length; t++) if (visible[t] && owner[t] !== NONE) meet(state, power, owner[t]);
  for (const u of state.units) if (visible[u.tile]) meet(state, power, u.owner);
}

export function hasMet(state: GameState, a: number, b: number): boolean {
  return state.powers[a].met.includes(b);
}

export function startWar(state: GameState, a: number, b: number): void {
  const pa = state.powers[a];
  const pb = state.powers[b];
  if (!pa.wars.includes(b)) pa.wars.push(b);
  if (!pb.wars.includes(a)) pb.wars.push(a);
}
