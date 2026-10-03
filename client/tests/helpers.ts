// Маленькая ручная карта для тестов правил: всё — равнина, без особых клеток.

import { createCity, createUnit } from '../src/core/entities';
import { startWar } from '../src/core/diplomacy';
import { NONE, T_PLAINS, type GameState, type Unit, type UnitType } from '../src/core/types';

export function blankState(width = 12, height = 10, powers = 2): GameState {
  const n = width * height;
  return {
    version: 1,
    settings: { seed: 1, powers, humanNation: null, difficulty: 'normal' },
    turn: 1,
    humanPower: 0,
    map: { width, height, terrain: new Array(n).fill(T_PLAINS), special: new Array(n).fill(0), starts: [] },
    territory: { owner: new Array(n).fill(NONE), city: new Array(n).fill(NONE) },
    powers: Array.from({ length: powers }, (_, id) => ({
      id,
      nationId: id === 0 ? 'russia' : 'greece',
      name: `P${id}`,
      color: '#ffffff',
      isHuman: id === 0,
      character: id === 0 ? null : 'aggressor',
      alive: true,
      gold: 1000,
      science: 0,
      culture: 0,
      explored: new Array(n).fill(0),
      capitalId: NONE,
      cityNamesUsed: 0,
      met: [],
      wars: [],
    })),
    cities: [],
    units: [],
    nextId: 1,
    log: [],
  };
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

export function declareWar(state: GameState, a: number, b: number): void {
  for (const [x, y] of [[a, b], [b, a]]) if (!state.powers[x].met.includes(y)) state.powers[x].met.push(y);
  startWar(state, a, b);
}
