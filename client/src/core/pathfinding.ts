// Поиск пути A* со стоимостью местности, зона контроля, погрузка на воду и переброска по сети:
// с клетки своей сети на любую клетку той же сети за transferCost (в пути это шаг на дальнюю клетку).

import { balance } from './data';
import { distance, neighbors } from './hex';
import { computeNetwork } from './network';
import { atWar, cityAt, isLand, mapSize, terrainMoveCost, unitAt } from './state';
import { NONE, type GameState, type Unit } from './types';

/** Стоимость входа юнита в клетку или null, если войти нельзя. */
export function enterCost(state: GameState, unit: Unit, tile: number): number | null {
  const cost = terrainMoveCost(state, tile);
  if (cost === null) return null;
  const other = unitAt(state, tile);
  if (other && other.owner !== unit.owner) return null;
  const city = cityAt(state, tile);
  if (city && city.owner !== unit.owner) return null;
  return cost;
}

/** Занятость клеток для одного поиска: считается один раз вместо линейного поиска юнитов и городов на каждой клетке. */
interface Occupancy {
  /** Войти нельзя: чужой юнит или чужой город. */
  blocked: Uint8Array;
  /** Стоит другой юнит (остановиться нельзя). */
  occupied: Uint8Array;
}

function occupancy(state: GameState, unit: Unit): Occupancy {
  const n = state.map.terrain.length;
  const blocked = new Uint8Array(n);
  const occupied = new Uint8Array(n);
  for (const u of state.units) {
    if (u.id === unit.id) continue;
    occupied[u.tile] = 1;
    if (u.owner !== unit.owner) blocked[u.tile] = 1;
  }
  for (const c of state.cities) if (c.owner !== unit.owner) blocked[c.tile] = 1;
  return { blocked, occupied };
}

function fastEnter(state: GameState, occ: Occupancy, tile: number): number | null {
  return occ.blocked[tile] ? null : terrainMoveCost(state, tile);
}

function fastCanStop(state: GameState, occ: Occupancy, tile: number): boolean {
  return !occ.occupied[tile] && fastEnter(state, occ, tile) !== null;
}

/** Сеть державы для переброски: метка компоненты каждой клетки и клетки каждой компоненты. */
interface JumpNet {
  label: Int32Array;
  parts: number[][];
}

function jumpNet(state: GameState, power: number): JumpNet {
  const label = computeNetwork(state, power);
  const parts: number[][] = [];
  for (let t = 0; t < label.length; t++) if (label[t] !== NONE) (parts[label[t]] ??= []).push(t);
  return { label, parts };
}

/** Можно ли перебросить юнит с клетки from на клетку to по сети его державы. */
export function canJump(state: GameState, unit: Unit, from: number, to: number): boolean {
  if (from === to || enterCost(state, unit, to) === null) return false;
  const label = computeNetwork(state, unit.owner);
  return label[from] !== NONE && label[from] === label[to];
}

/** Стоимость шага пути: в соседнюю клетку — по местности (или переброской, если дешевле), в дальнюю — только переброской. */
export function stepCost(state: GameState, unit: Unit, from: number, to: number): number | null {
  const jumpCost = balance.units.transferCost;
  if (distance(mapSize(state), from, to) > 1) return canJump(state, unit, from, to) ? jumpCost : null;
  const walk = enterCost(state, unit, to);
  if (walk === null || walk <= jumpCost) return walk;
  return canJump(state, unit, from, to) ? jumpCost : walk;
}

/** Шаг пути — переброска по сети, а не обычный ход. */
export function isJumpStep(state: GameState, from: number, to: number): boolean {
  return distance(mapSize(state), from, to) > 1;
}

/** Зона контроля: рядом стоит вражеский юнит — движение в этой клетке заканчивается. */
export function inEnemyZoc(state: GameState, unit: Unit, tile: number): boolean {
  const size = mapSize(state);
  return neighbors(size, tile).some((n) => {
    const other = unitAt(state, n);
    return other !== undefined && atWar(state, unit.owner, other.owner);
  });
}

/** Клетки зоны контроля врагов этого юнита (рядом с вражеским юнитом). */
export function enemyZocMap(state: GameState, unit: Unit): Uint8Array {
  const size = mapSize(state);
  const zoc = new Uint8Array(size.width * size.height);
  for (const other of state.units) {
    if (!atWar(state, unit.owner, other.owner)) continue;
    for (const n of neighbors(size, other.tile)) zoc[n] = 1;
  }
  return zoc;
}

/** Штраф пути за клетку зоны контроля: там движение обрывается, обходной путь обычно лучше. */
const ZOC_PATH_PENALTY = 4;

/** Шаг заканчивает движение в этом ходу: зона контроля врага или погрузка/высадка. */
export function stepEndsMove(state: GameState, unit: Unit, from: number, to: number): boolean {
  if (balance.movement.embarkEndsMove && isLand(state, from) !== isLand(state, to)) return true;
  return inEnemyZoc(state, unit, to);
}

/** Можно ли закончить движение в клетке: на клетке один юнит. */
export function canStop(state: GameState, unit: Unit, tile: number): boolean {
  if (enterCost(state, unit, tile) === null) return false;
  const other = unitAt(state, tile);
  return !other || other.id === unit.id;
}

class MinHeap {
  private items: { key: number; tie: number; value: number }[] = [];

  get size(): number {
    return this.items.length;
  }

