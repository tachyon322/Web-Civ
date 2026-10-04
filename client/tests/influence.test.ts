import { describe, expect, it } from 'vitest';
import { NO_TARGET } from '../src/core/abilities';
import { execute, validate } from '../src/core/commands';
import { diplomacyConfig, pathsConfig } from '../src/core/data';
import { declareWar as declare } from '../src/core/diplomacy';
import { computeIncome } from '../src/core/economy';
import {
  addInfluence,
  cultureIncomes,
  foreignInfluence,
  hegemonOf,
  hegemonyOver,
  influenceDecay,
  influenceGain,
  influenceNewTurn,
  influenceOf,
  tourCost,
  tourGain,
} from '../src/core/influence';
import { addPact, opinion } from '../src/core/relations';
import { computeStability, refreshAllStability } from '../src/core/stability';
import { MIGRATIONS } from '../src/save/format';
import { findCoalitionLeader } from '../src/core/relations';
import { hegemonyLeft, hegemonyNeeded } from '../src/core/victory';
import { NONE, type GameState } from '../src/core/types';
import { addCity, at, blankState, declareWar, meetAll } from './helpers';

const cfg = pathsConfig.influence;
const tour = pathsConfig.abilities.tour;

/** Три знакомые державы со столицами; у 0 запас культуры. */
function three(): GameState {
  const s = blankState(30, 12, 3);
  addCity(s, 0, 3, 5, true);
  addCity(s, 1, 14, 5, true);
  addCity(s, 2, 25, 5, true);
  meetAll(s);
  s.powers[0].culture = 5000;
  refreshAllStability(s);
  return s;
}

const useTour = (s: GameState, power: number, target: number) =>
  execute(s, { type: 'UseAbility', power, ...NO_TARGET, ability: 'tour', target });

describe('доли влияния', () => {
  it('новое влияние сначала занимает свободное место, затем отъедает чужие доли пропорционально', () => {
    const s = three();
    addInfluence(s, 2, 0, 30);
    addInfluence(s, 2, 1, 50);
    expect(foreignInfluence(s, 2)).toBe(80);
    // 20 свободно, ещё 20 — из чужих долей.
    addInfluence(s, 2, 0, 40);
    expect(influenceOf(s, 2, 0)).toBe(70);
    expect(influenceOf(s, 2, 1)).toBe(30);
    expect(foreignInfluence(s, 2)).toBe(100);
    // Чужие доли режутся пропорционально.
    const t = three();
    t.powers.push({ ...t.powers[2], id: 3, influence: [] });
    addInfluence(t, 2, 1, 60);
    addInfluence(t, 2, 3, 40);
    addInfluence(t, 2, 0, 50);
    expect(influenceOf(t, 2, 1)).toBe(30);
    expect(influenceOf(t, 2, 3)).toBe(20);
  });

  it('при полной шкале прирост целиком идёт за счёт других, сумма не больше 100', () => {
    const s = three();
    addInfluence(s, 2, 0, 60);
    addInfluence(s, 2, 1, 40);
    addInfluence(s, 2, 1, 20);
    expect(influenceOf(s, 2, 1)).toBe(60);
    expect(influenceOf(s, 2, 0)).toBe(40);
    expect(foreignInfluence(s, 2)).toBe(100);
  });

  it('гегемон — доля строго больше половины, он только один', () => {
    const s = three();
    addInfluence(s, 2, 0, cfg.hegemonShare);
    expect(hegemonOf(s, 2)).toBe(NONE);
    addInfluence(s, 2, 0, 1);
    expect(hegemonOf(s, 2)).toBe(0);
    expect(hegemonyOver(s, 0)).toEqual([2]);
  });
});

