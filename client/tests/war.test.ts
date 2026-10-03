import { describe, expect, it } from 'vitest';
import { execute, validate } from '../src/core/commands';
import { plunderLoot } from '../src/core/capture';
import { balance } from '../src/core/data';
import { removeUnit } from '../src/core/entities';
import { distance } from '../src/core/hex';
import { computeNetwork } from '../src/core/network';
import { findPath, reachableTiles } from '../src/core/pathfinding';
import { cityStrength, forecastCityShot } from '../src/core/combat';
import { citiesOf, cityMaxDurability, cityTiles } from '../src/core/state';
import { T_MOUNTAIN, T_WATER } from '../src/core/types';
import { addCitizen, addCity, addUnit, at, blankState, declareWar } from './helpers';

const end = (s: ReturnType<typeof blankState>) => execute(s, { type: 'EndTurn', power: 0 });

describe('движение на войне', () => {
  it('зона контроля: войдя в клетку рядом с врагом, юнит останавливается', () => {
    const s = blankState(16, 8);
    // Узкий проход из двух рядов между горами — обойти врага нельзя.
    for (let i = 0; i < 16 * 8; i++) if (Math.floor(i / 16) !== 3 && Math.floor(i / 16) !== 4) s.map.terrain[i] = T_MOUNTAIN;
    declareWar(s, 0, 1);
    // Враг виден с самого начала — остановка именно из-за зоны контроля, а не из-за обнаружения.
    const u = addUnit(s, 0, 'horseman', 4, 3, 2, 6);
    const enemy = addUnit(s, 1, 'warrior', 6, 4, 2);
    execute(s, { type: 'Move', power: 0, unitId: u.id, target: at(s, 10, 3) });
    expect(distance(s.map, u.tile, enemy.tile)).toBe(1);
    expect(u.mp).toBe(0);
    expect(u.routeTarget).toBe(at(s, 10, 3));
  });

  it('путь по возможности обходит зону контроля', () => {
    const s = blankState(16, 8);
    declareWar(s, 0, 1);
    const u = addUnit(s, 0, 'horseman', 4, 3, 2, 6);
    const enemy = addUnit(s, 1, 'warrior', 6, 3, 2);
    const path = findPath(s, u, at(s, 9, 3))!;
    expect(path.every((t) => distance(s.map, t, enemy.tile) > 1)).toBe(true);
  });

  it('без войны чужой юнит зоны контроля не создаёт', () => {
    const s = blankState(16, 8);
    const u = addUnit(s, 0, 'horseman', 2, 3, 2, 6);
    addUnit(s, 1, 'warrior', 6, 3, 2);
    execute(s, { type: 'Move', power: 0, unitId: u.id, target: at(s, 8, 4) });
    expect(u.tile).toBe(at(s, 8, 4));
  });

  it('погрузка на воду заканчивает движение', () => {
    const s = blankState(16, 8);
    for (let c = 4; c < 16; c++) for (let r = 0; r < 8; r++) s.map.terrain[at(s, c, r)] = T_WATER;
    const u = addUnit(s, 0, 'warrior', 2, 3, 2, 4);
    execute(s, { type: 'Move', power: 0, unitId: u.id, target: at(s, 8, 3) });
    expect(u.tile).toBe(at(s, 4, 3));
    expect(u.mp).toBe(0);
    expect(u.routeTarget).toBe(at(s, 8, 3));
    const reach = reachableTiles(s, { ...u, tile: at(s, 3, 3), mp: 4 });
    expect(reach.has(at(s, 5, 3))).toBe(false);
  });

  it('маршрут прерывается, когда в обзоре появляется враг', () => {
    const s = blankState(30, 6);
    declareWar(s, 0, 1);
    const u = addUnit(s, 0, 'warrior', 1, 2, 2, 4);
    addUnit(s, 1, 'warrior', 10, 2, 2);
    execute(s, { type: 'Move', power: 0, unitId: u.id, target: at(s, 25, 3) });
    for (let i = 0; i < 4; i++) end(s);
    expect(u.routeTarget).toBe(-1);
    expect(u.tile % 30).toBeLessThan(10);
    expect(s.log.some((e) => e.text.includes('замечен враг'))).toBe(true);
  });

  it('вражеский юнит на клетке разрывает сеть', () => {
    const s = blankState(16, 10);
    const a = addCity(s, 0, 2, 5, true);
    const b = addCity(s, 0, 8, 5);
    for (let c = 4; c <= 6; c++) {
      s.territory.owner[at(s, c, 5)] = 0;
      s.territory.city[at(s, c, 5)] = a.id;
    }
    expect(computeNetwork(s, 0)[a.tile]).toBe(computeNetwork(s, 0)[b.tile]);
    addUnit(s, 1, 'warrior', 5, 5, 2);
    expect(computeNetwork(s, 0)[a.tile]).toBe(computeNetwork(s, 0)[b.tile]);
    declareWar(s, 0, 1);
    expect(computeNetwork(s, 0)[a.tile]).not.toBe(computeNetwork(s, 0)[b.tile]);
  });
});

