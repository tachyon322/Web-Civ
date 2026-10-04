import { describe, expect, it } from 'vitest';
import { execute, validate, type Command } from '../src/core/commands';
import { diplomacyConfig } from '../src/core/data';
import {
  accepts,
  dealBlocker,
  evaluateDeal,
  shortfallHint,
  giftForecast,
  NO_TERMS,
  pendingProposals,
  refusalText,
  warSides,
} from '../src/core/diplomacy';
import { computeIncome, grossGold } from '../src/core/economy';
import { computeNetwork } from '../src/core/network';
import { addPact, memoryValue, opinion, remember } from '../src/core/relations';
import { atWar, citiesOf, hasPact, suppliedAt, truceLeft, unitsOf } from '../src/core/state';
import { computeVisible } from '../src/core/visibility';
import { NONE, type Deal, type GameState } from '../src/core/types';
import { addCity, addUnit, at, blankState, declareWar, meetAll } from './helpers';

const end = (s: GameState) => execute(s, { type: 'EndTurn', power: 0 });

/** Три державы на широкой карте: 0 — игрок, 1 и 2 — боты-дипломаты; все знакомы. */
function three(): GameState {
  const s = blankState(30, 12, 3);
  s.powers[1].character = 'diplomat';
  s.powers[2].character = 'diplomat';
  addCity(s, 0, 3, 5, true);
  addCity(s, 1, 14, 5, true);
  addCity(s, 2, 25, 5, true);
  meetAll(s);
  return s;
}

const propose = (s: GameState, power: number, target: number, deal: Deal) =>
  execute(s, { type: 'Propose', power, target, deal });

describe('относительная ценность подарков', () => {
  it('50 золота стране с доходом 10 дают +25, а державе с доходом 100 — около +3', () => {
    const s = blankState(60, 30, 3);
    s.powers[1].character = 'diplomat';
    s.powers[2].character = 'diplomat';
    addCity(s, 0, 2, 2, true);
    const small = addCity(s, 1, 2, 10, true);
    small.level = 5;
    small.buildings = ['market'];
    // Десять городов 5-го уровня с рынками — доход 100.
    for (let i = 0; i < 10; i++) {
      const c = addCity(s, 2, 10 + (i % 5) * 4, 4 + Math.floor(i / 5) * 8, i === 0);
      c.level = 5;
      c.buildings = ['market'];
    }
    // Без золота с земли — доходы ровно по уровню городов и рынкам.
    s.territory.owner.fill(NONE);
    meetAll(s);
    expect(grossGold(s, 1)).toBe(10);
    expect(grossGold(s, 2)).toBe(100);
    expect(giftForecast(s, 0, 1, 50, 'gold').value).toBe(25);
    expect(giftForecast(s, 0, 2, 50, 'gold').value).toBe(3);
  });

  it('максимум +30, повторный подарок в течение 10 ходов работает вдвое слабее', () => {
    const s = three();
    expect(giftForecast(s, 0, 1, 500, 'gold').value).toBe(diplomacyConfig.gift.max);
    expect(execute(s, { type: 'Gift', power: 0, target: 1, gold: 20 }).ok).toBe(true);
    const first = s.powers[1].memories[0].value;
    expect(first).toBeGreaterThan(0);
    expect(giftForecast(s, 0, 1, 20, 'gold').value).toBe(Math.round(first * 0.5));
    expect(s.powers[1].gold).toBe(1020);
    expect(s.powers[0].gold).toBe(980);
  });

  it('изоляционист почти не замечает подарков, во время войны их не принимают', () => {
    const s = three();
    const diplomat = giftForecast(s, 0, 1, 20, 'gold').value;
    s.powers[1].character = 'isolationist';
    expect(giftForecast(s, 0, 1, 20, 'gold').value).toBeLessThan(diplomat / 2);
    declareWar(s, 0, 1);
    expect(validate(s, { type: 'Gift', power: 0, target: 1, gold: 20 }).ok).toBe(false);
  });

  it('культурный обмен тратит культуру и улучшает отношения', () => {
    const s = three();
    s.powers[0].culture = 50;
    const before = opinion(s, 1, 0).total;
    expect(execute(s, { type: 'CultureExchange', power: 0, target: 1, culture: 20 }).ok).toBe(true);
    expect(s.powers[0].culture).toBe(30);
    expect(opinion(s, 1, 0).total).toBeGreaterThan(before);
  });
});

