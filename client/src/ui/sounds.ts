// Какой звук сопровождает выполненную команду игрока.

import type { Sfx } from '../audio';
import type { Command } from '../core';

/** Покупки: что за них платят, то и звучит. Подарки и обмены в дипломатии покупками не считаются. */
const PURCHASES: ReadonlySet<Command['type']> = new Set([
  'BuyCitizen',
  'BuyBuilding',
  'BuyMilitary',
  'BuyProjectStage',
  'FoundCity',
  'UseAbility',
]);

export type Purse = Record<'gold' | 'science' | 'culture', number>;

/** Звук выполненной команды игрока: атака, саботаж или покупка за потраченный ресурс. */
export function commandSound(cmd: Command, before: Purse, after: Purse): Sfx | null {
  if (cmd.type === 'Attack') return 'attack';
  if (cmd.type === 'UseAbility' && cmd.ability === 'sabotage') return 'sabotage';
  if (!PURCHASES.has(cmd.type)) return null;
  let spent: keyof Purse | null = null;
  for (const res of ['gold', 'science', 'culture'] as const) {
    const cost = before[res] - after[res];
    if (cost > 0 && (!spent || cost > before[spent] - after[spent])) spent = res;
  }
  return spent;
}
