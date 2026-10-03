// Дипломатия бота: мир по ходу войны, договоры и союзы с теми, кто нравится, уния, просьбы о помощи,
// дань со слабых (агрессор) и подарки для открытия договоров. Ответ другого бота бот узнаёт той же
// формулой, что и прогноз в интерфейсе; игроку предлагает не чаще раза в несколько ходов.

import type { Command } from '../core/commands';
import { aiConfig, diplomacyConfig } from '../core/data';
import {
  accepts,
  dealBlocker,
  evaluateDeal,
  giftBlocker,
  giftForecast,
  lastProposalAge,
  NO_TERMS,
} from '../core/diplomacy';
import { grossGold, computeIncome } from '../core/economy';
import { lastMemoryAge, opinion, strengthOf } from '../core/relations';
import { atWar, citiesOf, findPact, hasPact, principalOf, vassalsOf } from '../core/state';
import { NONE, type Deal, type DealKind, type PeaceTerms } from '../core/types';
import { exec, type BotContext } from './context';

const cfg = aiConfig.diplomacy;

/** Державы, с которыми бот может вести дела: живые и встреченные. */
function contacts(ctx: BotContext): number[] {
  const me = ctx.state.powers[ctx.power];
  return me.met.filter((p) => ctx.state.powers[p].alive);
}

/** Согласился бы бот сам, если бы from предложил ему эту сделку. */
function iWouldAccept(ctx: BotContext, from: number, deal: Deal): boolean {
  return accepts(evaluateDeal(ctx.state, from, ctx.power, deal));
}

/**
 * Предложить сделку, если она возможна и, по прогнозу, будет принята.
 * Игроку — только если прошло достаточно ходов с прошлого такого предложения.
 */
function offer(ctx: BotContext, target: number, deal: Deal, force = false): boolean {
  const { state, power } = ctx;
  if (dealBlocker(state, power, target, deal)) return false;
  const human = state.powers[target].isHuman;
  if (human && lastProposalAge(state, power, target, deal.kind) < cfg.humanCooldown) return false;
  if (!force && !accepts(evaluateDeal(state, power, target, deal))) return false;
  const cmd: Command = { type: 'Propose', power, target, deal };
  return exec(ctx, cmd);
}

/** Условия с точки зрения другой стороны (если бы предлагала она). */
function mirror(t: PeaceTerms): PeaceTerms {
  return { giveGold: t.takeGold, giveCity: t.takeCity, takeGold: t.giveGold, takeCity: t.giveCity, vassal: t.vassal };
}

function roundGold(x: number): number {
  return Math.max(0, Math.round(x / 5) * 5);
}

/** Варианты мира от самого выгодного боту до самого уступчивого. */
function peaceOptions(ctx: BotContext, enemy: number): PeaceTerms[] {
  const { state, power } = ctx;
  const me = state.powers[power];
  const them = state.powers[enemy];
  const explored = me.explored;
  const options: PeaceTerms[] = [];
  if (!vassalsOf(state, enemy).length) options.push({ ...NO_TERMS, vassal: enemy });
  const theirCity = citiesOf(state, enemy)
    .filter((c) => !c.isCapital && explored[c.tile])
    .sort((a, b) => b.level - a.level || a.id - b.id)[0];
  if (theirCity) options.push({ ...NO_TERMS, takeCity: theirCity.id });
  const take = Math.min(them.gold, roundGold(grossGold(state, enemy) * cfg.peaceGoldTurns));
  if (take >= 10) options.push({ ...NO_TERMS, takeGold: take });
  options.push(NO_TERMS);
  const give = Math.min(me.gold, roundGold(grossGold(state, power) * cfg.peaceGoldTurns));
  if (give >= 10) options.push({ ...NO_TERMS, giveGold: give });
  const myCity = citiesOf(state, power)
    .filter((c) => !c.isCapital)
    .sort((a, b) => a.level - b.level || b.id - a.id)[0];
  if (myCity) options.push({ ...NO_TERMS, giveCity: myCity.id });
  if (!vassalsOf(state, power).length) options.push({ ...NO_TERMS, vassal: power });
  return options;
}

