// Способности путей: тратят очки науки или культуры. Каждая трата спасает сейчас, но отодвигает победу.
// Наука: разведка, модерация контента, саботаж сети, деанон, глушилка. Культура: призыв к миру, пропаганда,
// переманивание, праздник, гастроли, подстрекательство (культурный обмен — в дипломатии).

import { pathsConfig, type AbilityId } from './data';
import { dealBlocker, hasMet, logPublic, propose } from './diplomacy';
import { log } from './entities';
import { applyIncite, inciteBlocker, inciteCost, revealIntrigue } from './incite';
import { applyTour, tourCost } from './influence';
import { neighbors } from './hex';
import { nationTrait } from './nations';
import { remember } from './relations';
import { allied, atWar, cityAt, findCity, findUnit, mapSize, unitPeople } from './state';
import { turnsWord } from './text';
import { NONE, type EffectKind, type GameState, type Intrigue } from './types';
import { computeVisible } from './visibility';

const abilities = pathsConfig.abilities;

export interface AbilityUse {
  ability: AbilityId;
  /** Держава-цель (разведка, пропаганда, призыв к миру, гастроли) или NONE. */
  target: number;
  /** Город (модерация, саботаж сети) или NONE. */
  cityId: number;
  /** Юнит (переманивание) или NONE. */
  unitId: number;
  /** Жертва агрессора (призыв к миру), на кого натравить (подстрекательство) или NONE. */
  victim: number;
}

export const NO_TARGET: Omit<AbilityUse, 'ability'> = { target: NONE, cityId: NONE, unitId: NONE, victim: NONE };

export function abilityPath(ability: AbilityId): 'science' | 'culture' {
  return abilities[ability].path as 'science' | 'culture';
}

export function abilityCost(state: GameState, power: number, use: AbilityUse): number {
  let cost: number;
  if (use.ability === 'convert') {
    const unit = findUnit(state, use.unitId);
    cost = abilities.convert.costPerPerson * (unit ? unitPeople(unit) : 1);
  } else if (use.ability === 'incite') {
    cost = state.powers[use.target]?.alive ? inciteCost(state, power, use.target) : abilities.incite.cost;
  } else if (use.ability === 'tour') {
    cost = state.powers[use.target]?.alive ? tourCost(state, use.target) : abilities.tour.minCost;
  } else cost = (abilities[use.ability] as { cost: number }).cost;
  const discount = abilityPath(use.ability) === 'science' ? (nationTrait(state, power).scienceAbilityDiscount ?? 0) : 0;
  return Math.round(cost * (1 - discount));
}

function hasEffect(state: GameState, power: number, kind: EffectKind, target: number): boolean {
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
  const cost = abilityCost(state, power, use);
  const path = abilityPath(use.ability);
  const have = path === 'science' ? p.science : p.culture;
  const need = () => `Нужно ${cost} ${path === 'science' ? 'науки' : 'культуры'}`;

  const sabotaged = abilities.sabotage.buildings as string[];
  let blocker: string | null = null;
  switch (use.ability) {
    case 'recon':
      blocker = foreignPowerBlocker(state, power, use.target);
      if (!blocker && hasEffect(state, power, 'recon', use.target)) blocker = 'Разведка уже идёт';
      break;
    case 'moderation': {
      const city = findCity(state, use.cityId);
      if (!city || city.owner !== power) blocker = 'Это не ваш город';
      else if (city.moderationTurns > 0) blocker = `Модерация уже действует (ещё ${city.moderationTurns} ${turnsWord(city.moderationTurns)})`;
      break;
    }
    case 'sabotage': {
      const city = findCity(state, use.cityId);
      if (!city || city.owner === power) blocker = 'Выберите чужой город';
      else if (!p.explored[city.tile]) blocker = 'Этот город вам неизвестен';
      else blocker = foreignPowerBlocker(state, power, city.owner);
      if (!blocker && allied(state, power, city!.owner)) blocker = 'Против союзника — нельзя';
      if (!blocker && !city!.buildings.some((b) => sabotaged.includes(b))) blocker = 'В городе нет храмов, театров и музеев';
      if (!blocker && city!.disabledTurns > 0) blocker = 'В городе уже идёт саботаж';
      break;
    }
    case 'deanon':
      if (!hiddenIntriguesAgainst(state, power).length) blocker = 'Нераскрытых интриг против вас и ваших союзников нет';
      break;
    case 'jammer':
      if (!state.powers[use.target]?.alive) blocker = 'Выберите державу';
      else if (use.target !== power && !hasMet(state, power, use.target)) blocker = 'Вы ещё не встречались';
      else if (jammed(state, use.target)) blocker = 'Глушилка уже действует';
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
    case 'tour':
      blocker = foreignPowerBlocker(state, power, use.target);
      if (!blocker && atWar(state, power, use.target)) blocker = 'С врагом гастролей не бывает';
      blocker ??= intrigueJamBlocker(state, use.target);
      break;
    case 'incite':
      blocker = inciteBlocker(state, power, use.target, use.victim) ?? intrigueJamBlocker(state, use.target);
      break;
  }
  if (blocker) return blocker;
  return have < cost ? need() : null;
}

