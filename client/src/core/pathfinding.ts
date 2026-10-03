// Поиск пути A* со стоимостью местности, зона контроля и погрузка на воду.

import { balance } from './data';
import { distance, neighbors } from './hex';
import { atWar, cityAt, isLand, mapSize, terrainMoveCost, unitAt } from './state';
import type { GameState, Unit } from './types';

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
  g[unit.tile] = 0;
  heap.push(distance(size, unit.tile, target), unit.tile, unit.tile);
  while (heap.size) {
    const t = heap.pop();
    if (t === target) break;
    for (const nb of neighbors(size, t)) {
      let cost = enterCost(state, unit, nb);
      if (cost === null) continue;
      if (zoc[nb] && nb !== target) {
        // В зоне контроля придётся остановиться — через занятую клетку там не пройти.
        if (!canStop(state, unit, nb)) continue;
        cost += ZOC_PATH_PENALTY;
      }
      const ng = g[t] + cost;
      if (ng < g[nb]) {
        g[nb] = ng;
        from[nb] = t;
        heap.push(ng + distance(size, nb, target), nb, nb);
      }
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
  heap.push(0, unit.tile, unit.tile);
  while (heap.size) {
    const t = heap.pop();
    if (terminal.has(t)) continue;
    const g = best.get(t)!;
    for (const nb of neighbors(size, t)) {
      const cost = enterCost(state, unit, nb);
      if (cost === null) continue;
      const ng = g + cost;
      if (ng > unit.mp) continue;
      if (ng < (best.get(nb) ?? Infinity)) {
        best.set(nb, ng);
        if (stepEndsMove(state, unit, t, nb)) terminal.add(nb);
        else terminal.delete(nb);
        heap.push(ng, nb, nb);
      }
    }
  }
  const result = new Map<number, number>();
  for (const [t, c] of best) if (t !== unit.tile && canStop(state, unit, t)) result.set(t, c);
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
    const cost = enterCost(state, unit, path[i]);
    if (cost === null || cost > mp) break;
    mp -= cost;
    reach = i + 1;
    if (stepEndsMove(state, unit, from, path[i])) break;
    from = path[i];
  }
  while (reach > 0 && !canStop(state, unit, path[reach - 1])) reach--;
  return reach;
}
