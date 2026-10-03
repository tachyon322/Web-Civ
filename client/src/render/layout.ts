// Геометрия гексов на экране. Карта слегка наклонена: вертикаль сжата коэффициентом TILT.

import { axialRound, axialToOffset, inBounds, indexOf, type MapSize } from '../core/hex';

export const HEX_SIZE = 32;
export const TILT = 0.8;
const SQRT3 = Math.sqrt(3);

export function tileCenter(size: MapSize, index: number): { x: number; y: number } {
  const row = Math.floor(index / size.width);
  const col = index % size.width;
  return {
    x: HEX_SIZE * SQRT3 * (col + 0.5 * (row & 1)),
    y: HEX_SIZE * 1.5 * row * TILT,
  };
}

export function pixelToTile(size: MapSize, x: number, y: number): number {
  const yy = y / TILT;
  const q = ((SQRT3 / 3) * x - yy / 3) / HEX_SIZE;
  const r = ((2 / 3) * yy) / HEX_SIZE;
  const { col, row } = axialToOffset(axialRound(q, r));
  return inBounds(size, col, row) ? indexOf(size, col, row) : -1;
}

/**
 * Углы гекса: 0 — справа сверху, дальше по часовой. Ребро между углами k-1 и k
 * смотрит на соседа в направлении EDGE_FOR_DIRECTION.
 */
export function hexCorners(cx: number, cy: number, scale = 1): number[] {
  const pts: number[] = [];
  for (let k = 0; k < 6; k++) {
    const a = ((60 * k - 30) * Math.PI) / 180;
    pts.push(cx + HEX_SIZE * scale * Math.cos(a), cy + HEX_SIZE * scale * Math.sin(a) * TILT);
  }
  return pts;
}

/** Для направления соседа (В, СВ, СЗ, З, ЮЗ, ЮВ) — пара углов общего ребра. */
export const EDGE_CORNERS: readonly [number, number][] = [
  [0, 1],
  [5, 0],
  [4, 5],
  [3, 4],
  [2, 3],
  [1, 2],
];

export function worldSize(size: MapSize): { width: number; height: number } {
  return {
    width: HEX_SIZE * SQRT3 * (size.width + 0.5),
    height: HEX_SIZE * (1.5 * (size.height - 1) + 2) * TILT,
  };
}
