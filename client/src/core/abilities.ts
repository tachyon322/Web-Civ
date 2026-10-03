// Способности путей: тратят очки науки или культуры. Каждая трата спасает сейчас, но отодвигает победу.
// Наука: разведка, фортификация, саботаж, оружие сдерживания. Культура: призыв к миру, пропаганда,
// переманивание, праздник (культурный обмен — в дипломатии).

import { buildingDef, pathsConfig, type AbilityId } from './data';
import { dealBlocker, hasMet, logPublic, propose } from './diplomacy';
import { log, removeUnit } from './entities';
import { epochName, epochOf, LAST_EPOCH } from './epochs';
import { neighbors } from './hex';
import { remember } from './relations';
import { allied, atWar, cityAt, citySlots, findCity, findUnit, mapSize, unitPeople } from './state';
import { turnsWord } from './text';
import { NONE, type City, type GameState } from './types';
import { computeVisible } from './visibility';

const abilities = pathsConfig.abilities;

export interface AbilityUse {
  ability: AbilityId;
  /** Держава-цель (разведка, пропаганда, призыв к миру) или NONE. */
  target: number;
  /** Город (фортификация, саботаж) или NONE. */
  cityId: number;
  /** Юнит (переманивание) или NONE. */
  unitId: number;
  /** Здание для саботажа. */
  building: string | null;
  /** Жертва агрессора (призыв к миру) или NONE. */
  victim: number;
}

export const NO_TARGET: Omit<AbilityUse, 'ability'> = { target: NONE, cityId: NONE, unitId: NONE, building: null, victim: NONE };

export function abilityPath(ability: AbilityId): 'science' | 'culture' {
  return abilities[ability].path as 'science' | 'culture';
}

export function abilityCost(state: GameState, use: AbilityUse): number {
  if (use.ability === 'convert') {
    const unit = findUnit(state, use.unitId);
    return abilities.convert.costPerPerson * (unit ? unitPeople(unit) : 1);
  }
  return (abilities[use.ability] as { cost: number }).cost;
}

function hasEffect(state: GameState, power: number, kind: 'recon' | 'propaganda' | 'holiday', target: number): boolean {
  return state.powers[power].effects.some((e) => e.kind === kind && e.target === target && e.until > state.turn);
}

function foreignPowerBlocker(state: GameState, power: number, target: number): string | null {
  const t = state.powers[target];
  if (!t || !t.alive || target === power) return 'Выберите другую державу';
  if (!hasMet(state, power, target)) return 'Вы ещё не встречались';
  return null;
}

/** Почему способность нельзя применить; null — можно. */
export function abilityBlocker(state: GameState, power: number, use: AbilityUse): string | null {
  const p = state.powers[power];
  const def = abilities[use.ability];
  if (!def) return 'Неизвестная способность';
  const cost = abilityCost(state, use);
  const path = abilityPath(use.ability);
  const have = path === 'science' ? p.science : p.culture;
  const need = () => `Нужно ${cost} ${path === 'science' ? 'науки' : 'культуры'}`;

  let blocker: string | null = null;
  switch (use.ability) {
    case 'recon':
      blocker = foreignPowerBlocker(state, power, use.target);
      if (!blocker && hasEffect(state, power, 'recon', use.target)) blocker = 'Разведка уже идёт';
      break;
    case 'fortify': {
      const city = findCity(state, use.cityId);
      if (!city || city.owner !== power) blocker = 'Это не ваш город';
      else if (city.fortifyTurns > 0) blocker = `Фортификация уже действует (ещё ${city.fortifyTurns} ${turnsWord(city.fortifyTurns)})`;
      break;
    }
    case 'sabotage': {
      const city = findCity(state, use.cityId);
      if (!city || city.owner === power) blocker = 'Выберите чужой город';
      else if (!p.explored[city.tile]) blocker = 'Этот город вам неизвестен';
      else blocker = foreignPowerBlocker(state, power, city.owner);
      if (!blocker && allied(state, power, city!.owner)) blocker = 'Против союзника — нельзя';
      if (!blocker && (!use.building || !city!.buildings.includes(use.building))) blocker = 'В городе нет такого здания';
      if (!blocker && city!.disabledTurns > 0) blocker = 'В городе уже идёт саботаж';
      break;
    }
    case 'deterrent':
      if (epochOf(p) < LAST_EPOCH) blocker = `Откроется в эпоху «${epochName(LAST_EPOCH)}»`;
      else if (p.deterrent) blocker = 'Оружие сдерживания уже есть';
      break;
    case 'callPeace':
      if (use.target === power) blocker = 'Призыв к миру обращают к агрессору';
      else blocker = dealBlocker(state, power, use.target, { kind: 'callPeace', victim: use.victim });
      if (!blocker && state.proposals.some((x) => x.status === 'pending' && x.to === use.target && x.deal.kind === 'callPeace')) {
        blocker = 'Призыв уже ждёт ответа';
      }
      break;
    case 'propaganda':
      blocker = foreignPowerBlocker(state, power, use.target);
      if (!blocker && allied(state, power, use.target)) blocker = 'Против союзника — нельзя';
      if (!blocker && hasEffect(state, power, 'propaganda', use.target)) blocker = 'Пропаганда уже идёт';
      break;
    case 'convert': {
      const unit = findUnit(state, use.unitId);
      if (!unit || unit.owner === power) blocker = 'Выберите чужой юнит';
      else if (!atWar(state, power, unit.owner)) blocker = 'Переманить можно только юнит врага';
      else if (!computeVisible(state, power)[unit.tile]) blocker = 'Юнит не виден';
      else if (cityAt(state, unit.tile)?.owner === unit.owner) blocker = 'Юнит в своём городе не переманить';
      else {
        const owner = state.territory.owner;
        const near = owner[unit.tile] === power || neighbors(mapSize(state), unit.tile).some((n) => owner[n] === power);
        if (!near) blocker = 'Юнит должен стоять на вашей земле или у её границы';
      }
      break;
    }
    case 'holiday':
      if (hasEffect(state, power, 'holiday', power)) blocker = 'Праздник уже идёт';
      break;
  }
  if (blocker) return blocker;
  return have < cost ? need() : null;
}

