// Армия бота: бьёт только по выгодному прогнозу, держит гарнизоны в угрожаемых городах,
// собирает силы у ближайшего своего города и идёт на штурм, когда их достаточно.

import { choiceBlocker, type CaptureChoice } from '../core/capture';
import { attackBlocker, cityStrength, forecastAttack, type CombatForecast } from '../core/combat';
import { aiConfig, balance, unitDef } from '../core/data';
import { armyStrength } from '../core/deterrence';
import { distance, neighbors, range } from '../core/hex';
import { canStop, enemyZocMap, reachableTiles } from '../core/pathfinding';
import { atWar, cityAt, isLand, isMilitary, mapSize, unitAt, unitMaxStrength } from '../core/state';
import { MILITARY_TYPES, type City, type MilitaryType, type Unit } from '../core/types';
import {
  atWarWithAnyone,
  exec,
  grossGoldIncome,
  knownForeignCities,
  myCities,
  myUnits,
  nearest,
  outOfTime,
  threatNear,
  visible,
  visibleEnemies,
  type BotContext,
} from './context';
import { mergeRecruits } from './settlers';

const cfg = aiConfig.military;

/**
 * Сколько силы армии бот хочет держать: не меньше нормы на город и доли дохода по характеру
 * (содержание — 1 золото за человека, так что доля дохода — это доля бюджета на армию).
 */
export function desiredArmy(ctx: BotContext): number {
  const cities = myCities(ctx);
  const early = ctx.state.turn < aiConfig.war.minTurn;
  const perCity = ctx.character.armyPerCity * cities.length * (early ? 0.5 : 1);
  // Когда в казне лишнее золото, на армию идёт большая доля дохода.
  const rich = ctx.state.powers[ctx.power].gold > aiConfig.economy.stockpile;
  const share = rich ? ctx.character.armyIncomeShareRich : ctx.character.armyIncomeShare;
  const byIncome = early ? 0 : share * grossGoldIncome(ctx);
  let want = Math.max(perCity, byIncome);
  if (atWarWithAnyone(ctx)) want *= 1.5;
  for (const c of cities) want += threatNear(ctx, c.tile, cfg.threatRadius + 1);
  return want;
}

export function armyNeed(ctx: BotContext): number {
  return desiredArmy(ctx) - armyStrength(ctx.state, ctx.power);
}

