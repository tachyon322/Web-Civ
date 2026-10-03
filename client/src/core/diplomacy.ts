// Дипломатия: встречи, объявление войны (с союзниками и вассалами), подарки, сделки и их оценка.
// Ответ бота считается той же функцией, что и прогноз в интерфейсе, поэтому отказ всегда объясним.

import { transferCity } from './capture';
import { characterDef, diplomacyConfig, diplomacyTraits } from './data';
import { computeIncome, grossGold, type Breakdown } from './economy';
import { log } from './entities';
import { range } from './hex';
import { canStop } from './pathfinding';
import {
  addPact,
  endWar,
  findCoalitionLeader,
  forgetPower,
  lastMemoryAge,
  opinion,
  pruneMemories,
  remember,
  removePact,
  sizeOf,
  startWar,
  strengthOf,
  warTurns,
} from './relations';
import {
  allied,
  atWar,
  findCity,
  findPact,
  hasPact,
  isLand,
  mapSize,
  principalOf,
  truceLeft,
  vassalLink,
  vassalsOf,
} from './state';
import { turnsWord } from './text';
import { NONE, type City, type Deal, type GameState, type PeaceTerms, type Proposal } from './types';
import { computeVisible, updateExplored } from './visibility';

const cfg = diplomacyConfig;

// ---------- Встречи и журнал ----------

function meet(state: GameState, a: number, b: number): void {
  if (a === b || a === NONE || b === NONE) return;
  const pa = state.powers[a];
  const pb = state.powers[b];
  if (!pa.met.includes(b)) pa.met.push(b);
  if (!pb.met.includes(a)) pb.met.push(a);
}

/** Держава встречает всех, чьи клетки, города или юниты сейчас видит своими глазами. Встреча взаимна. */
export function updateContacts(state: GameState, power: number): void {
  const visible = computeVisible(state, power, false);
  const { owner } = state.territory;
  for (let t = 0; t < visible.length; t++) if (visible[t] && owner[t] !== NONE) meet(state, power, owner[t]);
  for (const u of state.units) if (visible[u.tile]) meet(state, power, u.owner);
}

export function hasMet(state: GameState, a: number, b: number): boolean {
  return state.powers[a].met.includes(b);
}

/** Запись в журнал для участников и тех, кто с ними встречался. */
export function logPublic(state: GameState, parties: number[], text: string): void {
  const audience = state.powers
    .filter((p) => p.alive && (parties.includes(p.id) || parties.some((x) => p.met.includes(x))))
    .map((p) => p.id);
  state.log.push({ turn: state.turn, power: NONE, text, audience });
}

// ---------- Блоки: сюзерен со своими вассалами ----------

/** Сюзерен и его вассалы — воюют и мирятся вместе. */
export function blocOf(state: GameState, power: number): number[] {
  const head = principalOf(state, power);
  return [head, ...vassalsOf(state, head)];
}

export function blocStrength(state: GameState, power: number): number {
  return blocOf(state, power).reduce((sum, p) => sum + strengthOf(state, p), 0);
}

// ---------- Война ----------

/** Почему a не может объявить войну b; null — может. */
export function warBlocker(state: GameState, a: number, b: number): string | null {
  const pa = state.powers[a];
  const pb = state.powers[b];
  if (!pb || !pb.alive) return 'Такой державы нет';
  if (a === b) return 'Нельзя объявить войну себе';
  if (!hasMet(state, a, b)) return 'Вы ещё не встречались';
  if (atWar(state, a, b)) return 'Война уже идёт';
  if (pa.suzerain !== NONE) return `Вассал не объявляет войн сам — это решает ${state.powers[pa.suzerain].name}`;
  if (vassalLink(state, a, b)) return pb.suzerain === a ? 'Это ваш вассал' : 'Это ваш сюзерен';
  const left = Math.max(truceLeft(state, a, b), truceLeft(state, a, principalOf(state, b)));
  if (left) return `Перемирие: нападать нельзя ещё ${left} ${turnsWord(left)}`;
  return null;
}

export interface WarSides {
  /** Нападающий и его вассалы. */
  attackers: number[];
  /** Цель, её сюзерен и вассалы. */
  defenders: number[];
  /** Союзники цели, которые вступят в войну. */
  allies: number[];
  /** С кем нападающий нарушает договор. */
  betrayed: number[];
}