/** Мир: самый выгодный вариант, на который согласны обе стороны. */
function seekPeace(ctx: BotContext): void {
  const { state, power } = ctx;
  const me = state.powers[power];
  if (me.suzerain !== NONE) return;
  for (const enemy of [...me.wars]) {
    if (!atWar(state, power, enemy) || principalOf(state, enemy) !== enemy) continue;
    const human = state.powers[enemy].isHuman;
    let fallback: Deal | null = null;
    for (const terms of peaceOptions(ctx, enemy)) {
      const deal: Deal = { kind: 'peace', terms };
      if (dealBlocker(state, power, enemy, deal)) continue;
      if (!iWouldAccept(ctx, enemy, { kind: 'peace', terms: mirror(terms) })) continue;
      if (accepts(evaluateDeal(state, power, enemy, deal))) {
        if (offer(ctx, enemy, deal)) break;
        continue;
      }
      fallback = deal;
    }
    // Игроку можно предложить и то, что по модели он вряд ли примет: решает он сам.
    if (human && fallback && atWar(state, power, enemy)) offer(ctx, enemy, fallback, true);
  }
}

/** Договоры, союзы и уния с теми, кто нравится и кому нравится бот. */
function seekPacts(ctx: BotContext): void {
  const { state, power } = ctx;
  for (const t of contacts(ctx)) {
    if (atWar(state, power, t)) continue;
    for (const kind of ['trade', 'alliance'] as const) {
      const deal: Deal = { kind };
      if (dealBlocker(state, power, t, deal) || !iWouldAccept(ctx, t, deal)) continue;
      offer(ctx, t, deal);
    }
    if (ctx.character.seeksUnion && !state.powers[t].isHuman) offer(ctx, t, { kind: 'union' });
    if (!state.powers[t].alive) continue;
    // Договор с тем, кого бот разлюбил, расторгается.
    const op = opinion(state, power, t).total;
    if (hasPact(state, power, t, 'trade') && op < cfg.cancelTradeBelow) {
      exec(ctx, { type: 'CancelPact', power, target: t, kind: 'trade' });
    }
    const alliance = findPact(state, power, t, 'alliance');
    if (alliance && op < cfg.cancelAllianceBelow && !state.powers[power].wars.some((w) => atWar(state, t, w))) {
      exec(ctx, { type: 'CancelPact', power, target: t, kind: 'alliance' });
    }
  }
}

/** Просьбы вступить в войну: бесплатно, а если нужно — за плату. */
function askForHelp(ctx: BotContext): void {
  const { state, power } = ctx;
  const me = state.powers[power];
  if (me.suzerain !== NONE) return;
  let asked = 0;
  for (const enemy of [...me.wars]) {
    for (const t of contacts(ctx)) {
      if (asked >= cfg.maxJoinAsks) return;
      if (t === enemy || atWar(state, t, enemy) || atWar(state, power, t)) continue;
      if (state.powers[t].isHuman && !hasPact(state, power, t, 'alliance')) continue;
      const income = Math.max(diplomacyConfig.gift.minIncome, grossGold(state, t));
      const offers = [0, ...cfg.joinWarPayTurns.map((k) => roundGold(income * k))];
      for (const gold of offers) {
        if (gold > me.gold - aiConfig.economy.stockpile / 2 && gold > 0) break;
        if (offer(ctx, t, { kind: 'joinWar', enemy, gold })) {
          asked++;
          break;
        }
        if (state.powers[t].isHuman) break;
      }
    }
  }
}

/** Агрессор требует дань с тех, кто намного слабее. */
function demandTribute(ctx: BotContext): void {
  const { state, power } = ctx;
  if (!ctx.character.demandsTribute || state.turn < aiConfig.war.minTurn) return;
  const d = diplomacyConfig.deals;
  const mine = strengthOf(state, power);
  for (const t of contacts(ctx)) {
    if (mine < strengthOf(state, t) * d.tributeRatio * cfg.tributeMargin) continue;
    const gold = Math.min(state.powers[t].gold, roundGold(grossGold(state, t) * cfg.tributeIncomeTurns));
    if (gold < cfg.tributeMin) continue;
    offer(ctx, t, { kind: 'tribute', gold }, state.powers[t].isHuman);
  }
}

