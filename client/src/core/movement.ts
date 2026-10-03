// Движение юнита по пути. Житель размечает землю по дороге.

import { balance } from './data';
import { range } from './hex';
import { enterCost, findPath, stepEndsMove, stepsThisTurn } from './pathfinding';
import { atWar, isLand, mapSize } from './state';
import { tryClaim } from './territory';
import { NONE, type GameState, type Unit } from './types';
import { computeVisible, reveal } from './visibility';

/** Вражеские юниты в поле зрения державы. */
function visibleEnemies(state: GameState, power: number): Set<number> {
  const visible = computeVisible(state, power);
  const ids = new Set<number>();
  for (const u of state.units) if (visible[u.tile] && atWar(state, power, u.owner)) ids.add(u.id);
  return ids;
}

/** Появился ли в обзоре юнита враг, которого держава раньше не видела. */
function newEnemySighted(state: GameState, unit: Unit, known: Set<number>): boolean {
  const around = new Set(range(mapSize(state), unit.tile, balance.vision.unit));
  return state.units.some((u) => around.has(u.tile) && atWar(state, unit.owner, u.owner) && !known.has(u.id));
}

export interface MoveResult {
  steps: number;
  /** Движение прервано: в обзоре появился враг. */
  interrupted: boolean;
}

/** Передвигает юнит по пути, насколько хватит очков хода. */
export function moveAlong(state: GameState, unit: Unit, path: number[]): MoveResult {
  const steps = stepsThisTurn(state, unit, path);
  const known = visibleEnemies(state, unit.owner);
  for (let i = 0; i < steps; i++) {
    const from = unit.tile;
    const t = path[i];
    unit.mp -= enterCost(state, unit, t)!;
    unit.tile = t;
    unit.moved = true;
    unit.fortified = false;
    if (unit.type === 'citizen' && isLand(state, t)) tryClaim(state, unit.owner, t);
    reveal(state, unit.owner, t, balance.vision.unit);
    if (stepEndsMove(state, unit, from, t)) unit.mp = 0;
    if (i < steps - 1 && newEnemySighted(state, unit, known)) return { steps: i + 1, interrupted: true };
  }
  return { steps, interrupted: false };
}

export type RouteOutcome = 'ok' | 'blocked' | 'enemy';

/**
 * Ведёт юнит к цели: идёт сколько может, остаток запоминает как маршрут на следующие ходы.
 * Маршрут сбрасывается, если пути больше нет или в обзоре появился враг.
 */
export function moveTowards(state: GameState, unit: Unit, target: number): RouteOutcome {
  const path = findPath(state, unit, target);
  if (!path) {
    unit.routeTarget = NONE;
    return 'blocked';
  }
  const { steps, interrupted } = moveAlong(state, unit, path);
  unit.routeTarget = steps === path.length || interrupted ? NONE : target;
  return interrupted ? 'enemy' : 'ok';
}
