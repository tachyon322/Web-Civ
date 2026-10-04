// Пути бота: Великий проект и способности науки и культуры. Наука — и счёт к победе, и валюта:
// в последней эпохе бот копит на этапы проекта и тратит только лишнее.

import { NO_TARGET, abilityBlocker, abilityCost, type AbilityUse } from '../core/abilities';
import { aiConfig, pathsConfig, type AbilityId } from '../core/data';
import { blocStrength } from '../core/diplomacy';
import { LAST_EPOCH, epochOf } from '../core/epochs';
import { neighbors } from '../core/hex';
import { findPact, isMilitary, mapSize, unitPeople } from '../core/state';
import { NONE, type ProjectKind } from '../core/types';
import { projectBlocker, projectCity, projectStageCost } from '../core/victory';
import { incited, inciteExposed, inciteStrength } from '../core/incite';
import { hegemonOf, influenceOf, tourGain } from '../core/influence';
import { opinion, strengthOf } from '../core/relations';
import { allied, atWar, hasPact } from '../core/state';
import { hegemonyLeader } from '../core/victory';
import { exec, myCities, visibleEnemies, type BotContext } from './context';
import { createContext } from './context';
import { inciteForecast } from './incite';
import { warReadiness } from './war';

const cfg = aiConfig.paths;

/** Город для проекта: уже начатый или самый крупный (столица при равенстве). */
function projectSite(ctx: BotContext, kind: ProjectKind): number | null {
  const started = projectCity(ctx.state, ctx.power, kind);
  if (started) return started.id;
  const cities = myCities(ctx).sort((a, b) => b.level - a.level || Number(b.isCapital) - Number(a.isCapital) || a.id - b.id);
  return cities[0]?.id ?? null;
}

/** Выкупает этапы финальных проектов, когда хватает очков. */
export function projectsTurn(ctx: BotContext): void {
  const site = projectSite(ctx, 'science');
  if (site !== null && !projectBlocker(ctx.state, ctx.power, site, 'science')) {
    exec(ctx, { type: 'BuyProjectStage', power: ctx.power, cityId: site, kind: 'science' });
  }
}

/** Сколько очков пути держать в запасе на следующий этап проекта. */
export function pathReserve(ctx: BotContext, path: 'science' | 'culture'): number {
  const { state, power } = ctx;
  const p = state.powers[power];
  // Копить есть смысл только науку на Великий проект: культура побеждает гегемонией, а не выкупом.
  if (path !== 'science' || epochOf(p) < LAST_EPOCH) return 0;
  const site = projectSite(ctx, 'science');
  const city = site !== null ? myCities(ctx).find((c) => c.id === site) : undefined;
  return city ? (projectStageCost(city, 'science') ?? 0) : 0;
}

function tryUse(ctx: BotContext, ability: AbilityId, target: Partial<AbilityUse> = {}, extraReserve = 0): boolean {
  const use: AbilityUse = { ...NO_TARGET, ...target, ability };
  if (abilityBlocker(ctx.state, ctx.power, use)) return false;
  const p = ctx.state.powers[ctx.power];
  const path = pathsConfig.abilities[ability].path as 'science' | 'culture';
  const have = path === 'science' ? p.science : p.culture;
  if (have - abilityCost(ctx.state, ctx.power, use) < pathReserve(ctx, path) + extraReserve) return false;
  return exec(ctx, { type: 'UseAbility', power: ctx.power, ...use });
}

/** Способности: праздник при недовольстве, призыв к миру против сильного агрессора, пропаганда и
 *  переманивание на войне, модерация города под давлением, саботаж сети культурного врага. */
export function abilitiesTurn(ctx: BotContext): void {
  const { state, power } = ctx;
  const p = state.powers[power];
  if (p.stability < cfg.holidayBelow) tryUse(ctx, 'holiday');

  for (const enemy of p.wars) {
    // Напали на нас, и враг сильнее — зовём мировое мнение.
    if (findPact(state, power, enemy, 'war')?.by === enemy && blocStrength(state, enemy) > blocStrength(state, power)) {
      if (tryUse(ctx, 'callPeace', { target: state.powers[enemy].suzerain === NONE ? enemy : state.powers[enemy].suzerain, victim: power })) break;
    }
  }
  const strongest = [...p.wars].sort((a, b) => blocStrength(state, b) - blocStrength(state, a))[0];
  if (strongest !== undefined) tryUse(ctx, 'propaganda', { target: strongest }, cfg.propagandaReserve);

  const owner = state.territory.owner;
  const size = mapSize(state);
  const convertible = visibleEnemies(ctx)
    .filter((u) => isMilitary(u) && unitPeople(u) >= 2 && (owner[u.tile] === power || neighbors(size, u.tile).some((n) => owner[n] === power)))
    .sort((a, b) => b.strength - a.strength);
  for (const u of convertible.slice(0, 2)) if (tryUse(ctx, 'convert', { unitId: u.id }, cfg.convertReserve)) break;

  // Модерация контента — городу, который вот-вот уйдёт под культурным давлением или мятежом.
  const culture = pathsConfig.culture;
  for (const c of myCities(ctx)) {
    if (c.moderationTurns > 0) continue;
    const pressed = c.pressureFrom !== NONE && c.pressure >= culture.pressureThreshold / 2;
    const revolting = c.revoltFrom !== NONE && c.revoltProgress >= culture.revoltTurns / 2;
    if (pressed || revolting) tryUse(ctx, 'moderation', { cityId: c.id });
  }

  // Саботаж сети: отключить культуру самому культурному известному городу врага.
  const off = pathsConfig.abilities.sabotage.buildings as string[];
  const cultured = (c: { buildings: string[] }) => c.buildings.filter((b) => off.includes(b)).length;
  const target = state.cities
    .filter((c) => p.wars.includes(c.owner) && p.explored[c.tile] && c.disabledTurns === 0 && cultured(c) > 0)
    .sort((a, b) => cultured(b) - cultured(a) || a.id - b.id)[0];
  if (target) tryUse(ctx, 'sabotage', { cityId: target.id });

  scienceShieldTurn(ctx);
  inciteTurn(ctx);
  toursTurn(ctx);
}