describe('пассивный рост и угасание', () => {
  it('договор, граница и чудеса, умноженные на соотношение доходов культуры', () => {
    const s = three();
    expect(influenceGain(s, 0, 1, [10, 10, 0]).total).toBe(0);
    addPact(s, 0, 1, 'trade');
    expect(influenceGain(s, 0, 1, [10, 10, 0]).total).toBe(cfg.trade);
    s.territory.owner[at(s, 4, 5)] = 0;
    s.territory.owner[at(s, 5, 5)] = 1;
    s.cities[0].buildings.push('pyramids', 'gardens');
    const base = cfg.trade + cfg.border + 2 * cfg.perWonder;
    expect(influenceGain(s, 0, 1, [10, 10, 0]).total).toBe(base);
    expect(influenceGain(s, 0, 1, [40, 10, 0]).total).toBe(base * cfg.ratioMax);
    expect(influenceGain(s, 0, 1, [1, 10, 0]).total).toBe(base * cfg.ratioMin);
  });

  it('без дохода культуры, без встречи и во время войны влияние не растёт', () => {
    const s = three();
    addPact(s, 0, 1, 'trade');
    expect(influenceGain(s, 0, 1, [0, 10, 0]).total).toBe(0);
    s.powers[0].met = [];
    expect(influenceGain(s, 0, 1, [10, 10, 0]).total).toBe(0);
    meetAll(s);
    declareWar(s, 0, 1);
    expect(influenceGain(s, 0, 1, [10, 10, 0]).total).toBe(0);
  });

  it('за ход доли угасают, у изоляциониста быстрее; затем прибавляется пассивный рост', () => {
    const s = three();
    s.powers[1].character = 'diplomat';
    s.powers[2].character = 'isolationist';
    addInfluence(s, 1, 0, 40);
    addInfluence(s, 2, 0, 40);
    influenceNewTurn(s, [0, 0, 0]);
    expect(influenceOf(s, 1, 0)).toBeCloseTo(40 * (1 - cfg.decay), 5);
    expect(influenceDecay(s, 2)).toBe(cfg.decay * diplomacyConfig.characters.isolationist.influenceResist);
    expect(influenceOf(s, 2, 0)).toBeLessThan(influenceOf(s, 1, 0));
    addPact(s, 0, 1, 'trade');
    const before = influenceOf(s, 1, 0);
    influenceNewTurn(s, [10, 10, 0]);
    expect(influenceOf(s, 1, 0)).toBeCloseTo(before * (1 - cfg.decay) + cfg.trade, 1);
  });

  it('в конце хода влияние растёт само и о новом гегемоне узнают все', () => {
    const s = three();
    s.cities[0].buildings.push('pyramids', 'gardens', 'colossus');
    addPact(s, 0, 1, 'trade');
    s.territory.owner[at(s, 4, 5)] = 0;
    s.territory.owner[at(s, 5, 5)] = 1;
    addInfluence(s, 1, 0, cfg.hegemonShare);
    expect(hegemonOf(s, 1)).toBe(NONE);
    // Прирост за ход должен перекрыть угасание ровно половинной доли.
    expect(influenceGain(s, 0, 1, cultureIncomes(s)).total).toBeGreaterThan(cfg.hegemonShare * cfg.decay);
    execute(s, { type: 'EndTurn', power: 0 });
    expect(influenceOf(s, 1, 0)).toBeGreaterThan(cfg.hegemonShare * (1 - cfg.decay));
    expect(hegemonOf(s, 1)).toBe(0);
    expect(s.log.some((e) => e.text === 'P1 попадает под культурное влияние державы P0')).toBe(true);
  });
});

describe('гастроли', () => {
  it('цена — ходы дохода культуры цели, но не меньше минимума', () => {
    const s = three();
    expect(tourCost(s, 1)).toBe(tour.minCost);
    s.cities[1].buildings.push('temple', 'pyramids', 'great_wall', 'hagia_sophia');
    const income = computeIncome(s, 1).culture.total;
    expect(tourCost(s, 1)).toBe(Math.max(tour.minCost, Math.round(income * tour.incomeTurns)));
    expect(tourCost(s, 1)).toBeGreaterThan(tour.minCost);
  });

  it('дают влияние, повторные в окне вдвое слабее, культура списывается', () => {
    const s = three();
    const cost = tourCost(s, 1);
    expect(useTour(s, 0, 1).ok).toBe(true);
    expect(s.powers[0].culture).toBe(5000 - cost);
    expect(influenceOf(s, 1, 0)).toBe(tour.gain);
    expect(tourGain(s, 0, 1)).toBe(tour.gain * tour.repeatFactor);
    useTour(s, 0, 1);
    expect(influenceOf(s, 1, 0)).toBe(tour.gain * (1 + tour.repeatFactor));
    expect(tourGain(s, 0, 2)).toBe(tour.gain);
  });

  it('нельзя: с врагом, с незнакомой державой, без культуры', () => {
    const s = three();
    declareWar(s, 0, 1);
    expect(validate(s, { type: 'UseAbility', power: 0, ...NO_TARGET, ability: 'tour', target: 1 }).ok).toBe(false);
    s.powers[0].met = [];
    expect(validate(s, { type: 'UseAbility', power: 0, ...NO_TARGET, ability: 'tour', target: 2 }).ok).toBe(false);
    meetAll(s);
    s.powers[0].culture = 0;
    expect(validate(s, { type: 'UseAbility', power: 0, ...NO_TARGET, ability: 'tour', target: 2 }).ok).toBe(false);
  });
});

