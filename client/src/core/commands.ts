// Все действия — команды. validate отвечает «можно ли и почему нет», apply меняет состояние.
// Интерфейс и боты пользуются одними и теми же командами.

import { captureBlocker, captureCity, choiceBlocker, type CaptureChoice } from './capture';
import { attackBlocker, resolveAttack } from './combat';
import { balance, buildingDef, buildings, unitDef } from './data';
import {
  cancelPact,
  dealBlocker,
  declareWar,
  giftBlocker,
  giveGift,
  propose,
  respond,
  updateContacts,
  warBlocker,
} from './diplomacy';
import { buildingPrice, citizenPrice, foundCityPrice, militaryPrice } from './economy';
import { createCity, createUnit, log, removeUnit, spawnTile } from './entities';
import { colOf, distance, inBounds, rowOf } from './hex';
import { computeNetwork } from './network';
import { enterCost, findPath } from './pathfinding';
import { moveTowards } from './movement';
import {
  cityAt,
  citySlots,
  findCity,
  findUnit,
  hasBuildingEffect,
  hasPact,
  isLand,
  mapSize,
  unitAt,
} from './state';
import { advanceTurn } from './turn';
import { MILITARY_TYPES, NONE, type Deal, type GameState, type MilitaryType, type Unit } from './types';

export type Command =
  | { type: 'Move'; power: number; unitId: number; target: number }
  | { type: 'CancelRoute'; power: number; unitId: number }
  | { type: 'Transfer'; power: number; unitId: number; cityId: number }
  | { type: 'FoundCity'; power: number; unitId: number }
  | { type: 'BuyCitizen'; power: number; cityId: number }
  | { type: 'BuyBuilding'; power: number; cityId: number; buildingId: string }
  | { type: 'BuyMilitary'; power: number; cityId: number; unitType: MilitaryType }
  | { type: 'Merge'; power: number; unitId: number; targetId: number; into: MilitaryType }
  | { type: 'Attack'; power: number; unitId: number; target: number }
  | { type: 'CaptureCity'; power: number; unitId: number; cityId: number; choice: CaptureChoice }
  | { type: 'DeclareWar'; power: number; target: number }
  | { type: 'Gift'; power: number; target: number; gold: number }
  | { type: 'CultureExchange'; power: number; target: number; culture: number }
  | { type: 'Propose'; power: number; target: number; deal: Deal }
  | { type: 'Respond'; power: number; proposalId: number; accept: boolean }
  | { type: 'CancelPact'; power: number; target: number; kind: 'trade' | 'alliance' }
  | { type: 'EndTurn'; power: number };

export type Validation = { ok: true } | { ok: false; reason: string };

const OK: Validation = { ok: true };
const fail = (reason: string): Validation => ({ ok: false, reason });

function ownUnit(state: GameState, power: number, unitId: number): Unit | string {
  const unit = findUnit(state, unitId);
  if (!unit) return 'Юнит не найден';
  if (unit.owner !== power) return 'Это чужой юнит';
  return unit;
}

