// Индекс сдерживания: насколько дорого напасть на державу. Виден всем — по нему боты решают о войне.
// Складывается из армии, обороны городов и культурного щита.

import { cityStrength } from './combat';
import { balance, pathsConfig } from './data';
import type { Breakdown } from './economy';
import { citiesOf, isMilitary, unitsOf } from './state';
import type { GameState } from './types';

/** Суммарная сила военных юнитов державы. */
export function armyStrength(state: GameState, power: number): number {
  return unitsOf(state, power)
    .filter(isMilitary)
    .reduce((sum, u) => sum + u.strength, 0);
}

export function deterrenceIndex(state: GameState, power: number): Breakdown {
  const cfg = balance.deterrence;
  const army = Math.round(armyStrength(state, power) * cfg.armyWeight * 10) / 10;
  const cities = citiesOf(state, power).reduce((sum, c) => sum + cityStrength(c), 0) * cfg.cityWeight;
  const p = state.powers[power];
  const culture = pathsConfig.culture;
  const shield = Math.round(Math.min(culture.shieldMax, p.cultureTotal * culture.shieldPerCulture) * 10) / 10;
  const items = [
    { label: 'Армия', value: army },
    { label: 'Оборона городов', value: cities },
    { label: 'Культурный щит', value: shield },
  ].filter((i) => i.value);
  return { total: Math.round(items.reduce((s, i) => s + i.value, 0) * 10) / 10, items };
}