describe('отношения с разбивкой', () => {
  it('память держится, затем угасает и забывается', () => {
    const s = three();
    remember(s, 1, 0, 'betrayal', -40);
    const m = s.powers[1].memories[0];
    const hold = diplomacyConfig.memories.betrayal.hold;
    expect(memoryValue(m, s.turn + hold)).toBe(-40);
    expect(memoryValue(m, s.turn + hold + 20)).toBe(-30);
    expect(opinion(s, 1, 0).items.some((i) => i.label.startsWith('Нарушили договор с нами'))).toBe(true);
  });

  it('общая граница и армия у границы снижают отношения, общий враг — повышает', () => {
    const s = three();
    const base = opinion(s, 1, 0).total;
    // Территории 0 и 1 соприкасаются.
    for (let c = 5; c <= 12; c++) s.territory.owner[at(s, c, 5)] = c <= 8 ? 0 : 1;
    expect(opinion(s, 1, 0).items.some((i) => i.label === 'Общая граница')).toBe(true);
    addUnit(s, 0, 'warrior', 10, 6, 3);
    const op = opinion(s, 1, 0);
    expect(op.items.find((i) => i.label === 'Их армия у нашей границы')?.value).toBeLessThan(0);
    expect(op.total).toBeLessThan(base);
    declareWar(s, 0, 2);
    declareWar(s, 1, 2);
    expect(opinion(s, 1, 0).items.some((i) => i.label.startsWith('Общий враг'))).toBe(true);
  });
});

