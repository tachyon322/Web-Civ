import { describe, expect, it } from 'vitest';
import { NO_TARGET } from '../src/core/abilities';
import { execute, type Command } from '../src/core/commands';
import { commandSound, type Purse } from '../src/ui/sounds';
import { addCity, blankState } from './helpers';

/** Выполняет команду и возвращает её звук. */
function soundOf(s: ReturnType<typeof blankState>, cmd: Command) {
  const p = s.powers[0];
  const before: Purse = { gold: p.gold, science: p.science, culture: p.culture };
  expect(execute(s, cmd)).toEqual({ ok: true });
  return commandSound(cmd, before, p);
}

describe('звуки команд', () => {
  it('покупка звучит ресурсом, за который куплена', () => {
    const s = blankState();
    Object.assign(s.powers[0], { gold: 1000, science: 1000, culture: 1000 });
    const city = addCity(s, 0, 5, 5, true);
    expect(soundOf(s, { type: 'BuyCitizen', power: 0, cityId: city.id })).toBe('gold');
    const fortify = { ...NO_TARGET, ability: 'fortify' as const, cityId: city.id };
    expect(soundOf(s, { type: 'UseAbility', power: 0, ...fortify })).toBe('science');
    const holiday = { ...NO_TARGET, ability: 'holiday' as const };
    expect(soundOf(s, { type: 'UseAbility', power: 0, ...holiday })).toBe('culture');
  });

  it('атака и саботаж — свои звуки, подарки и ходы — без звука', () => {
    const purse: Purse = { gold: 100, science: 100, culture: 100 };
    const spent: Purse = { gold: 50, science: 60, culture: 100 };
    expect(commandSound({ type: 'Attack', power: 0, unitId: 1, target: 2 }, purse, purse)).toBe('attack');
    const sabotage = { ...NO_TARGET, ability: 'sabotage' as const, cityId: 1, building: 'market' };
    expect(commandSound({ type: 'UseAbility', power: 0, ...sabotage }, purse, spent)).toBe('sabotage');
    expect(commandSound({ type: 'Gift', power: 0, target: 1, gold: 50 }, purse, spent)).toBeNull();
    expect(commandSound({ type: 'Move', power: 0, unitId: 1, target: 2 }, purse, purse)).toBeNull();
  });
});
