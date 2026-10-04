import { describe, expect, it } from 'vitest';
import { NO_TARGET, type AbilityUse } from '../src/core/abilities';
import { execute, validate, type Command } from '../src/core/commands';
import { pressureGain } from '../src/core/culture';
import { curtainCut } from '../src/core/curtain';
import { pathsConfig } from '../src/core/data';
import { computeIncome } from '../src/core/economy';
import { addInfluence, influenceGain, influenceOf, tourGain } from '../src/core/influence';
import { addPact, opinion } from '../src/core/relations';
import { refreshAllStability } from '../src/core/stability';
import type { AbilityId } from '../src/core/data';
import type { GameState } from '../src/core/types';
import { MIGRATIONS } from '../src/save/format';
import { addCity, at, blankState, meetAll } from './helpers';

const end = (s: GameState) => execute(s, { type: 'EndTurn', power: 0 });
const use = (s: GameState, power: number, ability: AbilityId, extra: Partial<AbilityUse> = {}) =>
  execute(s, { type: 'UseAbility', power, ...NO_TARGET, ability, ...extra });
const curtain = pathsConfig.curtain;

/** Три знакомые державы; у 0 и 1 запас науки и культуры. */
function three(): GameState {
  const s = blankState(30, 12, 3);
  addCity(s, 0, 3, 5, true);
  addCity(s, 1, 14, 5, true);
  addCity(s, 2, 25, 5, true);
  meetAll(s);
  for (const p of [s.powers[0], s.powers[1]]) Object.assign(p, { science: 5000, culture: 5000 });
  refreshAllStability(s);
  return s;
}

describe('цифровой занавес', () => {
  it('срез растёт с отношением своей науки к чужой культуре, до предела', () => {
    const s = three();
    s.powers[1].cultureTotal = 100;
    s.powers[0].scienceTotal = 100;
    expect(curtainCut(s, 0, 1)).toBe(0);
    s.powers[0].scienceTotal = 300;
    expect(curtainCut(s, 0, 1)).toBe(2 * curtain.perRatio);
    s.powers[0].scienceTotal = 100000;
    expect(curtainCut(s, 0, 1)).toBe(curtain.max);
  });

  it('режет рост влияния, гастроли, культурное давление и утечку мозгов', () => {
    const s = three();
    addPact(s, 1, 0, 'trade');
    s.powers[1].cultureTotal = 100;
    const gain = influenceGain(s, 1, 0, [10, 10, 0]).total;
    const tour = tourGain(s, 1, 0);
    const pressure = pressureGain(s, 1, 3, 0);
    s.powers[0].scienceTotal = 100000;
    expect(influenceGain(s, 1, 0, [10, 10, 0]).total).toBeCloseTo(gain * (1 - curtain.max), 1);
    expect(tourGain(s, 1, 0)).toBeCloseTo(tour * (1 - curtain.max), 1);
    expect(pressureGain(s, 1, 3, 0)).toBeCloseTo(pressure * (1 - curtain.max), 1);

    // Утечка мозгов: соседи по границе, у 1 культура вдвое выше.
    const t = three();
    t.cities[0].buildings = ['library', 'university', 'observatory', 'laboratory', 'royal_academy'];
    t.cities[0].level = 5;
    t.territory.owner[at(t, 4, 5)] = 0;
    t.territory.owner[at(t, 5, 5)] = 1;
    t.powers[1].cultureTotal = 1000;
    t.powers[0].cultureTotal = 100;
    const drain = (st: GameState) => computeIncome(st, 0).science.items.find((i) => i.label === 'Утечка мозгов')?.value ?? 0;
    const open = drain(t);
    expect(open).toBeLessThan(0);
    t.powers[0].scienceTotal = 100000;
    expect(drain(t)).toBeGreaterThan(open);
  });
});