describe('договоры и союзы', () => {
  it('торговый договор: бот соглашается от 0, оба получают золото, больше при общей границе', () => {
    const s = three();
    const before = computeIncome(s, 0).gold.total;
    expect(propose(s, 0, 1, { kind: 'trade' }).ok).toBe(true);
    expect(hasPact(s, 0, 1, 'trade')).toBe(true);
    const cfg = diplomacyConfig.trade;
    expect(computeIncome(s, 0).gold.total).toBe(before + cfg.goldBase);
    s.territory.owner[at(s, 8, 5)] = 0;
    s.territory.owner[at(s, 9, 5)] = 1;
    expect(computeIncome(s, 1).gold.items.find((i) => i.label === 'Торговые договоры')?.value).toBe(cfg.goldBase + cfg.goldBorder);
  });

  it('отказ объясняется: «Нет: …» с причиной из отношений', () => {
    const s = three();
    remember(s, 1, 0, 'betrayal', -40);
    const score = evaluateDeal(s, 0, 1, { kind: 'trade' });
    expect(accepts(score)).toBe(false);
    expect(refusalText(s, 0, 1, score)).toMatch(/^Нет: отношения -40 — нарушили договор с нами/);
    propose(s, 0, 1, { kind: 'trade' });
    expect(hasPact(s, 0, 1, 'trade')).toBe(false);
    expect(s.log.some((e) => e.text.includes('отклоняет') && e.text.includes('Нет:'))).toBe(true);
  });

  it('союз нужен от 50; слабый соглашается на союз с сильным при меньших отношениях', () => {
    const s = three();
    expect(accepts(evaluateDeal(s, 0, 1, { kind: 'alliance' }))).toBe(false);
    remember(s, 1, 0, 'gift', 30);
    remember(s, 1, 0, 'liberated', 20);
    const equal = evaluateDeal(s, 0, 1, { kind: 'alliance' }).total;
    for (let i = 0; i < 4; i++) addUnit(s, 0, 'warrior', 2 + i, 8, 4);
    const strong = evaluateDeal(s, 0, 1, { kind: 'alliance' }).total;
    expect(strong).toBeGreaterThan(equal);
    expect(propose(s, 0, 1, { kind: 'alliance' }).ok).toBe(true);
    expect(hasPact(s, 0, 1, 'alliance')).toBe(true);
  });

  it('союзники: общий обзор, общая сеть и снабжение на союзной земле', () => {
    const s = three();
    const a = citiesOf(s, 0)[0];
    const b = addCity(s, 0, 20, 9);
    // Между городами игрока — только земля союзника 1.
    for (let c = 4; c <= 19; c++) s.territory.owner[at(s, c, 9)] = c <= 5 ? 0 : 1;
    for (let r = 6; r <= 8; r++) s.territory.owner[at(s, 4, r)] = 0;
    const far = at(s, 14, 9);
    expect(computeVisible(s, 0)[at(s, 14, 5)]).toBe(0);
    expect(suppliedAt(s, 0, far)).toBe(false);
    addPact(s, 0, 1, 'alliance');
    expect(computeVisible(s, 0)[at(s, 14, 5)]).toBe(1);
    expect(suppliedAt(s, 0, far)).toBe(true);
    const net = computeNetwork(s, 0);
    expect(net[a.tile]).not.toBe(NONE);
    expect(net[a.tile]).toBe(net[b.tile]);
  });

  it('нападение на союзника втягивает в войну и его союзника', () => {
    const s = three();
    addPact(s, 0, 1, 'alliance');
    expect(warSides(s, 2, 1).allies).toEqual([0]);
    expect(execute(s, { type: 'DeclareWar', power: 2, target: 1 }).ok).toBe(true);
    expect(atWar(s, 2, 1)).toBe(true);
    expect(atWar(s, 2, 0)).toBe(true);
    expect(hasPact(s, 0, 1, 'alliance')).toBe(true);
  });

  it('нарушение договора: жертва и все знакомые помнят долго', () => {
    const s = three();
    addPact(s, 0, 1, 'trade');
    execute(s, { type: 'DeclareWar', power: 0, target: 1 });
    expect(hasPact(s, 0, 1, 'trade')).toBe(false);
    expect(s.powers[1].memories.find((m) => m.kind === 'betrayal')?.value).toBe(diplomacyConfig.events.betrayalVictim);
    const seen = s.powers[2].memories.find((m) => m.kind === 'betrayalSeen');
    expect(seen?.value).toBeLessThan(0);
    expect(opinion(s, 2, 0).items.some((i) => i.label.startsWith('Нарушили договор с P1'))).toBe(true);
  });

  it('расторжение договора партнёр запоминает', () => {
    const s = three();
    addPact(s, 0, 1, 'trade');
    expect(execute(s, { type: 'CancelPact', power: 0, target: 1, kind: 'trade' }).ok).toBe(true);
    expect(hasPact(s, 0, 1, 'trade')).toBe(false);
    expect(s.powers[1].memories.some((m) => m.kind === 'treatyCancelled')).toBe(true);
  });
});

