// Захват городов: при прочности 0 воин или всадник входит в город, и победитель выбирает,
// присоединить, разграбить или освободить его.

import { balance, buildingDef, unitDef } from './data';
import { log, removeUnit } from './entities';
import { distance } from './hex';
import { atWar, citiesOf, cityMaxDurability, citySlots, findCity, mapSize, unitAt } from './state';
import { NONE, type City, type GameState, type Unit } from './types';
import { updateExplored } from './visibility';

export type CaptureChoice = 'annex' | 'plunder' | 'liberate';

/** Почему юнит не может войти в город; null — может. */
export function captureBlocker(state: GameState, unit: Unit, city: City): string | null {
  if (!unitDef(unit.type).canCapture) return 'Захватывать города могут только воины и всадники';
  if (unit.mp <= 0) return 'Нет очков хода';
  if (city.owner === unit.owner) return 'Это ваш город';
  if (!atWar(state, unit.owner, city.owner)) return 'С этой державой нет войны';
  if (distance(mapSize(state), unit.tile, city.tile) !== 1) return 'Город не рядом';
  if (city.durability > 0) return `Сначала снизьте прочность до 0 (сейчас ${city.durability})`;
  if (unitAt(state, city.tile)) return 'В городе стоит защитник';
  return null;
}

/** Сколько ходов город ещё нельзя грабить (0 — можно). */
export function plunderCooldown(state: GameState, city: City): number {
  return Math.max(0, city.plunderBlockedUntil - state.turn);
}

export function turnsWord(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return 'ход';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'хода';
  return 'ходов';
}

/** Почему недоступен вариант после захвата; null — доступен. */
export function choiceBlocker(state: GameState, unit: Unit, city: City, choice: CaptureChoice): string | null {
  if (choice === 'plunder') {
    const left = plunderCooldown(state, city);
    return left > 0 ? `Город недавно разграблен: снова можно через ${left} ${turnsWord(left)}` : null;
  }
  if (choice !== 'liberate') return null;
  if (city.founder === city.owner) return 'Город и так у основателя';
  if (city.founder === unit.owner) return 'Это ваш бывший город — его можно присоединить';
  if (!state.powers[city.founder].alive) return 'Держава-основатель выбыла';
  return null;
}

/** Добыча от разграбления: золото по уровню города до грабежа и несколько ходов дохода зданий. */
export function plunderLoot(city: City): { gold: number; science: number; culture: number } {
  const turns = balance.capture.plunderYieldTurns;
  let science = 0;
  let culture = 0;
  for (const b of city.buildings) {
    const y = buildingDef(b).yields;
    science += (y.science ?? 0) * turns;
    culture += (y.culture ?? 0) * turns;
  }
  return { gold: balance.capture.plunderGoldByLevel[city.level - 1], science, culture };
}

/** Передаёт город другой державе вместе с его клетками. */
export function transferCity(state: GameState, city: City, newOwner: number): void {
  const oldOwner = city.owner;
  city.owner = newOwner;
  const { owner, city: cityOf } = state.territory;
  for (let t = 0; t < cityOf.length; t++) if (cityOf[t] === city.id) owner[t] = newOwner;
  if (city.isCapital) {
    city.isCapital = false;
    chooseNewCapital(state, oldOwner);
  }
  checkElimination(state, oldOwner);
  updateExplored(state, newOwner);
}

/** Новая столица — крупнейший из оставшихся городов (при равенстве — старейший). */
function chooseNewCapital(state: GameState, power: number): void {
  const cities = citiesOf(state, power).sort((a, b) => b.level - a.level || a.id - b.id);
  const p = state.powers[power];
  if (!cities.length) {
    p.capitalId = NONE;
    return;
  }
  cities[0].isCapital = true;
  p.capitalId = cities[0].id;
  log(state, power, `Новая столица — ${cities[0].name}`);
}

/** Держава без городов выбывает, её юниты исчезают. */
export function checkElimination(state: GameState, power: number): void {
  const p = state.powers[power];
  if (!p.alive || citiesOf(state, power).length) return;
  p.alive = false;
  for (const u of state.units.filter((x) => x.owner === power)) removeUnit(state, u.id);
  // С выбывшей державой больше никто не воюет.
  for (const other of state.powers) other.wars = other.wars.filter((w) => w !== power);
  p.wars = [];
  log(state, NONE, `${p.name} выбывает из игры`);
}

export function captureCity(state: GameState, unit: Unit, cityId: number, choice: CaptureChoice): void {
  const city = findCity(state, cityId)!;
  const victim = state.powers[city.owner];
  const me = state.powers[unit.owner];
  unit.mp = 0;
  unit.moved = true;
  unit.fortified = false;
  unit.routeTarget = NONE;

  if (choice === 'annex') {
    unit.tile = city.tile;
    log(state, unit.owner, `${city.name} присоединён`);
    log(state, victim.id, `${city.name} захвачен державой ${me.name}`);
    transferCity(state, city, unit.owner);
    city.purchasedThisTurn = true;
  } else if (choice === 'plunder') {
    const loot = plunderLoot(city);
    me.gold += loot.gold;
    me.science += loot.science;
    me.culture += loot.culture;
    city.level = Math.max(1, city.level - 1);
    city.growth = 0;
    while (city.buildings.length > citySlots(city)) city.buildings.pop();
    // Город сразу восстанавливает оборону и какое-то время защищён от нового грабежа.
    city.durability = cityMaxDurability(city);
    city.plunderBlockedUntil = state.turn + balance.capture.plunderCooldownTurns;
    log(state, unit.owner, `${city.name} разграблен: +${loot.gold} золота, +${loot.science} науки, +${loot.culture} культуры`);
    log(state, victim.id, `${city.name} разграблен державой ${me.name}`);
  } else {
    const founder = state.powers[city.founder];
    log(state, unit.owner, `${city.name} освобождён и возвращён державе ${founder.name}`);
    log(state, founder.id, `${city.name} освобождён державой ${me.name} и возвращён нам`);
    transferCity(state, city, city.founder);
  }
}
