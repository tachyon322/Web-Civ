import { describe, expect, it } from 'vitest';
import { createContext } from '../src/ai/context';
import { inciteForecast } from '../src/ai/incite';
import { assessWar, chooseWarTarget } from '../src/ai/war';
import { NO_TARGET } from '../src/core/abilities';
import { execute, validate } from '../src/core/commands';
import { aiConfig, diplomacyConfig, pathsConfig } from '../src/core/data';
import { inciteCost, inciteStrength, inciteWarFactor } from '../src/core/incite';
import { addInfluence } from '../src/core/influence';
import { addPact, opinion, remember } from '../src/core/relations';
import { refreshAllStability } from '../src/core/stability';
import { allied, hasPact } from '../src/core/state';
import type { GameState } from '../src/core/types';
import { addCity, addUnit, blankState, meetAll } from './helpers';

const cfg = pathsConfig.abilities.incite;

/** 0 — игрок-подстрекатель, 1 — бот-агрессор с армией (A), 2 — бот (B) в досягаемости A. A любит B. */
function setup(): GameState {
  const s = blankState(24, 10, 3);
  s.powers[2].character = 'diplomat';
  addCity(s, 0, 2, 5, true);
  addCity(s, 1, 11, 5, true);
  addCity(s, 2, 20, 5, true);
  for (const col of [10, 12, 13]) addUnit(s, 1, 'warrior', col, 6, 2);
  meetAll(s);
  s.powers[1].explored.fill(1);
  s.turn = aiConfig.war.minTurn;
  s.powers[0].culture = 1000;
  s.powers[0].cultureTotal = 1000;
  remember(s, 1, 2, 'gift', 60);
  refreshAllStability(s);
  return s;
}

const incite = (_s: GameState, a = 1, b = 2) => ({ type: 'UseAbility' as const, power: 0, ...NO_TARGET, ability: 'incite' as const, target: a, victim: b });

describe('подстрекательство: правила', () => {
  it('нужно влияние на A от минимума; сила растёт до полной и умножается на характер', () => {
    const s = setup();
    expect(inciteStrength(s, 0, 1)).toBe(0);
    expect(validate(s, incite(s)).ok).toBe(false);
    addInfluence(s, 1, 0, cfg.minInfluence);
    const factor = diplomacyConfig.characters.aggressor.inciteFactor;
    expect(inciteStrength(s, 0, 1)).toBeCloseTo((cfg.minInfluence / cfg.fullInfluence) * factor, 2);
    addInfluence(s, 1, 0, 50);
    expect(inciteStrength(s, 0, 1)).toBe(factor);
  });

  it('цена от размера A, игрока натравить нельзя, раз в 10 ходов на одну державу', () => {
    const s = setup();
    addInfluence(s, 1, 0, 60);
    expect(inciteCost(s, 0, 1)).toBe(cfg.cost);
    s.cities[1].level = 4;
    expect(inciteCost(s, 0, 1)).toBe(cfg.cost * cfg.sizeMax);
    addInfluence(s, 0, 1, 60);
    expect(validate(s, { ...incite(s), power: 1, target: 0, victim: 2 }).ok).toBe(false);
    expect(execute(s, incite(s)).ok).toBe(true);
    expect(s.powers[0].culture).toBe(1000 - cfg.cost * cfg.sizeMax);
    expect(validate(s, incite(s)).ok).toBe(false);
    s.turn += cfg.cooldown;
    expect(validate(s, incite(s)).ok).toBe(true);
  });
});

