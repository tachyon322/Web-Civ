// Отношения между державами: войны, перемирия, договоры, союзы, вассалитет и память о событиях.
// Отношение одной державы к другой (от −100 до +100) всегда собирается из слагаемых, чтобы его можно было объяснить.

import { diplomacyConfig, diplomacyTraits, memoryDef, pathsConfig } from './data';
import { deterrenceIndex } from './deterrence';
import type { Breakdown } from './economy';
import { neighbors } from './hex';
import { allied, atWar, cityAt, findPact, isMilitary, mapSize, vassalLink } from './state';
import { turnsAgo } from './text';
import { hegemonyLeader, projectLeader } from './victory';
import { hegemonOf, influenceOf } from './influence';
import { NONE, type GameState, type Memory, type MemoryKind, type Pact, type PactKind } from './types';
import { computeVisible } from './visibility';

const ocfg = diplomacyConfig.opinion;

// ---------- Пары: войны, перемирия, договоры ----------

export function addPact(state: GameState, a: number, b: number, kind: PactKind, until = 0, by?: number): void {
  if (findPact(state, a, b, kind)) return;
  const pact: Pact = { kind, a: Math.min(a, b), b: Math.max(a, b), since: state.turn, until };
  if (by !== undefined) pact.by = by;
  state.pacts.push(pact);
}

export function removePact(state: GameState, a: number, b: number, kind: PactKind): boolean {
  const p = findPact(state, a, b, kind);
  if (!p) return false;
  state.pacts = state.pacts.filter((x) => x !== p);
  return true;
}

/** Начинает войну пары: договоры и перемирие между ними прекращаются. by — кто напал. */
export function startWar(state: GameState, a: number, b: number, by: number = a): void {
  if (a === b) return;
  const pa = state.powers[a];
  const pb = state.powers[b];
  if (!pa.wars.includes(b)) pa.wars.push(b);
  if (!pb.wars.includes(a)) pb.wars.push(a);
  for (const kind of ['trade', 'alliance', 'truce'] as const) removePact(state, a, b, kind);
  addPact(state, a, b, 'war', 0, by);
}

/** Заканчивает войну пары перемирием; обе стороны помнят войну. */
export function endWar(state: GameState, a: number, b: number): void {
  const pa = state.powers[a];
  const pb = state.powers[b];
  pa.wars = pa.wars.filter((w) => w !== b);
  pb.wars = pb.wars.filter((w) => w !== a);
  removePact(state, a, b, 'war');
  addPact(state, a, b, 'truce', state.turn + diplomacyConfig.truceTurns);
  remember(state, a, b, 'recentWar', diplomacyConfig.events.recentWar);
  remember(state, b, a, 'recentWar', diplomacyConfig.events.recentWar);
}

/** Сколько ходов идёт война пары (0 — войны нет). */
export function warTurns(state: GameState, a: number, b: number): number {
  const p = findPact(state, a, b, 'war');
  return p ? state.turn - p.since : 0;
}

/** Держава уходит со сцены: её договоры исчезают, вассалы свободны. */
export function forgetPower(state: GameState, power: number): void {
  const p = state.powers[power];
  for (const other of state.powers) other.wars = other.wars.filter((w) => w !== power);
  p.wars = [];
  state.pacts = state.pacts.filter((x) => x.a !== power && x.b !== power);
  p.suzerain = NONE;
  for (const other of state.powers) if (other.suzerain === power) other.suzerain = NONE;
  p.influence = [];
  for (const other of state.powers) if (other.influence[power]) other.influence[power] = 0;
  for (const pr of state.proposals) {
    if (pr.status === 'pending' && (pr.from === power || pr.to === power)) pr.status = 'expired';
  }
  if (state.coalitionLeader === power) state.coalitionLeader = NONE;
}

// ---------- Память ----------

export function remember(state: GameState, who: number, about: number, kind: MemoryKind, value: number, label?: string): void {
  if (who === about || value === 0) return;
  const m: Memory = { about, kind, value: Math.round(value), turn: state.turn };
  if (label) m.label = label;
  state.powers[who].memories.push(m);
}

