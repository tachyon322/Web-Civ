import { describe, expect, it } from 'vitest';
import { NO_TARGET, type AbilityUse } from '../src/core/abilities';
import { buildingPrice, wondersOwned } from '../src/core/buildings';
import { transferCity } from '../src/core/capture';
import { improvableTiles } from '../src/core/improvements';
import { specialistPrice } from '../src/core/specialists';
import { cityStrength, forecastAttack } from '../src/core/combat';
import { execute, validate, type Command } from '../src/core/commands';
import { pathsConfig, type AbilityId, type Currency } from '../src/core/data';
import { NO_TERMS, evaluateDeal } from '../src/core/diplomacy';
import { citizenPrice, computeIncome } from '../src/core/economy';
import { epochOf } from '../src/core/epochs';
import { findCoalitionLeader } from '../src/core/relations';
import { projectCooldown } from '../src/core/victory';
import { computeStability, refreshAllStability } from '../src/core/stability';
import { atWar, citiesOf, cityMaxDurability, citySlots, cityUnitLevel, fitCityToLevel, unitAt, usedSlots } from '../src/core/state';
import { S_GOLD, S_MARBLE, S_RUINS, T_WATER, NONE, type GameState, type SpecialistKind } from '../src/core/types';
import { computeVisible } from '../src/core/visibility';
import { addCity, addUnit, at, blankState, declareWar, meetAll } from './helpers';

const end = (s: GameState) => execute(s, { type: 'EndTurn', power: 0 });
const epochs = pathsConfig.epochs;
const item = (s: GameState, power: number, label: string) => computeStability(s, power).items.find((i) => i.label.startsWith(label))?.value;
const ability = (s: GameState, power: number, ab: AbilityId, extra: Partial<AbilityUse> = {}) =>
  execute(s, { type: 'UseAbility', power, ...NO_TARGET, ability: ab, ...extra });

/** Три державы, все знакомы, у каждой столица; игроку — запас науки и культуры. */
function three(): GameState {
  const s = blankState(30, 12, 3);
  s.powers[1].character = 'diplomat';
  s.powers[2].character = 'diplomat';
  addCity(s, 0, 3, 5, true);
  addCity(s, 1, 14, 5, true);
  addCity(s, 2, 25, 5, true);
  meetAll(s);
  s.powers[0].science = 5000;
  s.powers[0].culture = 5000;
  refreshAllStability(s);
  return s;
}

describe('эпохи', () => {
  it('наступают по всей заработанной науке; трата науки эпоху не отнимает', () => {
    const s = three();
    const p = s.powers[0];
    expect(epochOf(p)).toBe(0);
    p.scienceTotal = epochs[1].science - 1;
    p.science = 0;
    s.cities[0].buildings = ['library'];
    end(s);
    expect(epochOf(p)).toBe(1);
    expect(s.log.some((e) => e.text.includes('вступает в эпоху «Античность»'))).toBe(true);
    p.science = 0;
    expect(epochOf(p)).toBe(1);
  });

  it('эпоха даёт +1 к ходу, но не силу: у науки нет боевых бонусов', () => {
    const s = three();
    declareWar(s, 0, 1);
    const a = addUnit(s, 0, 'warrior', 8, 5, 2);
    addUnit(s, 1, 'warrior', 9, 5, 2);
    const before = forecastAttack(s, a, at(s, 9, 5)).attacker.effective;
    s.powers[0].scienceTotal = epochs[2].science;
    s.powers[1].scienceTotal = 0;
    const f = forecastAttack(s, a, at(s, 9, 5));
    expect(f.attacker.modifiers.some((m) => /Эпоха|разрыв/.test(m.label))).toBe(false);
    expect(f.attacker.effective).toBe(before);
    end(s);
    expect(a.mp).toBe(4 + 2 * pathsConfig.epoch.mpPerEpoch + (s.territory.owner[a.tile] === 0 ? 1 : 0));
  });

});