describe('мир и перемирие', () => {
  function atWarFor(turns: number): GameState {
    const s = three();
    declareWar(s, 0, 1);
    for (let i = 0; i < turns; i++) end(s);
    return s;
  }

  it('золото в мире без потолка: чем больше сумма, тем дороже', () => {
    const s = atWarFor(15);
    s.powers[1].gold = 5000;
    s.powers[0].gold = 5000;
    const total = (terms: Partial<typeof NO_TERMS>) => evaluateDeal(s, 0, 1, { kind: 'peace', terms: { ...NO_TERMS, ...terms } }).total;
    expect(total({ takeGold: 1000 })).toBeLessThan(total({ takeGold: 300 }));
    expect(total({ takeGold: 3000 })).toBeLessThan(total({ takeGold: 1000 }));
    expect(total({ giveGold: 1000 })).toBeGreaterThan(total({ giveGold: 300 }));
    expect(dealBlocker(s, 0, 1, { kind: 'peace', terms: { ...NO_TERMS, takeGold: 6000 } })).toBe('У них только 5000 золота');
  });

  it('подсказка: сколько золота не хватает до согласия', () => {
    const s = atWarFor(2);
    s.powers[0].gold = 3000;
    s.powers[1].gold = 3000;
    const peace: Deal = { kind: 'peace', terms: NO_TERMS };
    expect(accepts(evaluateDeal(s, 0, 1, peace))).toBe(false);
    const hint = shortfallHint(s, 0, 1, peace);
    expect(hint).not.toBeNull();
    expect(accepts(evaluateDeal(s, 0, 1, hint!.deal))).toBe(true);
    if (hint!.deal.kind === 'peace' && hint!.deal.terms.giveGold >= 5) {
      const less = { ...hint!.deal.terms, giveGold: hint!.deal.terms.giveGold - 5 };
      expect(accepts(evaluateDeal(s, 0, 1, { kind: 'peace', terms: less }))).toBe(false);
    }
    expect(shortfallHint(atWarFor(15), 0, 1, peace)).toBeNull();
    // слишком большая просьба: подсказка предлагает посильную сумму
    const greedy: Deal = { kind: 'peace', terms: { ...NO_TERMS, takeGold: 3000 } };
    const g = shortfallHint(atWarFor(15), 0, 1, greedy);
    if (g) expect(g.deal.kind === 'peace' && g.deal.terms.takeGold < 3000).toBe(true);
  });

  it('в начале войны бот мира не хочет, со временем соглашается', () => {
    const s = atWarFor(1);
    const peace: Deal = { kind: 'peace', terms: NO_TERMS };
    expect(accepts(evaluateDeal(s, 0, 1, peace))).toBe(false);
    const later = atWarFor(15);
    expect(accepts(evaluateDeal(later, 0, 1, peace))).toBe(true);
    expect(propose(later, 0, 1, peace).ok).toBe(true);
    expect(atWar(later, 0, 1)).toBe(false);
    expect(truceLeft(later, 0, 1)).toBe(diplomacyConfig.truceTurns);
  });

  it('перемирие 10 ходов: напасть нельзя, потом можно', () => {
    const s = atWarFor(15);
    propose(s, 0, 1, { kind: 'peace', terms: NO_TERMS });
    const war: Command = { type: 'DeclareWar', power: 0, target: 1 };
    const v = validate(s, war);
    expect(v.ok).toBe(false);
    expect(v.ok ? '' : v.reason).toMatch(/Перемирие/);
    for (let i = 0; i < diplomacyConfig.truceTurns; i++) end(s);
    expect(validate(s, war).ok).toBe(true);
    expect(s.powers[1].memories.some((m) => m.kind === 'recentWar')).toBe(true);
  });

  it('мир с условиями: город с гарнизоном и золото переходят победителю', () => {
    const s = atWarFor(15);
    const city = addCity(s, 1, 14, 9);
    const guard = addUnit(s, 1, 'warrior', 14, 9, 2);
    const terms = { ...NO_TERMS, takeCity: city.id, takeGold: 50 };
    // Город игроку неизвестен — требовать нельзя.
    expect(dealBlocker(s, 0, 1, { kind: 'peace', terms })).toBe('Этот город вам неизвестен');
    s.powers[0].explored[city.tile] = 1;
    const capital = citiesOf(s, 1).find((c) => c.isCapital)!;
    expect(dealBlocker(s, 0, 1, { kind: 'peace', terms: { ...terms, takeCity: capital.id } })).toBe('Столицу по договору не отдают');
    // Сильная армия игрока делает условия приемлемыми.
    for (let i = 0; i < 6; i++) addUnit(s, 0, 'warrior', 1 + i, 1, 4);
    expect(accepts(evaluateDeal(s, 0, 1, { kind: 'peace', terms }))).toBe(true);
    const gold = s.powers[0].gold;
    expect(propose(s, 0, 1, { kind: 'peace', terms }).ok).toBe(true);
    expect(city.owner).toBe(0);
    expect(guard.tile).not.toBe(city.tile);
    expect(unitsOf(s, 1)).toContain(guard);
    expect(s.powers[0].gold).toBe(gold + 50);
  });
});

