// Бой. Случайности нет: исход считается одной функцией и для прогноза, и для самой атаки.
// Сила юнита — она же здоровье. Модификаторы перемножаются.

import { activeBuildings } from './buildings';
import { balance, buildingDef, terrainDefs, unitDef } from './data';
import { stabilityLevel } from './stability';
import { log, removeUnit } from './entities';
import { distance } from './hex';
import { nationTrait } from './nations';
import { atWar, cityAt, isLand, mapSize, unitAt, unitMaxStrength } from './state';
import { TERRAINS, type City, type GameState, type Unit, type UnitType } from './types';
import { computeVisible } from './visibility';

const cfg = balance.combat;

export interface Modifier {
  label: string;
  /** Множитель силы, например 1.5 или 0.5. */
  factor: number;
}

export interface CombatSide {
  name: string;
  /** Для юнита — сила, для города — прочность. */
  before: number;
  after: number;
  max: number;
  /** Сила с модификаторами. */
  effective: number;
  modifiers: Modifier[];
}

export interface CombatForecast {
  target: 'unit' | 'city';
  attackerId: number;
  defenderUnitId: number | null;
  defenderCityId: number | null;
  /** Атака без ответного урона (лучник). */
  ranged: boolean;
  ratio: number;
  attacker: CombatSide;
  defender: CombatSide;
  attackerDies: boolean;
  defenderDies: boolean;
}

/** Округление силы вниз до шага: так юнит рано или поздно погибает, а не тает бесконечно. */
export function floorStrength(x: number): number {
  const steps = Math.floor(x / cfg.strengthStep + 1e-9);
  return Math.max(0, Math.round(steps * cfg.strengthStep * 100) / 100);
}

/** Доли потерь по соотношению сил: таблица из game-design, между точками — интерполяция по логарифму. */
export function lossesForRatio(ratio: number): { defenderLoss: number; attackerLoss: number } {
  const pts = cfg.outcomes;
  if (ratio <= pts[0].ratio) return { defenderLoss: pts[0].defenderLoss, attackerLoss: pts[0].attackerLoss };
  const last = pts[pts.length - 1];
  if (ratio >= last.ratio) return { defenderLoss: last.defenderLoss, attackerLoss: last.attackerLoss };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (ratio <= b.ratio) {
      const t = (Math.log(ratio) - Math.log(a.ratio)) / (Math.log(b.ratio) - Math.log(a.ratio));
      return {
        defenderLoss: a.defenderLoss + (b.defenderLoss - a.defenderLoss) * t,
        attackerLoss: a.attackerLoss + (b.attackerLoss - a.attackerLoss) * t,
      };
    }
  }
  return { defenderLoss: last.defenderLoss, attackerLoss: last.attackerLoss };
}

function counters(a: UnitType, b: UnitType): boolean {
  return (cfg.counters as Record<string, string>)[a] === b;
}

function unitName(unit: Unit): string {
  return `${unitDef(unit.type).name} ${unit.level} ур.`;
}

function product(mods: Modifier[]): number {
  return mods.reduce((p, m) => p * m.factor, 1);
}

/** Модификаторы державы: недовольство. Боевых бонусов у науки нет (ни эпох, ни технологического разрыва). */
function powerModifiers(state: GameState, owner: number, _enemy: number): Modifier[] {
  const mods: Modifier[] = [];
  const level = stabilityLevel(state.powers[owner].stability);
  if (level.combat !== 1) mods.push({ label: `${level.name}: боевой дух`, factor: level.combat });
  return mods;
}

/** Бонус за звезду ветерана у державы (черта нации может его менять). */
export function starBonus(state: GameState, power: number): number {
  return nationTrait(state, power).starBonus ?? cfg.starBonus;
}

