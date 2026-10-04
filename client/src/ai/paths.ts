// Пути бота: финальные проекты и способности науки и культуры. Наука и культура — и счёт к победе,
// и валюта: в последней эпохе (или с тремя чудесами) бот копит на этапы проекта и тратит только лишнее.

import { NO_TARGET, abilityBlocker, abilityCost, sabotageTarget, type AbilityUse } from '../core/abilities';
import { cityStrength } from '../core/combat';
import { aiConfig, pathsConfig, type AbilityId } from '../core/data';
import { blocStrength } from '../core/diplomacy';
import { LAST_EPOCH, epochOf } from '../core/epochs';
import { distance, neighbors } from '../core/hex';
import { findPact, isMilitary, mapSize, unitPeople } from '../core/state';
import { wondersOwned } from '../core/buildings';
import { NONE, type ProjectKind } from '../core/types';
import { projectBlocker, projectCity, projectStageCost } from '../core/victory';
import { exec, myCities, threatNear, visibleEnemies, type BotContext } from './context';

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
  for (const kind of ['science', 'culture'] as const) {
    const site = projectSite(ctx, kind);
    if (site === null || projectBlocker(ctx.state, ctx.power, site, kind)) continue;
    exec(ctx, { type: 'BuyProjectStage', power: ctx.power, cityId: site, kind });
  }
}

/** Сколько очков пути держать в запасе на следующий этап проекта. */
export function pathReserve(ctx: BotContext, path: 'science' | 'culture'): number {
  const { state, power } = ctx;
  const p = state.powers[power];
  const eligible = path === 'science' ? epochOf(p) >= LAST_EPOCH : wondersOwned(state, power) >= pathsConfig.projects.culture.wonders;
  if (!eligible) return 0;
  const site = projectSite(ctx, path);
  const city = site !== null ? myCities(ctx).find((c) => c.id === site) : undefined;
  return city ? (projectStageCost(city, path) ?? 0) : 0;
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
 *  переманивание на войне, фортификация угрожаемого города, оружие сдерживания в последней эпохе. */
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

  for (const c of myCities(ctx)) {
    if (c.fortifyTurns > 0 || c.durability > 1) continue;
    if (threatNear(ctx, c.tile) > cityStrength(c)) tryUse(ctx, 'fortify', { cityId: c.id });
  }

  // Саботаж стен у вражеского города, к которому подошла наша армия, — помогает штурму.
  const army = state.units.filter((u) => u.owner === power && isMilitary(u));
  const besieged = state.cities.find(
    (c) =>
      p.wars.includes(c.owner) &&
      p.explored[c.tile] &&
      c.buildings.includes('walls') &&
      army.some((u) => distance(size, u.tile, c.tile) <= 3),
  );
  if (besieged) tryUse(ctx, 'sabotage', { cityId: besieged.id, building: sabotageTarget(besieged) ?? 'walls' });

  const def = pathsConfig.abilities.deterrent;
  if (p.science >= def.cost * cfg.deterrentReserve) tryUse(ctx, 'deterrent');
}