describe('вассалы', () => {
  function vassalState(): GameState {
    const s = three();
    // Держава 2 крупная, чтобы союз игрока с вассалом не дал победу федерацией.
    citiesOf(s, 2)[0].level = 5;
    addCity(s, 2, 25, 9).level = 5;
    declareWar(s, 0, 1);
    for (let i = 0; i < 15; i++) end(s);
    for (let i = 0; i < 6; i++) addUnit(s, 0, 'warrior', 1 + i, 1, 4);
    expect(propose(s, 0, 1, { kind: 'peace', terms: { ...NO_TERMS, vassal: 1 } }).ok).toBe(true);
    return s;
  }

  it('капитуляция делает вассалом: дань 20% дохода, своих войн не объявляет', () => {
    const s = vassalState();
    expect(s.powers[1].suzerain).toBe(0);
    const tribute = computeIncome(s, 1).gold.items.find((i) => i.label === 'Дань сюзерену')!.value;
    expect(tribute).toBeLessThan(0);
    expect(computeIncome(s, 0).gold.items.find((i) => i.label === 'Дань вассалов')!.value).toBe(-tribute);
    const v = validate(s, { type: 'DeclareWar', power: 1, target: 2 });
    expect(v.ok ? '' : v.reason).toMatch(/Вассал не объявляет/);
  });

  it('война с вассалом — война с сюзереном, вассал воюет на стороне сюзерена', () => {
    const s = vassalState();
    execute(s, { type: 'DeclareWar', power: 2, target: 1 });
    expect(atWar(s, 2, 0)).toBe(true);
    const s2 = vassalState();
    s2.pacts = s2.pacts.filter((p) => p.kind !== 'truce');
    execute(s2, { type: 'DeclareWar', power: 0, target: 2 });
    expect(atWar(s2, 1, 2)).toBe(true);
  });

  it('вассал восстаёт, когда становится сильнее сюзерена', () => {
    const s = vassalState();
    s.units = s.units.filter((u) => u.owner !== 0);
    for (let i = 0; i < 4; i++) addUnit(s, 1, 'warrior', 10 + i, 1, 4);
    end(s);
    expect(s.powers[1].suzerain).toBe(NONE);
    expect(s.powers[0].memories.some((m) => m.kind === 'rebellion')).toBe(true);
  });
});

describe('уния, дань, просьба о войне', () => {
  it('уния: после 20 ходов союза при отношениях от 80 младший вливается в старшего', () => {
    const s = three();
    s.powers[0].isHuman = false;
    s.powers[0].character = 'diplomat';
    addCity(s, 0, 3, 9);
    addPact(s, 0, 1, 'alliance');
    const deal: Deal = { kind: 'union' };
    expect(dealBlocker(s, 0, 1, deal)).toMatch(/Нужен союз не меньше 20/);
    s.pacts[0].since = s.turn - 20;
    remember(s, 1, 0, 'liberated', 40);
    remember(s, 1, 0, 'gift', 30);
    expect(accepts(evaluateDeal(s, 0, 1, deal))).toBe(true);
    const unit = addUnit(s, 1, 'warrior', 14, 8, 2);
    expect(propose(s, 0, 1, deal).ok).toBe(true);
    expect(s.powers[1].alive).toBe(false);
    expect(citiesOf(s, 0).length).toBe(3);
    expect(unit.owner).toBe(0);
    expect(citiesOf(s, 0).filter((c) => c.isCapital).length).toBe(1);
  });

  it('игрока в чужую державу не принимают', () => {
    const s = three();
    expect(dealBlocker(s, 1, 0, { kind: 'union' })).toBe('Игрок не входит в чужую державу');
  });

  it('дань платят только намного более сильному; отказ портит отношения обеим сторонам', () => {
    const s = three();
    const deal: Deal = { kind: 'tribute', gold: 20 };
    expect(propose(s, 0, 1, deal).ok).toBe(true);
    expect(s.powers[1].gold).toBe(1000);
    expect(s.powers[1].memories.some((m) => m.kind === 'tributeDemanded')).toBe(true);
    expect(s.powers[0].memories.some((m) => m.kind === 'tributeRefused')).toBe(true);
    expect(validate(s, { type: 'Propose', power: 0, target: 1, deal }).ok).toBe(false);
    const s2 = three();
    for (let i = 0; i < 6; i++) addUnit(s2, 0, 'warrior', 1 + i, 1, 4);
    expect(propose(s2, 0, 1, deal).ok).toBe(true);
    expect(s2.powers[1].gold).toBe(980);
    expect(s2.powers[0].gold).toBe(1020);
    expect(s2.powers[1].memories.some((m) => m.kind === 'tributePaid')).toBe(true);
  });

  it('союзник соглашается вступить в войну; тот, кто помог, запомнится', () => {
    const s = three();
    addPact(s, 0, 1, 'alliance');
    remember(s, 1, 0, 'gift', 30);
    declareWar(s, 0, 2);
    // Сам союзник не втянут: нападал игрок.
    expect(atWar(s, 1, 2)).toBe(false);
    for (let i = 0; i < 3; i++) addUnit(s, 1, 'warrior', 12 + i, 1, 4);
    const deal: Deal = { kind: 'joinWar', enemy: 2, gold: 0 };
    expect(accepts(evaluateDeal(s, 0, 1, deal))).toBe(true);
    expect(propose(s, 0, 1, deal).ok).toBe(true);
    expect(atWar(s, 1, 2)).toBe(true);
    expect(s.powers[0].memories.some((m) => m.kind === 'joinedWar')).toBe(true);
  });
});

