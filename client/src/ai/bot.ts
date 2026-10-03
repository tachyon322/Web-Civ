// Ход одного бота: дипломатия, финальные проекты и способности, решение о войне, армия, покупки, жители, подарки. Все действия — обычные команды ядра.

import type { Command } from '../core/commands';
import { aiConfig } from '../core/data';
import { foundCityPrice } from '../core/economy';
import type { GameState } from '../core/types';
import { createContext, myCities, myUnits } from './context';
import { diplomacyTurn, giftsTurn } from './diplomacy';
import { abilitiesTurn, projectsTurn } from './paths';
import { armyNeed, chooseUnitType, militaryTurn } from './military';
import { purchasesTurn } from './purchases';
import { citizensTurn, claimableTiles, findSites, settlersAllowed } from './settlers';
import { decideWar } from './war';

/** Играет ход державы прямо на state и возвращает выполненные команды. */
export function playBotTurn(state: GameState, power: number, deadline = Infinity): Command[] {
  const ctx = createContext(state, power, deadline);
  if (!state.powers[power].alive) return ctx.commands;

  diplomacyTurn(ctx);
  projectsTurn(ctx);
  abilitiesTurn(ctx);
  decideWar(ctx);
  const unitType = chooseUnitType(ctx);
  militaryTurn(ctx, unitType);

  const sites = findSites(ctx);
  const settlers = settlersAllowed(ctx, sites);
  const citizens = myUnits(ctx).filter((u) => u.type === 'citizen').length;
  const claimable = claimableTiles(ctx).length;
  const cap = Math.round(myCities(ctx).length * aiConfig.economy.citizensPerCity + aiConfig.economy.extraCitizens);
  const jobs = Math.ceil(claimable / 2) + settlers;
  const need = armyNeed(ctx);
  purchasesTurn(ctx, {
    armyNeed: need,
    citizensWanted: Math.max(0, Math.min(cap, jobs) - citizens),
    reserve: settlers > 0 ? foundCityPrice(state, power) : 0,
    unitType,
  });

  citizensTurn(ctx, sites, need > 0 ? unitType : null);
  giftsTurn(ctx);
  return ctx.commands;
}
