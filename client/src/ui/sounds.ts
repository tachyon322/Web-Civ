// Звук покупки — по валюте, которой за неё заплатили.

import type { Cue } from '../audio/sfx';

export type Purse = Record<'gold' | 'science' | 'culture', number>;

const CURRENCY_CUE: Record<keyof Purse, Cue> = { gold: 'coins', science: 'science', culture: 'culture' };

/** Звук потраченной валюты (больше всего ушло — та и звучит); null — ничего не потрачено. */
export function spentCue(before: Purse, after: Purse): Cue | null {
  let spent: keyof Purse | null = null;
  for (const res of ['gold', 'science', 'culture'] as const) {
    const cost = before[res] - after[res];
    if (cost > 0 && (!spent || cost > before[spent] - after[spent])) spent = res;
  }
  return spent && CURRENCY_CUE[spent];
}