/** Кто окажется в войне, если a нападёт на b. Та же функция — для прогноза и для самого объявления. */
export function warSides(state: GameState, a: number, b: number): WarSides {
  const attackers = blocOf(state, a);
  const defenders = blocOf(state, b);
  const allies: number[] = [];
  for (const d of defenders) {
    for (const p of state.pacts) {
      if (p.kind !== 'alliance' || (p.a !== d && p.b !== d)) continue;
      const ally = p.a === d ? p.b : p.a;
      if (attackers.includes(ally) || defenders.includes(ally) || allies.includes(ally)) continue;
      if (allied(state, ally, a) || truceLeft(state, ally, a)) continue;
      for (const x of blocOf(state, ally)) if (!allies.includes(x) && !attackers.includes(x)) allies.push(x);
    }
  }
  const betrayed = defenders.filter((d) => hasPact(state, a, d, 'trade') || hasPact(state, a, d, 'alliance'));
  return { attackers, defenders, allies, betrayed };
}

/** Объявление войны: воюют блоки, союзники цели вступают на её стороне, нарушение договора все запоминают. */
export function declareWar(state: GameState, a: number, b: number): WarSides {
  const sides = warSides(state, a, b);
  const ev = cfg.events;
  for (const x of sides.attackers) {
    for (const y of [...sides.defenders, ...sides.allies]) if (!atWar(state, x, y)) startWar(state, x, y);
  }
  const pa = state.powers[a];
  if (sides.betrayed.length) {
    const names = sides.betrayed.map((d) => state.powers[d].name).join(', ');
    for (const v of sides.betrayed) remember(state, v, a, 'betrayal', ev.betrayalVictim);
    for (const o of state.powers) {
      if (!o.alive || o.id === a || sides.betrayed.includes(o.id) || !o.met.includes(a)) continue;
      // Предательство сильного запоминают сильнее.
      const factor = strengthOf(state, a) > strengthOf(state, o.id) ? ev.betrayalStrongFactor : 1;
      remember(state, o.id, a, 'betrayalSeen', ev.betrayalSeen * factor, `Нарушили договор с ${names}`);
    }
  }
  const traders = sides.defenders.filter((d) => state.powers[d].character === 'trader');
  if (traders.length) {
    const names = traders.map((d) => state.powers[d].name).join(', ');
    for (const o of state.powers) {
      if (!o.alive || o.id === a || !o.met.includes(a)) continue;
      remember(state, o.id, a, 'attackedTrader', ev.attackedTrader, `Напали на торговца: ${names}`);
    }
  }
  const pb = state.powers[b];
  logPublic(state, [a, b], `Объявлена война: ${pa.name} — ${pb.name}${sides.betrayed.length ? ' (нарушен договор)' : ''}`);
  const head = principalOf(state, b);
  if (head !== b) logPublic(state, [head, a], `${state.powers[head].name} вступает в войну за своего вассала ${pb.name}`);
  for (const x of sides.allies) {
    logPublic(state, [x, a], `${state.powers[x].name} вступает в войну с державой ${pa.name} на стороне союзника`);
  }
  return sides;
}

/** Мир между блоками сторон: войны пар заканчиваются перемирием. */
export function makePeace(state: GameState, a: number, b: number): void {
  for (const x of blocOf(state, a)) for (const y of blocOf(state, b)) if (atWar(state, x, y)) endWar(state, x, y);
}

// ---------- Вассалитет и уния ----------

/** vassal становится вассалом suzerain: его союзы распадаются, чужие войны кончаются, войны сюзерена — его войны. */
export function vassalize(state: GameState, vassal: number, suzerain: number): void {
  const pv = state.powers[vassal];
  pv.suzerain = suzerain;
  state.pacts = state.pacts.filter((p) => !(p.kind === 'alliance' && (p.a === vassal || p.b === vassal)));
  for (const w of [...pv.wars]) if (!atWar(state, suzerain, w)) endWar(state, vassal, w);
  for (const w of state.powers[suzerain].wars) if (w !== vassal && !atWar(state, vassal, w)) startWar(state, vassal, w);
  logPublic(state, [vassal, suzerain], `${pv.name} становится вассалом державы ${state.powers[suzerain].name}`);
}

