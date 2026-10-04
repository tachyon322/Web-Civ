// Эпохи: наступают сами по всей заработанной науке. Каждая даёт юнитам множитель силы и +1 к ходу,
// открывает улучшения зданий и чудеса. Технологический разрыв — бонус в бою против отставших.

import { pathsConfig } from './data';
import type { GameState, Power, UnitType } from './types';

const epochs = pathsConfig.epochs;
export const LAST_EPOCH = epochs.length - 1;

/** Индекс эпохи державы. */
export function epochOf(power: Power): number {
  let e = 0;
  for (let i = 0; i < epochs.length; i++) if (power.scienceTotal >= epochs[i].science) e = i;
  return e;
}

export function epochName(index: number): string {
  return epochs[index].name;
}

/** Сколько всего науки нужно до следующей эпохи (null — последняя). */
export function nextEpochScience(power: Power): number | null {
  const e = epochOf(power);
  return e < LAST_EPOCH ? epochs[e + 1].science : null;
}

/** Прибавка к очкам хода от эпохи. */
export function epochMpBonus(state: GameState, power: number): number {
  return pathsConfig.epoch.mpPerEpoch * epochOf(state.powers[power]);
}

/** Облик юнита по эпохе: воин в древности — мечник в античности и так далее. */
export function unitEpochName(type: UnitType, epoch: number): string {
  return epochs[epoch].units[type];
}