describe('способности науки', () => {
  it('модерация контента: нет давления, мятежа и отделения; на бой не влияет', () => {
    const s = three();
    const city = addCity(s, 0, 8, 5);
    city.pressureFrom = 1;
    city.pressure = 50;
    city.revoltFrom = 2;
    city.revoltProgress = 1;
    s.powers[2].cultureTotal = 10000;
    s.powers[1].cultureTotal = 10000;
    expect(use(s, 0, 'moderation', { cityId: city.id }).ok).toBe(true);
    end(s);
    expect(city.pressure).toBe(50);
    expect(city.revoltProgress).toBe(1);
    expect(city.owner).toBe(0);
    expect(city.moderationTurns).toBe(pathsConfig.abilities.moderation.turns - 1);
    expect(use(s, 0, 'moderation', { cityId: s.cities[1].id }).ok).toBe(false);
  });

  it('деанон раскрывает нераскрытые интриги против себя и союзников', () => {
    const s = three();
    addPact(s, 0, 2, 'alliance');
    s.intrigues.push(
      { by: 1, a: 2, b: 0, turn: 1, until: 11, strength: 1, revealed: false },
      { by: 1, a: 0, b: 2, turn: 1, until: 11, strength: 1, revealed: false },
    );
    expect(validate(s, { type: 'UseAbility', power: 2, ...NO_TARGET, ability: 'deanon' } as Command).ok).toBe(false); // нет науки
    expect(use(s, 0, 'deanon').ok).toBe(true);
    expect(s.intrigues.every((x) => x.revealed)).toBe(true);
    expect(opinion(s, 0, 1).items.some((i) => i.label.startsWith('Подстрекали против нас'))).toBe(true);
    expect(opinion(s, 2, 1).items.some((i) => i.label.startsWith('Подстрекали против нас'))).toBe(true);
    expect(use(s, 0, 'deanon').ok).toBe(false);
  });

  it('глушилка: на державу нельзя гастроли и подстрекательство, пока действует', () => {
    const s = three();
    addInfluence(s, 2, 1, 60);
    const tour: Command = { type: 'UseAbility', power: 1, ...NO_TARGET, ability: 'tour', target: 2 };
    expect(validate(s, tour).ok).toBe(true);
    expect(use(s, 0, 'jammer', { target: 2 }).ok).toBe(true);
    expect(validate(s, tour)).toEqual({ ok: false, reason: 'На эту державу действует глушилка' });
    expect(validate(s, { ...tour, ability: 'incite', victim: 0 } as Command).ok).toBe(false);
    for (let i = 0; i < pathsConfig.abilities.jammer.turns; i++) end(s);
    expect(validate(s, tour).ok).toBe(true);
    expect(use(s, 0, 'jammer', { target: 0 }).ok).toBe(true);
  });
});

describe('этапы Великого проекта меняют мир', () => {
  it('этап 1 — обвал влияния, этап 2 — планетарная глушилка', () => {
    const s = three();
    const cfg = pathsConfig.projects.science;
    s.powers[0].scienceTotal = pathsConfig.epochs[pathsConfig.epochs.length - 1].science;
    s.powers[0].science = 100000;
    addInfluence(s, 2, 1, 80);
    const buy: Command = { type: 'BuyProjectStage', power: 0, cityId: s.cities[0].id, kind: 'science' };
    expect(execute(s, buy).ok).toBe(true);
    expect(influenceOf(s, 2, 1)).toBeCloseTo(80 * (1 - cfg.influenceCrash), 5);
    const tour: Command = { type: 'UseAbility', power: 1, ...NO_TARGET, ability: 'tour', target: 2 };
    expect(validate(s, tour).ok).toBe(true);
    for (let i = 0; i < cfg.cooldown; i++) end(s);
    expect(execute(s, buy).ok).toBe(true);
    expect(validate(s, tour)).toEqual({ ok: false, reason: 'Планетарная глушилка: пока стоит Великий проект, интриги невозможны' });
  });
});

describe('сохранения', () => {
  it('миграция 2 → 3: модерация вместо фортификации, без отключённого здания и оружия сдерживания', () => {
    const m = MIGRATIONS[2]({
      version: 2,
      powers: [{ id: 0, deterrent: true }],
      cities: [{ id: 1, fortifyTurns: 2, disabledBuilding: 'market', disabledTurns: 3, project: null }],
    });
    expect(m.powers).toEqual([{ id: 0, influence: [], hegemonySince: 0 }]);
    expect(m.cities).toEqual([{ id: 1, moderationTurns: 0, disabledTurns: 0, project: null }]);
  });
});
