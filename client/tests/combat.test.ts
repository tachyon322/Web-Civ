import { describe, expect, it } from 'vitest';
import { execute, preview, validate } from '../src/core/commands';
import { forecastAttack, lossesForRatio } from '../src/core/combat';
import { balance } from '../src/core/data';
import { T_ROUGH } from '../src/core/types';
import { addCity, addUnit, at, blankState, declareWar } from './helpers';

describe('таблица исхода боя', () => {
  it('совпадает с game-design в опорных точках', () => {
    expect(lossesForRatio(2)).toEqual({ defenderLoss: 1, attackerLoss: 0.1 });
    expect(lossesForRatio(1)).toEqual({ defenderLoss: 0.5, attackerLoss: 0.25 });
    expect(lossesForRatio(0.5)).toEqual({ defenderLoss: 0.25, attackerLoss: 0.5 });
    expect(lossesForRatio(5)).toEqual(lossesForRatio(2));
    expect(lossesForRatio(0.1)).toEqual(lossesForRatio(0.5));
  });

  it('промежуточные значения монотонны', () => {
    let prev = lossesForRatio(0.5);
    for (let r = 0.55; r <= 2; r += 0.05) {
      const cur = lossesForRatio(r);
      expect(cur.defenderLoss).toBeGreaterThanOrEqual(prev.defenderLoss);
      expect(cur.attackerLoss).toBeLessThanOrEqual(prev.attackerLoss);
      prev = cur;
    }
  });
});

describe('бой юнитов', () => {
  it('равные силы: «враг 4 → 2, ты 4 → 3»', () => {
    const s = blankState();
    declareWar(s, 0, 1);
    const a = addUnit(s, 0, 'warrior', 3, 3, 3);
    const d = addUnit(s, 1, 'warrior', 4, 3, 3);
    const f = forecastAttack(s, a, d.tile);
    expect([f.defender.before, f.defender.after]).toEqual([4, 2]);
    expect([f.attacker.before, f.attacker.after]).toEqual([4, 3]);
  });

  it('контр-тип и местность: всадник 4×1,5 = 6 против лучника на холме 4×1,25 = 5', () => {
    const s = blankState();
    declareWar(s, 0, 1);
    const a = addUnit(s, 0, 'horseman', 3, 3, 3);
    const d = addUnit(s, 1, 'archer', 4, 3, 3);
    s.map.terrain[d.tile] = T_ROUGH;
    const f = forecastAttack(s, a, d.tile);
    expect(f.attacker.effective).toBeCloseTo(6);
    expect(f.defender.effective).toBeCloseTo(5);
    expect(f.attacker.modifiers.map((m) => m.factor)).toEqual([1.5]);
  });

  it('лучник сильнее против воина — и в защите', () => {
    const s = blankState();
    declareWar(s, 0, 1);
    const a = addUnit(s, 0, 'warrior', 3, 3, 3);
    const d = addUnit(s, 1, 'archer', 4, 3, 3);
    expect(forecastAttack(s, a, d.tile).defender.effective).toBeCloseTo(6);
  });

  it('модификаторы перемножаются: укрепление и звёзды', () => {
    const s = blankState();
    declareWar(s, 0, 1);
    const a = addUnit(s, 0, 'warrior', 3, 3, 3);
    const d = addUnit(s, 1, 'warrior', 4, 3, 3);
    d.fortified = true;
    d.stars = 2;
    s.map.terrain[d.tile] = T_ROUGH;
    expect(forecastAttack(s, a, d.tile).defender.effective).toBeCloseTo(4 * 1.25 * 1.25 * 1.2);
  });

  it('прогноз совпадает с результатом атаки', () => {
    const s = blankState();
    declareWar(s, 0, 1);
    const a = addUnit(s, 0, 'horseman', 3, 3, 3);
    const d = addUnit(s, 1, 'archer', 4, 3, 2);
    const f = forecastAttack(s, a, d.tile);
    const predicted = preview(s, { type: 'Attack', power: 0, unitId: a.id, target: d.tile })!;
    execute(s, { type: 'Attack', power: 0, unitId: a.id, target: d.tile });
    expect(s).toEqual(predicted);
    expect(a.strength).toBe(f.attacker.after);
  });

  it('вдвое сильнее — защитник погибает, атакующий получает звезду', () => {
    const s = blankState();
    declareWar(s, 0, 1);
    const a = addUnit(s, 0, 'warrior', 3, 3, 3);
    const d = addUnit(s, 1, 'warrior', 4, 3, 2);
    execute(s, { type: 'Attack', power: 0, unitId: a.id, target: d.tile });
    expect(s.units.find((u) => u.id === d.id)).toBeUndefined();
    expect(a.stars).toBe(1);
    expect(a.strength).toBeCloseTo(3.6);
    expect(a.mp).toBe(0);
  });

  it('лучник бьёт с 2 клеток без ответного урона', () => {
    const s = blankState();
    declareWar(s, 0, 1);
    const a = addUnit(s, 0, 'archer', 2, 3, 2);
    const d = addUnit(s, 1, 'warrior', 4, 3, 2);
    expect(validate(s, { type: 'Attack', power: 0, unitId: a.id, target: d.tile }).ok).toBe(true);
    execute(s, { type: 'Attack', power: 0, unitId: a.id, target: d.tile });
    expect(a.strength).toBe(2);
    expect(d.strength).toBeLessThan(2);
  });

  it('воин не достаёт через клетку', () => {
    const s = blankState();
    declareWar(s, 0, 1);
    const a = addUnit(s, 0, 'warrior', 2, 3, 2);
    const d = addUnit(s, 1, 'warrior', 4, 3, 2);
    expect(validate(s, { type: 'Attack', power: 0, unitId: a.id, target: d.tile })).toEqual({ ok: false, reason: 'Цель не рядом' });
  });

  it('без войны атаковать нельзя; войну объявляют только после встречи', () => {
    const s = blankState();
    const a = addUnit(s, 0, 'warrior', 3, 3, 2);
    const d = addUnit(s, 1, 'warrior', 4, 3, 2);
    expect(validate(s, { type: 'Attack', power: 0, unitId: a.id, target: d.tile })).toEqual({
      ok: false,
      reason: 'С этой державой нет войны',
    });
    expect(validate(s, { type: 'DeclareWar', power: 0, target: 1 }).ok).toBe(false);
    s.powers[0].met.push(1);
    expect(execute(s, { type: 'DeclareWar', power: 0, target: 1 }).ok).toBe(true);
    expect(s.powers[1].wars).toContain(0);
    expect(validate(s, { type: 'Attack', power: 0, unitId: a.id, target: d.tile }).ok).toBe(true);
  });

  it('с воды атаковать нельзя, а на воде юнит вдвое слабее в защите', () => {
    const s = blankState();
    declareWar(s, 0, 1);
    s.map.terrain[at(s, 4, 3)] = 0;
    const a = addUnit(s, 0, 'warrior', 3, 3, 2);
    const d = addUnit(s, 1, 'warrior', 4, 3, 2);
    expect(forecastAttack(s, a, d.tile).defender.effective).toBeCloseTo(2 * balance.combat.onWaterDefenseMultiplier);
    expect(validate(s, { type: 'Attack', power: 1, unitId: d.id, target: a.tile }).ok).toBe(false);
  });
});

