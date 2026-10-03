// Общее для всех решений бота: состояние, характер, выполнение команд и то, что держава знает о мире.
// Бот не жульничает: чужие юниты он видит только в своём обзоре, чужие города — на разведанных клетках.

import { execute, type Command } from '../core/commands';
import { aiConfig, characterDef } from '../core/data';
import { computeIncome } from '../core/economy';
import { distance } from '../core/hex';
import { atWar, citiesOf, isMilitary, mapSize, unitsOf } from '../core/state';
import type { City, GameState, Unit } from '../core/types';
import { computeVisible } from '../core/visibility';

export type CharacterDef = ReturnType<typeof characterDef>;

export interface BotContext {
  state: GameState;
  power: number;
  character: CharacterDef;
  /** Выполненные команды по порядку — их основной поток применит к своему состоянию. */
  commands: Command[];
  /** Момент (performance.now), после которого бот больше ничего не начинает. */
  deadline: number;
  /** Клетки, уже выбранные целью другим юнитом в этом ходу. */
  reserved: Set<number>;
  /** Юниты, которым в этом ходу уже дана задача. */
  busy: Set<number>;
  visibleCache: Uint8Array | null;
}

export function createContext(state: GameState, power: number, deadline: number): BotContext {
  const character = characterDef(state.powers[power].character ?? 'diplomat');
  return { state, power, character, commands: [], deadline, reserved: new Set(), busy: new Set(), visibleCache: null };
}

export function outOfTime(ctx: BotContext): boolean {
  return performance.now() > ctx.deadline;
}

/** Выполняет команду через ядро и запоминает её. */
export function exec(ctx: BotContext, cmd: Command): boolean {
  const v = execute(ctx.state, cmd);
  if (!v.ok) return false;
  ctx.commands.push(cmd);
  ctx.visibleCache = null;
  return true;
}

export function visible(ctx: BotContext): Uint8Array {
  ctx.visibleCache ??= computeVisible(ctx.state, ctx.power);
  return ctx.visibleCache;
}

export function myCities(ctx: BotContext): City[] {
  return citiesOf(ctx.state, ctx.power);
}

export function myUnits(ctx: BotContext): Unit[] {
  return unitsOf(ctx.state, ctx.power);
}

export function goldIncome(ctx: BotContext): number {
  return computeIncome(ctx.state, ctx.power).gold.total;
}

/** Приход золота до вычета содержания юнитов. */
export function grossGoldIncome(ctx: BotContext): number {
  return computeIncome(ctx.state, ctx.power)
    .gold.items.filter((i) => i.value > 0)
    .reduce((sum, i) => sum + i.value, 0);
}

export function atWarWithAnyone(ctx: BotContext): boolean {
  return ctx.state.powers[ctx.power].wars.length > 0;
}

/** Видимые сейчас юниты держав, с которыми идёт война. */
export function visibleEnemies(ctx: BotContext): Unit[] {
  const vis = visible(ctx);
  return ctx.state.units.filter((u) => vis[u.tile] && atWar(ctx.state, ctx.power, u.owner));
}

/** Чужие города на разведанных клетках. */
export function knownForeignCities(ctx: BotContext): City[] {
  const explored = ctx.state.powers[ctx.power].explored;
  return ctx.state.cities.filter((c) => c.owner !== ctx.power && explored[c.tile]);
}

/** Сила видимых вражеских военных рядом с клеткой. */
export function threatNear(ctx: BotContext, tile: number, radius = aiConfig.military.threatRadius): number {
  const size = mapSize(ctx.state);
  return visibleEnemies(ctx)
    .filter((u) => isMilitary(u) && distance(size, u.tile, tile) <= radius)
    .reduce((sum, u) => sum + u.strength, 0);
}

/** Ближайший к клетке элемент списка по расстоянию на гексах. */
export function nearest<T>(ctx: BotContext, tile: number, items: T[], tileOf: (x: T) => number): T | null {
  const size = mapSize(ctx.state);
  let best: T | null = null;
  let bestD = Infinity;
  for (const x of items) {
    const d = distance(size, tile, tileOf(x));
    if (d < bestD) {
      best = x;
      bestD = d;
    }
  }
  return best;
}
