// Индекс сдерживания: насколько дорого напасть на державу. Виден всем — по нему боты решают о войне.
// Сейчас складывается из армии и обороны городов; технологический разрыв и культурный щит добавятся на этапе 5.

import { cityStrength } from './combat';
import { balance } from './data';
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
  const items = [
    { label: 'Армия', value: army },
    { label: 'Оборона городов', value: cities },
  ].filter((i) => i.value);
  return { total: Math.round((army + cities) * 10) / 10, items };
}