describe('слияние', () => {
  it('два жителя дают военный юнит 2-го уровня выбранного типа', () => {
    const s = blankState();
    const a = addUnit(s, 0, 'citizen', 3, 3, 1);
    const b = addUnit(s, 0, 'citizen', 4, 3, 1);
    expect(execute(s, { type: 'Merge', power: 0, unitId: a.id, targetId: b.id, into: 'archer' }).ok).toBe(true);
    expect(s.units).toHaveLength(1);
    expect(b).toMatchObject({ type: 'archer', level: 2, strength: 2 });
  });

  it('сила складывается, звёзды — от лучшего, тип можно сменить', () => {
    const s = blankState();
    const a = addUnit(s, 0, 'archer', 3, 3, 2);
    const b = addUnit(s, 0, 'archer', 4, 3, 2);
    a.strength = 1;
    b.strength = 1;
    a.stars = 2;
    execute(s, { type: 'Merge', power: 0, unitId: a.id, targetId: b.id, into: 'warrior' });
    expect(b).toMatchObject({ type: 'warrior', level: 3, strength: 2, stars: 2 });
  });

  it('только одного уровня, рядом и не выше потолка', () => {
    const s = blankState();
    const a = addUnit(s, 0, 'warrior', 3, 3, 2);
    const b = addUnit(s, 0, 'warrior', 4, 3, 3);
    expect(validate(s, { type: 'Merge', power: 0, unitId: a.id, targetId: b.id, into: 'warrior' }).ok).toBe(false);
    const c = addUnit(s, 0, 'warrior', 6, 3, 2);
    expect(validate(s, { type: 'Merge', power: 0, unitId: a.id, targetId: c.id, into: 'warrior' }).ok).toBe(false);
    const x = addUnit(s, 0, 'warrior', 1, 1, 4);
    const y = addUnit(s, 0, 'warrior', 2, 1, 4);
    expect(validate(s, { type: 'Merge', power: 0, unitId: x.id, targetId: y.id, into: 'warrior' })).toEqual({
      ok: false,
      reason: 'Это уже потолок пирамиды',
    });
  });

  it('казармы: военный юнит 2-го уровня сразу, без слияния', () => {
    const s = blankState();
    const city = addCity(s, 0, 5, 5, true);
    expect(validate(s, { type: 'BuyMilitary', power: 0, cityId: city.id, unitType: 'horseman' })).toEqual({
      ok: false,
      reason: 'Нужны казармы',
    });
    city.buildings.push('barracks');
    expect(execute(s, { type: 'BuyMilitary', power: 0, cityId: city.id, unitType: 'horseman' }).ok).toBe(true);
    expect(s.units[0]).toMatchObject({ type: 'horseman', level: 2, strength: 2, mp: 6 });
  });
});