/** Уния: младший партнёр вливается в старшего — города, юниты и карта переходят мирно, младший уходит со сцены. */
export function performUnion(state: GameState, senior: number, junior: number): void {
  const ps = state.powers[senior];
  const pj = state.powers[junior];
  for (const u of state.units) if (u.owner === junior) u.owner = senior;
  const { owner } = state.territory;
  for (let t = 0; t < owner.length; t++) if (owner[t] === junior) owner[t] = senior;
  for (const c of state.cities) {
    if (c.owner !== junior) continue;
    c.owner = senior;
    c.isCapital = false;
  }
  pj.explored.forEach((e, t) => {
    if (e) ps.explored[t] = 1;
  });
  for (const m of pj.met) if (m !== senior) meet(state, senior, m);
  pj.alive = false;
  pj.capitalId = NONE;
  forgetPower(state, junior);
  updateExplored(state, senior);
  logPublic(state, [senior, junior], `${pj.name} входит в унию с державой ${ps.name}: города переходят мирно`);
}

/** Передача города по условиям мира: юниты прежнего владельца выходят из него на ближайшую свободную клетку. */
export function cedeCity(state: GameState, city: City, to: number): void {
  const size = mapSize(state);
  for (const u of state.units.filter((x) => x.tile === city.tile && x.owner !== to)) {
    let spot = NONE;
    for (let r = 1; r <= 6 && spot === NONE; r++) {
      const ring = range(size, city.tile, r).filter((t) => isLand(state, t) && t !== city.tile && canStop(state, u, t));
      spot = ring.find((t) => state.territory.owner[t] === u.owner) ?? ring[0] ?? NONE;
    }
    if (spot === NONE) state.units = state.units.filter((x) => x !== u);
    else u.tile = spot;
  }
  transferCity(state, city, to);
  city.purchasedThisTurn = true;
}

// ---------- Подарки ----------

export interface GiftForecast {
  value: number;
  notes: string[];
}

/**
 * Принцип относительной ценности: подарок оценивается в ходах дохода получателя.
 * Повторные подарки в течение окна работают слабее, максимум ограничен.
 */
export function giftForecast(state: GameState, from: number, to: number, amount: number, resource: 'gold' | 'culture'): GiftForecast {
  const g = cfg.gift;
  const income = resource === 'gold' ? grossGold(state, to) : computeIncome(state, to).culture.total;
  const base = Math.max(g.minIncome, income);
  const turns = amount / base;
  const notes = [`${fmt(turns)} ${turnsWord(Math.ceil(turns))} их дохода (${resource === 'gold' ? 'золото' : 'культура'} ${income} за ход)`];
  const traits = diplomacyTraits(state.powers[to].character);
  const factor = resource === 'gold' ? traits.giftFactor : traits.cultureFactor;
  let v = turns * g.valuePerTurnOfIncome * factor;
  if (factor !== 1) notes.push(`характер получателя ×${fmt(factor)}`);
  if (traits.respectsStrength && strengthOf(state, from) < strengthOf(state, to)) {
    v *= g.fromWeakFactor;
    notes.push(`подарок от слабого считают слабостью ×${fmt(g.fromWeakFactor)}`);
  }
  if (v > g.max) {
    v = g.max;
    notes.push(`не больше +${g.max} за раз`);
  }
  const kind = resource === 'gold' ? 'gift' : 'culture';
  const recent = state.powers[to].memories.filter(
    (m) => m.about === from && m.kind === kind && state.turn - m.turn < g.repeatWindow,
  ).length;
  if (recent) {
    v *= g.repeatFactor ** recent;
    notes.push(`повторный за ${g.repeatWindow} ходов ×${fmt(g.repeatFactor ** recent)}`);
  }
  return { value: Math.round(v), notes };
}

function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}

export function giftBlocker(state: GameState, from: number, to: number, amount: number, resource: 'gold' | 'culture'): string | null {
  const pt = state.powers[to];
  if (!pt || !pt.alive || from === to) return 'Такой державы нет';
  if (!hasMet(state, from, to)) return 'Вы ещё не встречались';
  if (atWar(state, from, to)) return 'Во время войны подарки не принимают';
  if (!Number.isInteger(amount) || amount <= 0) return 'Неверное количество';
  const have = resource === 'gold' ? state.powers[from].gold : state.powers[from].culture;
  if (have < amount) return `Нужно ${amount} ${resource === 'gold' ? 'золота' : 'культуры'}`;
  return null;
}

