// Жители бота: основывают города на хороших местах, размечают землю вокруг городов,
// а лишние, когда нужна армия, сливаются в военных.

import { aiConfig, balance, pathsConfig } from '../core/data';
import { foundCityPrice } from '../core/economy';
import { distance, neighbors, range } from '../core/hex';
import { canStop } from '../core/pathfinding';
import { isLand, mapSize, terrainMoveCost } from '../core/state';
import { freeCities } from '../core/stability';
import { checkClaim } from '../core/territory';
import { NONE, S_NONE, type MilitaryType, type Unit } from '../core/types';
import {
  exec,
  goldIncome,
  knownForeignCities,
  myCities,
  myUnits,
  nearest,
  outOfTime,
  threatNear,
  type BotContext,
} from './context';

export interface Site {
  tile: number;
  score: number;
}

/** Места под новый город на разведанной земле: свободная суша вокруг и особые клетки. */
export function findSites(ctx: BotContext): Site[] {
  const { state, power } = ctx;
  const cfg = aiConfig.settle;
  const size = mapSize(state);
  const explored = state.powers[power].explored;
  const { owner } = state.territory;
  const mine = myCities(ctx);
  const foreign = knownForeignCities(ctx);
  const known = [...mine, ...foreign];
  const min = balance.city.minDistanceBetweenCities;

  const candidates = new Set<number>();
  for (const c of mine) for (const t of range(size, c.tile, cfg.searchRadius)) candidates.add(t);
  const sites: Site[] = [];
  for (const t of candidates) {
    if (!explored[t] || !isLand(state, t) || terrainMoveCost(state, t) === null) continue;
    if (owner[t] !== NONE && owner[t] !== power) continue;
    if (known.some((c) => distance(size, c.tile, t) < min)) continue;
    if (foreign.some((c) => distance(size, c.tile, t) < cfg.foreignCityDistance)) continue;
    let score = 0;
    for (const n of range(size, t, cfg.siteRadius)) {
      if (!explored[n] || !isLand(state, n) || owner[n] !== NONE) continue;
      score += 1 + (state.map.special[n] !== S_NONE ? cfg.specialScore : 0);
    }
    if (score >= cfg.minScore) sites.push({ tile: t, score });
  }
  return sites.sort((a, b) => b.score - a.score || a.tile - b.tile);
}

/** Новый город сверх бесплатных снизит стабильность — бот не опускает её ниже порога. */
export function canExpand(ctx: BotContext): boolean {
  const { state, power } = ctx;
  const p = state.powers[power];
  const free = freeCities(state, power);
  if (myCities(ctx).length < free) return true;
  return p.stability + pathsConfig.stability.extraCity >= aiConfig.paths.minStabilityToExpand;
}

/** Сколько жителей могут одновременно идти основывать города. */
export function settlersAllowed(ctx: BotContext, sites: Site[]): number {
  if (!sites.length || !canExpand(ctx)) return 0;
  const price = foundCityPrice(ctx.state, ctx.power);
  const gold = ctx.state.powers[ctx.power].gold;
  // Идём, только если к приходу на место золота хватит.
  const affordable = gold + Math.max(0, goldIncome(ctx)) * 6 >= price;
  return affordable ? Math.max(1, Math.round((1 + Math.floor(myCities(ctx).length / 3)) * ctx.character.expansion)) : 0;
}

/** Клетки, которые можно разметить прямо сейчас (граничат с территорией, у города есть лимит). */
export function claimableTiles(ctx: BotContext): number[] {
  const { state, power } = ctx;
  const size = mapSize(state);
  const { owner } = state.territory;
  const result = new Set<number>();
  for (let t = 0; t < owner.length; t++) {
    if (owner[t] !== power) continue;
    for (const n of neighbors(size, t)) {
      if (owner[n] === NONE && isLand(state, n) && !result.has(n) && checkClaim(state, power, n).ok) result.add(n);
    }
  }
  return [...result];
}

function isSettler(unit: Unit, siteTiles: Set<number>): boolean {
  return unit.routeTarget !== NONE && siteTiles.has(unit.routeTarget);
}

/** Сайт конфликтует с уже выбранным: города встали бы слишком близко. */
function conflicts(ctx: BotContext, tile: number, taken: number[]): boolean {
  const size = mapSize(ctx.state);
  return taken.some((t) => distance(size, t, tile) < balance.city.minDistanceBetweenCities);
}