describe('стабильность', () => {
  it('разбивка: база, мир, храмы, лишние города, долги', () => {
    const s = three();
    const cfg = pathsConfig.stability;
    expect(computeStability(s, 0).total).toBe(cfg.base + cfg.peace);
    s.cities[0].buildings = ['temple'];
    expect(item(s, 0, 'Храмы')).toBe(1);
    for (const [c, r] of [[3, 1], [7, 1], [3, 9], [7, 9]]) addCity(s, 0, c, r);
    expect(item(s, 0, 'Города сверх 3')).toBe(2 * cfg.extraCity);
    s.powers[0].gold = -5;
    expect(item(s, 0, 'Долги')).toBe(cfg.debts);
  });

  it('усталость от войны копится, у агрессора сильнее', () => {
    const s = three();
    execute(s, { type: 'DeclareWar', power: 0, target: 1 });
    for (let i = 0; i < 10; i++) end(s);
    const aggressor = item(s, 0, 'Усталость')!;
    const victim = item(s, 1, 'Усталость')!;
    expect(victim).toBeLessThan(0);
    expect(aggressor).toBeLessThan(victim);
    expect(item(s, 0, 'Мир')).toBeUndefined();
  });

  it('расцвет прибавляет доходы, недовольство убавляет их и боевой дух', () => {
    const s = three();
    s.cities[0].level = 5;
    s.cities[0].buildings = ['market'];
    const base = computeIncome(s, 0).gold.total;
    s.powers[0].stability = 80;
    expect(computeIncome(s, 0).gold.total).toBeGreaterThan(base);
    s.powers[0].stability = 30;
    expect(computeIncome(s, 0).gold.total).toBeLessThan(base);
    declareWar(s, 0, 1);
    const a = addUnit(s, 0, 'warrior', 8, 5, 2);
    addUnit(s, 1, 'warrior', 9, 5, 2);
    expect(forecastAttack(s, a, at(s, 9, 5)).attacker.modifiers.find((m) => m.label.includes('боевой дух'))?.factor).toBe(0.8);
  });

  it('мятежи: предупреждение, через 3 хода город уходит к соседу с самой сильной культурой', () => {
    const s = three();
    const far = addCity(s, 0, 10, 9);
    s.powers[1].cultureTotal = 500;
    s.powers[0].effects.push({ kind: 'propaganda', target: 0, until: 999 });
    s.powers[2].effects.push({ kind: 'propaganda', target: 0, until: 999 });
    s.powers[0].gold = -100;
    s.powers[0].culture = 0;
    end(s);
    expect(s.powers[0].stability).toBeLessThan(pathsConfig.stability.secessionBelow);
    expect(s.powers[0].secession?.cityId).toBe(far.id);
    for (let i = 0; i < pathsConfig.stability.secessionWarningTurns; i++) end(s);
    expect(far.owner).toBe(1);
  });

  it('отрезанные от столицы связанные города образуют новое государство', () => {
    const s = three();
    const a = addCity(s, 0, 10, 9);
    const b = addCity(s, 0, 13, 9);
    for (let c = 10; c <= 13; c++) s.territory.owner[at(s, c, 9)] = 0;
    s.powers[0].effects.push({ kind: 'propaganda', target: 0, until: 999 });
    s.powers[1].effects.push({ kind: 'propaganda', target: 0, until: 999 });
    s.powers[0].gold = -100;
    for (let i = 0; i <= pathsConfig.stability.secessionWarningTurns; i++) end(s);
    expect(s.powers.length).toBe(4);
    expect(a.owner).toBe(3);
    expect(b.owner).toBe(3);
    expect(s.powers[3].alive).toBe(true);
    expect(citiesOf(s, 3).filter((c) => c.isCapital)).toHaveLength(1);
  });
});

