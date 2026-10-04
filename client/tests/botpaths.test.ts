import { describe, expect, it } from 'vitest';
import { createContext } from '../src/ai/context';
import { seekPactsForTest } from '../src/ai/diplomacy';
import { abilitiesTurn } from '../src/ai/paths';
import { aiConfig } from '../src/core/data';
import { addInfluence, influenceOf } from '../src/core/influence';
import { addPact, remember } from '../src/core/relations';
import { refreshAllStability } from '../src/core/stability';
import { hasPact } from '../src/core/state';
import type { GameState } from '../src/core/types';
import { addCity, addUnit, blankState, meetAll } from './helpers';

const cfg = aiConfig.paths;

/** Как в тестах подстрекательства: 0 — бот-культурник, 1 — агрессор с армией, 2 — его сосед. */
function setup(): GameState {
  const s = blankState(24, 10, 3);
  s.powers[0].isHuman = false;
  s.powers[0].character = 'diplomat';
  s.powers[2].character = 'diplomat';
  addCity(s, 0, 2, 5, true);
  addCity(s, 1, 11, 5, true);
  addCity(s, 2, 20, 5, true);
  for (const col of [10, 12, 13]) addUnit(s, 1, 'warrior', col, 6, 2);
  meetAll(s);
  s.powers[1].explored.fill(1);
  s.turn = aiConfig.war.minTurn;
  refreshAllStability(s);
  return s;
}

const run = (s: GameState, power = 0) => {
  const ctx = createContext(s, power, Infinity);
  abilitiesTurn(ctx);
  return ctx.commands;
};

describe('боты: культура и наука', () => {
  it('гастроли — туда, где своя доля ближе к гегемонии', () => {
    const s = setup();
    s.powers[0].culture = 200;
    addInfluence(s, 2, 0, 30);
    const cmds = run(s);
    expect(cmds).toContainEqual(expect.objectContaining({ ability: 'tour', target: 2 }));
    expect(influenceOf(s, 2, 0)).toBeGreaterThan(30);
  });

  it('подстрекательство — когда прогноз обещает войну с нелюбимой державой и нас не раскроют', () => {
    const s = setup();
    s.powers[0].culture = 1000;
    s.powers[0].cultureTotal = 1000;
    addInfluence(s, 1, 0, 60);
    addInfluence(s, 2, 0, cfg.tourSecureShare);
    remember(s, 0, 2, 'sabotage', -40);
    const cmds = run(s);
    expect(cmds).toContainEqual(expect.objectContaining({ ability: 'incite', target: 1, victim: 2 }));
  });

  it('не подстрекает, если жертва узнает (её культура выше)', () => {
    const s = setup();
    s.powers[0].culture = 1000;
    s.powers[0].cultureTotal = 1000;
    s.powers[2].cultureTotal = 5000;
    addInfluence(s, 1, 0, 60);
    remember(s, 0, 2, 'sabotage', -40);
    expect(run(s).some((c) => 'ability' in c && c.ability === 'incite')).toBe(false);
  });

  it('деанон при скрытых интригах и глушилка на себя под сильным влиянием', () => {
    const s = setup();
    s.powers[2].science = 500;
    s.intrigues.push({ by: 0, a: 1, b: 2, turn: s.turn, until: s.turn + 10, strength: 1, revealed: false });
    addInfluence(s, 2, 0, cfg.jamShare);
    const cmds = run(s, 2);
    expect(cmds).toContainEqual(expect.objectContaining({ ability: 'deanon' }));
    expect(cmds).toContainEqual(expect.objectContaining({ ability: 'jammer', target: 2 }));
    expect(s.intrigues[0].revealed).toBe(true);
  });

  it('изоляционист рвёт договор с тем, чьё влияние на него растёт', () => {
    const s = setup();
    s.powers[2].character = 'isolationist';
    addPact(s, 2, 0, 'trade');
    remember(s, 2, 0, 'gift', 50);
    seekPactsForTest(createContext(s, 2, Infinity));
    expect(hasPact(s, 2, 0, 'trade')).toBe(true);
    addInfluence(s, 2, 0, cfg.isolationCancelShare);
    seekPactsForTest(createContext(s, 2, Infinity));
    expect(hasPact(s, 2, 0, 'trade')).toBe(false);
  });
});
