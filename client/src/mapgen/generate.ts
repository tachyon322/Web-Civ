// Генерация карты по сиду: большой континент, хребты с проходами, острова по краям,
// честные старты и особые клетки. Один сид — всегда одна и та же карта.

import { mapgenConfig as cfg } from '../core/data';
import {
  axialOfIndex,
  axialRound,
  distance,
  indexOfAxial,
  neighbors,
  range,
  ring,
  type MapSize,
} from '../core/hex';
import { createRng, deriveSeed, type Rng } from '../core/rng';
import {
  S_GOLD,
  S_MARBLE,
  S_NONE,
  S_RUINS,
  T_MOUNTAIN,
  T_PLAINS,
  T_ROUGH,
  T_WATER,
} from '../core/types';
import { fbm } from './noise';

export interface GeneratedMap {
  width: number;
  height: number;
  terrain: number[];
  special: number[];
  /** Стартовые клетки столиц, по одной на державу. */
  starts: number[];
}

export function mapSizeFor(powers: number): MapSize {
  const scale = Math.sqrt(powers / cfg.basePowers);
  return {
    width: Math.max(cfg.minWidth, Math.round(cfg.baseWidth * scale)),
    height: Math.max(cfg.minHeight, Math.round(cfg.baseHeight * scale)),
  };
}

export function generateMap(seed: number, powers: number): GeneratedMap {
  for (let attempt = 0; attempt < cfg.mapAttempts; attempt++) {
    const map = tryGenerate(deriveSeed(seed, attempt), powers);
    if (map) return map;
  }
  throw new Error(`Не удалось сгенерировать карту для сида ${seed}`);
}

/** Координаты центра клетки в «квадратных» единицах, чтобы шум не вытягивался по гексам. */
function planePos(size: MapSize, i: number): [number, number] {
  const row = Math.floor(i / size.width);
  const col = i % size.width;
  return [col + 0.5 * (row & 1), row * 0.866];
}

function tryGenerate(seed: number, powers: number): GeneratedMap | null {
  const size = mapSizeFor(powers);
  const n = size.width * size.height;
  const rng = createRng(seed);
  const terrain = new Array<number>(n).fill(T_WATER);
  const special = new Array<number>(n).fill(S_NONE);

  const continent = buildContinent(size, seed, terrain);
  addIslands(size, rng, terrain, continent);
  addRidges(size, rng, powers, terrain, continent);
  addRough(size, seed, terrain);

  const starts = placeStarts(size, rng, powers, continent);
  if (!starts) return null;
  normalizeStarts(size, rng, terrain, starts);
  if (!startsConnected(size, terrain, starts)) return null;
  placeSpecials(size, rng, terrain, special, starts);

  return { width: size.width, height: size.height, terrain, special, starts };
}