describe('здания, улучшения и чудеса', () => {
  it('улучшение доступно без эпохи, стоит золото и занимает тот же слот', () => {
    const s = three();
    const city = s.cities[0];
    const p = s.powers[0];
    city.buildings = ['library'];
    const science = p.science;
    const gold = p.gold;
    const price = buildingPrice(s, 0, 'university');
    expect(execute(s, { type: 'BuyBuilding', power: 0, cityId: city.id, buildingId: 'university' }).ok).toBe(true);
    expect(city.buildings).toEqual(['university']);
    expect(p.gold).toBe(gold - price);
    expect(p.science).toBe(science);
    city.purchasedThisTurn = false;
    expect(validate(s, { type: 'BuyBuilding', power: 0, cityId: city.id, buildingId: 'library' })).toEqual({ ok: false, reason: 'Уже есть улучшенное здание' });
    // Цепочка идёт по шагам: лабораторию — только после обсерватории.
    expect(validate(s, { type: 'BuyBuilding', power: 0, cityId: city.id, buildingId: 'laboratory' })).toEqual({ ok: false, reason: 'Сначала нужно здание «Обсерватория»' });
    expect(execute(s, { type: 'BuyBuilding', power: 0, cityId: city.id, buildingId: 'observatory' }).ok).toBe(true);
    expect(city.buildings).toEqual(['observatory']);
  });

  it('чудо света одно на весь мир и дешевле в городе с мрамором', () => {
    const s = three();
    const mine = s.cities[0];
    s.cities[1].level = 2;
    const cmd: Command = { type: 'BuyBuilding', power: 0, cityId: mine.id, buildingId: 'pyramids' };
    const plain = buildingPrice(s, 0, 'pyramids', mine);
    s.map.special[at(s, 4, 5)] = S_MARBLE;
    const marble = buildingPrice(s, 0, 'pyramids', mine);
    expect(marble).toBeLessThan(plain);
    // Каменоломня на мраморе — ещё дешевле.
    s.improvements.push(at(s, 4, 5));
    expect(buildingPrice(s, 0, 'pyramids', mine)).toBeLessThan(marble);
    const gold = s.powers[0].gold;
    const price = buildingPrice(s, 0, 'pyramids', mine);
    expect(execute(s, cmd).ok).toBe(true);
    expect(s.powers[0].gold).toBe(gold - price);
    expect(wondersOwned(s, 0)).toBe(1);
    const v = validate(s, { type: 'BuyBuilding', power: 1, cityId: s.cities[1].id, buildingId: 'pyramids' });
    expect(v.ok ? '' : v.reason).toMatch(/Чудо уже построено/);
    expect(item(s, 0, 'Чудеса')).toBe(3);
  });

  it('чудо и державное здание слот не занимают; потеря уровня сносит только обычные здания', () => {
    const s = three();
    const city = s.cities[0];
    city.buildings = ['market'];
    expect(validate(s, { type: 'BuyBuilding', power: 0, cityId: city.id, buildingId: 'library' })).toEqual({ ok: false, reason: 'Нет свободных слотов' });
    expect(execute(s, { type: 'BuyBuilding', power: 0, cityId: city.id, buildingId: 'pyramids' }).ok).toBe(true);
    expect(usedSlots(city)).toBe(1);
    city.level = 2;
    city.buildings = ['market', 'pyramids', 'library', 'treasury'];
    city.level = 1;
    fitCityToLevel(s, city);
    expect(city.buildings).toEqual(['market', 'pyramids', 'treasury']);
  });

  it('средневековье и индустрия дают по слоту во всех городах', () => {
    const s = three();
    const city = s.cities[0];
    expect(citySlots(s, city)).toBe(1);
    s.powers[0].scienceTotal = epochs[2].science;
    expect(citySlots(s, city)).toBe(2);
    s.powers[0].scienceTotal = epochs[4].science;
    expect(citySlots(s, city)).toBe(3);
  });

  it('специалисты: за золото или свою валюту, не больше уровня города, цена растёт', () => {
    const s = three();
    const city = s.cities[0];
    const p = s.powers[0];
    city.level = 2;
    const buy = (kind: SpecialistKind, currency: Currency): Command => ({ type: 'BuySpecialist', power: 0, cityId: city.id, kind, currency });
    expect(validate(s, buy('merchant', 'science'))).toEqual({ ok: false, reason: 'Купец не покупается за эту валюту' });
    const science = p.science;
    const total = p.scienceTotal;
    expect(execute(s, buy('scientist', 'science')).ok).toBe(true);
    expect(p.science).toBe(science - 20);
    expect(p.scienceTotal).toBe(total);
    expect(city.specialists.scientist).toBe(1);
    expect(computeIncome(s, 0).science.items.find((i) => i.label === 'Специалисты: учёных')?.value).toBe(2);
    expect(validate(s, buy('artisan', 'gold'))).toEqual({ ok: false, reason: 'В этом городе уже была покупка в этом ходу' });
    city.purchasedThisTurn = false;
    const gold = p.gold;
    expect(execute(s, buy('artisan', 'gold')).ok).toBe(true);
    expect(p.gold).toBe(gold - 20);
    city.purchasedThisTurn = false;
    expect(validate(s, buy('scientist', 'gold'))).toEqual({ ok: false, reason: 'В городе 2-го уровня не больше 2 специалистов' });
    expect(specialistPrice(s, 0, 'scientist')).toBe(30);
    city.level = 1;
    fitCityToLevel(s, city);
    expect(city.specialists.scientist + city.specialists.artisan).toBe(1);
  });

  it('школа даёт науку за каждого учёного в городе', () => {
    const s = three();
    const city = s.cities[0];
    city.level = 3;
    city.specialists.scientist = 2;
    city.buildings = ['school'];
    expect(computeIncome(s, 0).science.items.find((i) => i.label === 'Школа')?.value).toBe(2);
    city.buildings = ['college'];
    expect(computeIncome(s, 0).science.items.find((i) => i.label === 'Колледж')?.value).toBe(6);
  });

  it('гавань — только в городе у моря', () => {
    const s = three();
    const city = s.cities[0];
    const cmd: Command = { type: 'BuyBuilding', power: 0, cityId: city.id, buildingId: 'harbor' };
    expect(validate(s, cmd)).toEqual({ ok: false, reason: 'Только в городе у моря' });
    s.map.terrain[at(s, 3, 6)] = T_WATER;
    expect(execute(s, cmd).ok).toBe(true);
  });

  it('державное здание: нужно 3 университета, +15% науки, одно на державу, пропадает при захвате', () => {
    const s = three();
    const capital = s.cities[0];
    const b = addCity(s, 0, 8, 2);
    const c = addCity(s, 0, 8, 9);
    capital.buildings = ['university'];
    b.buildings = ['observatory'];
    const cmd: Command = { type: 'BuyBuilding', power: 0, cityId: capital.id, buildingId: 'royal_academy' };
    expect(validate(s, cmd)).toEqual({ ok: false, reason: 'Нужно городов с «Университет» (или лучше): 3, сейчас 2' });
    c.buildings = ['laboratory'];
    const before = computeIncome(s, 0).science;
    expect(execute(s, cmd).ok).toBe(true);
    const bonus = computeIncome(s, 0).science.items.find((i) => i.label === 'Королевская академия')?.value;
    const base = before.items.filter((i) => !/Полисы|Стабильность|Утечка/.test(i.label)).reduce((sum, i) => sum + i.value, 0);
    expect(bonus).toBe(Math.round(base * 0.15));
    b.purchasedThisTurn = false;
    const v = validate(s, { type: 'BuyBuilding', power: 0, cityId: b.id, buildingId: 'royal_academy' });
    expect(v.ok ? '' : v.reason).toBe(`Уже есть в державе: ${capital.name}`);
    transferCity(s, capital, 1);
    expect(capital.buildings).toEqual(['university']);
  });

  it('сооружение на особой клетке своего города: одно на клетку, приносит доход', () => {
    const s = three();
    const city = s.cities[0];
    const p = s.powers[0];
    const tile = at(s, 4, 5);
    s.map.special[tile] = S_GOLD;
    expect(improvableTiles(s, city)).toEqual([tile]);
    const gold = p.gold;
    const cmd: Command = { type: 'BuyImprovement', power: 0, cityId: city.id, tile };
    expect(execute(s, cmd).ok).toBe(true);
    expect(p.gold).toBe(gold - 50);
    expect(computeIncome(s, 0).gold.items.find((i) => i.label === 'Рудник')?.value).toBe(3);
    city.purchasedThisTurn = false;
    expect(validate(s, cmd)).toEqual({ ok: false, reason: 'Сооружение уже построено' });
    const far = at(s, 10, 5);
    s.map.special[far] = S_RUINS;
    expect(validate(s, { type: 'BuyImprovement', power: 0, cityId: city.id, tile: far })).toEqual({ ok: false, reason: 'Клетка не принадлежит этому городу' });
  });

  it('военная академия даёт юниты 3-го уровня по цене четырёх жителей', () => {
    const s = three();
    const city = s.cities[0];
    const p = s.powers[0];
    city.buildings = ['barracks'];
    p.gold = 1000;
    expect(execute(s, { type: 'BuyBuilding', power: 0, cityId: city.id, buildingId: 'academy' }).ok).toBe(true);
    expect(cityUnitLevel(city)).toBe(3);
    city.purchasedThisTurn = false;
    const gold = p.gold;
    expect(execute(s, { type: 'BuyMilitary', power: 0, cityId: city.id, unitType: 'warrior' }).ok).toBe(true);
    expect(p.gold).toBe(gold - 4 * citizenPrice(s, 0));
    expect(s.units.find((u) => u.owner === 0 && u.type === 'warrior')?.level).toBe(3);
  });

  it('крепость и бастион крепче стен', () => {
    const s = three();
    const city = s.cities[0];
    city.level = 1;
    city.buildings = ['walls'];
    const walls = cityStrength(city);
    city.buildings = ['fortress'];
    expect(cityStrength(city)).toBe(walls + 1);
    city.buildings = ['bastion'];
    expect(cityStrength(city)).toBe(walls + 2);
    expect(cityMaxDurability(city)).toBe(cityMaxDurability({ ...city, buildings: ['walls'] }) + 1);
  });

  it('чудо света одно на весь мир и дешевле в городе с мрамором', () => {
    const s = three();
    const mine = s.cities[0];
    s.cities[1].level = 2;
    const cmd: Command = { type: 'BuyBuilding', power: 0, cityId: mine.id, buildingId: 'pyramids' };
    const plain = buildingPrice(s, 0, 'pyramids', mine);
    s.map.special[at(s, 4, 5)] = S_MARBLE;
    expect(buildingPrice(s, 0, 'pyramids', mine)).toBeLessThan(plain);
    expect(execute(s, cmd).ok).toBe(true);
    expect(wondersOwned(s, 0)).toBe(1);
    const v = validate(s, { type: 'BuyBuilding', power: 1, cityId: s.cities[1].id, buildingId: 'pyramids' });
    expect(v.ok ? '' : v.reason).toMatch(/Чудо уже построено/);
    expect(item(s, 0, 'Чудеса')).toBe(3);
  });
});