export function giveGift(state: GameState, from: number, to: number, amount: number, resource: 'gold' | 'culture'): void {
  const f = giftForecast(state, from, to, amount, resource);
  const pf = state.powers[from];
  const pt = state.powers[to];
  if (resource === 'gold') {
    pf.gold -= amount;
    pt.gold += amount;
    remember(state, to, from, 'gift', f.value);
    log(state, from, `Подарок державе ${pt.name}: ${amount} золота (отношения +${f.value})`);
    log(state, to, `${pf.name} дарит нам ${amount} золота`);
  } else {
    pf.culture -= amount;
    remember(state, to, from, 'culture', f.value);
    log(state, from, `Культурный обмен с державой ${pt.name}: −${amount} культуры (отношения +${f.value})`);
    log(state, to, `${pf.name} проводит с нами культурный обмен`);
  }
}

// ---------- Сделки ----------

export const NO_TERMS: PeaceTerms = { giveGold: 0, giveCity: NONE, takeGold: 0, takeCity: NONE, vassal: NONE };

const DEAL_NAMES: Record<Deal['kind'], string> = {
  trade: 'торговый договор',
  alliance: 'союз',
  union: 'уния',
  joinWar: 'вступить в войну',
  tribute: 'дань',
  peace: 'мир',
};

/** Описание сделки с точки зрения предлагающего. */
export function dealText(state: GameState, from: number, to: number, deal: Deal): string {
  const name = (p: number) => state.powers[p].name;
  switch (deal.kind) {
    case 'trade':
    case 'alliance':
      return DEAL_NAMES[deal.kind];
    case 'union':
      return `уния: ${name(to)} входит в державу ${name(from)}`;
    case 'joinWar':
      return `вступить в войну с державой ${name(deal.enemy)}${deal.gold ? ` за ${deal.gold} золота` : ''}`;
    case 'tribute':
      return `дань ${deal.gold} золота`;
    case 'peace':
      return `мир${termsText(state, from, to, deal.terms)}`;
  }
}

export function termsText(state: GameState, from: number, to: number, t: PeaceTerms): string {
  const parts: string[] = [];
  const name = (p: number) => state.powers[p].name;
  const city = (id: number) => findCity(state, id)?.name ?? '?';
  if (t.giveGold) parts.push(`${name(from)} платит ${t.giveGold} золота`);
  if (t.takeGold) parts.push(`${name(to)} платит ${t.takeGold} золота`);
  if (t.giveCity !== NONE) parts.push(`${name(from)} отдаёт ${city(t.giveCity)}`);
  if (t.takeCity !== NONE) parts.push(`${name(to)} отдаёт ${city(t.takeCity)}`);
  if (t.vassal !== NONE) parts.push(`${name(t.vassal)} становится вассалом`);
  return parts.length ? `: ${parts.join(', ')}` : ' без условий';
}

function citiesBlocker(state: GameState, cityId: number, owner: number, viewer: number): string | null {
  if (cityId === NONE) return null;
  const city = findCity(state, cityId);
  if (!city || city.owner !== owner) return 'Город не принадлежит этой стороне';
  if (city.isCapital) return 'Столицу по договору не отдают';
  if (!state.powers[viewer].explored[city.tile]) return 'Этот город вам неизвестен';
  return null;
}