  push(key: number, tie: number, value: number): void {
    const items = this.items;
    items.push({ key, tie, value });
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      [items[i], items[p]] = [items[p], items[i]];
      i = p;
    }
  }

  pop(): number {
    const items = this.items;
    const top = items[0].value;
    const last = items.pop()!;
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.less(l, m)) m = l;
        if (r < items.length && this.less(r, m)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m], items[i]];
        i = m;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    const x = this.items[a];
    const y = this.items[b];
    return x.key !== y.key ? x.key < y.key : x.tie < y.tie;
  }
}

/**
 * Кратчайший путь от юнита до цели (без стартовой клетки) или null.
 * Цель должна быть клеткой, где можно остановиться.
 */
export function findPath(state: GameState, unit: Unit, target: number): number[] | null {
  if (target === unit.tile) return [];
  if (!canStop(state, unit, target)) return null;
  const size = mapSize(state);
  const n = size.width * size.height;
  const g = new Float64Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  const zoc = enemyZocMap(state, unit);
  const occ = occupancy(state, unit);
  const net = jumpNet(state, unit.owner);
  const jumpCost = balance.units.transferCost;
  // Оценка остатка с учётом переброски: дойти пешком или прыгнуть в ближайшую к цели клетку сети.
  let netToTarget = Infinity;
  for (const part of net.parts) for (const t of part) netToTarget = Math.min(netToTarget, distance(size, t, target));
  const h = (t: number) => Math.min(distance(size, t, target), jumpCost + netToTarget);
  // Наименьшая стоимость, с которой уже раскрывали переброску из компоненты сети.
  const jumpedAt = new Array<number>(net.parts.length).fill(Infinity);
  const relax = (t: number, nb: number, base: number | null) => {
    if (base === null) return;
    let cost = base;
    if (zoc[nb] && nb !== target) {
      // В зоне контроля придётся остановиться — через занятую клетку там не пройти.
      if (!fastCanStop(state, occ, nb)) return;
      cost += ZOC_PATH_PENALTY;
    }
    const ng = g[t] + cost;
    if (ng < g[nb]) {
      g[nb] = ng;
      from[nb] = t;
      heap.push(ng + h(nb), nb, nb);
    }
  };
  g[unit.tile] = 0;
  heap.push(h(unit.tile), unit.tile, unit.tile);
  while (heap.size) {
    const t = heap.pop();
    if (t === target) break;
    for (const nb of neighbors(size, t)) relax(t, nb, fastEnter(state, occ, nb));
    const l = net.label[t];
    if (l !== NONE && g[t] < jumpedAt[l]) {
      jumpedAt[l] = g[t];
      for (const m of net.parts[l]) if (m !== t && fastEnter(state, occ, m) !== null) relax(t, m, jumpCost);
    }
  }
  if (g[target] === Infinity) return null;
  const path: number[] = [];
  for (let t = target; t !== unit.tile; t = from[t]) path.push(t);
  return path.reverse();
}

/** Клетки, куда юнит может дойти и остановиться в этом ходу, со стоимостью. */
export function reachableTiles(state: GameState, unit: Unit): Map<number, number> {
  const size = mapSize(state);
  const best = new Map<number, number>([[unit.tile, 0]]);
  // Клетки, после входа в которые движение заканчивается: дальше из них не идём.
  const terminal = new Set<number>();
  const heap = new MinHeap();
  const occ = occupancy(state, unit);
  const zoc = enemyZocMap(state, unit);
  const embarkEnds = balance.movement.embarkEndsMove;
  const net = jumpNet(state, unit.owner);
  const jumpCost = balance.units.transferCost;
  const jumpedAt = new Array<number>(net.parts.length).fill(Infinity);
  const relax = (t: number, nb: number, cost: number | null, g: number) => {
    if (cost === null) return;
    const ng = g + cost;
    if (ng > unit.mp) return;
    if (ng < (best.get(nb) ?? Infinity)) {
      best.set(nb, ng);
      // То же, что stepEndsMove, но по готовой карте зоны контроля.
      if ((embarkEnds && isLand(state, t) !== isLand(state, nb)) || zoc[nb]) terminal.add(nb);
      else terminal.delete(nb);
      heap.push(ng, nb, nb);
    }
  };
  heap.push(0, unit.tile, unit.tile);
  while (heap.size) {
    const t = heap.pop();
    if (terminal.has(t)) continue;
    const g = best.get(t)!;
    for (const nb of neighbors(size, t)) relax(t, nb, fastEnter(state, occ, nb), g);
    const l = net.label[t];
    if (l !== NONE && g < jumpedAt[l]) {
      jumpedAt[l] = g;
      for (const m of net.parts[l]) if (m !== t && fastEnter(state, occ, m) !== null) relax(t, m, jumpCost, g);
    }
  }
  const result = new Map<number, number>();
  for (const [t, c] of best) if (t !== unit.tile && fastCanStop(state, occ, t)) result.set(t, c);
  return result;
}

/**
 * Сколько шагов пути юнит пройдёт в этом ходу: префикс по очкам хода, обрывается
 * зоной контроля и погрузкой; последняя клетка должна быть свободна для остановки.
 */
export function stepsThisTurn(state: GameState, unit: Unit, path: number[]): number {
  let mp = unit.mp;
  let reach = 0;
  let from = unit.tile;
  for (let i = 0; i < path.length; i++) {
    const cost = stepCost(state, unit, from, path[i]);
    if (cost === null || cost > mp) break;
    mp -= cost;
    reach = i + 1;
    if (stepEndsMove(state, unit, from, path[i])) break;
    from = path[i];
  }
  while (reach > 0 && !canStop(state, unit, path[reach - 1])) reach--;
  return reach;
}