/** Глушилка: на державу сейчас нельзя применять гастроли и подстрекательство. */
export function jammed(state: GameState, target: number): boolean {
  return state.powers.some((p) => p.effects.some((e) => e.kind === 'jammer' && e.target === target && e.until > state.turn));
}

/** Планетарная глушилка: пока цел город с Великим проектом на нужном этапе, интриги отключены для всех. */
export function planetaryJam(state: GameState): boolean {
  const stage = pathsConfig.projects.science.jamStage;
  return state.cities.some((c) => c.project && c.project.stages >= stage && state.powers[c.owner].alive);
}

/** Почему гастроли и подстрекательство на target сейчас заглушены; null — нет. */
export function intrigueJamBlocker(state: GameState, target: number): string | null {
  if (planetaryJam(state)) return 'Планетарная глушилка: пока стоит Великий проект, интриги невозможны';
  if (jammed(state, target)) return 'На эту державу действует глушилка';
  return null;
}

/** Нераскрытые подстрекательства против державы и её союзников. */
export function hiddenIntriguesAgainst(state: GameState, power: number): Intrigue[] {
  return state.intrigues.filter((x) => !x.revealed && x.by !== power && (x.b === power || allied(state, power, x.b)));
}

export function useAbility(state: GameState, power: number, use: AbilityUse): void {
  const p = state.powers[power];
  const cost = abilityCost(state, power, use);
  if (abilityPath(use.ability) === 'science') p.science -= cost;
  else p.culture -= cost;
  const name = (x: number) => state.powers[x].name;

  switch (use.ability) {
    case 'recon':
      p.effects.push({ kind: 'recon', target: use.target, until: state.turn + abilities.recon.turns });
      log(state, power, `Разведка: ${abilities.recon.turns} ходов видны все юниты державы ${name(use.target)}`);
      break;
    case 'moderation': {
      const city = findCity(state, use.cityId)!;
      city.moderationTurns = abilities.moderation.turns;
      log(state, power, `${city.name}: модерация контента на ${abilities.moderation.turns} ходов — ни давления, ни мятежей`);
      break;
    }
    case 'sabotage': {
      const city = findCity(state, use.cityId)!;
      city.disabledTurns = abilities.sabotage.turns;
      remember(state, city.owner, power, 'sabotage', -10);
      log(state, power, `Саботаж сети: в городе ${city.name} ${abilities.sabotage.turns} ходов не работают храмы, театры и музеи`);
      log(state, city.owner, `${city.name}: саботаж сети — храмы, театры и музеи не работают ${abilities.sabotage.turns} ходов`);
      break;
    }
    case 'deanon': {
      const found = hiddenIntriguesAgainst(state, power);
      for (const x of found) revealIntrigue(state, x);
      log(state, power, `Деанон: раскрыто интриг — ${found.length}`);
      break;
    }
    case 'jammer':
      p.effects.push({ kind: 'jammer', target: use.target, until: state.turn + abilities.jammer.turns });
      logPublic(state, [power, use.target], `${p.name} ставит глушилку на державу ${name(use.target)}: ${abilities.jammer.turns} ходов никаких гастролей и подстрекательства`);
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
    case 'tour': {
      const gain = applyTour(state, power, use.target);
      log(state, power, `Гастроли в державе ${name(use.target)}: наше влияние +${gain}%`);
      log(state, use.target, `${p.name} гастролирует у нас`);
      break;
    }
    case 'incite':
      applyIncite(state, power, use.target, use.victim);
      break;
  }
}