/** Тип нового военного: доли характера плюс ответ на то, что бот видит у врагов. */
export function chooseUnitType(ctx: BotContext): MilitaryType {
  const counters = balance.combat.counters as Record<string, string>;
  const mine = myUnits(ctx).filter(isMilitary);
  const enemies = visibleEnemies(ctx).filter(isMilitary);
  const share = (list: Unit[], t: string) => (list.length ? list.filter((u) => u.type === t).length / list.length : 0);
  let best: MilitaryType = 'warrior';
  let bestScore = -Infinity;
  for (const t of MILITARY_TYPES) {
    const score = ctx.character.unitShares[t] - share(mine, t) + 0.5 * share(enemies, counters[t]);
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

/** Польза атаки по прогнозу; отрицательная — не атаковать. */
export function attackValue(f: CombatForecast): number {
  if (f.attackerDies) return -1;
  if (f.target === 'city') return f.ratio >= 1 ? 1 + f.defender.before - f.defender.after : -1;
  const dealt = f.defender.before - f.defender.after;
  const taken = f.attacker.before - f.attacker.after;
  if (!f.defenderDies && f.attacker.after < f.attacker.max * 0.3) return -1;
  return dealt + (f.defenderDies ? f.defender.max * 0.5 : 0) - taken * 1.1;
}

/** Сила юнита в атаке на город: лучнику бонус, звёздам — свой. */
export function strengthVsCity(u: Unit): number {
  const c = balance.combat;
  return u.strength * (u.type === 'archer' ? 1 + c.archerVsCityBonus : 1) * (1 + c.starBonus * u.stars);
}

/** Уровень, с которого лучник пробивает город такой силы (не выше потолка пирамиды). */
export function breachLevel(cityStr: number): number {
  const bonus = 1 + balance.combat.archerVsCityBonus;
  let level = 1;
  while (level < balance.units.maxLevel && 2 ** (level - 1) * bonus < cityStr) level++;
  return level;
}

/** Цели, по которым юнит в принципе может бить: видимые враги и вражеские города. */
function targetTiles(ctx: BotContext): number[] {
  const vis = visible(ctx);
  const tiles = visibleEnemies(ctx).map((u) => u.tile);
  for (const c of knownForeignCities(ctx)) {
    if (vis[c.tile] && atWar(ctx.state, ctx.power, c.owner) && !tiles.includes(c.tile)) tiles.push(c.tile);
  }
  return tiles;
}

function bestAttack(ctx: BotContext, u: Unit, tiles: number[]): { tile: number; value: number } | null {
  let best: { tile: number; value: number } | null = null;
  for (const t of tiles) {
    if (attackBlocker(ctx.state, u, t)) continue;
    const value = attackValue(forecastAttack(ctx.state, u, t));
    if (value > cfg.attackValueMin && (!best || value > best.value)) best = { tile: t, value };
  }
  return best;
}

function captureChoice(ctx: BotContext, u: Unit, city: City): CaptureChoice {
  // При низкой стабильности ещё один присоединённый город опасен — бот грабит.
  const unrest = ctx.state.powers[ctx.power].stability < aiConfig.paths.plunderBelow;
  const preferred = (unrest && !city.isCapital ? 'plunder' : ctx.character.capture) as CaptureChoice;
  // Столицы всегда присоединяют.
  if (city.isCapital || choiceBlocker(ctx.state, u, city, preferred)) return 'annex';
  return preferred;
}

/** Захват соседнего города с прочностью 0. */
function tryCapture(ctx: BotContext, u: Unit): boolean {
  if (!unitDef(u.type).canCapture || u.mp <= 0) return false;
  for (const n of neighbors(mapSize(ctx.state), u.tile)) {
    const city = cityAt(ctx.state, n);
    if (!city || city.owner === ctx.power || city.durability > 0 || unitAt(ctx.state, n)) continue;
    if (!atWar(ctx.state, ctx.power, city.owner)) continue;
    if (exec(ctx, { type: 'CaptureCity', power: ctx.power, unitId: u.id, cityId: city.id, choice: captureChoice(ctx, u, city) })) {
      return true;
    }
  }
  return false;
}

function tryAttack(ctx: BotContext, u: Unit): boolean {
  if (u.mp <= 0) return false;
  const best = bestAttack(ctx, u, targetTiles(ctx));
  return best !== null && exec(ctx, { type: 'Attack', power: ctx.power, unitId: u.id, target: best.tile });
}

/** Действие с места: захват или атака. */
function act(ctx: BotContext, u: Unit): boolean {
  if (!ctx.state.units.includes(u)) return true;
  return tryCapture(ctx, u) || tryAttack(ctx, u);
}

/**
 * Подойти и ударить в этом же ходу: клетка в досягаемости, вне зоны контроля врага
 * (иначе движение закончится), с очками хода на атаку.
 */
function strikeMove(ctx: BotContext, u: Unit, maxTargetDistance = Infinity): boolean {
  if (u.mp <= 0 || outOfTime(ctx)) return false;
  const size = mapSize(ctx.state);
  const reach = unitDef(u.type).range;
  const targets = targetTiles(ctx)
    .filter((t) => distance(size, u.tile, t) <= Math.min(u.mp + reach, maxTargetDistance))
    .map((t) => {
      const owner = unitAt(ctx.state, t)?.owner ?? cityAt(ctx.state, t)!.owner;
      if (!atWar(ctx.state, ctx.power, owner)) return { t, value: -1 };
      return { t, value: attackValue(forecastAttack(ctx.state, u, t)) };
    })
    .filter((x) => x.value > cfg.attackValueMin)
    .sort((a, b) => b.value - a.value);
  if (!targets.length) return false;
  const tiles = reachableTiles(ctx.state, u);
  const zoc = enemyZocMap(ctx.state, u);
  for (const { t: target } of targets.slice(0, 3)) {
    let spot = -1;
    let spotCost = Infinity;
    for (const [t, cost] of tiles) {
      const d = distance(size, t, target);
      if (zoc[t] || u.mp - cost <= 0 || d < 1 || d > reach || !isLand(ctx.state, t)) continue;
      if (cost < spotCost) {
        spot = t;
        spotCost = cost;
      }
    }
    if (spot < 0) continue;
    if (!exec(ctx, { type: 'Move', power: ctx.power, unitId: u.id, target: spot })) continue;
    return act(ctx, u) || true;
  }
  return false;
}

/** Подойти к цели на расстояние dist (ближайшая к юниту свободная клетка). */
function approach(ctx: BotContext, u: Unit, goal: number, dist: number): boolean {
  if (u.mp <= 0 || u.tile === goal) return false;
  const size = mapSize(ctx.state);
  if (dist > 0 && distance(size, u.tile, goal) <= dist && distance(size, u.tile, goal) > 0) return false;
  const spots = (dist === 0 ? [goal] : range(size, goal, dist).filter((t) => t !== goal))
    .filter((t) => t !== u.tile && isLand(ctx.state, t) && canStop(ctx.state, u, t) && !ctx.reserved.has(t))
    .sort((a, b) => distance(size, u.tile, a) - distance(size, u.tile, b) || a - b);
  for (const t of spots.slice(0, 4)) {
    if (exec(ctx, { type: 'Move', power: ctx.power, unitId: u.id, target: t })) {
      ctx.reserved.add(t);
      return true;
    }
  }
  return false;
}

/**
 * Куда идти, если вражеских городов не видно: ближайшая известная клетка врага,
 * а если о нём ничего не известно — ближайшая неразведанная суша.
 */
export function scoutGoal(ctx: BotContext): number | null {
  const { state, power } = ctx;
  const capital = myCities(ctx)[0];
  if (!capital) return null;
  const size = mapSize(state);
  const explored = state.powers[power].explored;
  const wars = state.powers[power].wars;
  const { owner } = state.territory;
  let best: number | null = null;
  let bestD = Infinity;
  for (let t = 0; t < owner.length; t++) {
    if (!explored[t] || owner[t] === -1 || !wars.includes(owner[t])) continue;
    const d = distance(size, capital.tile, t);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  if (best !== null) return best;
  for (let t = 0; t < owner.length; t++) {
    if (explored[t] || !isLand(state, t)) continue;
    const d = distance(size, capital.tile, t);
    if (d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** Ближайший вражеский город — цель наступления. */
export function chooseTargetCity(ctx: BotContext): City | null {
  const mine = myCities(ctx);
  if (!mine.length) return null;
  const size = mapSize(ctx.state);
  let best: City | null = null;
  let bestScore = Infinity;
  for (const c of knownForeignCities(ctx)) {
    if (!atWar(ctx.state, ctx.power, c.owner)) continue;
    const d = Math.min(...mine.map((m) => distance(size, m.tile, c.tile)));
    const score = d + cityStrength(c);
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

export function militaryTurn(ctx: BotContext, recruitType: MilitaryType): void {
  const { state, power } = ctx;
  const size = mapSize(state);
  const alive = (u: Unit) => state.units.includes(u);
  // Лучники первыми: бьют без ответа и снимают прочность для захвата.
  const units = myUnits(ctx)
    .filter(isMilitary)
    .sort((a, b) => (a.type === 'archer' ? 0 : 1) - (b.type === 'archer' ? 0 : 1) || a.id - b.id);
  if (!units.length) return;

  // 1. Действия с места.
  for (const u of units) {
    if (outOfTime(ctx)) return;
    if (act(ctx, u)) ctx.busy.add(u.id);
  }

  // 2. Раненые отходят лечиться в свой город.
  const cities = myCities(ctx);
  for (const u of units) {
    if (ctx.busy.has(u.id) || !alive(u) || u.strength >= unitMaxStrength(u) * cfg.retreatShare) continue;
    ctx.busy.add(u.id);
    if (cityAt(state, u.tile)?.owner === power) continue;
    const homes = cities.filter((c) => canStop(state, u, c.tile));
    const home = nearest(ctx, u.tile, homes, (c) => c.tile);
    if (home) approach(ctx, u, home.tile, 0);
  }

  // 3. Гарнизоны: угрожаемые города удерживают стоящего в них юнита или зовут ближайшего.
  const threatened = cities.filter((c) => threatNear(ctx, c.tile) > 0);
  for (const c of cities) {
    const here = unitAt(state, c.tile);
    if (here && here.owner === power && isMilitary(here) && threatened.includes(c)) ctx.busy.add(here.id);
  }
  for (const c of threatened) {
    if (unitAt(state, c.tile)) continue;
    const free = units.filter((u) => alive(u) && !ctx.busy.has(u.id) && u.mp > 0 && distance(size, u.tile, c.tile) <= 6);
    const u = nearest(ctx, c.tile, free, (x) => x.tile);
    if (u && approach(ctx, u, c.tile, 0)) ctx.busy.add(u.id);
  }

  // 4. Война: штурм цели или сбор у своего города, ближайшего к ней.
  const target = chooseTargetCity(ctx);
  const free = () => units.filter((u) => alive(u) && !ctx.busy.has(u.id));
  if (target) {
    const staging = nearest(ctx, target.tile, cities, (c) => c.tile);
    const group = free();
    const groupStrength = group.reduce((s, u) => s + u.strength, 0);
    const defenders = visibleEnemies(ctx)
      .filter((e) => isMilitary(e) && distance(size, e.tile, target.tile) <= 2)
      .reduce((s, e) => s + e.strength, 0);
    const cityStr = cityStrength(target);
    const required = cityStr * cfg.assaultRatio + defenders;
    // Без юнита, который сильнее города, штурм не снимет прочность.
    const canBreach = group.some((u) => strengthVsCity(u) >= cityStr);
    if ((groupStrength >= required && canBreach) || !staging) {
      for (const u of group) {
        if (outOfTime(ctx)) return;
        ctx.busy.add(u.id);
        if (strikeMove(ctx, u)) continue;
        const reach = unitDef(u.type).range;
        if (approach(ctx, u, target.tile, reach) && alive(u)) act(ctx, u);
      }
    } else {
      // Сбор: по пути бьём то, что рядом, и сливаем юниты, пока не появится пробивающий город.
      for (const u of group) {
        if (outOfTime(ctx)) return;
        if (strikeMove(ctx, u, 3)) ctx.busy.add(u.id);
      }
      for (const u of free()) {
        if (distance(size, u.tile, staging.tile) > 2) approach(ctx, u, staging.tile, 2);
      }
      const level = breachLevel(cityStr);
      const mergeable = free().filter(
        (u) =>
          u.level < Math.min(level, balance.units.maxLevel) &&
          u.strength >= unitMaxStrength(u) * 0.75 &&
          distance(size, u.tile, staging.tile) <= 3,
      );
      // Пробивать города удобнее лучникам: бонус против городов и нет ответного урона.
      mergeRecruits(ctx, mergeable, canBreach ? recruitType : 'archer');
    }
    return;
  }

  // 4б. Война, но ни одного вражеского города бот не знает: идём на разведку.
  if (atWarWithAnyone(ctx)) {
    const goal = scoutGoal(ctx);
    if (goal !== null) {
      for (const u of free()) {
        if (outOfTime(ctx)) return;
        if (strikeMove(ctx, u, 3)) {
          ctx.busy.add(u.id);
          continue;
        }
        if (unitAt(state, u.tile) === u && cityAt(state, u.tile)?.owner === power && threatNear(ctx, u.tile) > 0) continue;
        if (approach(ctx, u, goal, 1)) ctx.busy.add(u.id);
      }
    }
  }

  // 5. Мир (или врага не видно): бьём подошедших, остальные — гарнизоны городов.
  for (const u of free()) {
    if (outOfTime(ctx)) return;
    if (atWarWithAnyone(ctx) && strikeMove(ctx, u, 4)) ctx.busy.add(u.id);
  }
  const ungarrisoned = cities.filter((c) => !unitAt(state, c.tile));
  for (const c of cities) {
    const here = unitAt(state, c.tile);
    if (here && here.owner === power && isMilitary(here)) ctx.busy.add(here.id);
  }
  for (const c of ungarrisoned) {
    const u = nearest(ctx, c.tile, free().filter((x) => x.mp > 0), (x) => x.tile);
    if (u && approach(ctx, u, c.tile, 0)) ctx.busy.add(u.id);
  }
  // Лишние в мирное время укрупняются, чтобы не держать россыпь слабых юнитов.
  const extra = free();
  if (extra.length >= 2 && units.length > cities.length * 1.5) {
    mergeRecruits(
      ctx,
      extra.filter((u) => u.level <= cfg.mergeMaxLevel && u.strength >= unitMaxStrength(u) * 0.75),
      recruitType,
    );
  }
  for (const u of free()) {
    if (state.territory.owner[u.tile] === power || u.mp <= 0) continue;
    const home = nearest(ctx, u.tile, cities, (c) => c.tile);
    if (home) approach(ctx, u, home.tile, 2);
  }
}