describe('снабжение, восстановление, укрепление', () => {
  it('вне своей территории юнит теряет 10% силы за ход', () => {
    const s = blankState();
    const u = addUnit(s, 0, 'warrior', 5, 5, 3);
    end(s);
    expect(u.strength).toBeCloseTo(4 - 4 * balance.upkeep.supplyLossShare);
  });

  it('на клетке рядом со своей границей снабжение есть, глубже — нет', () => {
    const s = blankState(16, 10);
    addCity(s, 0, 3, 5, true); // территория — радиус 1 вокруг (3,5)
    const border = addUnit(s, 0, 'warrior', 5, 5, 3); // соседняя с территорией клетка
    const deep = addUnit(s, 0, 'warrior', 7, 5, 3); // дальше одной клетки
    expect(s.territory.owner[border.tile]).toBe(-1);
    end(s);
    expect(border.strength).toBe(4);
    expect(deep.strength).toBeCloseTo(4 - 4 * balance.upkeep.supplyLossShare);
  });

  it('житель вне своей земли и при долгах силу не теряет', () => {
    const s = blankState();
    const c = addUnit(s, 0, 'citizen', 5, 5, 1);
    s.powers[0].gold = -100;
    for (let i = 0; i < 15; i++) end(s);
    expect(s.units).toContain(c);
    expect(c.strength).toBe(1);
  });

  it('на своей земле без движения +25%, в городе +50%', () => {
    const s = blankState(16, 10);
    addCity(s, 0, 3, 5, true);
    const field = addUnit(s, 0, 'warrior', 4, 5, 3);
    const garrison = addUnit(s, 0, 'warrior', 3, 5, 3);
    field.strength = 1;
    garrison.strength = 1;
    end(s);
    expect(field.strength).toBe(2);
    expect(garrison.strength).toBe(3);
  });

  it('юнит, простоявший ход, укрепляется; движение снимает укрепление', () => {
    const s = blankState(16, 10);
    addCity(s, 0, 3, 5, true);
    const u = addUnit(s, 0, 'warrior', 4, 5, 2);
    end(s);
    expect(u.fortified).toBe(true);
    execute(s, { type: 'Move', power: 0, unitId: u.id, target: at(s, 4, 6) });
    expect(u.fortified).toBe(false);
  });

  it('при долгах юниты дезертируют — теряют силу', () => {
    const s = blankState(16, 10);
    addCity(s, 0, 3, 5, true);
    const u = addUnit(s, 0, 'warrior', 3, 5, 3);
    u.strength = 4;
    s.powers[0].gold = -100;
    end(s);
    expect(u.strength).toBeCloseTo(4 - 4 * balance.upkeep.debtLossShare);
  });
});

