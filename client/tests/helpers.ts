// Маленькая ручная карта для тестов правил: всё — равнина, без особых клеток.
// Все державы — Греция (черта: +20% культуры); тесты черт меняют нацию явно через setNation.

import { blankPower, createCity, createUnit } from '../src/core/entities';
import { startWar } from '../src/core/relations';
import { NONE, STATE_VERSION, T_PLAINS, type GameState, type Unit, type UnitType } from '../src/core/types';

export function blankState(width = 12, height = 10, powers = 2): GameState {
  const n = width * height;
  return {
    version: STATE_VERSION,
    settings: { seed: 1, powers, humanNation: null, difficulty: 'normal' },
    turn: 1,
    humanPower: 0,
    map: { width, height, terrain: new Array(n).fill(T_PLAINS), special: new Array(n).fill(0), starts: [] },
    territory: { owner: new Array(n).fill(NONE), city: new Array(n).fill(NONE) },
    powers: Array.from({ length: powers }, (_, id) => ({
      ...blankPower(id, 'greece', id === 0, id === 0 ? null : 'aggressor', n, 1000),
      name: `P${id}`,
      color: '#ffffff',
    })),
    cities: [],
    units: [],
    pacts: [],
    proposals: [],
    coalitionLeader: NONE,
    winner: null,
    improvements: [],
    nextId: 1,
    log: [],
  };
}

/** Сменить нацию державы (для тестов черт). */
export function setNation(state: GameState, power: number, nationId: string): void {
  state.powers[power].nationId = nationId;
}

export const at = (state: GameState, col: number, row: number) => row * state.map.width + col;

export function addCity(state: GameState, power: number, col: number, row: number, capital = false) {
  return createCity(state, power, at(state, col, row), capital);
}

export function addCitizen(state: GameState, power: number, col: number, row: number, mp = 4): Unit {
  return createUnit(state, power, 'citizen', at(state, col, row), mp);
}

export function addUnit(state: GameState, power: number, type: UnitType, col: number, row: number, level = 2, mp = 4): Unit {
  return createUnit(state, power, type, at(state, col, row), mp, level);
}

export function meetAll(state: GameState): void {
  for (const p of state.powers) for (const q of state.powers) if (p.id !== q.id && !p.met.includes(q.id)) p.met.push(q.id);
}

export function declareWar(state: GameState, a: number, b: number): void {
  for (const [x, y] of [[a, b], [b, a]]) if (!state.powers[x].met.includes(y)) state.powers[x].met.push(y);
  startWar(state, a, b);
}