/** Почему сделка невозможна в принципе (независимо от согласия); null — возможна. */
export function dealBlocker(state: GameState, from: number, to: number, deal: Deal): string | null {
  const pf = state.powers[from];
  const pt = state.powers[to];
  if (!pt || !pt.alive || from === to) return 'Такой державы нет';
  if (!hasMet(state, from, to)) return 'Вы ещё не встречались';
  const name = (p: number) => state.powers[p].name;
  switch (deal.kind) {
    case 'trade':
      if (atWar(state, from, to)) return 'Идёт война';
      if (hasPact(state, from, to, 'trade')) return 'Договор уже есть';
      return null;

    case 'alliance': {
      if (atWar(state, from, to)) return 'Идёт война';
      if (hasPact(state, from, to, 'alliance')) return 'Союз уже есть';
      if (vassalLink(state, from, to)) return 'Вы и так связаны вассалитетом';
      if (pf.suzerain !== NONE || pt.suzerain !== NONE) return 'Вассалы не заключают союзов';
      const theirAllyEnemy = pf.wars.find((w) => allied(state, to, w));
      if (theirAllyEnemy !== undefined) return `Они в союзе с вашим врагом: ${name(theirAllyEnemy)}`;
      const myAllyEnemy = pt.wars.find((w) => allied(state, from, w));
      if (myAllyEnemy !== undefined) return `Вы в союзе с их врагом: ${name(myAllyEnemy)}`;
      return null;
    }

    case 'union': {
      if (pt.isHuman) return 'Игрок не входит в чужую державу';
      if (pf.suzerain !== NONE) return 'Вассал не заключает унию';
      const alliance = findPact(state, from, to, 'alliance');
      const need = cfg.deals.unionAllianceTurns;
      if (!alliance) return `Нужен союз не меньше ${need} ходов`;
      const turns = state.turn - alliance.since;
      if (turns < need) return `Нужен союз не меньше ${need} ходов (сейчас ${turns})`;
      if (sizeOf(state, from) <= sizeOf(state, to)) return 'Уния возможна только с меньшей державой';
      return null;
    }

    case 'joinWar': {
      const e = deal.enemy;
      if (!state.powers[e]?.alive) return 'Такой державы нет';
      if (!atWar(state, from, e)) return `Вы не воюете с державой ${name(e)}`;
      if (e === to) return 'Нельзя просить воевать с самим собой';
      if (atWar(state, to, e)) return `Они уже воюют с державой ${name(e)}`;
      const blocker = warBlocker(state, to, e);
      if (blocker) return `Против ${name(e)}: ${blocker.charAt(0).toLowerCase()}${blocker.slice(1)}`;
      if (!Number.isInteger(deal.gold) || deal.gold < 0) return 'Неверная сумма';
      if (deal.gold > pf.gold) return `Нужно ${deal.gold} золота`;
      return null;
    }

    case 'tribute': {
      if (atWar(state, from, to)) return 'Идёт война — дань берут условиями мира';
      if (pf.suzerain !== NONE) return 'Вассал не требует дани';
      if (vassalLink(state, from, to)) return 'Вы связаны вассалитетом';
      if (allied(state, from, to)) return 'С союзника дань не требуют';
      if (!Number.isInteger(deal.gold) || deal.gold <= 0) return 'Неверная сумма';
      if (pt.gold < deal.gold) return `У них только ${pt.gold} золота`;
      const age = Math.min(lastMemoryAge(state, to, from, 'tributeDemanded'), lastMemoryAge(state, to, from, 'tributePaid'));
      const wait = cfg.deals.tributeCooldown - age;
      if (wait > 0) return `Дань уже требовали — снова можно через ${wait} ${turnsWord(wait)}`;
      return null;
    }

    case 'peace': {
      const t = deal.terms;
      if (!atWar(state, from, to)) return 'Войны нет';
      if (pf.suzerain !== NONE) return `Мир за вассала заключает ${name(pf.suzerain)}`;
      if (pt.suzerain !== NONE) return `Мир заключают с сюзереном — ${name(pt.suzerain)}`;
      for (const g of [t.giveGold, t.takeGold]) if (!Number.isInteger(g) || g < 0) return 'Неверная сумма';
      if (t.giveGold > pf.gold) return `Нужно ${t.giveGold} золота`;
      if (t.takeGold > pt.gold) return `У них только ${pt.gold} золота`;
      const cityProblem = citiesBlocker(state, t.giveCity, from, from) ?? citiesBlocker(state, t.takeCity, to, from);
      if (cityProblem) return cityProblem;
      if (t.vassal !== NONE) {
        if (t.vassal !== from && t.vassal !== to) return 'Вассалом может стать только одна из сторон';
        if (vassalsOf(state, t.vassal).length) return 'У будущего вассала есть свои вассалы';
      }
      return null;
    }
  }
}

function add(b: Breakdown, label: string, value: number): void {
  const v = Math.round(value);
  if (v === 0) return;
  b.items.push({ label, value: v });
  b.total += v;
}

function clamp(v: number, max: number): number {
  return Math.max(-max, Math.min(max, v));
}

/** Сколько ходов дохода получателя составляет сумма. */
function incomeTurns(state: GameState, power: number, gold: number): number {
  return gold / Math.max(cfg.gift.minIncome, grossGold(state, power));
}

/**
 * Насколько to согласен на предложение from: разбивка счёта, согласие — при сумме ≥ 0.
 * Для игрока считается как для нейтрального характера — так боты предугадывают ответ игрока.
 */
