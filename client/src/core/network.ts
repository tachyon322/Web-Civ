// Сеть городов: связные компоненты своей и союзной территории. Вражеский юнит на клетке блокирует её.

import { neighbors } from './hex';
import { atWar, friendsOf, mapSize } from './state';
import { NONE, type GameState } from './types';

/**
 * Метка компоненты для каждой клетки сети державы (NONE — не в сети).
 * Клетки с одинаковой меткой связаны непрерывной цепочкой своей или союзной территории.
 */
export function computeNetwork(state: GameState, power: number): Int32Array {
  const size = mapSize(state);
  const { owner } = state.territory;
  const label = new Int32Array(owner.length).fill(NONE);
  const blocked = new Uint8Array(owner.length);
  for (const u of state.units) if (atWar(state, power, u.owner)) blocked[u.tile] = 1;
  const member = new Uint8Array(state.powers.length);
  member[power] = 1;
  for (const f of friendsOf(state, power)) member[f] = 1;
  const inNet = (t: number) => owner[t] !== NONE && member[owner[t]] === 1 && !blocked[t];

  let next = 0;
  const stack: number[] = [];
  for (let start = 0; start < owner.length; start++) {
    if (!inNet(start) || label[start] !== NONE) continue;
    label[start] = next;
    stack.push(start);
    while (stack.length) {
      const t = stack.pop()!;
      for (const n of neighbors(size, t)) {
        if (inNet(n) && label[n] === NONE) {
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