describe('предложения игроку', () => {
  it('ждут ответа до конца следующего хода игрока; принятие исполняет сделку', () => {
    const s = three();
    expect(propose(s, 1, 0, { kind: 'trade' }).ok).toBe(true);
    const [pr] = pendingProposals(s, 0);
    expect(pr).toBeDefined();
    expect(validate(s, { type: 'Propose', power: 1, target: 0, deal: { kind: 'trade' } }).ok).toBe(false);
    end(s);
    expect(pendingProposals(s, 0)).toHaveLength(1);
    expect(execute(s, { type: 'Respond', power: 0, proposalId: pr.id, accept: true }).ok).toBe(true);
    expect(hasPact(s, 0, 1, 'trade')).toBe(true);
  });

  it('без ответа предложение истекает; неотвеченное требование дани — как отказ', () => {
    const s = three();
    propose(s, 1, 0, { kind: 'tribute', gold: 10 });
    end(s);
    end(s);
    expect(pendingProposals(s, 0)).toHaveLength(0);
    expect(s.powers[1].memories.some((m) => m.kind === 'tributeRefused')).toBe(true);
  });
});

describe('коалиция и журнал', () => {
  it('держава с чужими столицами — лидер: о ней узнают все, отношения к ней падают', () => {
    const s = blankState(30, 12, 4);
    for (let i = 1; i < 4; i++) s.powers[i].character = 'diplomat';
    s.map.starts = [at(s, 3, 5), at(s, 10, 5), at(s, 17, 5), at(s, 24, 5)];
    s.map.starts.forEach((t, i) => addCity(s, i, t % 30, Math.floor(t / 30), true));
    meetAll(s);
    const capital = citiesOf(s, 1)[0];
    capital.owner = 0;
    end(s);
    expect(s.coalitionLeader).toBe(0);
    expect(opinion(s, 2, 0).items.some((i) => i.label === 'Близки к победе')).toBe(true);
    expect(opinion(s, 2, 3).items.some((i) => i.label.startsWith('Общая угроза'))).toBe(true);
    expect(s.log.some((e) => e.text.includes('собирается коалиция'))).toBe(true);
  });

  it('объявление войны видят только те, кто встречал участников', () => {
    const s = blankState(30, 12, 3);
    s.powers[1].met.push(2);
    s.powers[2].met.push(1);
    execute(s, { type: 'DeclareWar', power: 1, target: 2 });
    const entry = s.log.find((e) => e.text.startsWith('Объявлена война'))!;
    expect(entry.audience).toEqual([1, 2]);
  });

  it('освобождённый город приносит большой плюс к отношениям', () => {
    const s = three();
    const city = addCity(s, 1, 14, 9);
    city.owner = 2;
    declareWar(s, 0, 2);
    city.durability = 0;
    const u = addUnit(s, 0, 'warrior', 13, 9, 2);
    expect(execute(s, { type: 'CaptureCity', power: 0, unitId: u.id, cityId: city.id, choice: 'liberate' }).ok).toBe(true);
    expect(opinion(s, 1, 0).items.find((i) => i.label.startsWith('Освободили наш город'))?.value).toBe(40);
  });
});