/** Текущее значение памяти: держится hold ходов, затем угасает на fade в ход. */
export function memoryValue(m: Memory, turn: number): number {
  const def = memoryDef(m.kind);
  const faded = Math.max(0, turn - m.turn - def.hold) * def.fade;
  const v = m.value > 0 ? Math.max(0, m.value - faded) : Math.min(0, m.value + faded);
  return Math.round(v);
}

/** Убирает угасшую память. */
export function pruneMemories(state: GameState): void {
  for (const p of state.powers) p.memories = p.memories.filter((m) => memoryValue(m, state.turn) !== 0);
}

/** Сколько ходов назад было последнее событие этого вида (Infinity — не было). */
export function lastMemoryAge(state: GameState, who: number, about: number, kind: MemoryKind): number {
  let age = Infinity;
  for (const m of state.powers[who].memories) {
    if (m.about === about && m.kind === kind) age = Math.min(age, state.turn - m.turn);
  }
  return age;
}

// ---------- Сила и размер ----------

/** Сила державы для дипломатии — индекс сдерживания (не меньше 1). */
export function strengthOf(state: GameState, power: number): number {
  return Math.max(1, deterrenceIndex(state, power).total);
}

/** Размер державы — сумма уровней её городов. */
export function sizeOf(state: GameState, power: number): number {
  return state.cities.reduce((sum, c) => sum + (c.owner === power ? c.level : 0), 0);
}

/** Сколько исходных столиц чужих держав контролирует держава. */
export function foreignCapitalsHeld(state: GameState, power: number): number {
  let n = 0;
  state.map.starts.forEach((tile, i) => {
    if (i !== power && cityAt(state, tile)?.owner === power) n++;
  });
  return n;
}

/** Держава, близкая к победе (против неё собирается коалиция), или NONE: научный проект, отсчёт гегемонии, затем завоевание. */
export function findCoalitionLeader(state: GameState): number {
  const builder = projectLeader(state);
  if (builder !== NONE) return builder;
  const hegemon = hegemonyLeader(state);
  if (hegemon !== NONE) return hegemon;
  const need = Math.max(1, Math.ceil(state.map.starts.length * diplomacyConfig.coalition.capitalsShare));
  let best = NONE;
  let bestHeld = 0;
  for (const p of state.powers) {
    if (!p.alive) continue;
    const held = foreignCapitalsHeld(state, p.id);
    if (held >= need && held > bestHeld) {
      best = p.id;
      bestHeld = held;
    }
  }
  return best;
}

// ---------- Отношение ----------

/** Граница: сколько клеток from соседствуют с клетками to. Матрица всех пар кэшируется по хэшу территории. */
const borderCache = new WeakMap<GameState, { hash: number; counts: Int32Array }>();

function territoryHash(state: GameState): number {
  let h = 2166136261;
  const owner = state.territory.owner;
  for (let i = 0; i < owner.length; i++) h = Math.imul(h ^ (owner[i] + 2), 16777619);
  return h;
}

export function borderTiles(state: GameState, from: number, to: number): number {
  const n = state.powers.length;
  const hash = territoryHash(state);
  let cached = borderCache.get(state);
  if (!cached || cached.hash !== hash) {
    const counts = new Int32Array(n * n);
    const size = mapSize(state);
    const owner = state.territory.owner;
    const seen = new Int32Array(n).fill(-1);
    for (let t = 0; t < owner.length; t++) {
      const o = owner[t];
      if (o === NONE) continue;
      for (const nb of neighbors(size, t)) {
        const other = owner[nb];
        if (other === NONE || other === o || seen[other] === t) continue;
        seen[other] = t;
        counts[o * n + other]++;
      }
    }
    cached = { hash, counts };
    borderCache.set(state, cached);
  }
  return cached.counts[from * n + to];
}

/** Сила военных юнитов to на земле from или рядом с ней — только тех, кого from видит. */
function armyNearBorder(state: GameState, from: number, to: number): number {
  const size = mapSize(state);
  const owner = state.territory.owner;
  const near = state.units.filter(
    (u) => u.owner === to && isMilitary(u) && (owner[u.tile] === from || neighbors(size, u.tile).some((n) => owner[n] === from)),
  );
  if (!near.length) return 0;
  const visible = computeVisible(state, from);
  return near.reduce((sum, u) => sum + (visible[u.tile] ? u.strength : 0), 0);
}