/** Модификаторы юнита в атаке. */
function attackModifiers(state: GameState, attacker: Unit, defender: Unit | null, defenderOwner: number): Modifier[] {
  const mods: Modifier[] = powerModifiers(state, attacker.owner, defenderOwner);
  if (defender && counters(attacker.type, defender.type)) {
    mods.push({ label: `${unitDef(attacker.type).name} против: ${unitDef(defender.type).name.toLowerCase()}`, factor: 1 + cfg.counterBonus });
  }
  if (attacker.stars) mods.push({ label: `Звёзды ветерана ×${attacker.stars}`, factor: 1 + starBonus(state, attacker.owner) * attacker.stars });
  if (!defender && attacker.type === 'archer') mods.push({ label: 'Лучник против города', factor: 1 + cfg.archerVsCityBonus });
  return mods;
}

/** Модификаторы юнита в защите. attackerType — null, если стреляет город. */
export function defenseModifiers(state: GameState, defender: Unit, attackerType: UnitType | null, attackerOwner: number): Modifier[] {
  const mods: Modifier[] = powerModifiers(state, defender.owner, attackerOwner);
  if (attackerType && counters(defender.type, attackerType)) {
    mods.push({ label: `${unitDef(defender.type).name} против: ${unitDef(attackerType).name.toLowerCase()}`, factor: 1 + cfg.counterBonus });
  }
  const terrain = terrainDefs[TERRAINS[state.map.terrain[defender.tile]]];
  if (terrain.defenseBonus) mods.push({ label: terrain.name, factor: 1 + terrain.defenseBonus });
  if (defender.fortified) mods.push({ label: 'Укрепился', factor: 1 + cfg.fortifiedBonus });
  if (defender.stars) mods.push({ label: `Звёзды ветерана ×${defender.stars}`, factor: 1 + starBonus(state, defender.owner) * defender.stars });
  if (!isLand(state, defender.tile)) mods.push({ label: 'На воде', factor: cfg.onWaterDefenseMultiplier });
  return mods;
}

/** Слагаемые силы города: уровень, стены, столица. */
export function cityStrengthParts(city: City): { label: string; value: number }[] {
  const cfgCity = balance.cityDefense;
  const parts = [{ label: 'уровень', value: city.level * cfgCity.strengthPerLevel }];
  for (const b of activeBuildings(city)) {
    const def = buildingDef(b);
    if (def.strength) parts.push({ label: def.name.toLowerCase(), value: def.strength });
  }
  if (city.isCapital) parts.push({ label: 'столица', value: cfgCity.capitalStrengthBonus });
  return parts;
}

/** Сила города — одна и та же в защите и при выстреле. */
export function cityStrength(city: City): number {
  return cityStrengthParts(city).reduce((sum, p) => sum + p.value, 0);
}

/** Почему юнит не может атаковать клетку; null — может. */
export function attackBlocker(state: GameState, attacker: Unit, tile: number): string | null {
  if (attacker.mp <= 0) return 'Нет очков хода';
  if (!isLand(state, attacker.tile)) return 'С воды атаковать нельзя';
  const unit = unitAt(state, tile);
  const city = cityAt(state, tile);
  const owner = unit?.owner ?? city?.owner;
  if (owner === undefined || owner === attacker.owner) return 'Здесь нет противника';
  if (!atWar(state, attacker.owner, owner)) return 'С этой державой нет войны';
  if (!computeVisible(state, attacker.owner)[tile]) return 'Цель не видна';
  const range = unitDef(attacker.type).range;
  const d = distance(mapSize(state), attacker.tile, tile);
  if (d > range) return range > 1 ? `Цель дальше ${range} клеток` : 'Цель не рядом';
  if (!unit && city && city.durability <= 0) return 'Прочность города уже 0 — его можно захватить';
  return null;
}