/** Самое ценное здание для саботажа по умолчанию: стены, затем с наибольшим доходом. */
export function sabotageTarget(city: City): string | null {
  if (!city.buildings.length) return null;
  const value = (id: string) => {
    const d = buildingDef(id);
    if (d.effect === 'walls') return 100;
    return Object.values(d.yields).reduce((s: number, v) => s + (v ?? 0), 0);
  };
  return [...city.buildings].sort((a, b) => value(b) - value(a))[0];
}

/** Удар оружием сдерживания по столице агрессора. */
export function deterrentStrike(state: GameState, aggressor: number, owner: number): void {
  const capital = findCity(state, state.powers[aggressor].capitalId);
  if (!capital) return;
  const def = abilities.deterrent;
  capital.level = Math.max(1, capital.level - def.levelLoss);
  capital.growth = 0;
  while (capital.buildings.length > citySlots(capital)) capital.buildings.pop();
  capital.durability = 0;
  const unit = state.units.find((u) => u.tile === capital.tile);
  if (unit) removeUnit(state, unit.id);
  logPublic(
    state,
    [aggressor, owner],
    `${state.powers[owner].name} отвечает на нападение оружием сдерживания: ${capital.name} теряет ${def.levelLoss} уровня и всю оборону`,
  );
}

export function useAbility(state: GameState, power: number, use: AbilityUse): void {
  const p = state.powers[power];
  const cost = abilityCost(state, use);
  if (abilityPath(use.ability) === 'science') p.science -= cost;
  else p.culture -= cost;
  const name = (x: number) => state.powers[x].name;

  switch (use.ability) {
    case 'recon':
      p.effects.push({ kind: 'recon', target: use.target, until: state.turn + abilities.recon.turns });
      log(state, power, `Разведка: ${abilities.recon.turns} ходов видны все юниты державы ${name(use.target)}`);
      break;
    case 'fortify': {
      const city = findCity(state, use.cityId)!;
      city.fortifyTurns = abilities.fortify.turns;
      log(state, power, `${city.name}: фортификация на ${abilities.fortify.turns} хода`);
      break;
    }
    case 'sabotage': {
      const city = findCity(state, use.cityId)!;
      city.disabledBuilding = use.building;
      city.disabledTurns = abilities.sabotage.turns;
      remember(state, city.owner, power, 'sabotage', -10);
      log(state, power, `Саботаж: в городе ${city.name} не работает «${buildingDef(use.building!).name}»`);
      log(state, city.owner, `${city.name}: саботаж — «${buildingDef(use.building!).name}» не работает ${abilities.sabotage.turns} ходов`);
      break;
    }
    case 'deterrent':
      p.deterrent = true;
      logPublic(state, [power], `${p.name} создаёт оружие сдерживания: нападение на неё обернётся ударом по столице агрессора`);
      break;
    case 'callPeace':
      logPublic(state, [power, use.target], `${p.name} призывает державу ${name(use.target)} к миру с державой ${name(use.victim)}`);
      propose(state, power, use.target, { kind: 'callPeace', victim: use.victim });
      break;
    case 'propaganda':
      p.effects.push({ kind: 'propaganda', target: use.target, until: state.turn + abilities.propaganda.turns });
      remember(state, use.target, power, 'propaganda', abilities.propaganda.memory);
      log(state, power, `Пропаганда против державы ${name(use.target)}: стабильность ${pathsConfig.stability.propaganda} на ${abilities.propaganda.turns} ходов`);
      log(state, use.target, `${p.name} ведёт против нас пропаганду`);
      break;
    case 'convert': {
      const unit = findUnit(state, use.unitId)!;
      const from = unit.owner;
      unit.owner = power;
      unit.mp = 0;
      unit.routeTarget = NONE;
      unit.fortified = false;
      unit.moved = true;
      remember(state, from, power, 'converted', abilities.convert.memory);
      log(state, power, 'Вражеский юнит переходит на нашу сторону');
      log(state, from, `${p.name} переманивает наш юнит`);
      break;
    }
    case 'holiday':
      p.effects.push({ kind: 'holiday', target: power, until: state.turn + abilities.holiday.turns });
      log(state, power, `Праздник: +${abilities.holiday.stability} к стабильности на ${abilities.holiday.turns} ходов`);
      break;
  }
}