describe('города в бою и захват', () => {
  function siege() {
    const s = blankState(16, 10);
    declareWar(s, 0, 1);
    const mine = addCity(s, 0, 2, 5, true);
    const city = addCity(s, 1, 8, 5, true);
    const other = addCity(s, 1, 13, 5);
    return { s, mine, city, other };
  }

  it('выигранная атака снимает 1 прочность; лучник получает бонус против города', () => {
    const { s, city } = siege();
    const archer = addUnit(s, 0, 'archer', 6, 5, 2);
    expect(city.durability).toBe(balance.cityDefense.durabilityBase);
    execute(s, { type: 'Attack', power: 0, unitId: archer.id, target: city.tile });
    expect(city.durability).toBe(balance.cityDefense.durabilityBase - 1);
    expect(archer.strength).toBe(2);
  });

  it('проигранная атака прочность не снимает', () => {
    const { s, city } = siege();
    city.level = 2; // сила 2 + столица 1 = 3 против воина 2
    const w = addUnit(s, 0, 'warrior', 7, 5, 2);
    execute(s, { type: 'Attack', power: 0, unitId: w.id, target: city.tile });
    expect(city.durability).toBe(balance.cityDefense.durabilityBase);
    expect(w.strength).toBeLessThan(2);
  });

  it('без атак прочность восстанавливается на 1 за ход; стены дают +1', () => {
    const { s, city } = siege();
    city.durability = 0;
    end(s);
    expect(city.durability).toBe(1);
    city.buildings.push('walls');
    end(s);
    end(s);
    expect(city.durability).toBe(balance.cityDefense.durabilityBase + 1);
  });

  it('сила города: уровень, +1 за стены, +1 столице', () => {
    const { city, other } = siege();
    expect(cityStrength(city)).toBe(2); // столица 1-го уровня без стен
    expect(cityStrength(other)).toBe(1);
    city.buildings.push('walls');
    city.level = 3;
    expect(cityStrength(city)).toBe(5);
    expect(cityMaxDurability(city)).toBe(balance.cityDefense.durabilityBase + 1);
  });

  it('выстрел города бьёт с силой города', () => {
    const { s, city } = siege();
    const w = addUnit(s, 0, 'warrior', 7, 5, 2);
    const shot = forecastCityShot(s, city, w);
    expect(shot.ratio).toBeCloseTo(cityStrength(city) / 2);
  });

  it('юниты 2-го уровня берут столицу 1-го уровня несколькими отрядами', () => {
    const { s, city } = siege();
    const w1 = addUnit(s, 0, 'warrior', 7, 5, 2);
    const w2 = addUnit(s, 0, 'warrior', 8, 4, 2);
    const rider = addUnit(s, 0, 'horseman', 8, 6, 2);
    expect(execute(s, { type: 'Attack', power: 0, unitId: w1.id, target: city.tile }).ok).toBe(true);
    expect(city.durability).toBe(1);
    expect(execute(s, { type: 'Attack', power: 0, unitId: w2.id, target: city.tile }).ok).toBe(true);
    expect(city.durability).toBe(0);
    expect(
      execute(s, { type: 'CaptureCity', power: 0, unitId: rider.id, cityId: city.id, choice: 'annex' }).ok,
    ).toBe(true);
    expect(city.owner).toBe(0);
    expect(w1.strength).toBeGreaterThan(0);
    expect(w2.strength).toBeGreaterThan(0);
  });

  it('город сам стреляет по соседнему врагу', () => {
    const { s } = siege();
    const w = addUnit(s, 0, 'warrior', 7, 5, 2);
    end(s);
    expect(w.strength).toBeLessThan(2);
  });

  it('захват: только при прочности 0, только воин или всадник, город пуст', () => {
    const { s, city } = siege();
    const w = addUnit(s, 0, 'warrior', 7, 5, 2);
    const archer = addUnit(s, 0, 'archer', 7, 4, 2);
    const cmd = { type: 'CaptureCity', power: 0, unitId: w.id, cityId: city.id, choice: 'annex' } as const;
    expect(validate(s, cmd).ok).toBe(false);
    city.durability = 0;
    expect(validate(s, { ...cmd, unitId: archer.id })).toMatchObject({ ok: false });
    expect(validate(s, cmd).ok).toBe(true);
  });

  it('присоединение: город и его клетки переходят, столица переезжает', () => {
    const { s, city, other } = siege();
    const w = addUnit(s, 0, 'warrior', 7, 5, 2);
    city.durability = 0;
    const tiles = cityTiles(s, city.id);
    execute(s, { type: 'CaptureCity', power: 0, unitId: w.id, cityId: city.id, choice: 'annex' });
    expect(city.owner).toBe(0);
    expect(city.isCapital).toBe(false);
    expect(w.tile).toBe(city.tile);
    expect(tiles.every((t) => s.territory.owner[t] === 0)).toBe(true);
    expect(other.isCapital).toBe(true);
    expect(s.powers[1].capitalId).toBe(other.id);
  });

  it('разграбление: добыча, город падает на уровень и остаётся у владельца', () => {
    const { s, city } = siege();
    city.level = 3;
    city.buildings.push('library', 'temple', 'market');
    city.durability = 0;
    const w = addUnit(s, 0, 'warrior', 7, 5, 2);
    const gold = s.powers[0].gold;
    execute(s, { type: 'CaptureCity', power: 0, unitId: w.id, cityId: city.id, choice: 'plunder' });
    expect(city.owner).toBe(1);
    expect(city.level).toBe(2);
    expect(city.buildings).toHaveLength(2);
    expect(s.powers[0].gold).toBe(gold + balance.capture.plunderGoldByLevel[2]);
    expect(s.powers[0].science).toBe(2 * balance.capture.plunderYieldTurns);
  });

  it('после грабежа прочность сразу максимальная: 2, со стенами 3', () => {
    const { s, city } = siege();
    city.isCapital = false;
    city.level = 3;
    city.buildings.push('walls', 'library', 'temple');
    city.durability = 0;
    const w = addUnit(s, 0, 'warrior', 7, 5, 2);
    execute(s, { type: 'CaptureCity', power: 0, unitId: w.id, cityId: city.id, choice: 'plunder' });
    expect(city.buildings).toEqual(['walls', 'library']);
    expect(city.durability).toBe(3);

    const { s: s2, city: plain } = siege();
    plain.durability = 0;
    const w2 = addUnit(s2, 0, 'warrior', 7, 5, 2);
    execute(s2, { type: 'CaptureCity', power: 0, unitId: w2.id, cityId: plain.id, choice: 'plunder' });
    expect(plain.durability).toBe(2);
    // Атаковать снова можно, но захватить — только сняв прочность заново.
    expect(validate(s2, { type: 'CaptureCity', power: 0, unitId: addUnit(s2, 0, 'horseman', 9, 5, 2).id, cityId: plain.id, choice: 'annex' }).ok).toBe(false);
  });

  it('повторный грабёж в течение 10 ходов недоступен никому', () => {
    const { s, city } = siege();
    s.powers.push({ ...structuredClone(s.powers[0]), id: 2, name: 'P2', isHuman: false });
    declareWar(s, 2, 1);
    city.level = 3;
    city.durability = 0;
    const w = addUnit(s, 0, 'warrior', 7, 5, 2);
    execute(s, { type: 'CaptureCity', power: 0, unitId: w.id, cityId: city.id, choice: 'plunder' });
    const plunderedAt = s.turn;

    for (const [power, col, row] of [[0, 9, 5], [2, 8, 4]]) {
      city.durability = 0;
      const u = addUnit(s, power, 'horseman', col, row, 2);
      const v = validate(s, { type: 'CaptureCity', power, unitId: u.id, cityId: city.id, choice: 'plunder' });
      expect(v).toEqual({ ok: false, reason: 'Город недавно разграблен: снова можно через 10 ходов' });
      // Присоединить при этом можно.
      expect(validate(s, { type: 'CaptureCity', power, unitId: u.id, cityId: city.id, choice: 'annex' }).ok).toBe(true);
      removeUnit(s, u.id);
    }

    const u = addUnit(s, 2, 'horseman', 8, 6, 2);
    city.durability = 0;
    s.turn = plunderedAt + 9;
    expect(validate(s, { type: 'CaptureCity', power: 2, unitId: u.id, cityId: city.id, choice: 'plunder' })).toEqual({
      ok: false,
      reason: 'Город недавно разграблен: снова можно через 1 ход',
    });
    s.turn = plunderedAt + 10;
    expect(validate(s, { type: 'CaptureCity', power: 2, unitId: u.id, cityId: city.id, choice: 'plunder' }).ok).toBe(true);
  });

  it('добыча зависит от уровня до грабежа; город не падает ниже 1-го уровня', () => {
    const { s, city } = siege();
    city.durability = 0;
    expect(city.level).toBe(1);
    expect(plunderLoot(city).gold).toBeLessThan(plunderLoot({ ...city, level: 5 }).gold / 5);
    const w = addUnit(s, 0, 'warrior', 7, 5, 2);
    const gold = s.powers[0].gold;
    execute(s, { type: 'CaptureCity', power: 0, unitId: w.id, cityId: city.id, choice: 'plunder' });
    expect(city.level).toBe(1);
    expect(s.powers[0].gold).toBe(gold + balance.capture.plunderGoldByLevel[0]);
  });

  it('освобождение: город возвращается основателю', () => {
    const { s, city } = siege();
    s.powers.push({ ...structuredClone(s.powers[1]), id: 2, name: 'P2' });
    declareWar(s, 0, 2);
    // Держава 2 когда-то захватила город державы 1.
    city.owner = 2;
    city.isCapital = false;
    for (const t of cityTiles(s, city.id)) s.territory.owner[t] = 2;
    city.durability = 0;
    const w = addUnit(s, 0, 'warrior', 7, 5, 2);
    expect(execute(s, { type: 'CaptureCity', power: 0, unitId: w.id, cityId: city.id, choice: 'liberate' }).ok).toBe(true);
    expect(city.owner).toBe(1);
  });

  it('держава без городов выбывает вместе с юнитами', () => {
    const s = blankState(16, 10);
    declareWar(s, 0, 1);
    addCity(s, 0, 2, 5, true);
    const city = addCity(s, 1, 8, 5, true);
    addUnit(s, 1, 'warrior', 12, 8, 2);
    city.durability = 0;
    const w = addUnit(s, 0, 'warrior', 7, 5, 2);
    execute(s, { type: 'CaptureCity', power: 0, unitId: w.id, cityId: city.id, choice: 'annex' });
    expect(s.powers[1].alive).toBe(false);
    expect(citiesOf(s, 1)).toHaveLength(0);
    expect(s.units.every((u) => u.owner === 0)).toBe(true);
  });

  it('житель захватить город не может', () => {
    const { s, city } = siege();
    city.durability = 0;
    const c = addCitizen(s, 0, 7, 5);
    expect(validate(s, { type: 'CaptureCity', power: 0, unitId: c.id, cityId: city.id, choice: 'annex' }).ok).toBe(false);
  });
});

