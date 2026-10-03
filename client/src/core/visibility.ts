// Туман войны: видимое сейчас считается из юнитов, городов и территории (своих и союзных — общий обзор),
// разведанное хранится в состоянии державы.

import { balance } from './data';
import { range } from './hex';
import { friendsOf, mapSize } from './state';
import type { GameState } from './types';

/** Что держава видит сейчас. shared=false — только своими глазами, без обзора союзников. */
export function computeVisible(state: GameState, power: number, shared = true): Uint8Array {
  const size = mapSize(state);
  const visible = new Uint8Array(size.width * size.height);
  const mark = (center: number, radius: number) => {
    for (const t of range(size, center, radius)) visible[t] = 1;
  };
  const eyes = new Uint8Array(state.powers.length);
  eyes[power] = 1;
  if (shared) for (const f of friendsOf(state, power)) eyes[f] = 1;
  for (const u of state.units) if (eyes[u.owner]) mark(u.tile, balance.vision.unit);
  for (const c of state.cities) if (eyes[c.owner]) mark(c.tile, balance.vision.city);
  const { owner } = state.territory;
  for (let t = 0; t < owner.length; t++) if (owner[t] !== -1 && eyes[owner[t]]) mark(t, balance.vision.territory);
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
