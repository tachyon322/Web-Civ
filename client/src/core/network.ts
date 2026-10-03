// Сеть городов: связные компоненты своей территории. Вражеский юнит на клетке блокирует её.
// Союзная территория войдёт в сеть на этапе 4.

import { neighbors } from './hex';
import { atWar, mapSize } from './state';
import { NONE, type GameState } from './types';

/**
 * Метка компоненты для каждой клетки державы (NONE — не в сети).
 * Клетки с одинаковой меткой связаны непрерывной цепочкой своей территории.
 */
export function computeNetwork(state: GameState, power: number): Int32Array {
  const size = mapSize(state);
  const { owner } = state.territory;
  const label = new Int32Array(owner.length).fill(NONE);
  const blocked = new Uint8Array(owner.length);
  for (const u of state.units) if (atWar(state, power, u.owner)) blocked[u.tile] = 1;

  let next = 0;
  const stack: number[] = [];
  for (let start = 0; start < owner.length; start++) {
    if (owner[start] !== power || blocked[start] || label[start] !== NONE) continue;
    label[start] = next;
    stack.push(start);
    while (stack.length) {
      const t = stack.pop()!;
      for (const n of neighbors(size, t)) {
        if (owner[n] === power && !blocked[n] && label[n] === NONE) {
          label[n] = next;
          stack.push(n);
        }
      }
    }
    next++;
  }
  return label;
}

/** Связаны ли две клетки одной сетью державы. */
export function connected(state: GameState, power: number, a: number, b: number): boolean {
  const label = computeNetwork(state, power);
  return label[a] !== NONE && label[a] === label[b];
}

/** Города державы, связанные сетью с клеткой (включая город на самой клетке). */
export function networkCities(state: GameState, power: number, tile: number): number[] {
  const label = computeNetwork(state, power);
  if (label[tile] === NONE) return [];
  return state.cities.filter((c) => c.owner === power && label[c.tile] === label[tile]).map((c) => c.id);
}