export function validate(state: GameState, cmd: Command): Validation {
  const power = state.powers[cmd.power];
  if (!power || !power.alive) return fail('Держава выбыла');

  switch (cmd.type) {
    case 'Move': {
      const unit = ownUnit(state, cmd.power, cmd.unitId);
      if (typeof unit === 'string') return fail(unit);
      const size = mapSize(state);
      if (cmd.target < 0 || !inBounds(size, colOf(size, cmd.target), rowOf(size, cmd.target))) {
        return fail('Вне карты');
      }
      if (cmd.target === unit.tile) return fail('Юнит уже здесь');
      if (enterCost(state, unit, cmd.target) === null) return fail('Сюда пройти нельзя');
      const other = unitAt(state, cmd.target);
      if (other && other.id !== unit.id) return fail('Клетка занята: на клетке один юнит');
      if (!findPath(state, unit, cmd.target)) return fail('Нет пути');
      return OK;
    }

    case 'CancelRoute': {
      const unit = ownUnit(state, cmd.power, cmd.unitId);
      return typeof unit === 'string' ? fail(unit) : OK;
    }

    case 'Transfer': {
      const unit = ownUnit(state, cmd.power, cmd.unitId);
      if (typeof unit === 'string') return fail(unit);
      const from = cityAt(state, unit.tile);
      if (!from || from.owner !== cmd.power) return fail('Переброска возможна только из своего города');
      const to = findCity(state, cmd.cityId);
      if (!to || to.owner !== cmd.power) return fail('Переброска возможна только в свой город');
      if (to.id === from.id) return fail('Юнит уже в этом городе');
      if (unit.mp < balance.units.transferCost) return fail('Не хватает очков хода');
      const label = computeNetwork(state, cmd.power);
      if (label[from.tile] === NONE || label[from.tile] !== label[to.tile]) {
        return fail('Города не связаны сетью территории');
      }
      if (unitAt(state, to.tile)) return fail('В городе назначения уже стоит юнит');
      return OK;
    }

    case 'FoundCity': {
      const unit = ownUnit(state, cmd.power, cmd.unitId);
      if (typeof unit === 'string') return fail(unit);
      if (unit.type !== 'citizen') return fail('Основать город может только житель');
      if (!isLand(state, unit.tile)) return fail('Город можно основать только на суше');
      const owner = state.territory.owner[unit.tile];
      if (owner !== NONE && owner !== cmd.power) return fail('Это чужая территория');
      const size = mapSize(state);
      const min = balance.city.minDistanceBetweenCities;
      const near = state.cities.find((c) => distance(size, c.tile, unit.tile) < min);
      if (near) return fail(`Слишком близко к городу ${near.name} (нужно не меньше ${min} клеток)`);
      const price = foundCityPrice(state, cmd.power);
      if (power.gold < price) return fail(`Нужно ${price} золота`);
      return OK;
    }

    case 'BuyCitizen': {
      const city = findCity(state, cmd.cityId);
      if (!city || city.owner !== cmd.power) return fail('Это не ваш город');
      if (city.purchasedThisTurn) return fail('В этом городе уже была покупка в этом ходу');
      const price = citizenPrice(state, cmd.power);
      if (power.gold < price) return fail(`Нужно ${price} золота`);
      if (spawnTile(state, city) === null) return fail('Вокруг города нет свободной клетки');
      return OK;
    }

    case 'BuyBuilding': {
      const city = findCity(state, cmd.cityId);
      if (!city || city.owner !== cmd.power) return fail('Это не ваш город');
      if (!buildings.some((b) => b.id === cmd.buildingId)) return fail('Неизвестное здание');
      if (city.purchasedThisTurn) return fail('В этом городе уже была покупка в этом ходу');
      if (city.buildings.includes(cmd.buildingId)) return fail('Здание уже построено');
      if (city.buildings.length >= citySlots(city)) return fail('Нет свободных слотов');
      const price = buildingPrice(state, cmd.power, cmd.buildingId);
      if (power.gold < price) return fail(`Нужно ${price} золота`);
      return OK;
    }

    case 'BuyMilitary': {
      const city = findCity(state, cmd.cityId);
      if (!city || city.owner !== cmd.power) return fail('Это не ваш город');
      if (!MILITARY_TYPES.includes(cmd.unitType)) return fail('Неизвестный тип юнита');
      if (!hasBuildingEffect(city, 'barracks')) return fail('Нужны казармы');
      if (city.purchasedThisTurn) return fail('В этом городе уже была покупка в этом ходу');
      const price = militaryPrice(state, cmd.power);
      if (power.gold < price) return fail(`Нужно ${price} золота`);
      if (spawnTile(state, city) === null) return fail('Вокруг города нет свободной клетки');
      return OK;
    }

    case 'Merge': {
      const unit = ownUnit(state, cmd.power, cmd.unitId);
      if (typeof unit === 'string') return fail(unit);
      const target = ownUnit(state, cmd.power, cmd.targetId);
      if (typeof target === 'string') return fail(target);
      if (unit.id === target.id) return fail('Нельзя слить юнит с самим собой');
      if (!MILITARY_TYPES.includes(cmd.into)) return fail('Неизвестный тип юнита');
      if (unit.level !== target.level) return fail('Сливаются только юниты одного уровня');
      if (unit.level >= balance.units.maxLevel) return fail('Это уже потолок пирамиды');
      if (distance(mapSize(state), unit.tile, target.tile) !== 1) return fail('Юниты должны стоять рядом');
      if (unit.mp <= 0) return fail('Нет очков хода');
      return OK;
    }

    case 'Attack': {
      const unit = ownUnit(state, cmd.power, cmd.unitId);
      if (typeof unit === 'string') return fail(unit);
      const blocker = attackBlocker(state, unit, cmd.target);
      return blocker ? fail(blocker) : OK;
    }

    case 'CaptureCity': {
      const unit = ownUnit(state, cmd.power, cmd.unitId);
      if (typeof unit === 'string') return fail(unit);
      const city = findCity(state, cmd.cityId);
      if (!city) return fail('Город не найден');
      const blocker = captureBlocker(state, unit, city) ?? choiceBlocker(state, unit, city, cmd.choice);
      return blocker ? fail(blocker) : OK;
    }

    case 'DeclareWar': {
      const blocker = warBlocker(state, cmd.power, cmd.target);
      return blocker ? fail(blocker) : OK;
    }

    case 'Gift': {
      const blocker = giftBlocker(state, cmd.power, cmd.target, cmd.gold, 'gold');
      return blocker ? fail(blocker) : OK;
    }

    case 'CultureExchange': {
      const blocker = giftBlocker(state, cmd.power, cmd.target, cmd.culture, 'culture');
      return blocker ? fail(blocker) : OK;
    }

    case 'Propose': {
      const blocker = dealBlocker(state, cmd.power, cmd.target, cmd.deal);
      if (blocker) return fail(blocker);
      const pending = state.proposals.some((p) => p.status === 'pending' && p.from === cmd.power && p.to === cmd.target && p.deal.kind === cmd.deal.kind);
      return pending ? fail('Такое предложение уже ждёт ответа') : OK;
    }

    case 'Respond': {
      const pr = state.proposals.find((p) => p.id === cmd.proposalId);
      if (!pr || pr.to !== cmd.power) return fail('Предложение не найдено');
      if (pr.status !== 'pending') return fail('На это предложение уже ответили');
      if (!state.powers[pr.from].alive) return fail('Держава выбыла');
      if (!cmd.accept) return OK;
      const blocker = dealBlocker(state, pr.from, pr.to, pr.deal);
      return blocker ? fail(`Уже невозможно: ${blocker.charAt(0).toLowerCase()}${blocker.slice(1)}`) : OK;
    }

    case 'CancelPact': {
      if (!state.powers[cmd.target]) return fail('Такой державы нет');
      if (!hasPact(state, cmd.power, cmd.target, cmd.kind)) return fail(cmd.kind === 'trade' ? 'Договора нет' : 'Союза нет');
      return OK;
    }

    case 'EndTurn':
      return power.isHuman ? OK : fail('Ход завершает игрок');
  }
}

