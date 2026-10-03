// Конец хода: доходы, выстрелы городов, рост, восстановление и снабжение юнитов, маршруты.

import { forecastCityShot } from './combat';
import { balance, unitDef } from './data';
import { updateContacts } from './diplomacy';
import { cityGrowthPerTurn, computeIncome } from './economy';
import { log, removeUnit } from './entities';
import { neighbors } from './hex';
import { moveTowards } from './movement';
import {
  atWar,
  cityAt,
  cityGrowthThreshold,
  cityMaxDurability,
  isMilitary,
  mapSize,
  suppliedAt,
  unitAt,
  unitBaseMp,
  unitMaxStrength,
} from './state';
import { NONE, type GameState, type Unit } from './types';
import { updateExplored } from './visibility';

function collectIncome(state: GameState): void {
  for (const power of state.powers) {
    if (!power.alive) continue;
    const income = computeIncome(state, power.id);
    power.gold += income.gold.total;
    power.science += income.science.total;
    power.culture += income.culture.total;
  }
}

/** Каждый город бьёт одного соседнего врага, как лучник: самого слабого (при равенстве — старшего по id). */
function cityShots(state: GameState): void {
  const size = mapSize(state);
  for (const city of [...state.cities].sort((a, b) => a.id - b.id)) {
    const targets = neighbors(size, city.tile)
      .map((t) => unitAt(state, t))
      .filter((u): u is Unit => u !== undefined && atWar(state, city.owner, u.owner))
      .sort((a, b) => a.strength - b.strength || a.id - b.id);
    const target = targets[0];
    if (!target) continue;
    const { after } = forecastCityShot(state, city, target);
    target.strength = after;
    log(state, target.owner, `${city.name} обстрелял юнит: сила ${after}`);
    if (after <= 0) {
      removeUnit(state, target.id);
      log(state, target.owner, `Юнит погиб от обстрела города ${city.name}`);
    }
  }
}

function growCities(state: GameState): void {
  for (const city of state.cities) {
    city.purchasedThisTurn = false;
    if (!city.attackedThisTurn) {
      city.durability = Math.min(cityMaxDurability(city), city.durability + balance.cityDefense.durabilityRegen);
    }
    city.attackedThisTurn = false;
    if (cityGrowthThreshold(city) === null) continue;
    city.growth += cityGrowthPerTurn(state, city);
    for (let t = cityGrowthThreshold(city); t !== null && city.growth >= t; t = cityGrowthThreshold(city)) {
      city.growth -= t;
      city.level++;
      log(state, city.owner, `${city.name} вырос до уровня ${city.level}`);
    }
    if (cityGrowthThreshold(city) === null) city.growth = 0;
  }
}

function roundStrength(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Восстановление (если юнит не двигался): +25% на своей земле, +50% в своём городе.
 * Снабжение: военные дальше одной клетки от своей территории теряют 10% за ход. Долги: военные теряют 10% (дезертирство).
 */
function upkeepUnits(state: GameState): void {
  const { owner } = state.territory;
  for (const unit of [...state.units]) {
    const max = unitMaxStrength(unit);
    const onOwnLand = owner[unit.tile] === unit.owner;
    // Снабжение и дезертирство касаются только военных: житель сам по себе силу не теряет.
    const attrition = isMilitary(unit);
    if (!onOwnLand) {
      if (attrition && !suppliedAt(state, unit.owner, unit.tile)) {
        unit.strength = roundStrength(unit.strength - max * balance.upkeep.supplyLossShare);
      }
    } else if (!unit.moved) {
      const city = cityAt(state, unit.tile);
      const share = city && city.owner === unit.owner ? balance.recovery.cityShare : balance.recovery.ownTerritoryShare;
      unit.strength = Math.min(max, roundStrength(unit.strength + max * share));
    }
    if (attrition && state.powers[unit.owner].gold < 0) {
      unit.strength = roundStrength(unit.strength - max * balance.upkeep.debtLossShare);
    }
    if (unit.strength <= 0) {
      removeUnit(state, unit.id);
      log(state, unit.owner, `${unitDef(unit.type).name} погиб: ${onOwnLand ? 'дезертирство из-за долгов' : 'нет снабжения'}`);
      continue;
    }
    unit.fortified = !unit.moved;
    unit.moved = false;
    unit.mp = unitBaseMp(unit) + (onOwnLand ? balance.units.ownTerritoryMpBonus : 0);
  }
}

function continueRoutes(state: GameState): void {
  const routed = state.units.filter((u) => u.routeTarget !== NONE).sort((a, b) => a.id - b.id);
  for (const unit of routed) {
    const outcome = moveTowards(state, unit, unit.routeTarget);
    if (outcome === 'blocked') log(state, unit.owner, 'Маршрут прерван: путь закрыт');
    else if (outcome === 'enemy') log(state, unit.owner, 'Маршрут прерван: замечен враг');
  }
}

/** Переход к следующему ходу для всех держав. */
export function advanceTurn(state: GameState): void {
  collectIncome(state);
  cityShots(state);
  growCities(state);
  state.turn++;
  upkeepUnits(state);
  continueRoutes(state);
  for (const power of state.powers) {
    if (!power.alive) continue;
    updateExplored(state, power.id);
    updateContacts(state, power.id);
  }
}
