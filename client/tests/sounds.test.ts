import { describe, expect, it } from 'vitest';
import { NO_TARGET } from '../src/core/abilities';
import { execute, type Command } from '../src/core/commands';
import { spentCue, type Purse } from '../src/ui/sounds';
import { addCity, blankState } from './helpers';

/** Выполняет команду и возвращает звук потраченной валюты. */
function cueOf(s: ReturnType<typeof blankState>, cmd: Command) {
  const p = s.powers[0];
  const before: Purse = { gold: p.gold, science: p.science, culture: p.culture };
  expect(execute(s, cmd)).toEqual({ ok: true });
  return spentCue(before, p);
}

describe('звук покупки', () => {
  it('звучит валютой, за которую куплено', () => {
    const s = blankState();
    Object.assign(s.powers[0], { gold: 1000, science: 1000, culture: 1000 });
    const city = addCity(s, 0, 5, 5, true);
    expect(cueOf(s, { type: 'BuyCitizen', power: 0, cityId: city.id })).toBe('coins');
    expect(cueOf(s, { type: 'UseAbility', power: 0, ...NO_TARGET, ability: 'moderation', cityId: city.id })).toBe('science');
    expect(cueOf(s, { type: 'UseAbility', power: 0, ...NO_TARGET, ability: 'holiday' })).toBe('culture');
  });

  it('без трат — без звука валюты; при нескольких — по самой большой', () => {
    const purse: Purse = { gold: 100, science: 100, culture: 100 };
    expect(spentCue(purse, purse)).toBeNull();
    expect(spentCue(purse, { gold: 120, science: 100, culture: 100 })).toBeNull();
    expect(spentCue(purse, { gold: 90, science: 70, culture: 100 })).toBe('science');
  });
});
