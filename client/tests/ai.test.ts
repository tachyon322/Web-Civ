import { describe, expect, it } from 'vitest';
import { playBotTurn, runBots } from '../src/ai';
import { createContext } from '../src/ai/context';
import { attackValue, breachLevel, chooseTargetCity } from '../src/ai/military';
import { canExpand, findSites } from '../src/ai/settlers';
import { chooseWarTarget } from '../src/ai/war';
import { execute } from '../src/core/commands';
import { forecastAttack } from '../src/core/combat';
import { aiConfig, nationDef, pathsConfig } from '../src/core/data';
import { deterrenceIndex } from '../src/core/deterrence';
import { computeIncome } from '../src/core/economy';
import { newGame } from '../src/core/game';
import { atWar, citiesOf, hasPact, unitsOf } from '../src/core/state';
import { pendingProposals } from '../src/core/diplomacy';
import { addPact, remember } from '../src/core/relations';
import { refreshAllStability } from '../src/core/stability';
import { addCitizen, addCity, addUnit, at, blankState, declareWar } from './helpers';

/** Держава 1 — бот, всё вокруг разведано; встреча с игроком уже была. */
function botVsHuman() {
  const s = blankState(16, 12);
  s.powers[1].explored.fill(1);
  s.powers[0].met.push(1);
  s.powers[1].met.push(0);
  s.turn = aiConfig.war.minTurn;
  return s;
}

describe('характеры и сложность', () => {
  it('у ботов есть характер, у игрока — нет; распределение задаётся сидом', () => {
    const a = newGame({ seed: 9, powers: 12, humanNation: null });
    const b = newGame({ seed: 9, powers: 12, humanNation: null });
    expect(a.powers[0].character).toBeNull();
    expect(a.powers.slice(1).every((p) => p.character !== null)).toBe(true);
    expect(a.powers.map((p) => p.character)).toEqual(b.powers.map((p) => p.character));
  });

  it('склонность нации выпадает чаще остальных характеров', () => {
    let match = 0;
    let total = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const s = newGame({ seed, powers: 12, humanNation: null });
      for (const p of s.powers.slice(1)) {
        total++;
        if (p.character === nationDef(p.nationId).tendency) match++;
      }
    }
    // Ожидается 50% + 50% × ¼ = 62,5%; случайно было бы 25%.
    expect(match / total).toBeGreaterThan(0.45);
  }, 60000);

  it('сложность меняет доход ботов, но не игрока', () => {
    const s = blankState();
    addCity(s, 0, 2, 2, true);
    addCity(s, 1, 8, 2, true);
    const base = computeIncome(s, 1).gold.total;
    s.settings.difficulty = 'hard';
    expect(computeIncome(s, 1).gold.total).toBeGreaterThan(base);
    expect(computeIncome(s, 0).gold.total).toBe(base);
    s.settings.difficulty = 'easy';
    expect(computeIncome(s, 1).gold.total).toBeLessThan(base);
    expect(computeIncome(s, 1).gold.items.some((i) => i.label === 'Сложность')).toBe(true);
  });
});

describe('индекс сдерживания', () => {
  it('складывается из армии и обороны городов', () => {
    const s = blankState();
    addCity(s, 0, 2, 2, true);
    addUnit(s, 0, 'warrior', 3, 3, 3);
    addCitizen(s, 0, 4, 4);
    const d = deterrenceIndex(s, 0);
    // Армия: воин 3-го уровня = 4 (житель не в счёт). Города: столица 1-го уровня = 2 × 0,25.
    expect(d.items.find((i) => i.label === 'Армия')?.value).toBe(4);
    expect(d.items.find((i) => i.label === 'Оборона городов')?.value).toBe(0.5);
    expect(d.total).toBe(4.5);
  });
});