describe('что даёт гегемония', () => {
  it('держава под влиянием лучше относится к гегемону', () => {
    const s = three();
    addInfluence(s, 1, 0, 80);
    const item = opinion(s, 1, 0).items.find((i) => i.label === 'Культурное влияние');
    expect(item?.value).toBe(Math.min(cfg.opinionMax, 80 * cfg.opinionPerShare));
    expect(opinion(s, 2, 0).items.some((i) => i.label === 'Культурное влияние')).toBe(false);
  });

  it('объявить войну своему гегемону — минус стабильность; если нападает гегемон, его влияние обнуляется', () => {
    const s = three();
    addInfluence(s, 1, 0, 80);
    declare(s, 1, 0);
    refreshAllStability(s);
    const item = computeStability(s, 1).items.find((i) => i.label === 'Война с культурным гегемоном');
    expect(item?.value).toBe(pathsConfig.stability.warOnHegemon);

    const t = three();
    addInfluence(t, 1, 0, 80);
    declare(t, 0, 1);
    expect(influenceOf(t, 1, 0)).toBe(0);
    expect(hegemonOf(t, 1)).toBe(NONE);
    refreshAllStability(t);
    expect(computeStability(t, 1).items.some((i) => i.label === 'Война с культурным гегемоном')).toBe(false);
  });
});

describe('культурная победа — гегемония', () => {
  const end = (s: GameState) => execute(s, { type: 'EndTurn', power: 0 });

  /** Пять держав; 0 — гегемон для 1, 2 и 3 (больше половины из четырёх). Без пассивного роста — доли держатся обновлением. */
  function five(): GameState {
    const s = blankState(50, 12, 5);
    for (let i = 0; i < 5; i++) addCity(s, i, 3 + i * 10, 5, true);
    meetAll(s);
    refreshAllStability(s);
    return s;
  }
  const hold = (s: GameState, targets: number[]) => {
    for (const p of s.powers) p.influence = [];
    for (const t of targets) addInfluence(s, t, 0, 90);
  };

  it('нужно больше половины живых держав, не считая себя', () => {
    const s = five();
    expect(hegemonyNeeded(s)).toBe(3);
    s.powers[4].alive = false;
    expect(hegemonyNeeded(s)).toBe(2);
  });

  it('отсчёт: оповещение и коалиция, сброс при потере, победа через 10 ходов удержания', () => {
    const s = five();
    hold(s, [1, 2]);
    end(s);
    expect(hegemonyLeft(s, 0)).toBeNull();
    hold(s, [1, 2, 3]);
    end(s);
    const turns = pathsConfig.victory.hegemonyTurns;
    expect(hegemonyLeft(s, 0)).toBe(turns);
    expect(s.log.some((e) => e.text.startsWith('P0 — культурный гегемон мира'))).toBe(true);
    expect(findCoalitionLeader(s)).toBe(0);
    hold(s, [1, 2]);
    end(s);
    expect(hegemonyLeft(s, 0)).toBeNull();
    expect(s.log.some((e) => e.text === 'P0 теряет культурную гегемонию: отсчёт сброшен')).toBe(true);
    for (let i = 0; i < turns + 1 && !s.winner; i++) {
      hold(s, [1, 2, 3]);
      if (i < turns) expect(s.winner).toBeNull();
      end(s);
    }
    expect(s.winner).toMatchObject({ power: 0, kind: 'culture' });
  });
});

describe('сохранения', () => {
  it('миграция 2 → 3: пустое влияние, отсчёт гегемонии, интриги; Мировое наследие убирается', () => {
    const migrated = MIGRATIONS[2]({
      version: 2,
      powers: [{ id: 0 }],
      cities: [{ id: 1, project: { kind: 'culture', stages: 2 } }, { id: 2, project: { kind: 'science', stages: 1 } }],
    });
    expect(migrated).toEqual({
      version: 3,
      intrigues: [],
      powers: [{ id: 0, influence: [], hegemonySince: 0 }],
      cities: [
        { id: 1, project: null, moderationTurns: 0, disabledTurns: 0 },
        { id: 2, project: { kind: 'science', stages: 1 }, moderationTurns: 0, disabledTurns: 0 },
      ],
    });
  });
});
