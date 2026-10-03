// Гексы с вершиной вверх. Хранение — смещённые координаты «odd-r»
// (нечётные ряды сдвинуты вправо), индекс клетки = row * width + col.
// Расстояния и соседи считаются в осевых/кубических координатах.

export interface Axial {
  q: number;
  r: number;
}

export interface MapSize {
  width: number;
  height: number;
}

/** Направления соседей: В, СВ, СЗ, З, ЮЗ, ЮВ. */
export const AXIAL_DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function offsetToAxial(col: number, row: number): Axial {
  return { q: col - (row - (row & 1)) / 2, r: row };
}

export function axialToOffset(a: Axial): { col: number; row: number } {
  return { col: a.q + (a.r - (a.r & 1)) / 2, row: a.r };
}

export function indexOf(size: MapSize, col: number, row: number): number {
  return row * size.width + col;
}

export function colOf(size: MapSize, index: number): number {
  return index % size.width;
}

export function rowOf(size: MapSize, index: number): number {
  return Math.floor(index / size.width);
}

export function inBounds(size: MapSize, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < size.width && row < size.height;
}

export function axialOfIndex(size: MapSize, index: number): Axial {
  return offsetToAxial(colOf(size, index), rowOf(size, index));
}

export function indexOfAxial(size: MapSize, a: Axial): number {
  const { col, row } = axialToOffset(a);
  return inBounds(size, col, row) ? indexOf(size, col, row) : -1;
}

export function axialDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function distance(size: MapSize, a: number, b: number): number {
  return axialDistance(axialOfIndex(size, a), axialOfIndex(size, b));
}

/** Соседи клетки в пределах карты (до 6). */
export function neighbors(size: MapSize, index: number): number[] {
  const a = axialOfIndex(size, index);
  const result: number[] = [];
  for (const d of AXIAL_DIRECTIONS) {
    const n = indexOfAxial(size, { q: a.q + d.q, r: a.r + d.r });
    if (n >= 0) result.push(n);
  }
  return result;
}

/** Сосед в заданном направлении (индекс в AXIAL_DIRECTIONS) или -1 за краем карты. */
export function neighborInDirection(size: MapSize, index: number, dir: number): number {
  const a = axialOfIndex(size, index);
  const d = AXIAL_DIRECTIONS[dir];
  return indexOfAxial(size, { q: a.q + d.q, r: a.r + d.r });
}

/** Все клетки на расстоянии не больше radius, включая центр. Порядок детерминирован. */
export function range(size: MapSize, center: number, radius: number): number[] {
  const c = axialOfIndex(size, center);
  const result: number[] = [];
  for (let dr = -radius; dr <= radius; dr++) {
    const qMin = Math.max(-radius, -dr - radius);
    const qMax = Math.min(radius, -dr + radius);
    for (let dq = qMin; dq <= qMax; dq++) {
      const n = indexOfAxial(size, { q: c.q + dq, r: c.r + dr });
      if (n >= 0) result.push(n);
    }
  }
  return result;
}

/** Клетки ровно на расстоянии radius. */
export function ring(size: MapSize, center: number, radius: number): number[] {
  return range(size, center, radius).filter((i) => distance(size, center, i) === radius);
}

/** Округление дробных осевых координат до ближайшего гекса. */
export function axialRound(q: number, r: number): Axial {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  // + 0 превращает -0 в 0.
  return { q: rq + 0, r: rr + 0 };
}