export function evaluateDeal(state: GameState, from: number, to: number, deal: Deal): Breakdown {
  const d = cfg.deals;
  const b: Breakdown = { total: 0, items: [] };
  const pt = state.powers[to];
  const traits = diplomacyTraits(pt.character);
  const charLabel = pt.character ? `Характер: ${characterDef(pt.character).name.toLowerCase()}` : 'Характер';
  const op = opinion(state, to, from).total;
  const name = (p: number) => state.powers[p].name;

  switch (deal.kind) {
    case 'trade':
      add(b, 'Отношения', op);
      add(b, charLabel, traits.trade);
      break;

    case 'alliance': {
      add(b, 'Отношения', op);
      add(b, 'Порог союза', -d.allianceOpinion);
      const r = clamp(Math.log2(strengthOf(state, from) / strengthOf(state, to)) * d.allianceStrengthPerLog, d.allianceStrengthMax);
      add(b, r > 0 ? 'Они сильнее нас — ищем защиты' : 'Они слабее нас — нам нужен повод', r);
      add(b, charLabel, traits.alliance);
      break;
    }

    case 'union':
      add(b, 'Отношения', op);
      add(b, 'Порог унии', -d.unionOpinion);
      add(b, charLabel, traits.union);
      break;

    case 'joinWar': {
      const e = deal.enemy;
      add(b, 'Отношения', op * d.joinWarOpinionShare);
      add(b, 'Риск войны', d.joinWarRisk);
      add(b, `Отношения с державой ${name(e)}`, -opinion(state, to, e).total * d.joinWarOpinionShare);
      const req = clamp(Math.log2(strengthOf(state, from) / strengthOf(state, to)) * d.joinWarRequesterPerLog, d.joinWarRequesterMax);
      add(b, req > 0 ? 'Просит сильный' : 'Просит слабый', req);
      const en = clamp(Math.log2(blocStrength(state, to) / blocStrength(state, e)) * d.joinWarEnemyPerLog, d.joinWarEnemyMax);
      add(b, en > 0 ? `${name(e)} слабее нас` : `${name(e)} сильнее нас`, en);
      if (allied(state, to, from)) add(b, 'Просит союзник', d.joinWarAlly);
      if (hasPact(state, to, e, 'trade')) add(b, `Торговый договор с державой ${name(e)}`, d.joinWarTradeWithEnemy);
      if (e === state.coalitionLeader) add(b, 'Против того, кто близок к победе', d.joinWarVsLeader);
      if (deal.gold) {
        const v = Math.min(cfg.gift.max, incomeTurns(state, to, deal.gold) * cfg.gift.valuePerTurnOfIncome);
        add(b, `Плата ${deal.gold} золота`, v);
      }
      add(b, charLabel, traits.joinWar);
      break;
    }

    case 'tribute': {
      const ratio = strengthOf(state, from) / strengthOf(state, to);
      const strength = ratio >= 1 ? `Они сильнее нас в ${fmt(ratio)} раза` : `Они слабее нас в ${fmt(1 / ratio)} раза`;
      add(b, strength, clamp((ratio - d.tributeRatio) * d.tributePerRatio, 40));
      const turns = incomeTurns(state, to, deal.gold);
      add(b, `Цена: ${fmt(turns)} ${turnsWord(Math.ceil(turns))} нашего дохода`, turns * d.tributePerTurnOfIncome);
      add(b, 'Отношения', op * d.tributeOpinionShare);
      add(b, charLabel, traits.tribute);
      break;
    }

    case 'peace': {
      const t = deal.terms;
      const turns = warTurns(state, to, from);
      if (turns < d.peaceMinWarTurns) add(b, 'Война только началась', d.peaceTooEarly);
      add(b, 'Усталость от войны', Math.min(d.peaceFatigueMax, turns * d.peaceFatiguePerTurn));
      const r = clamp(Math.log2(blocStrength(state, from) / blocStrength(state, to)) * d.peaceStrengthPerLog, d.peaceStrengthMax);
      add(b, r > 0 ? 'Враг сильнее нас' : 'Враг слабее нас', r);
      add(b, 'Отношения', op * d.peaceOpinionShare);
      if (from === state.coalitionLeader) add(b, 'Нельзя дать им победить', d.peaceVsLeader);
      if (t.giveGold) {
        add(b, `Получаем ${t.giveGold} золота`, Math.min(d.peaceGoldMax, incomeTurns(state, to, t.giveGold) * d.peaceGoldPerTurnOfIncome));
      }
      if (t.takeGold) {
        add(b, `Платим ${t.takeGold} золота`, -Math.min(2 * d.peaceGoldMax, incomeTurns(state, to, t.takeGold) * d.peaceGoldPerTurnOfIncome));
      }
      const give = t.giveCity !== NONE ? findCity(state, t.giveCity) : undefined;
      if (give) add(b, `Получаем город ${give.name}`, give.level * d.peaceCityGetPerLevel);
      const take = t.takeCity !== NONE ? findCity(state, t.takeCity) : undefined;
      if (take) add(b, `Отдаём город ${take.name}`, take.level * d.peaceCityGivePerLevel);
      if (t.vassal === to) add(b, 'Становимся вассалом', d.peaceBecomeVassal);
      if (t.vassal === from) add(b, 'Они становятся нашим вассалом', d.peaceGetVassal);
      add(b, charLabel, traits.peace);
      break;
    }
  }
  return b;
}

