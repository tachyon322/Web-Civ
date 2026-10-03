// Боты: по очереди играют ходы всех держав, кроме игрока. Работают на копии состояния
// (в Web Worker) и отдают список команд, который основной поток применяет через ядро.

import type { Command } from '../core/commands';
import { aiConfig } from '../core/data';
import type { GameState } from '../core/types';
import { playBotTurn } from './bot';

export interface RunBotsOptions {
  /** Бюджет времени на всех ботов, мс. */
  budgetMs?: number;
  /** Играть и за игрока (симуляция). */
  includeHuman?: boolean;
}

export function runBots(state: GameState, options: RunBotsOptions = {}): Command[] {
  const budget = options.budgetMs ?? aiConfig.turnBudgetMs;
  const start = performance.now();
  const bots = state.powers.filter((p) => p.alive && (options.includeHuman || !p.isHuman)).map((p) => p.id);
  const commands: Command[] = [];
  bots.forEach((power, i) => {
    // Каждый бот получает равную долю оставшегося времени.
    const now = performance.now();
    const deadline = now + (budget - (now - start)) / (bots.length - i);
    commands.push(...playBotTurn(state, power, deadline));
  });
  return commands;
}

export { playBotTurn };