describe('решение о войне', () => {
  it('бот с сильной армией нападает на слабого соседа', () => {
    const s = botVsHuman();
    addCity(s, 0, 2, 5, true);
    addCity(s, 1, 9, 5, true);
    for (const col of [8, 10, 11]) addUnit(s, 1, 'warrior', col, 6, 2);
    expect(chooseWarTarget(createContext(s, 1, Infinity))).toBe(0);
  });

  it('не нападает до минимального хода, без армии и на того, кто сильнее', () => {
    const s = botVsHuman();
    addCity(s, 0, 2, 5, true);
    addCity(s, 1, 9, 5, true);
    for (const col of [8, 10, 11]) addUnit(s, 1, 'warrior', col, 6, 2);
    s.turn = aiConfig.war.minTurn - 1;
    expect(chooseWarTarget(createContext(s, 1, Infinity))).toBeNull();
    s.turn = aiConfig.war.minTurn;
    // У игрока армия сильнее.
    for (const col of [1, 3, 4]) addUnit(s, 0, 'warrior', col, 6, 3);
    expect(chooseWarTarget(createContext(s, 1, Infinity))).toBeNull();
  });

  it('не нападает на тех, кого не встречал, и на чьи города не знает', () => {
    const s = botVsHuman();
    s.powers[1].met = [];
    addCity(s, 0, 2, 5, true);
    addCity(s, 1, 9, 5, true);
    for (const col of [8, 10, 11]) addUnit(s, 1, 'warrior', col, 6, 2);
    expect(chooseWarTarget(createContext(s, 1, Infinity))).toBeNull();
    s.powers[1].met.push(0);
    s.powers[1].explored.fill(0);
    expect(chooseWarTarget(createContext(s, 1, Infinity))).toBeNull();
  });

  it('не нападает на союзника, во время перемирия и на тех, кто ему нравится', () => {
    const setup = () => {
      const s = botVsHuman();
      addCity(s, 0, 2, 5, true);
      addCity(s, 1, 9, 5, true);
      for (const col of [8, 10, 11]) addUnit(s, 1, 'warrior', col, 6, 2);
      return s;
    };
    const ally = setup();
    addPact(ally, 0, 1, 'alliance');
    expect(chooseWarTarget(createContext(ally, 1, Infinity))).toBeNull();
    const truce = setup();
    addPact(truce, 0, 1, 'truce', truce.turn + 5);
    expect(chooseWarTarget(createContext(truce, 1, Infinity))).toBeNull();
    const friend = setup();
    remember(friend, 1, 0, 'gift', 30);
    remember(friend, 1, 0, 'liberated', 40);
    expect(chooseWarTarget(createContext(friend, 1, Infinity))).toBeNull();
  });

  it('договор нарушает только агрессор', () => {
    const s = botVsHuman();
    addCity(s, 0, 2, 5, true);
    addCity(s, 1, 9, 5, true);
    for (const col of [8, 10, 11]) addUnit(s, 1, 'warrior', col, 6, 2);
    addPact(s, 0, 1, 'trade');
    expect(chooseWarTarget(createContext(s, 1, Infinity))).toBe(0);
    s.powers[1].character = 'trader';
    expect(chooseWarTarget(createContext(s, 1, Infinity))).toBeNull();
  });

  it('союзники цели, которые вступятся, входят в риск', () => {
    const s = blankState(24, 12, 3);
    s.powers[1].explored.fill(1);
    for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) {
      s.powers[a].met.push(b);
      s.powers[b].met.push(a);
    }
    s.turn = aiConfig.war.minTurn;
    addCity(s, 0, 2, 5, true);
    addCity(s, 1, 9, 5, true);
    addCity(s, 2, 18, 5, true);
    for (const col of [8, 10, 11]) addUnit(s, 1, 'warrior', col, 6, 2);
    s.powers[2].character = 'diplomat';
    for (const col of [17, 19, 20]) addUnit(s, 2, 'warrior', col, 6, 3);
    expect(chooseWarTarget(createContext(s, 1, Infinity))).toBe(0);
    addPact(s, 0, 2, 'alliance');
    expect(chooseWarTarget(createContext(s, 1, Infinity))).toBeNull();
  });
});

