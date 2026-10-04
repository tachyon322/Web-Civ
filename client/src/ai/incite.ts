// Прогноз подстрекательства: то же подстрекательство применяется к копии состояния, и бот A
// на ней решает о войне своим обычным расчётом. Так игрок видит заранее, сработает ли интрига и почему нет.

import { allied, hasPact } from '../core/state';
import { applyIncite, inciteExposed } from '../core/incite';
import type { GameState } from '../core/types';
import { createContext } from './context';
import { assessWar, chooseWarTarget, warReadiness } from './war';

export interface InciteForecast {
  /** Интрига к чему-то приведёт: разрыв союза или война. */
  ok: boolean;
  breaksAlliance: boolean;
  breaksTrade: boolean;
  war: boolean;
  /** B узнает, кто стоит за интригой. */
  exposed: boolean;
  /** Что случится или почему ничего не случится. */
  text: string;
}

export function inciteForecast(state: GameState, by: number, a: number, b: number): InciteForecast {
  const copy = structuredClone(state);
  const wasAllied = allied(copy, a, b);
  const hadTrade = hasPact(copy, a, b, 'trade');
  applyIncite(copy, by, a, b);
  const breaksAlliance = wasAllied && !allied(copy, a, b);
  const breaksTrade = hadTrade && !hasPact(copy, a, b, 'trade');
  const ctx = createContext(copy, a, Infinity);
  const war = chooseWarTarget(ctx) === b;
  const pa = state.powers[a].name;
  const pb = state.powers[b].name;
  let text: string;
  const broken = [breaksAlliance && 'союз', breaksTrade && 'торговый договор'].filter(Boolean).join(' и ');
  if (war) text = `${broken ? `${pa} расторгнет ${broken} и` : pa} объявит войну державе ${pb}`;
  else {
    const assessment = assessWar(ctx, b);
    const choice = chooseWarTarget(ctx);
    const reason =
      warReadiness(ctx) ??
      ('reason' in assessment ? assessment.reason : choice !== null ? `предпочтёт войну с державой ${state.powers[choice].name}` : 'не решится');
    text = `${broken ? `${pa} расторгнет ${broken} с державой ${pb}, но войны не будет: ` : 'Войны не будет: '}${reason}`;
  }
  return { ok: war || breaksAlliance || breaksTrade, breaksAlliance, breaksTrade, war, exposed: inciteExposed(state, by, b), text };
}