export function accepts(score: Breakdown): boolean {
  return score.total >= 0;
}

/** «Нет: …» — самые весомые причины отказа, с расшифровкой отношений. */
export function refusalText(state: GameState, from: number, to: number, score: Breakdown): string {
  const negatives = score.items.filter((i) => i.value < 0).sort((a, b) => a.value - b.value).slice(0, 2);
  const parts = negatives.map((i) => {
    if (i.label !== 'Отношения') return `${i.label.toLowerCase()} (${i.value})`;
    const worst = opinion(state, to, from).items.filter((x) => x.value < 0).sort((a, b) => a.value - b.value)[0];
    return `отношения ${i.value}${worst ? ` — ${worst.label.toLowerCase()} (${worst.value})` : ''}`;
  });
  return `Нет: ${parts.join('; ') || 'не видим выгоды'} (итог ${score.total})`;
}

/** Исполняет принятую сделку. */
export function enactDeal(state: GameState, from: number, to: number, deal: Deal): void {
  const pf = state.powers[from];
  const pt = state.powers[to];
  switch (deal.kind) {
    case 'trade':
      addPact(state, from, to, 'trade');
      logPublic(state, [from, to], `Торговый договор: ${pf.name} — ${pt.name}`);
      break;

    case 'alliance':
      addPact(state, from, to, 'alliance');
      logPublic(state, [from, to], `Союз: ${pf.name} — ${pt.name}`);
      break;

    case 'union':
      performUnion(state, from, to);
      break;

    case 'joinWar': {
      pf.gold -= deal.gold;
      pt.gold += deal.gold;
      // Помощь маленькой стране ценнее, чем большой.
      const ev = cfg.events;
      const v = Math.min(ev.joinedWarMax, ev.joinedWarBase * Math.max(1, strengthOf(state, to) / strengthOf(state, from)));
      remember(state, from, to, 'joinedWar', v);
      log(state, from, `${pt.name} вступает в войну на нашей стороне`);
      declareWar(state, to, deal.enemy);
      break;
    }

    case 'tribute': {
      pt.gold -= deal.gold;
      pf.gold += deal.gold;
      const ev = cfg.events;
      const v = Math.max(ev.tributePaidMax, Math.min(ev.tributePaidMin, incomeTurns(state, to, deal.gold) * ev.tributePaidPerTurn));
      remember(state, to, from, 'tributePaid', v);
      logPublic(state, [from, to], `${pt.name} платит дань державе ${pf.name}: ${deal.gold} золота`);
      break;
    }

    case 'peace': {
      const t = deal.terms;
      makePeace(state, from, to);
      pf.gold += t.takeGold - t.giveGold;
      pt.gold += t.giveGold - t.takeGold;
      const give = t.giveCity !== NONE ? findCity(state, t.giveCity) : undefined;
      if (give) cedeCity(state, give, to);
      const take = t.takeCity !== NONE ? findCity(state, t.takeCity) : undefined;
      if (take) cedeCity(state, take, from);
      logPublic(state, [from, to], `Мир: ${pf.name} — ${pt.name}${termsText(state, from, to, t)}`);
      if (t.vassal === from) vassalize(state, from, to);
      if (t.vassal === to) vassalize(state, to, from);
      break;
    }
  }
}

/** Последствия отказа: требование дани портит отношения обеим сторонам. */
export function declineDeal(state: GameState, from: number, to: number, deal: Deal, reason: string | null, expired = false): void {
  const pf = state.powers[from];
  const pt = state.powers[to];
  if (deal.kind === 'tribute') {
    remember(state, to, from, 'tributeDemanded', cfg.events.tributeDemanded);
    remember(state, from, to, 'tributeRefused', cfg.events.tributeRefused);
  }
  log(state, from, `${pt.name} отклоняет: ${dealText(state, from, to, deal)}${reason ? `. ${reason}` : ''}`);
  if (!pt.isHuman) return;
  const verb = expired ? 'Истекло без ответа предложение' : 'Вы отклонили предложение';
  log(state, to, `${verb} державы ${pf.name}: ${dealText(state, from, to, deal)}`);
}