describe('пассивная культура', () => {
  it('ополчение: в атакованном городе культурной державы без защитника появляется воин', () => {
    const s = three();
    const city = s.cities[1];
    city.buildings = ['temple'];
    city.level = 5;
    for (let i = 0; i < 4; i++) addCity(s, 1, 10 + (i % 2) * 6, i < 2 ? 1 : 10).buildings = ['temple'];
    declareWar(s, 0, 1);
    const a = addUnit(s, 0, 'archer', 12, 5, 4);
    expect(execute(s, { type: 'Attack', power: 0, unitId: a.id, target: city.tile }).ok).toBe(true);
    end(s);
    const militia = unitAt(s, city.tile);
    expect(militia?.owner).toBe(1);
    expect(militia?.type).toBe('warrior');
    expect(militia?.level).toBe(2);
  });

  it('захваченный город с более культурным прежним владельцем восстаёт, гарнизон сдерживает', () => {
    const run = (garrison: boolean) => {
      const s = three();
      s.powers[1].cultureTotal = 400;
      const city = addCity(s, 1, 14, 9);
      declareWar(s, 0, 1);
      city.durability = 0;
      const u = addUnit(s, 0, garrison ? 'warrior' : 'horseman', 13, 9, garrison ? 3 : 1);
      execute(s, { type: 'CaptureCity', power: 0, unitId: u.id, cityId: city.id, choice: 'annex' });
      expect(city.revoltFrom).toBe(1);
      if (!garrison) s.units = s.units.filter((x) => x !== u);
      for (let i = 0; i < pathsConfig.culture.revoltTurns; i++) end(s);
      return city.owner;
    };
    expect(run(false)).toBe(1);
    expect(run(true)).toBe(0);
  });

  it('культурное давление: приграничный город слабого соседа переходит сам', () => {
    const s = three();
    const city = addCity(s, 1, 6, 5);
    s.powers[0].cultureTotal = 2000;
    s.powers[1].cultureTotal = 100;
    let turns = 0;
    while (city.owner === 1 && turns < 50) {
      end(s);
      turns++;
    }
    expect(city.owner).toBe(0);
    expect(turns).toBeGreaterThan(10);
  });

  it('утечка мозгов: сосед с сильной культурой забирает часть науки', () => {
    const s = three();
    s.cities[1].buildings = ['laboratory'];
    s.cities[1].level = 3;
    for (let i = 0; i < 3; i++) addCity(s, 1, 12 + i * 3, 10).buildings = ['laboratory'];
    s.territory.owner[at(s, 8, 5)] = 0;
    s.territory.owner[at(s, 9, 5)] = 1;
    const before = computeIncome(s, 1).science.total;
    s.powers[0].cultureTotal = 500;
    s.powers[1].cultureTotal = 100;
    const lost = computeIncome(s, 1).science.items.find((i) => i.label === 'Утечка мозгов')?.value;
    expect(lost).toBeLessThan(0);
    expect(computeIncome(s, 1).science.total).toBe(before + lost!);
    expect(computeIncome(s, 0).science.items.find((i) => i.label === 'Утечка мозгов к нам')?.value).toBe(-lost!);
  });
});