function addItem(b: Breakdown, label: string, value: number): void {
  const v = Math.round(value);
  if (v === 0) return;
  b.items.push({ label, value: v });
  b.total += v;
}

/**
 * Отношение from к to: от −100 до +100, с разбивкой.
 * Учитывает статус пары, общих врагов, границу, армию у границы, коалицию, характер и память.
 */
export function opinion(state: GameState, from: number, to: number): Breakdown {
  const b: Breakdown = { total: 0, items: [] };
  if (from === to) return b;
  const pf = state.powers[from];
  const pt = state.powers[to];
  const traits = diplomacyTraits(pf.character);

  if (atWar(state, from, to)) addItem(b, 'Война', ocfg.war);
  const trade = findPact(state, from, to, 'trade');
  if (trade) {
    const v = Math.min(ocfg.tradeMax, ocfg.tradeBase + Math.floor((state.turn - trade.since) / ocfg.tradeGrowthTurns));
    addItem(b, 'Торговый договор', v * traits.tradeOpinionFactor);
  }
  if (findPact(state, from, to, 'alliance')) addItem(b, 'Союз', ocfg.alliance);
  if (pf.suzerain === to) addItem(b, 'Наш сюзерен', ocfg.vassalView);
  if (pt.suzerain === from) addItem(b, 'Наш вассал', ocfg.suzerainView);

  const common = pf.wars.filter((w) => pt.wars.includes(w));
  if (common.length) {
    const names = common.map((w) => state.powers[w].name).join(', ');
    addItem(b, `Общий враг: ${names}`, Math.min(ocfg.commonEnemyMax, common.length * ocfg.commonEnemy));
  }

  const border = borderTiles(state, from, to);
  if (border && !allied(state, from, to)) {
    addItem(b, 'Общая граница', -Math.min(ocfg.borderMax, border * ocfg.borderPerTile) * traits.borderFactor);
  }
  if (!allied(state, from, to) && !atWar(state, from, to)) {
    const army = armyNearBorder(state, from, to);
    if (army) addItem(b, 'Их армия у нашей границы', -Math.min(ocfg.armyMax, army * ocfg.armyPerStrength) * traits.borderFactor);
  }

  if (hegemonOf(state, from) === to) {
    const icfg = pathsConfig.influence;
    addItem(b, 'Культурное влияние', Math.min(icfg.opinionMax, influenceOf(state, from, to) * icfg.opinionPerShare));
  }

  if (traits.respectsStrength) {
    const r = Math.log2(strengthOf(state, to) / strengthOf(state, from));
    const v = Math.max(-ocfg.respectMax, Math.min(ocfg.respectMax, r * ocfg.respectPerRatioLog));
    addItem(b, v > 0 ? 'Уважаем их силу' : 'Презираем слабость', v);
  }

  const leader = state.coalitionLeader;
  if (leader !== NONE && !vassalLink(state, from, leader)) {
    if (leader === to) addItem(b, 'Близки к победе', ocfg.leaderThreat);
    else if (leader !== from && !vassalLink(state, to, leader)) {
      addItem(b, `Общая угроза: ${state.powers[leader].name}`, ocfg.coalitionPartner);
    }
  }

  // Память: одинаковые подписи складываются, возраст — по последнему событию.
  const groups = new Map<string, { value: number; age: number }>();
  for (const m of pf.memories) {
    if (m.about !== to) continue;
    const v = memoryValue(m, state.turn);
    if (!v) continue;
    const label = m.label ?? memoryDef(m.kind).label;
    const g = groups.get(label) ?? { value: 0, age: Infinity };
    g.value += v;
    g.age = Math.min(g.age, state.turn - m.turn);
    groups.set(label, g);
  }
  for (const [label, g] of groups) addItem(b, `${label} (${turnsAgo(g.age)})`, g.value);

  b.total = Math.max(ocfg.min, Math.min(ocfg.max, b.total));
  return b;
}