/**
 * Предложение: боту — ответ сразу по той же формуле, что и прогноз; игроку — в очередь до его ответа.
 * Возвращает запись о предложении.
 */
export function propose(state: GameState, from: number, to: number, deal: Deal): Proposal {
  const pr: Proposal = { id: state.nextId++, from, to, deal, turn: state.turn, status: 'pending' };
  state.proposals.push(pr);
  const pt = state.powers[to];
  if (pt.isHuman) {
    log(state, to, `${state.powers[from].name} предлагает: ${dealText(state, from, to, deal)}`);
    return pr;
  }
  const score = evaluateDeal(state, from, to, deal);
  if (accepts(score)) {
    pr.status = 'accepted';
    if (deal.kind !== 'trade' && deal.kind !== 'alliance' && deal.kind !== 'peace' && deal.kind !== 'tribute') {
      log(state, from, `${pt.name} соглашается: ${dealText(state, from, to, deal)}`);
    }
    enactDeal(state, from, to, deal);
  } else {
    pr.status = 'declined';
    declineDeal(state, from, to, deal, refusalText(state, from, to, score));
  }
  return pr;
}

export function respond(state: GameState, proposal: Proposal, accept: boolean): void {
  if (accept) {
    proposal.status = 'accepted';
    enactDeal(state, proposal.from, proposal.to, proposal.deal);
  } else {
    proposal.status = 'declined';
    declineDeal(state, proposal.from, proposal.to, proposal.deal, null);
  }
}

/** Расторжение договора или союза: партнёр это запомнит. */
export function cancelPact(state: GameState, power: number, target: number, kind: 'trade' | 'alliance'): void {
  removePact(state, power, target, kind);
  remember(state, target, power, 'treatyCancelled', cfg.events.treatyCancelled);
  logPublic(state, [power, target], `${state.powers[power].name} расторгает ${kind === 'trade' ? 'торговый договор' : 'союз'} с державой ${state.powers[target].name}`);
}

/** До смены номера хода: предложения, на которые игрок не ответил за свой ход, истекают. */
export function expireProposals(state: GameState): void {
  for (const pr of state.proposals) {
    if (pr.status !== 'pending' || pr.turn >= state.turn) continue;
    pr.status = 'expired';
    // Без ответа на требование дани — то же, что отказ.
    if (pr.deal.kind === 'tribute' && state.powers[pr.from].alive && state.powers[pr.to].alive) {
      declineDeal(state, pr.from, pr.to, pr.deal, 'Ответа не было', true);
    }
  }
  const keep = cfg.proposals.keepTurns;
  state.proposals = state.proposals.filter((pr) => pr.status === 'pending' || state.turn - pr.turn < keep);
}

export function pendingProposals(state: GameState, to: number): Proposal[] {
  return state.proposals.filter((pr) => pr.status === 'pending' && pr.to === to);
}

/** Сколько ходов назад from предлагал to сделку этого вида (Infinity — не предлагал). */
export function lastProposalAge(state: GameState, from: number, to: number, kind: Deal['kind']): number {
  let age = Infinity;
  for (const pr of state.proposals) {
    if (pr.from === from && pr.to === to && pr.deal.kind === kind) age = Math.min(age, state.turn - pr.turn);
  }
  return age;
}

/** После смены номера хода: кончаются перемирия, сильные вассалы восстают, обновляется коалиция. */
export function diplomacyNewTurn(state: GameState): void {
  state.pacts = state.pacts.filter((p) => p.kind !== 'truce' || p.until > state.turn);
  for (const p of state.powers) {
    if (!p.alive || p.suzerain === NONE) continue;
    const s = p.suzerain;
    if (strengthOf(state, p.id) <= strengthOf(state, s)) continue;
    p.suzerain = NONE;
    remember(state, s, p.id, 'rebellion', cfg.events.rebellion);
    logPublic(state, [p.id, s], `${p.name} восстаёт и освобождается от власти державы ${state.powers[s].name}`);
  }
  const leader = findCoalitionLeader(state);
  if (leader !== state.coalitionLeader) {
    if (leader !== NONE) {
      const name = state.powers[leader].name;
      log(state, NONE, `${name} близка к победе завоеванием: против неё собирается коалиция`);
    } else if (state.coalitionLeader !== NONE) {
      log(state, NONE, `Угроза победы державы ${state.powers[state.coalitionLeader].name} миновала`);
    }
    state.coalitionLeader = leader;
  }
  pruneMemories(state);
}
