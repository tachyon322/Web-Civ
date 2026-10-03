// Решение о войне: бот сравнивает свою армию с индексом сдерживания цели и смотрит, есть ли что взять рядом.

import { aiConfig } from '../core/data';
import { armyStrength, deterrenceIndex } from '../core/deterrence';
import { hasMet } from '../core/diplomacy';
import { distance } from '../core/hex';
import { atWar, mapSize } from '../core/state';
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
  const army = armyStrength(state, power);
  if (army < cfg.minArmy) return null;
  const threshold = warThreshold(ctx);
  let best: number | null = null;
  let bestScore = 0;
  for (const other of state.powers) {
    if (other.id === power || !other.alive || !hasMet(state, power, other.id) || atWar(state, power, other.id)) continue;
    const { gain } = warGain(ctx, other.id);
    if (gain <= 0) continue;
    // Цель, которая уже с кем-то воюет, не может бросить на нас всю армию.
    const busy = 1 + cfg.busyTargetDiscount * other.wars.length;
    const risk = Math.max(1, deterrenceIndex(state, other.id).total / busy);
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