/** Ход жителей. recruitType — в кого сливать лишних, если нужна армия (null — не нужна). */
export function citizensTurn(ctx: BotContext, sites: Site[], recruitType: MilitaryType | null): void {
  const { state, power } = ctx;
  const size = mapSize(state);
  const siteTiles = new Set(sites.map((s) => s.tile));
  let citizens = myUnits(ctx).filter((u) => u.type === 'citizen');
  const taken: number[] = [];

  const allowed = settlersAllowed(ctx, sites);
  let settlers = 0;

  // 1. Основание: житель стоит на хорошем месте и золота хватает; если скоро хватит — ждёт на месте.
  for (const u of citizens) {
    if (!siteTiles.has(u.tile) || conflicts(ctx, u.tile, taken) || !canExpand(ctx)) continue;
    if (exec(ctx, { type: 'FoundCity', power, unitId: u.id })) {
      ctx.busy.add(u.id);
    } else if (settlers < allowed) {
      settlers++;
      ctx.busy.add(u.id);
      taken.push(u.tile);
    }
  }
  citizens = citizens.filter((u) => !ctx.busy.has(u.id) && state.units.includes(u));

  // 2. Уже идущие к месту продолжают путь.
  for (const u of citizens) {
    if (!isSettler(u, siteTiles) || conflicts(ctx, u.routeTarget, taken) || settlers >= allowed) continue;
    if (threatNear(ctx, u.routeTarget) > 0) continue;
    settlers++;
    taken.push(u.routeTarget);
    ctx.busy.add(u.id);
    if (u.mp > 0) exec(ctx, { type: 'Move', power, unitId: u.id, target: u.routeTarget });
  }

  // 3. Новые поселенцы: лучшие места — ближайшим свободным жителям.
  for (const site of sites) {
    if (settlers >= allowed || outOfTime(ctx)) break;
    if (conflicts(ctx, site.tile, taken) || threatNear(ctx, site.tile) > 0) continue;
    const free = citizens.filter((u) => !ctx.busy.has(u.id) && u.mp > 0);
    const u = nearest(ctx, site.tile, free, (x) => x.tile);
    if (!u) break;
    if (distance(size, u.tile, site.tile) > aiConfig.settle.searchRadius + 4) continue;
    if (!exec(ctx, { type: 'Move', power, unitId: u.id, target: site.tile })) continue;
    settlers++;
    taken.push(site.tile);
    ctx.busy.add(u.id);
    // Если дошёл сразу — основывает.
    if (u.tile === site.tile) exec(ctx, { type: 'FoundCity', power, unitId: u.id });
  }

  // 4. Разметка: ближайшая клетка, которую можно забрать (особые клетки — в приоритете).
  const claimable = claimableTiles(ctx);
  for (const u of citizens) {
    if (ctx.busy.has(u.id) || u.mp <= 0 || outOfTime(ctx)) continue;
    const options = claimable
      .filter((t) => !ctx.reserved.has(t) && canStop(state, u, t) && threatNear(ctx, t, 2) === 0)
      .map((t) => ({ t, d: distance(size, u.tile, t) - (state.map.special[t] !== S_NONE ? 2 : 0) }))
      .sort((a, b) => a.d - b.d || a.t - b.t)
      .slice(0, 4);
    for (const { t } of options) {
      if (exec(ctx, { type: 'Move', power, unitId: u.id, target: t })) {
        ctx.reserved.add(t);
        ctx.busy.add(u.id);
        break;
      }
    }
  }

  // 5. Лишние жители: сливаются в военных, если нужна армия, иначе ждут в своих границах.
  const idle = citizens.filter((u) => !ctx.busy.has(u.id) && state.units.includes(u));
  if (recruitType) mergeRecruits(ctx, idle, recruitType);
  for (const u of idle) {
    if (ctx.busy.has(u.id) || u.mp <= 0 || state.territory.owner[u.tile] === power) continue;
    const home = nearest(ctx, u.tile, myCities(ctx), (c) => c.tile);
    if (home) exec(ctx, { type: 'Move', power, unitId: u.id, target: home.tile });
  }
}

/** Попарно сводит юниты одного уровня и сливает их в военного. */
export function mergeRecruits(ctx: BotContext, units: Unit[], into: MilitaryType): void {
  const { state, power } = ctx;
  const size = mapSize(state);
  for (const a of units) {
    if (ctx.busy.has(a.id) || !state.units.includes(a) || outOfTime(ctx)) continue;
    const partners = units.filter((b) => b !== a && b.level === a.level && !ctx.busy.has(b.id) && state.units.includes(b));
    const b = nearest(ctx, a.tile, partners, (x) => x.tile);
    if (!b) continue;
    if (distance(size, a.tile, b.tile) === 1 && a.mp > 0) {
      if (exec(ctx, { type: 'Merge', power, unitId: a.id, targetId: b.id, into })) {
        ctx.busy.add(a.id);
        ctx.busy.add(b.id);
      }
      continue;
    }
    if (a.mp <= 0) continue;
    // Подходит к напарнику; тот стоит на месте.
    const spots = neighbors(size, b.tile)
      .filter((t) => canStop(state, a, t))
      .sort((x, y) => distance(size, a.tile, x) - distance(size, a.tile, y));
    for (const t of spots.slice(0, 3)) {
      if (exec(ctx, { type: 'Move', power, unitId: a.id, target: t })) {
        ctx.busy.add(a.id);
        ctx.busy.add(b.id);
        if (distance(size, a.tile, b.tile) === 1 && a.mp > 0) {
          exec(ctx, { type: 'Merge', power, unitId: a.id, targetId: b.id, into });
        }
        break;
      }
    }
  }
}
