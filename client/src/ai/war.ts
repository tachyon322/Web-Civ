// Решение о войне: бот сравнивает свою армию с индексом сдерживания цели (вместе с её сюзереном,
// вассалами и союзниками, которые вступятся) и смотрит, есть ли что взять рядом.
// Не нападает на союзников и тех, кто ему нравится; договор нарушает только агрессор.

import { aiConfig } from '../core/data';
import { armyStrength, deterrenceIndex } from '../core/deterrence';
import { warBlocker, warSides } from '../core/diplomacy';
import { distance } from '../core/hex';
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

/** Кому бот объявил бы войну сейчас; null — никому. */
export function chooseWarTarget(ctx: BotContext): number | null {
  const { state, power } = ctx;
  const cfg = aiConfig.war;
  if (state.turn < cfg.minTurn) return null;
  if (state.powers[power].wars.length >= cfg.maxOffensiveWars) return null;
  // Новая война добавит усталости — при низкой стабильности бот не рискует (кроме войны с лидером).
  const calm = state.powers[power].stability >= aiConfig.paths.warStabilityMin;
  const army = [power, ...vassalsOf(state, power)].reduce((sum, p) => sum + armyStrength(state, p), 0);
  if (army < cfg.minArmy) return null;
  let best: number | null = null;
  let bestScore = 0;
  for (const other of state.powers) {
    if (other.id === power || !other.alive || warBlocker(state, power, other.id)) continue;
    if (allied(state, power, other.id)) continue;
    if (hasPact(state, power, other.id, 'trade') && !ctx.character.breaksTreaties) continue;
    const leader = other.id === state.coalitionLeader;
    if (!calm && !leader) continue;
    if (!leader && opinion(state, power, other.id).total > ctx.character.warOpinionMax) continue;
    const { gain } = warGain(ctx, other.id);
    if (gain <= 0) continue;
    // Вступятся сюзерен, вассалы и союзники цели. Кто уже с кем-то воюет, не бросит на нас всю армию.
    const sides = warSides(state, power, other.id);
    const risk = Math.max(
      1,
      [...sides.defenders, ...sides.allies].reduce((sum, p) => {
        const busy = 1 + cfg.busyTargetDiscount * state.powers[p].wars.length;
        return sum + deterrenceIndex(state, p).total / busy;
      }, 0),
    );
    // Против того, кто близок к победе, бот идёт охотнее.
    const threshold = warThreshold(ctx) * (leader ? aiConfig.diplomacy.leaderWarFactor : 1);
    if (army < risk * threshold) continue;
    // Чем слабее цель и богаче добыча, тем лучше.
    const score = (gain * army) / risk;
    if (score > bestScore) {
      best = other.id;
      bestScore = score;
    }
  }
  return best;
}

export function decideWar(ctx: BotContext): void {
  const target = chooseWarTarget(ctx);
  if (target !== null) exec(ctx, { type: 'DeclareWar', power: ctx.power, target });
}