type Character = keyof typeof cfg.tourReserve;
const characterOf = (ctx: BotContext) => (ctx.state.powers[ctx.power].character ?? 'diplomat') as Character;

/** Деанон, когда против нас или союзников есть интриги; глушилка на себя, когда чужое влияние близко к гегемонии,
 *  и на ту державу, гегемонию над которой удерживает лидер культурного отсчёта. */
function scienceShieldTurn(ctx: BotContext): void {
  const { state, power } = ctx;
  tryUse(ctx, 'deanon');
  const me = state.powers[power];
  const pressing = me.influence.some((v, from) => from !== power && (v ?? 0) >= cfg.jamShare && state.powers[from]?.alive);
  if (pressing) tryUse(ctx, 'jammer', { target: power });
  const leader = hegemonyLeader(state);
  if (leader === NONE || leader === power || !me.met.includes(leader)) return;
  const held = state.powers
    .filter((p) => p.alive && p.id !== leader && me.met.includes(p.id) && hegemonOf(state, p.id) === leader)
    .sort((a, b) => influenceOf(state, a.id, leader) - influenceOf(state, b.id, leader) || a.id - b.id)[0];
  if (held) tryUse(ctx, 'jammer', { target: held.id });
}

/** Гастроли: туда, где своя доля ближе всего к гегемонии, но ещё не закреплена. */
function toursTurn(ctx: BotContext): void {
  const { state, power } = ctx;
  let reserve = cfg.tourReserve[characterOf(ctx)];
  // Есть кого натравить — сначала копим на подстрекательство, гастроли из остатка.
  const inciter = cfg.inciteReserve[characterOf(ctx)] < cfg.tourReserve.isolationist;
  if (inciter && state.powers[power].met.some((a) => !state.powers[a].isHuman && state.powers[a].alive && inciteStrength(state, power, a) > 0)) {
    reserve += pathsConfig.abilities.incite.cost;
  }
  const targets = state.powers[power].met
    .filter((t) => state.powers[t].alive && !atWar(state, power, t) && influenceOf(state, t, power) < cfg.tourSecureShare)
    .filter((t) => tourGain(state, power, t) >= cfg.tourMinGain)
    .sort((a, b) => influenceOf(state, b, power) - influenceOf(state, a, power) || a - b);
  for (const t of targets) if (tryUse(ctx, 'tour', { target: t }, reserve)) break;
}

/** Кого бот хочет стравить: врагов, лидера культурного отсчёта, тех, кого не любит. */
function inciteVictims(ctx: BotContext): number[] {
  const { state, power } = ctx;
  const me = state.powers[power];
  const list = [...me.wars];
  const leader = hegemonyLeader(state);
  if (leader !== NONE && leader !== power) list.push(leader);
  const disliked = me.met
    .filter((t) => state.powers[t].alive && opinion(state, power, t).total < 0)
    .sort((a, b) => opinion(state, power, a).total - opinion(state, power, b).total);
  list.push(...disliked);
  // Самые опасные соперники: сильнейшая армия и ближайший к научной победе.
  const rivals = me.met.filter((t) => state.powers[t].alive);
  const top = (score: (t: number) => number) => [...rivals].sort((a, b) => score(b) - score(a) || a - b)[0];
  if (rivals.length) list.push(top((t) => strengthOf(state, t)), top((t) => state.powers[t].scienceTotal));
  return [...new Set(list)].filter((b) => me.met.includes(b) && state.powers[b].alive && !allied(state, power, b) && state.powers[b].suzerain !== power);
}

/** Подстрекательство: только если прогноз обещает войну и нас не раскроют. Прогноз дорогой — проверяем немного пар. */
function inciteTurn(ctx: BotContext): void {
  const { state, power } = ctx;
  const reserve = cfg.inciteReserve[characterOf(ctx)];
  const p = state.powers[power];
  if (p.culture < pathReserve(ctx, 'culture') + reserve + pathsConfig.abilities.incite.cost * pathsConfig.abilities.incite.sizeMin) return;
  const agents = p.met
    .filter((a) => !state.powers[a].isHuman && state.powers[a].alive && inciteStrength(state, power, a) > 0)
    .sort((a, b) => strengthOf(state, b) - strengthOf(state, a) || a - b);
  let checked = 0;
  const ready: boolean[] = [];
  for (const b of inciteVictims(ctx)) {
    for (const a of agents) {
      if (a === b || state.powers[a].suzerain === power || state.powers[b].suzerain === a || incited(state, a, b) || inciteExposed(state, power, b) || hasPact(state, a, b, 'truce')) continue;
      if (ready[a] === undefined) ready[a] = warReadiness(createContext(state, a, Infinity)) === null;
      if (!ready[a]) continue;
      const use: AbilityUse = { ...NO_TARGET, ability: 'incite', target: a, victim: b };
      if (abilityBlocker(state, power, use)) continue;
      if (p.culture - abilityCost(state, power, use) < pathReserve(ctx, 'culture') + reserve) continue;
      if (++checked > cfg.inciteCandidates) return;
      const f = inciteForecast(state, power, a, b);
      if (f.war && !f.exposed) {
        exec(ctx, { type: 'UseAbility', power, ...use });
        return;
      }
    }
  }
}