describe('поиск пути с зоной контроля', () => {
  it('путь не идёт через свой юнит в зоне контроля врага', () => {
    const s = blankState(16, 8);
    declareWar(s, 0, 1);
    const u = addUnit(s, 0, 'warrior', 3, 3, 2);
    addUnit(s, 0, 'warrior', 4, 3, 2); // свой юнит прямо на пути, рядом с врагом
    addUnit(s, 1, 'warrior', 5, 3, 2);
    const target = at(s, 5, 5);
    expect(execute(s, { type: 'Move', power: 0, unitId: u.id, target }).ok).toBe(true);
    expect(u.tile).not.toBe(at(s, 3, 3));
  });
});

describe('выбывание', () => {
  it('войны с выбывшей державой заканчиваются у всех', () => {
    const s = blankState(12, 10, 3);
    declareWar(s, 0, 1);
    declareWar(s, 2, 1);
    const city = addCity(s, 1, 6, 5, true);
    addCity(s, 0, 2, 2, true);
    addCity(s, 2, 10, 8, true);
    city.durability = 0;
    const horse = addUnit(s, 0, 'horseman', 7, 5, 2);
    expect(execute(s, { type: 'CaptureCity', power: 0, unitId: horse.id, cityId: city.id, choice: 'annex' }).ok).toBe(true);
    expect(s.powers[1].alive).toBe(false);
    expect(s.powers.every((p) => !p.wars.includes(1))).toBe(true);
    expect(s.powers[1].wars).toEqual([]);
  });
});
