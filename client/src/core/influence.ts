// Влияние на народы: у каждой державы шкала иностранного влияния — доли других держав, в сумме не больше 100%.
// Доля больше половины делает державу гегемоном. Влияние растёт само (торговый договор, общая граница, чудеса,
// всё — с поправкой на соотношение доходов культуры), угасает долей в ход (у изоляциониста быстрее)
// и покупается гастролями. Новое влияние сначала занимает свободное место, потом отъедает чужие доли.

import { wondersOwned } from './buildings';
import { curtainCut } from './curtain';
import { diplomacyTraits, pathsConfig } from './data';
import { logPublic } from './diplomacy';
import { computeIncome, type Breakdown } from './economy';
import { borderTiles } from './relations';
import { atWar, hasPact } from './state';
import { NONE, type GameState } from './types';

const cfg = pathsConfig.influence;
const FULL = 100;

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Доля влияния from на target, 0..100. */
export function influenceOf(state: GameState, target: number, from: number): number {
  return state.powers[target].influence[from] ?? 0;
}

/** Сколько всего иностранного влияния на target. */
export function foreignInfluence(state: GameState, target: number): number {
  return state.powers[target].influence.reduce((sum, v) => sum + (v ?? 0), 0);
}

/** Гегемон target: держава с долей больше половины, или NONE. */
export function hegemonOf(state: GameState, target: number): number {
  const shares = state.powers[target].influence;
  for (let i = 0; i < shares.length; i++) if ((shares[i] ?? 0) > cfg.hegemonShare) return i;
  return NONE;
}

/** Державы, для которых power — гегемон. */
export function hegemonyOver(state: GameState, power: number): number[] {
  return state.powers.filter((p) => p.alive && p.id !== power && hegemonOf(state, p.id) === power).map((p) => p.id);
}

function setShare(state: GameState, target: number, from: number, value: number): void {
  const shares = state.powers[target].influence;
  while (shares.length <= from) shares.push(0);
  shares[from] = round2(Math.max(0, value));
}

/** Сообщает всем встречавшим, если у target сменился гегемон. */
function announceHegemon(state: GameState, target: number, before: number): void {
  const now = hegemonOf(state, target);
  if (now === before) return;
  const name = state.powers[target].name;
  if (now !== NONE) logPublic(state, [target, now], `${name} попадает под культурное влияние державы ${state.powers[now].name}`);
  else logPublic(state, [target, before], `${name} выходит из-под культурного влияния державы ${state.powers[before].name}`);
}

/** Добавляет влияние from на target: сначала в свободное место, остальное — за счёт чужих долей пропорционально. */
export function addInfluence(state: GameState, target: number, from: number, amount: number): void {
  if (amount <= 0 || from === target) return;
  const shares = state.powers[target].influence;
  const free = Math.max(0, FULL - foreignInfluence(state, target));
  const fill = Math.min(amount, free);
  const others = foreignInfluence(state, target) - influenceOf(state, target, from);
  const cut = Math.min(amount - fill, others);
  if (cut > 0) {
    for (let i = 0; i < shares.length; i++) {
      if (i !== from && shares[i]) setShare(state, target, i, shares[i] - (cut * shares[i]) / others);
    }
  }
  setShare(state, target, from, Math.min(FULL, influenceOf(state, target, from) + fill + cut));
}

/** Обнуляет влияние from на target (например, когда from нападает на target). */
export function clearInfluence(state: GameState, target: number, from: number): void {
  if (influenceOf(state, target, from) === 0) return;
  const before = hegemonOf(state, target);
  setShare(state, target, from, 0);
  announceHegemon(state, target, before);
}

/** Доход культуры за ход каждой державы (не меньше 0; у выбывших — 0). */
export function cultureIncomes(state: GameState): number[] {
  return state.powers.map((p) => (p.alive ? Math.max(0, computeIncome(state, p.id).culture.total) : 0));
}

/** Пассивный прирост влияния from на target за ход: слагаемые (до поправки), поправка на культуру и итог. */
export interface InfluenceGain extends Breakdown {
  /** Соотношение доходов культуры from / target в пределах ratioMin..ratioMax. */
  ratio: number;
  /** Доля, которую срезает цифровой занавес target. */
  curtain: number;
}

export function influenceGain(state: GameState, from: number, target: number, cultures: number[]): InfluenceGain {
  const g: InfluenceGain = { total: 0, items: [], ratio: 1, curtain: 0 };
  const pf = state.powers[from];
  const pt = state.powers[target];
  if (from === target || !pf.alive || !pt.alive || !pf.met.includes(target) || atWar(state, from, target)) return g;
  if (cultures[from] <= 0) return g;
  const add = (label: string, value: number) => {
    if (!value) return;
    g.items.push({ label, value });
    g.total += value;
  };
  if (hasPact(state, from, target, 'trade')) add('Торговый договор', cfg.trade);
  if (borderTiles(state, from, target) > 0) add('Общая граница', cfg.border);
  add('Чудеса света', wondersOwned(state, from) * cfg.perWonder);
  g.ratio = round2(Math.max(cfg.ratioMin, Math.min(cfg.ratioMax, cultures[from] / Math.max(1, cultures[target]))));
  g.curtain = curtainCut(state, target, from);
  g.total = round2(g.total * g.ratio * (1 - g.curtain));
  return g;
}

/** Доля, на которую чужое влияние на target угасает за ход (у изоляциониста быстрее). */
export function influenceDecay(state: GameState, target: number): number {
  return cfg.decay * diplomacyTraits(state.powers[target].character).influenceResist;
}

/** Новый ход: угасание, затем пассивный прирост (по порядку id влияющих). cultures — доходы культуры этого хода. */
export function influenceNewTurn(state: GameState, cultures: number[]): void {
  for (const pt of state.powers) {
    if (!pt.alive) {
      pt.influence = [];
      continue;
    }
    const before = hegemonOf(state, pt.id);
    const decay = influenceDecay(state, pt.id);
    pt.influence.forEach((v, from) => {
      setShare(state, pt.id, from, state.powers[from]?.alive ? v * (1 - decay) : 0);
    });
    for (const pf of state.powers) addInfluence(state, pt.id, pf.id, influenceGain(state, pf.id, pt.id, cultures).total);
    announceHegemon(state, pt.id, before);
  }
}

// ---------- Гастроли ----------

const tour = pathsConfig.abilities.tour;

/** Цена гастролей: несколько ходов дохода культуры цели, но не меньше минимума. */
export function tourCost(state: GameState, target: number): number {
  const income = Math.max(0, computeIncome(state, target).culture.total);
  return Math.max(tour.minCost, Math.round(income * tour.incomeTurns));
}

/** Сколько влияния дадут гастроли сейчас: повторные в ту же страну в окне слабее. */
export function tourGain(state: GameState, power: number, target: number): number {
  const recent = state.powers[power].effects.filter((e) => e.kind === 'tour' && e.target === target && e.until > state.turn).length;
  return round2(tour.gain * tour.repeatFactor ** recent * (1 - curtainCut(state, target, power)));
}

export function applyTour(state: GameState, power: number, target: number): number {
  const gain = tourGain(state, power, target);
  const before = hegemonOf(state, target);
  addInfluence(state, target, power, gain);
  state.powers[power].effects.push({ kind: 'tour', target, until: state.turn + tour.repeatWindow });
  announceHegemon(state, target, before);
  return gain;
}