describe('подстрекательство: действие', () => {
  it('A обижен на B, порог войны снижен; если культура подстрекателя выше — никто не узнаёт', () => {
    const s = setup();
    addInfluence(s, 1, 0, 60);
    const before = opinion(s, 1, 2).total;
    execute(s, incite(s));
    const grievance = Math.round(cfg.grievance * inciteStrength(s, 0, 1));
    expect(opinion(s, 1, 2).total).toBe(before - grievance);
    expect(opinion(s, 1, 2).items.some((i) => i.label.startsWith('Обида на них'))).toBe(true);
    expect(inciteWarFactor(s, 1, 2)).toBeCloseTo(cfg.warFactor, 5);
    expect(s.intrigues).toMatchObject([{ by: 0, a: 1, b: 2, revealed: false }]);
    expect(opinion(s, 2, 0).items.some((i) => i.label.startsWith('Подстрекали'))).toBe(false);
    // Отношение A к подстрекателю не портится.
    expect(opinion(s, 1, 0).items.some((i) => i.value < 0 && /Подстрек|интриг/.test(i.label))).toBe(false);
    s.turn += cfg.turns;
    expect(inciteWarFactor(s, 1, 2)).toBe(1);
  });

  it('если культура B выше — B узнаёт и помнит, остальные думают о подстрекателе хуже', () => {
    const s = setup();
    addInfluence(s, 1, 0, 60);
    s.powers[2].cultureTotal = 5000;
    execute(s, incite(s));
    expect(s.intrigues[0].revealed).toBe(true);
    expect(opinion(s, 2, 0).items.find((i) => i.label.startsWith('Подстрекали против нас'))?.value).toBe(cfg.exposedMemory);
    expect(opinion(s, 1, 0).items.find((i) => i.label.startsWith('Плетут интриги'))?.value).toBe(cfg.seenMemory);
    expect(s.log.some((e) => e.text.startsWith('Раскрыта интрига: P0'))).toBe(true);
  });

  it('союз рвётся, если обида опускает отношение ниже порога союза', () => {
    const s = setup();
    addInfluence(s, 1, 0, 60);
    addPact(s, 1, 2, 'alliance');
    s.powers[1].memories = [];
    expect(opinion(s, 1, 2).total).toBeLessThan(diplomacyConfig.deals.allianceOpinion + 30);
    execute(s, incite(s));
    expect(allied(s, 1, 2)).toBe(false);
    expect(opinion(s, 2, 1).items.some((i) => i.label.startsWith('Расторгли договор'))).toBe(true);
  });
});

describe('подстрекательство: санкции', () => {
  it('торговый договор рвётся, если обида опускает отношение ниже порога; прогноз это показывает', () => {
    const s = setup();
    addInfluence(s, 1, 0, 60);
    addPact(s, 1, 2, 'trade');
    s.powers[1].memories = [];
    remember(s, 1, 2, 'gift', 20);
    expect(opinion(s, 1, 2).total).toBeGreaterThanOrEqual(cfg.tradeBreakOpinion);
    const f = inciteForecast(s, 0, 1, 2);
    expect(f.breaksTrade).toBe(true);
    expect(f.text).toMatch(/расторгнет торговый договор/);
    execute(s, incite(s));
    expect(hasPact(s, 1, 2, 'trade')).toBe(false);
  });

  it('при хорошем отношении договор остаётся', () => {
    const s = setup();
    addInfluence(s, 1, 0, 60);
    addPact(s, 1, 2, 'trade');
    execute(s, incite(s));
    expect(hasPact(s, 1, 2, 'trade')).toBe(true);
  });
});

describe('подстрекательство: решение бота и прогноз', () => {
  it('до интриги A не нападает (слишком любит B), после — нападает; прогноз говорит то же', () => {
    const s = setup();
    addInfluence(s, 1, 0, 60);
    const ctx = createContext(s, 1, Infinity);
    expect(chooseWarTarget(ctx)).toBeNull();
    const reason = assessWar(ctx, 2);
    expect('reason' in reason && reason.reason).toMatch(/отношение/);
    const f = inciteForecast(s, 0, 1, 2);
    expect(f).toMatchObject({ ok: true, war: true, exposed: false });
    expect(f.text).toBe('P1 объявит войну державе P2');
    // Прогноз ничего не меняет в настоящем состоянии.
    expect(s.intrigues).toEqual([]);
    execute(s, incite(s));
    expect(chooseWarTarget(createContext(s, 1, Infinity))).toBe(2);
  });

  it('прогноз объясняет, почему войны не будет', () => {
    const s = setup();
    addInfluence(s, 1, 0, 60);
    s.turn = aiConfig.war.minTurn - 1;
    const f = inciteForecast(s, 0, 1, 2);
    expect(f.ok).toBe(false);
    expect(f.text).toMatch(/^Войны не будет: рано/);
  });
});