describe('способности', () => {
  it('праздник и пропаганда меняют стабильность и тратят культуру', () => {
    const s = three();
    const before = s.powers[0].stability;
    expect(ability(s, 0, 'holiday').ok).toBe(true);
    expect(s.powers[0].stability).toBe(before + pathsConfig.abilities.holiday.stability);
    expect(s.powers[0].culture).toBe(5000 - pathsConfig.abilities.holiday.cost);
    expect(ability(s, 0, 'holiday').ok).toBe(false);
    const target = s.powers[1].stability;
    expect(ability(s, 0, 'propaganda', { target: 1 }).ok).toBe(true);
    expect(s.powers[1].stability).toBe(target + pathsConfig.stability.propaganda);
    expect(s.powers[1].memories.some((m) => m.kind === 'propaganda')).toBe(true);
  });

  it('разведка показывает все юниты державы', () => {
    const s = three();
    const spy = addUnit(s, 1, 'warrior', 20, 10, 2);
    expect(computeVisible(s, 0)[spy.tile]).toBe(0);
    expect(ability(s, 0, 'recon', { target: 1 }).ok).toBe(true);
    expect(computeVisible(s, 0)[spy.tile]).toBe(1);
  });

  it('саботаж сети отключает храмы, театры и музеи города: их культура и стабильность не идут', () => {
    const s = three();
    const enemy = s.cities[1];
    enemy.buildings = ['market'];
    s.powers[0].explored[enemy.tile] = 1;
    expect(ability(s, 0, 'sabotage', { cityId: enemy.id }).ok).toBe(false);
    enemy.buildings = ['market', 'temple'];
    const culture = computeIncome(s, 1).culture.total;
    const gold = computeIncome(s, 1).gold.total;
    expect(ability(s, 0, 'sabotage', { cityId: enemy.id }).ok).toBe(true);
    expect(computeIncome(s, 1).culture.total).toBeLessThan(culture);
    expect(computeIncome(s, 1).gold.total).toBe(gold);
    expect(item(s, 1, 'Храмы')).toBeUndefined();
    for (let i = 0; i < pathsConfig.abilities.sabotage.turns; i++) end(s);
    expect(computeIncome(s, 1).culture.total).toBe(culture);
  });

  it('переманивание: вражеский юнит у границы переходит к вам', () => {
    const s = three();
    declareWar(s, 0, 1);
    const u = addUnit(s, 1, 'warrior', 4, 6, 2);
    expect(ability(s, 0, 'convert', { unitId: u.id }).ok).toBe(true);
    expect(u.owner).toBe(0);
    expect(s.powers[0].culture).toBe(5000 - 2 * pathsConfig.abilities.convert.costPerPerson);
  });

  it('призыв к миру: агрессор соглашается или все его осуждают', () => {
    const s = three();
    execute(s, { type: 'DeclareWar', power: 1, target: 2 });
    expect(ability(s, 0, 'callPeace', { target: 2, victim: 1 }).ok).toBe(false);
    s.powers[0].culture = 5000;
    expect(ability(s, 0, 'callPeace', { target: 1, victim: 2 }).ok).toBe(true);
    // Война только началась — агрессор отказывается, все знакомые запоминают.
    expect(atWar(s, 1, 2)).toBe(true);
    expect(s.powers[2].memories.some((m) => m.kind === 'refusedPeace' && m.about === 1)).toBe(true);
    for (let i = 0; i < 20; i++) end(s);
    expect(ability(s, 0, 'callPeace', { target: 1, victim: 2 }).ok).toBe(true);
    expect(atWar(s, 1, 2)).toBe(false);
  });

});

