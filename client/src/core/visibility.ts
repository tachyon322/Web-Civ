// Туман войны: видимое сейчас считается из юнитов, городов и территории,
// разведанное хранится в состоянии державы.

import { balance } from './data';
import { range } from './hex';
import { mapSize } from './state';
import type { GameState } from './types';

export function computeVisible(state: GameState, power: number): Uint8Array {
  const size = mapSize(state);
  const visible = new Uint8Array(size.width * size.height);
  const mark = (center: number, radius: number) => {
    for (const t of range(size, center, radius)) visible[t] = 1;
  };
  for (const u of state.units) if (u.owner === power) mark(u.tile, balance.vision.unit);
  for (const c of state.cities) if (c.owner === power) mark(c.tile, balance.vision.city);
  const { owner } = state.territory;
  for (let t = 0; t < owner.length; t++) if (owner[t] === power) mark(t, balance.vision.territory);
  return visible;
}

export function reveal(state: GameState, power: number, center: number, radius: number): void {
  const explored = state.powers[power].explored;
  for (const t of range(mapSize(state), center, radius)) explored[t] = 1;
}

/** Переносит всё видимое сейчас в разведанное. */
export function updateExplored(state: GameState, power: number): void {
  const visible = computeVisible(state, power);
  const explored = state.powers[power].explored;
  for (let t = 0; t < visible.length; t++) if (visible[t]) explored[t] = 1;
}
