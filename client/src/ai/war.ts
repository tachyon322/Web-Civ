// Решение о войне: бот сравнивает свою армию с индексом сдерживания цели (вместе с её сюзереном,
// вассалами и союзниками, которые вступятся) и смотрит, есть ли что взять рядом.
// Не нападает на союзников и тех, кто ему нравится; договор нарушает только агрессор.
// Подстрекательство снижает порог против цели, а агрессора толкает даже на союзника.

import { aiConfig } from '../core/data';
import { armyStrength, deterrenceIndex } from '../core/deterrence';
import { warBlocker, warSides } from '../core/diplomacy';
import { distance } from '../core/hex';
import { incited, inciteWarFactor } from '../core/incite';
import { opinion } from '../core/relations';
import { allied, hasPact, mapSize, vassalsOf } from '../core/state';
import type { City } from '../core/types';
import { exec, knownForeignCities, myCities, type BotContext } from './context';

/** Выгода войны: уровни известных городов цели в досягаемости от своих городов. */
export function warGain(ctx: BotContext, target: number): { gain: number; cities: City[] } {
  const size = mapSize(ctx.state);
  const mine = myCities(ctx);
  const cities = knownForeignCities(ctx).filter(
    (c) => c.owner === target && mine.some((m) => distance(size, m.tile, c.tile) <= aiConfig.war.reach),
  );
  return { gain: cities.reduce((sum, c) => sum + c.level + (c.isCapital ? 1 : 0), 0), cities };
}

/** Во сколько раз армия должна превосходить индекс сдерживания цели. */
export function warThreshold(ctx: BotContext): number {
  return ctx.character.warRatio * aiConfig.difficulty[ctx.state.settings.difficulty].warRatioFactor;
}

/** Оценка войны с одной целью: счёт (чем больше, тем привлекательнее) или причина, почему нет. */
export type WarAssessment = { score: number } | { reason: string };

/** Общие условия: можно ли боту сейчас вообще начинать войну; null — можно. */
export function warReadiness(ctx: BotContext): string | null {
  const { state, power } = ctx;
  const cfg = aiConfig.war;
  if (state.turn < cfg.minTurn) return `рано: войны начинаются не раньше ${cfg.minTurn}-го хода`;
  if (state.powers[power].wars.length >= cfg.maxOffensiveWars) return 'уже воюет и новую войну не начнёт';
  if (botArmy(ctx) < cfg.minArmy) return 'армия слишком мала для войны';
  return null;
}

function botArmy(ctx: BotContext): number {
  return [ctx.power, ...vassalsOf(ctx.state, ctx.power)].reduce((sum, p) => sum + armyStrength(ctx.state, p), 0);
}

export function assessWar(ctx: BotContext, target: number): WarAssessment {
  const { state, power } = ctx;
  const cfg = aiConfig.war;
  const other = state.powers[target];
  const blocker = target === power || !other.alive ? 'нельзя' : warBlocker(state, power, target);
  if (blocker) return { reason: blocker.toLowerCase() };
  // Подстрекательство снижает порог и толкает агрессора даже на союзника.
  const pushed = incited(state, power, target);
  if (allied(state, power, target) && !(pushed && ctx.character.breaksTreaties)) return { reason: 'это союзник' };
  if (hasPact(state, power, target, 'trade') && !ctx.character.breaksTreaties) return { reason: 'не нарушит торговый договор' };
  const leader = target === state.coalitionLeader;
  // Новая война добавит усталости — при низкой стабильности бот не рискует (кроме войны с лидером).
  if (state.powers[power].stability < aiConfig.paths.warStabilityMin && !leader) return { reason: 'стабильность слишком низкая' };
  const op = opinion(state, power, target).total;
  if (!leader && op > ctx.character.warOpinionMax) return { reason: `отношение к цели слишком хорошее (${op}, нужно не выше ${ctx.character.warOpinionMax})` };
  const { gain } = warGain(ctx, target);
  if (gain <= 0) return { reason: 'не знает городов цели в досягаемости' };
  // Вступятся сюзерен, вассалы и союзники цели. Кто уже с кем-то воюет, не бросит на нас всю армию.
  const sides = warSides(state, power, target);
  const risk = Math.max(
    1,
    [...sides.defenders, ...sides.allies].reduce((sum, p) => {
      const busy = 1 + cfg.busyTargetDiscount * state.powers[p].wars.length;
      return sum + deterrenceIndex(state, p).total / busy;
    }, 0),
  );
  // Против того, кто близок к победе, бот идёт охотнее.
  const threshold = warThreshold(ctx) * (leader ? aiConfig.diplomacy.leaderWarFactor : 1) * inciteWarFactor(state, power, target);
  const army = botArmy(ctx);
  const need = risk * threshold;
  if (army < need) return { reason: `армии не хватает ~${Math.ceil((1 - army / need) * 100)}%` };
  // Чем слабее цель и богаче добыча, тем лучше.
  return { score: (gain * army) / risk };
}

/** Кому бот объявил бы войну сейчас; null — никому. */
export function chooseWarTarget(ctx: BotContext): number | null {
  if (warReadiness(ctx)) return null;
  let best: number | null = null;
  let bestScore = 0;
  for (const other of ctx.state.powers) {
    const a = assessWar(ctx, other.id);
    if ('score' in a && a.score > bestScore) {
      best = other.id;
      bestScore = a.score;
    }
  }
  return best;
}

export function decideWar(ctx: BotContext): void {
  const target = chooseWarTarget(ctx);
  if (target !== null) exec(ctx, { type: 'DeclareWar', power: ctx.power, target });
}