/** Точный исход атаки. Та же функция используется в resolveAttack. */
export function forecastAttack(state: GameState, attacker: Unit, tile: number): CombatForecast {
  const defenderUnit = unitAt(state, tile) ?? null;
  const city = defenderUnit ? null : cityAt(state, tile)!;
  const ranged = unitDef(attacker.type).range > 1;

  const defenderOwner = defenderUnit?.owner ?? cityAt(state, tile)!.owner;
  const aMods = attackModifiers(state, attacker, defenderUnit, defenderOwner);
  const attackerEff = attacker.strength * product(aMods);

  let defenderEff: number;
  let defenderSide: CombatSide;
  if (defenderUnit) {
    const dMods = defenseModifiers(state, defenderUnit, attacker.type, attacker.owner);
    defenderEff = defenderUnit.strength * product(dMods);
    defenderSide = {
      name: unitName(defenderUnit),
      before: defenderUnit.strength,
      after: 0,
      max: unitMaxStrength(defenderUnit),
      effective: defenderEff,
      modifiers: dMods,
    };
  } else {
    defenderEff = cityStrength(city!);
    defenderSide = {
      name: `Город ${city!.name}`,
      before: city!.durability,
      after: 0,
      max: city!.durability,
      effective: defenderEff,
      modifiers: [],
    };
  }

  const ratio = attackerEff / Math.max(defenderEff, 1e-6);
  const { defenderLoss, attackerLoss } = lossesForRatio(ratio);
  if (defenderUnit) {
    defenderSide.after = defenderLoss >= 1 ? 0 : floorStrength(defenderUnit.strength * (1 - defenderLoss));
  } else {
    // Выигранная атака (атакующий не слабее) снимает 1 прочность.
    defenderSide.after = ratio >= 1 ? Math.max(0, city!.durability - 1) : city!.durability;
  }
  const attackerAfter = ranged ? attacker.strength : floorStrength(attacker.strength * (1 - attackerLoss));

  return {
    target: defenderUnit ? 'unit' : 'city',
    attackerId: attacker.id,
    defenderUnitId: defenderUnit?.id ?? null,
    defenderCityId: city?.id ?? null,
    ranged,
    ratio,
    attacker: {
      name: unitName(attacker),
      before: attacker.strength,
      after: attackerAfter,
      max: unitMaxStrength(attacker),
      effective: attackerEff,
      modifiers: aMods,
    },
    defender: defenderSide,
    attackerDies: attackerAfter <= 0,
    defenderDies: defenderUnit !== null && defenderSide.after <= 0,
  };
}

function addStar(unit: Unit): void {
  unit.stars = Math.min(cfg.maxStars, unit.stars + 1);
}

/** Применяет атаку по прогнозу. */
export function resolveAttack(state: GameState, attacker: Unit, tile: number): CombatForecast {
  const f = forecastAttack(state, attacker, tile);
  attacker.strength = f.attacker.after;
  attacker.moved = true;
  attacker.fortified = false;
  attacker.routeTarget = -1;
  attacker.mp = cfg.attackEndsTurn ? 0 : attacker.mp - 1;

  if (f.target === 'unit') {
    const defender = state.units.find((u) => u.id === f.defenderUnitId)!;
    defender.strength = f.defender.after;
    if (f.defenderDies) {
      removeUnit(state, defender.id);
      if (!f.attackerDies) addStar(attacker);
      log(state, defender.owner, `${f.defender.name} погиб в бою`);
      log(state, attacker.owner, `${f.attacker.name}: враг уничтожен`);
    } else if (f.attackerDies) {
      addStar(defender);
    }
  } else {
    const city = state.cities.find((c) => c.id === f.defenderCityId)!;
    city.durability = f.defender.after;
    city.attackedThisTurn = true;
    if (city.durability === 0) log(state, city.owner, `${city.name}: прочность 0, город может быть захвачен`);
  }
  if (f.attackerDies) {
    removeUnit(state, attacker.id);
    log(state, attacker.owner, `${f.attacker.name} погиб при атаке`);
  }
  return f;
}

/** Исход выстрела города по юниту: как лучник, без ответного урона. */
export function forecastCityShot(state: GameState, city: City, target: Unit): { after: number; ratio: number } {
  const defEff = target.strength * product(defenseModifiers(state, target, null, city.owner));
  const ratio = cityStrength(city) / Math.max(defEff, 1e-6);
  const { defenderLoss } = lossesForRatio(ratio);
  return { after: defenderLoss >= 1 ? 0 : floorStrength(target.strength * (1 - defenderLoss)), ratio };
}