/** Суша по шуму с затуханием к краям; остаётся только крупнейший массив. */
function buildContinent(size: MapSize, seed: number, terrain: number[]): Set<number> {
  const n = terrain.length;
  const margin = 3;
  const cx = size.width / 2;
  const cy = (size.height * 0.866) / 2;
  const score = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / size.width);
    const col = i % size.width;
    if (row < margin || col < margin || row >= size.height - margin || col >= size.width - margin) {
      score[i] = -Infinity;
      continue;
    }
    const [x, y] = planePos(size, i);
    const dx = (x - cx) / cx;
    const dy = (y - cy) / cy;
    const falloff = Math.sqrt(dx * dx + dy * dy);
    score[i] = fbm(seed, x * cfg.noiseScale, y * cfg.noiseScale) * 0.9 + (1 - falloff);
  }
  const sorted = Array.from(score).filter(Number.isFinite).sort((a, b) => b - a);
  const threshold = sorted[Math.floor(n * cfg.landShare)] ?? Infinity;
  const land = new Uint8Array(n);
  for (let i = 0; i < n; i++) land[i] = score[i] >= threshold ? 1 : 0;

  // Крупнейшая связная компонента — континент, мелкие куски уходят под воду.
  const seen = new Uint8Array(n);
  let best: number[] = [];
  for (let s = 0; s < n; s++) {
    if (!land[s] || seen[s]) continue;
    const comp: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const t = stack.pop()!;
      comp.push(t);
      for (const nb of neighbors(size, t)) {
        if (land[nb] && !seen[nb]) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  for (const t of best) terrain[t] = T_PLAINS;
  return new Set(best);
}

/** Небольшие острова в полосе между континентом и краем карты. */
function addIslands(size: MapSize, rng: Rng, terrain: number[], continent: Set<number>): void {
  const n = terrain.length;
  const farFromContinent = (t: number, d: number) =>
    range(size, t, d).every((x) => !continent.has(x));
  const insideMargin = (t: number) => {
    const row = Math.floor(t / size.width);
    const col = t % size.width;
    return row >= 1 && col >= 1 && row < size.height - 1 && col < size.width - 1;
  };
  const count = rng.int(cfg.islands[0], cfg.islands[1]);
  for (let k = 0; k < count; k++) {
    let seedTile = -1;
    for (let tries = 0; tries < 200; tries++) {
      const t = rng.int(0, n - 1);
      if (terrain[t] === T_WATER && insideMargin(t) && farFromContinent(t, 3)) {
        seedTile = t;
        break;
      }
    }
    if (seedTile < 0) continue;
    const target = rng.int(cfg.islandSize[0], cfg.islandSize[1]);
    const island = [seedTile];
    terrain[seedTile] = T_PLAINS;
    for (let tries = 0; island.length < target && tries < target * 20; tries++) {
      const from = rng.pick(island);
      const nb = rng.pick(neighbors(size, from));
      if (terrain[nb] === T_WATER && insideMargin(nb) && farFromContinent(nb, 2)) {
        terrain[nb] = T_PLAINS;
        island.push(nb);
      }
    }
  }
}

/** Горные хребты делят континент на области; через каждые несколько клеток — проход. */
function addRidges(size: MapSize, rng: Rng, powers: number, terrain: number[], continent: Set<number>): void {
  const tiles = Array.from(continent);
  const count = Math.max(1, Math.round(powers * cfg.ridgesPerPower));
  for (let k = 0; k < count; k++) {
    let t = rng.pick(tiles);
    let dir = rng.int(0, 5);
    const length = rng.int(cfg.ridgeLength[0], cfg.ridgeLength[1]);
    let untilPass = rng.int(cfg.passEvery[0], cfg.passEvery[1]);
    let passLeft = 0;
    for (let step = 0; step < length; step++) {
      if (!continent.has(t)) break;
      if (passLeft > 0) {
        passLeft--;
      } else if (untilPass-- <= 0) {
        untilPass = rng.int(cfg.passEvery[0], cfg.passEvery[1]);
        passLeft = rng.int(cfg.passWidth[0], cfg.passWidth[1]) - 1;
      } else {
        terrain[t] = T_MOUNTAIN;
        // Местами хребет в две клетки толщиной — сбоку от направления движения.
        if (rng.next() < cfg.ridgeThickness) {
          const side = AXIAL_DIRS[(dir + (rng.next() < 0.5 ? 2 : 4)) % 6];
          const a = axialOfIndex(size, t);
          const s = indexOfAxial(size, { q: a.q + side[0], r: a.r + side[1] });
          if (s >= 0 && continent.has(s)) terrain[s] = T_MOUNTAIN;
        }
      }
      const turn = rng.next();
      if (turn < 0.2) dir = (dir + 1) % 6;
      else if (turn < 0.4) dir = (dir + 5) % 6;
      const a = axialOfIndex(size, t);
      const d = AXIAL_DIRS[dir];
      const next = indexOfAxial(size, { q: a.q + d[0], r: a.r + d[1] });
      if (next < 0) break;
      t = next;
    }
  }
}

const AXIAL_DIRS: readonly [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

/** Пересечённая местность: верхняя доля второго шума среди равнин. */
function addRough(size: MapSize, seed: number, terrain: number[]): void {
  const roughSeed = deriveSeed(seed, 7777);
  const plains: { t: number; v: number }[] = [];
  for (let t = 0; t < terrain.length; t++) {
    if (terrain[t] !== T_PLAINS) continue;
    const [x, y] = planePos(size, t);
    plains.push({ t, v: fbm(roughSeed, x * cfg.roughNoiseScale, y * cfg.roughNoiseScale, 3) });
  }
  plains.sort((a, b) => b.v - a.v || a.t - b.t);
  const count = Math.floor(plains.length * cfg.roughShare);
  for (let i = 0; i < count; i++) terrain[plains[i].t] = T_ROUGH;
}

/** Расстояние до ближайшего другого старта для каждого старта. */
function nearestDistances(size: MapSize, starts: number[]): number[] {
  return starts.map((a, i) => {
    let best = Infinity;
    starts.forEach((b, j) => {
      if (i !== j) best = Math.min(best, distance(size, a, b));
    });
    return best;
  });
}

function spreadScore(size: MapSize, starts: number[]): number {
  const nn = nearestDistances(size, starts);
  const mean = nn.reduce((s, d) => s + d, 0) / nn.length;
  const variance = nn.reduce((s, d) => s + (d - mean) ** 2, 0) / nn.length;
  return (Math.max(...nn) - Math.min(...nn)) * 10 + variance;
}

/**
 * Старты на континенте с одинаковыми расстояниями до ближайших соседей:
 * жадный подбор с минимальной дистанцией, затем подстройка сдвигами.
 */
function placeStarts(
  size: MapSize,
  rng: Rng,
  powers: number,
  continent: Set<number>,
): number[] | null {
  const r = cfg.startClearRadius;
  const candidates = Array.from(continent).filter((t) =>
    range(size, t, r + 1).every((x) => continent.has(x)),
  );
  if (candidates.length < powers) return null;
  const candidateSet = new Set(candidates);

  const estimate = Math.floor(Math.sqrt((2 * continent.size) / (Math.sqrt(3) * powers)));
  let best: number[] | null = null;
  let bestScore = Infinity;
  for (let minDist = estimate; minDist >= 2 * r + 2 && !best; minDist--) {
    for (let attempt = 0; attempt < cfg.placementAttempts; attempt++) {
      const order = rng.shuffle(candidates.slice());
      const chosen: number[] = [];
      for (const t of order) {
        if (chosen.every((c) => distance(size, c, t) >= minDist)) chosen.push(t);
        if (chosen.length === powers) break;
      }
      if (chosen.length < powers) continue;
      const score = spreadScore(size, chosen);
      if (score < bestScore) {
        bestScore = score;
        best = chosen;
      }
    }
    if (best) best = refineStarts(size, best, candidateSet, minDist);
  }
  return best;
}

function refineStarts(size: MapSize, starts: number[], candidates: Set<number>, minDist: number): number[] {
  const result = starts.slice();
  let score = spreadScore(size, result);
  for (let iter = 0; iter < 40; iter++) {
    let improved = false;
    for (let i = 0; i < result.length; i++) {
      for (const nb of neighbors(size, result[i])) {
        if (!candidates.has(nb)) continue;
        const trial = result.slice();
        trial[i] = nb;
        if (trial.some((t, j) => j !== i && distance(size, t, nb) < minDist)) continue;
        const s = spreadScore(size, trial);
        if (s < score) {
          score = s;
          result[i] = nb;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return result;
}

/** Одинаковая земля вокруг каждого старта: равнина рядом, ровно N пересечённых клеток во втором кольце. */
function normalizeStarts(size: MapSize, rng: Rng, terrain: number[], starts: number[]): void {
  for (const s of starts) {
    for (const t of range(size, s, cfg.startClearRadius)) terrain[t] = T_PLAINS;
    const ring2 = rng.shuffle(ring(size, s, 2));
    for (let i = 0; i < cfg.startRoughInRing2 && i < ring2.length; i++) terrain[ring2[i]] = T_ROUGH;
  }
}

function passable(terrain: number[], t: number): boolean {
  return terrain[t] === T_PLAINS || terrain[t] === T_ROUGH;
}

function startsConnected(size: MapSize, terrain: number[], starts: number[]): boolean {
  const seen = new Uint8Array(terrain.length);
  const stack = [starts[0]];
  seen[starts[0]] = 1;
  while (stack.length) {
    const t = stack.pop()!;
    for (const nb of neighbors(size, t)) {
      if (!seen[nb] && passable(terrain, nb)) {
        seen[nb] = 1;
        stack.push(nb);
      }
    }
  }
  return starts.every((s) => seen[s]);
}

/**
 * У каждой державы две особые клетки на одинаковом расстоянии от столицы
 * (золотая жила и мрамор или руины), плюс спорные клетки между ближайшими соседями.
 */
function placeSpecials(size: MapSize, rng: Rng, terrain: number[], special: number[], starts: number[]): void {
  const free = (t: number, minFromStarts: number) =>
    passable(terrain, t) &&
    special[t] === S_NONE &&
    starts.every((s) => distance(size, s, t) >= minFromStarts);

  starts.forEach((s, i) => {
    const types = [S_GOLD, i % 2 === 0 ? S_MARBLE : S_RUINS];
    for (let d = cfg.specialDistance; d <= cfg.specialDistance + 2 && types.length; d++) {
      const options = rng.shuffle(ring(size, s, d).filter((t) => free(t, d)));
      for (const t of options) {
        if (!types.length) break;
        // Две свои особые клетки не ставим вплотную друг к другу.
        if (ring(size, s, d).some((x) => special[x] !== S_NONE && distance(size, x, t) < 3)) continue;
        special[t] = types.shift()!;
      }
    }
  });

  const contestedTypes = [S_RUINS, S_MARBLE, S_GOLD];
  const pairs = new Set<string>();
  let k = 0;
  starts.forEach((a, i) => {
    let j = -1;
    let best = Infinity;
    starts.forEach((b, jj) => {
      if (jj !== i && distance(size, a, b) < best) {
        best = distance(size, a, b);
        j = jj;
      }
    });
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (j < 0 || pairs.has(key)) return;
    pairs.add(key);
    const pa = axialOfIndex(size, a);
    const pb = axialOfIndex(size, starts[j]);
    const mid = indexOfAxial(size, axialRound((pa.q + pb.q) / 2, (pa.r + pb.r) / 2));
    if (mid < 0) return;
    let pick = -1;
    let pickDiff = Infinity;
    for (const t of range(size, mid, 2)) {
      if (!free(t, 3)) continue;
      const diff = Math.abs(distance(size, a, t) - distance(size, starts[j], t));
      if (diff < pickDiff) {
        pickDiff = diff;
        pick = t;
      }
    }
    if (pick >= 0) special[pick] = contestedTypes[k++ % contestedTypes.length];
  });
}