describe('дипломатия ботов', () => {
  /** Два бота (1 и 2) и игрок; все знакомы, города далеко друг от друга. */
  function bots(): ReturnType<typeof blankState> {
    const s = blankState(30, 12, 3);
    s.powers[1].character = 'trader';
    s.powers[2].character = 'trader';
    for (const p of s.powers) for (const q of s.powers) if (p.id !== q.id) p.met.push(q.id);
    addCity(s, 0, 3, 5, true);
    addCity(s, 1, 14, 5, true);
    addCity(s, 2, 25, 5, true);
    return s;
  }

  it('боты заключают торговые договоры с теми, кто не неприятен', () => {
    const s = bots();
    playBotTurn(s, 1);
    expect(hasPact(s, 1, 2, 'trade')).toBe(true);
    // Игроку — предложение, которое ждёт ответа.
    expect(pendingProposals(s, 0).some((p) => p.from === 1 && p.deal.kind === 'trade')).toBe(true);
  });

  it('проигрывающий бот предлагает мир, и другой бот соглашается, когда война затянулась', () => {
    const s = bots();
    declareWar(s, 1, 2);
    s.pacts.find((p) => p.kind === 'war')!.since = s.turn - 15;
    for (const col of [23, 24, 26]) addUnit(s, 2, 'warrior', col, 7, 3);
    playBotTurn(s, 1);
    expect(atWar(s, 1, 2)).toBe(false);
    expect(hasPact(s, 1, 2, 'truce')).toBe(true);
  });

  it('бот предлагает игроку мир, а не ждёт выбывания', () => {
    const s = bots();
    declareWar(s, 0, 1);
    s.pacts.find((p) => p.kind === 'war')!.since = s.turn - 15;
    playBotTurn(s, 1);
    expect(pendingProposals(s, 0).some((p) => p.from === 1 && p.deal.kind === 'peace')).toBe(true);
  });

  it('торговец с лишним золотом дарит тому, с кем до договора осталось немного', () => {
    const s = bots();
    s.powers[1].gold = 1000;
    remember(s, 2, 1, 'treatyCancelled', -25);
    playBotTurn(s, 1);
    expect(s.powers[2].memories.some((m) => m.kind === 'gift' && m.about === 1)).toBe(true);
  });
});

describe('бой бота', () => {
  it('атака ценится по прогнозу: выгодный размен — да, почти гибель или смерть атакующего — нет', () => {
    const s = blankState();
    declareWar(s, 0, 1);
    const weak = addUnit(s, 1, 'warrior', 4, 4, 1);
    const strong = addUnit(s, 0, 'warrior', 5, 4, 3);
    expect(attackValue(forecastAttack(s, strong, weak.tile))).toBeGreaterThan(0);
    // Слабый, но целый юнит снимает 25% силы и теряет половину своей — размен в его пользу.
    expect(attackValue(forecastAttack(s, weak, strong.tile))).toBeGreaterThan(0);
    // Израненный — после атаки останется почти без силы.
    weak.strength = 0.2;
    expect(attackValue(forecastAttack(s, weak, strong.tile))).toBeLessThan(0);
  });

  it('уровень для пробития города: лучник с бонусом против городов', () => {
    expect(breachLevel(1)).toBe(1); // 1 × 1,5
    expect(breachLevel(3)).toBe(2); // 2 × 1,5
    expect(breachLevel(6)).toBe(3); // 4 × 1,5
    expect(breachLevel(7)).toBe(4);
  });

  it('бот добивает соседний юнит и захватывает город с прочностью 0', () => {
    const s = botVsHuman();
    declareWar(s, 0, 1);
    addCity(s, 1, 12, 5, true);
    const city = addCity(s, 0, 5, 5, true);
    city.durability = 0;
    addCitizen(s, 0, 9, 8);
    const victim = s.units[s.units.length - 1];
    addUnit(s, 1, 'warrior', 8, 8, 3);
    addUnit(s, 1, 'horseman', 6, 5, 2);
    const commands = runBots(s, { budgetMs: 1e9 });
    expect(commands.some((c) => c.type === 'Attack' && c.target === victim.tile)).toBe(true);
    expect(commands.some((c) => c.type === 'CaptureCity' && c.cityId === city.id)).toBe(true);
    expect(s.powers[0].alive).toBe(false);
  });

  it('бот видит только то, что видит его держава: неразведанный вражеский город не цель', () => {
    const s = botVsHuman();
    declareWar(s, 0, 1);
    addCity(s, 1, 2, 5, true);
    const enemy = addCity(s, 0, 13, 5, true);
    s.powers[1].explored.fill(0);
    expect(chooseTargetCity(createContext(s, 1, Infinity))).toBeNull();
    s.powers[1].explored[enemy.tile] = 1;
    expect(chooseTargetCity(createContext(s, 1, Infinity))?.id).toBe(enemy.id);
  });
});