describe('финальные проекты и победы', () => {
  it('Великий проект: только в последней эпохе, между этапами откат; три этапа — победа', () => {
    const s = three();
    const city = s.cities[0];
    const cmd: Command = { type: 'BuyProjectStage', power: 0, cityId: city.id, kind: 'science' };
    const cooldown = pathsConfig.projects.science.cooldown;
    // Сразу после покупки и все ходы отката следующий этап недоступен.
    const passCooldown = () => {
      for (let i = 0; i < cooldown; i++) {
        expect(validate(s, cmd).ok).toBe(false);
        end(s);
      }
    };
    expect(validate(s, cmd).ok).toBe(false);
    s.powers[0].scienceTotal = epochs[epochs.length - 1].science;
    s.powers[0].science = 100000;
    expect(execute(s, cmd).ok).toBe(true);
    expect(projectCooldown(s, city, 'science')).toBe(cooldown);
    passCooldown();
    expect(findCoalitionLeader(s)).toBe(0);
    expect(s.coalitionLeader).toBe(0);
    expect(execute(s, cmd).ok).toBe(true);
    passCooldown();
    expect(execute(s, cmd).ok).toBe(true);
    expect(s.winner).toEqual({ power: 0, kind: 'science', turn: s.turn });
    expect(validate(s, { type: 'EndTurn', power: 0 })).toEqual({ ok: false, reason: 'Партия окончена' });
  });

  it('при захвате города прогресс Великого проекта сгорает', () => {
    const s = three();
    const city = s.cities[1];
    s.powers[1].science = 10000;
    s.powers[1].scienceTotal = epochs[epochs.length - 1].science;
    const cmd: Command = { type: 'BuyProjectStage', power: 1, cityId: city.id, kind: 'science' };
    expect(execute(s, cmd).ok).toBe(true);
    declareWar(s, 0, 1);
    s.powers[0].explored.fill(1);
    city.durability = 0;
    const u = addUnit(s, 0, 'warrior', 13, 5, 2);
    execute(s, { type: 'CaptureCity', power: 0, unitId: u.id, cityId: city.id, choice: 'annex' });
    expect(city.project).toBeNull();
  });

  it('завоевание — больше половины исходных столиц', () => {
    const s = three();
    s.map.starts = s.cities.map((c) => c.tile);
    declareWar(s, 0, 1);
    const city = s.cities[1];
    city.durability = 0;
    const u = addUnit(s, 0, 'warrior', 13, 5, 2);
    execute(s, { type: 'CaptureCity', power: 0, unitId: u.id, cityId: city.id, choice: 'annex' });
    expect(s.winner?.kind).toBe('conquest');
  });

  it('федерация — 60% уровней городов вместе с вассалами, нужен хотя бы один вассал', () => {
    const s = three();
    s.cities[0].level = 5;
    s.cities[2].level = 1;
    s.cities[1].level = 1;
    end(s);
    expect(s.winner).toBeNull();
    s.powers[1].suzerain = 0;
    s.powers[0].memories = [];
    end(s);
    expect(s.winner?.kind).toBe('federation');
  });

  it('вассал освобождается, если стабильность сюзерена ниже 40', () => {
    const s = three();
    s.cities[2].level = 5;
    addCity(s, 2, 25, 9).level = 5;
    s.powers[1].suzerain = 0;
    for (let i = 0; i < 6; i++) addUnit(s, 0, 'warrior', 1 + i, 1, 4);
    end(s);
    expect(s.powers[1].suzerain).toBe(0);
    s.powers[0].effects.push({ kind: 'propaganda', target: 0, until: 999 });
    s.powers[2].effects.push({ kind: 'propaganda', target: 0, until: 999 });
    s.powers[0].gold = -50;
    end(s);
    expect(s.powers[1].suzerain).toBe(NONE);
  });

  it('недовольство в стране делает бота сговорчивее в мире', () => {
    const s = three();
    declareWar(s, 0, 1);
    const deal = { kind: 'peace' as const, terms: NO_TERMS };
    const calm = evaluateDeal(s, 0, 1, deal).total;
    s.powers[1].stability = 30;
    const score = evaluateDeal(s, 0, 1, deal);
    expect(score.items.some((i) => i.label === 'Недовольство в стране')).toBe(true);
    expect(score.total).toBeGreaterThan(calm);
  });
});