/** Применяет команду без проверки. Вызывать только после validate (или через execute). */
export function apply(state: GameState, cmd: Command): void {
  const power = state.powers[cmd.power];
  switch (cmd.type) {
    case 'Move': {
      moveTowards(state, findUnit(state, cmd.unitId)!, cmd.target);
      break;
    }

    case 'CancelRoute': {
      findUnit(state, cmd.unitId)!.routeTarget = NONE;
      break;
    }

    case 'Transfer': {
      const unit = findUnit(state, cmd.unitId)!;
      const to = findCity(state, cmd.cityId)!;
      unit.tile = to.tile;
      unit.mp -= balance.units.transferCost;
      unit.routeTarget = NONE;
      break;
    }

    case 'FoundCity': {
      const unit = findUnit(state, cmd.unitId)!;
      power.gold -= foundCityPrice(state, cmd.power);
      state.units = state.units.filter((u) => u.id !== unit.id);
      const city = createCity(state, cmd.power, unit.tile, false);
      log(state, cmd.power, `Основан город ${city.name}`);
      break;
    }

    case 'BuyCitizen': {
      const city = findCity(state, cmd.cityId)!;
      power.gold -= citizenPrice(state, cmd.power);
      city.purchasedThisTurn = true;
      const mp = balance.units.boughtUnitsCanMove ? balance.units.citizen.mp : 0;
      createUnit(state, cmd.power, 'citizen', spawnTile(state, city)!, mp);
      break;
    }

    case 'BuyBuilding': {
      const city = findCity(state, cmd.cityId)!;
      power.gold -= buildingPrice(state, cmd.power, cmd.buildingId);
      city.purchasedThisTurn = true;
      city.buildings.push(cmd.buildingId);
      log(state, cmd.power, `${city.name}: построено здание «${buildingDef(cmd.buildingId).name}»`);
      break;
    }

    case 'BuyMilitary': {
      const city = findCity(state, cmd.cityId)!;
      power.gold -= militaryPrice(state, cmd.power);
      city.purchasedThisTurn = true;
      const mp = balance.units.boughtUnitsCanMove ? unitDef(cmd.unitType).mp : 0;
      createUnit(state, cmd.power, cmd.unitType, spawnTile(state, city)!, mp, balance.units.barracksLevel);
      log(state, cmd.power, `${city.name}: куплен ${unitDef(cmd.unitType).name.toLowerCase()}`);
      break;
    }

    case 'Merge': {
      const unit = findUnit(state, cmd.unitId)!;
      const target = findUnit(state, cmd.targetId)!;
      // Сила складывается, звёзды — от лучшего из двух.
      target.level += 1;
      target.type = cmd.into;
      target.strength = Math.round((unit.strength + target.strength) * 100) / 100;
      target.stars = Math.max(unit.stars, target.stars);
      target.mp = Math.min(unit.mp, target.mp);
      target.moved = true;
      target.fortified = false;
      target.routeTarget = NONE;
      removeUnit(state, unit.id);
      break;
    }

    case 'Attack':
      resolveAttack(state, findUnit(state, cmd.unitId)!, cmd.target);
      break;

    case 'CaptureCity':
      captureCity(state, findUnit(state, cmd.unitId)!, cmd.cityId, cmd.choice);
      break;

    case 'DeclareWar':
      declareWar(state, cmd.power, cmd.target);
      break;

    case 'Gift':
      giveGift(state, cmd.power, cmd.target, cmd.gold, 'gold');
      break;

    case 'CultureExchange':
      giveGift(state, cmd.power, cmd.target, cmd.culture, 'culture');
      break;

    case 'Propose':
      propose(state, cmd.power, cmd.target, cmd.deal);
      break;

    case 'Respond':
      respond(state, state.proposals.find((p) => p.id === cmd.proposalId)!, cmd.accept);
      break;

    case 'CancelPact':
      cancelPact(state, cmd.power, cmd.target, cmd.kind);
      break;

    case 'EndTurn':
      advanceTurn(state);
      return;
  }
  updateContacts(state, cmd.power);
}

/** Проверяет и применяет команду. */
export function execute(state: GameState, cmd: Command): Validation {
  const v = validate(state, cmd);
  if (v.ok) apply(state, cmd);
  return v;
}

/** Прогноз: та же функция apply на копии состояния — прогноз и результат не расходятся. */
export function preview(state: GameState, cmd: Command): GameState | null {
  if (!validate(state, cmd).ok) return null;
  const copy = structuredClone(state);
  apply(copy, cmd);
  return copy;
}