describe('экспансия', () => {
  it('места под город: на расстоянии от городов, на разведанной свободной земле', () => {
    const s = blankState(16, 12);
    s.powers[1].explored.fill(1);
    const capital = addCity(s, 1, 4, 5, true);
    const sites = findSites(createContext(s, 1, Infinity));
    expect(sites.length).toBeGreaterThan(0);
    const size = s.map;
    for (const site of sites) {
      const dc = Math.abs((site.tile % size.width) - (capital.tile % size.width));
      const dr = Math.abs(Math.floor(site.tile / size.width) - Math.floor(capital.tile / size.width));
      expect(Math.max(dc, dr)).toBeGreaterThanOrEqual(2);
    }
    s.powers[1].explored.fill(0);
    expect(findSites(createContext(s, 1, Infinity))).toEqual([]);
  });

  it('житель на хорошем месте основывает город', () => {
    const s = blankState(16, 12);
    s.powers[1].explored.fill(1);
    addCity(s, 1, 3, 5, true);
    addCitizen(s, 1, 9, 5);
    const site = findSites(createContext(s, 1, Infinity)).find((x) => x.tile === at(s, 9, 5));
    expect(site).toBeDefined();
    runBots(s, { budgetMs: 1e9 });
    expect(citiesOf(s, 1).map((c) => c.tile)).toContain(at(s, 9, 5));
  });
});

describe('ход ботов', () => {
  it('команды ботов, применённые к копии через ядро, дают то же состояние', () => {
    const s = newGame({ seed: 21, powers: 8, humanNation: null });
    for (let t = 0; t < 30; t++) {
      const copy = structuredClone(s);
      const commands = runBots(s, { budgetMs: 1e9 });
      for (const cmd of commands) expect(execute(copy, cmd)).toEqual({ ok: true });
      expect(copy).toEqual(s);
      execute(s, { type: 'EndTurn', power: 0 });
    }
  });

  it('симуляция: партия идёт, города растут, ход ботов укладывается в бюджет', () => {
    const s = newGame({ seed: 5, powers: 12, humanNation: null });
    let slowest = 0;
    for (let t = 0; t < 80; t++) {
      const t0 = performance.now();
      runBots(s, { includeHuman: true, budgetMs: 1e9 });
      slowest = Math.max(slowest, performance.now() - t0);
      execute(s, { type: 'EndTurn', power: 0 });
    }
    expect(slowest).toBeLessThan(aiConfig.turnBudgetMs);
    expect(s.cities.length).toBeGreaterThan(12 * 3);
    expect(s.log.some((e) => e.text.startsWith('Объявлена война'))).toBe(true);
    for (const p of s.powers.filter((x) => x.alive)) {
      expect(p.gold).toBeGreaterThanOrEqual(0);
      expect(unitsOf(s, p.id).every((u) => u.strength > 0)).toBe(true);
    }
  }, 60000);

  it('при нехватке времени бот прекращает ход, но команды остаются корректными', () => {
    const s = newGame({ seed: 4, powers: 12, humanNation: null });
    const copy = structuredClone(s);
    const commands = runBots(s, { budgetMs: 0 });
    for (const cmd of commands) expect(execute(copy, cmd).ok).toBe(true);
    expect(copy).toEqual(s);
  });
});

describe('пути ботов', () => {
  function bot(): ReturnType<typeof blankState> {
    const s = blankState(20, 12, 2);
    s.powers[1].character = 'diplomat';
    s.powers[0].met.push(1);
    s.powers[1].met.push(0);
    addCity(s, 0, 2, 5, true);
    addCity(s, 1, 14, 5, true);
    return s;
  }

  it('при недовольстве бот устраивает праздник', () => {
    const s = bot();
    s.powers[1].culture = 100;
    s.powers[0].effects.push({ kind: 'propaganda', target: 1, until: 99 });
    s.powers[1].gold = -10;
    refreshAllStability(s);
    expect(s.powers[1].stability).toBeLessThan(aiConfig.paths.holidayBelow);
    playBotTurn(s, 1);
    expect(s.powers[1].effects.some((e) => e.kind === 'holiday')).toBe(true);
  });

  it('в последней эпохе бот выкупает этап Великого проекта', () => {
    const s = bot();
    const last = pathsConfig.epochs[pathsConfig.epochs.length - 1];
    s.powers[1].scienceTotal = last.science;
    s.powers[1].science = 5000;
    playBotTurn(s, 1);
    expect(citiesOf(s, 1)[0].project).toEqual({ kind: 'science', stages: 1 });
  });

  it('при низкой стабильности бот не основывает новых городов сверх бесплатных', () => {
    const s = bot();
    for (const [c, r] of [[17, 2], [17, 9], [11, 9]]) addCity(s, 1, c, r);
    s.powers[1].stability = 46;
    expect(canExpand(createContext(s, 1, Infinity))).toBe(false);
    s.powers[1].stability = 60;
    expect(canExpand(createContext(s, 1, Infinity))).toBe(true);
  });
});