/** Насколько не хватает до согласия на сделку (0 — уже согласны, null — сделка не нужна или невозможна). */
function gapFor(ctx: BotContext, t: number, kind: DealKind): number | null {
  const { state, power } = ctx;
  const deal: Deal = kind === 'trade' ? { kind: 'trade' } : { kind: 'alliance' };
  if (dealBlocker(state, power, t, deal) || !iWouldAccept(ctx, t, deal)) return null;
  const score = evaluateDeal(state, power, t, deal).total;
  return score >= 0 ? null : -score;
}

/** Подарки золотом и культурой тем, с кем до договора или союза осталось немного. */
export function giftsTurn(ctx: BotContext): void {
  const { state, power } = ctx;
  if (!ctx.character.gifts) return;
  const me = state.powers[power];
  const surplus = me.gold - aiConfig.economy.stockpile;
  const culture = me.culture - cfg.cultureReserve;
  if (surplus < cfg.giftMin && culture < cfg.giftMin) return;
  let best: { t: number; gap: number } | null = null;
  for (const t of contacts(ctx)) {
    if (atWar(state, power, t)) continue;
    if (lastMemoryAge(state, t, power, 'gift') < diplomacyConfig.gift.repeatWindow) continue;
    if (lastMemoryAge(state, t, power, 'culture') < diplomacyConfig.gift.repeatWindow) continue;
    for (const kind of ['trade', 'alliance'] as const) {
      const gap = gapFor(ctx, t, kind);
      if (gap !== null && gap <= cfg.giftMaxGap && (!best || gap < best.gap)) best = { t, gap };
    }
  }
  // Договоры не на подходе, а золота много: задабриваем самого сильного из тех, кто к нам прохладен.
  if (!best && surplus >= aiConfig.economy.stockpile) {
    const mine = strengthOf(state, power);
    let strongest = 0;
    for (const t of contacts(ctx)) {
      if (atWar(state, power, t) || lastMemoryAge(state, t, power, 'gift') < diplomacyConfig.gift.repeatWindow) continue;
      const st = strengthOf(state, t);
      if (st <= mine || st <= strongest || opinion(state, t, power).total >= cfg.appeaseBelow) continue;
      strongest = st;
      best = { t, gap: cfg.appeaseValue };
    }
  }
  if (!best) return;
  const { t, gap } = best;
  // Сначала культура (если есть лишняя), потом золото — наименьшая сумма, которой хватит.
  const tries: { resource: 'gold' | 'culture'; budget: number }[] = [
    { resource: 'culture', budget: Math.floor(culture) },
    { resource: 'gold', budget: Math.floor(surplus * cfg.giftSurplusShare) },
  ];
  for (const { resource, budget } of tries) {
    if (budget < cfg.giftMin) continue;
    const income = resource === 'gold' ? grossGold(state, t) : computeIncome(state, t).culture.total;
    const step = Math.max(5, roundGold(Math.max(diplomacyConfig.gift.minIncome, income)));
    for (let amount = step; amount <= budget; amount += step) {
      if (giftBlocker(state, power, t, amount, resource)) break;
      if (giftForecast(state, power, t, amount, resource).value <= gap && amount + step <= budget) continue;
      const cmd: Command =
        resource === 'gold'
          ? { type: 'Gift', power, target: t, gold: amount }
          : { type: 'CultureExchange', power, target: t, culture: amount };
      if (exec(ctx, cmd)) return;
      break;
    }
  }
}

/** Дипломатия в начале хода бота. */
export function diplomacyTurn(ctx: BotContext): void {
  seekPeace(ctx);
  seekPacts(ctx);
  askForHelp(ctx);
  demandTribute(ctx);
}
