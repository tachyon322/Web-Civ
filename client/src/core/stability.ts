// Стабильность: одна шкала 0..100 на державу, всегда с разбивкой. Высокая даёт расцвет, низкая —
// недовольство (минус доходы и боевой дух), а при мятежах города начинают отделяться — без случайности:
// сначала предупреждение, через несколько ходов — отделение самого недовольного города.

import { transferCity } from './capture';
import { activeBuildings } from './buildings';
import { buildingDef, diplomacyConfig, nationDef, nations, pathsConfig } from './data';
import type { Breakdown } from './economy';
import { blankPower, log } from './entities';
import { epochOf } from './epochs';
import { distance } from './hex';
import { nationTrait } from './nations';
import { computeNetwork } from './network';
import { remember, warTurns } from './relations';
import { citiesOf, findCity, findPact, mapSize } from './state';
import { NONE, type City, type GameState } from './types';
import { updateExplored } from './visibility';

const cfg = pathsConfig.stability;

export interface StabilityLevel {
  min: number;
  name: string;
  /** Поправка к доходам (доля). */
  income: number;
  /** Множитель боевой силы юнитов. */
  combat: number;
}

export function stabilityLevel(value: number): StabilityLevel {
  return cfg.levels.find((l) => value >= l.min) ?? cfg.levels[cfg.levels.length - 1];
}

/** Культурный лидер — держава с наибольшей заработанной культурой (NONE, если культуры ни у кого нет). */
export function cultureLeader(state: GameState): number {
  let best = NONE;
  let bestCulture = 0;
  for (const p of state.powers) {
    if (p.alive && p.cultureTotal > bestCulture) {
      best = p.id;
      bestCulture = p.cultureTotal;
    }
  }
  return best;
}

function add(b: Breakdown, label: string, value: number): void {
  const v = Math.round(value);
  if (v === 0) return;
  b.items.push({ label, value: v });
  b.total += v;
}

/** Города, не связанные со столицей сетью территории. */
export function disconnectedCities(state: GameState, power: number): City[] {
  const capital = findCity(state, state.powers[power].capitalId);
  if (!capital) return [];
  const label = computeNetwork(state, power);
  return citiesOf(state, power).filter((c) => c.id !== capital.id && (label[c.tile] === NONE || label[c.tile] !== label[capital.tile]));
}

/** Сколько городов держава держит без штрафа к стабильности: база, эпоха, черта нации. */
export function freeCities(state: GameState, power: number): number {
  const p = state.powers[power];
  return cfg.freeCities + pathsConfig.epoch.freeCitiesPerEpoch * epochOf(p) + (nationTrait(state, power).freeCities ?? 0);
}

/** Стабильность с разбивкой: что поднимает и что снижает. */
export function computeStability(state: GameState, power: number): Breakdown {
  const p = state.powers[power];
  const b: Breakdown = { total: 0, items: [] };
  add(b, 'База', cfg.base);
  const cities = citiesOf(state, power);

  let temples = 0;
  let wonders = 0;
  for (const c of cities) {
    for (const id of activeBuildings(c)) {
      const def = buildingDef(id);
      if (def.wonder) wonders += def.stability ?? 0;
      else temples += def.stability ?? 0;
    }
  }
  add(b, 'Храмы, театры, музеи', temples);
  add(b, 'Чудеса света', wonders);
  if (!p.wars.length) add(b, 'Мир', cfg.peace);
  const alliances = state.pacts.filter((x) => x.kind === 'alliance' && (x.a === power || x.b === power)).length;
  add(b, 'Союзы', Math.min(cfg.allianceMax, alliances * cfg.alliance));
  const holiday = p.effects.some((e) => e.kind === 'holiday' && e.until > state.turn);
  if (holiday) add(b, 'Праздник', pathsConfig.abilities.holiday.stability);

  const free = freeCities(state, power);
  const extra = Math.max(0, cities.length - free);
  add(b, `Города сверх ${free}`, extra * cfg.extraCity);
  add(b, 'Города без связи со столицей', disconnectedCities(state, power).length * cfg.disconnected);

  let annexed = 0;
  for (const c of cities) {
    if (c.founder === power) continue;
    const founder = state.powers[c.founder];
    annexed += founder.alive && founder.cultureTotal > p.cultureTotal ? cfg.annexedStrongCulture : cfg.annexed;
  }
  add(b, 'Присоединённые города', annexed);

  // Усталость от войны копится каждый ход, сильнее у агрессора и в войне с культурным лидером.
  const leader = cultureLeader(state);
  let weariness = 0;
  for (const w of p.wars) {
    let v = Math.max(cfg.warMaxPerWar, warTurns(state, power, w) * cfg.warPerTurn);
    if (findPact(state, power, w, 'war')?.by === power) v *= cfg.warAggressorFactor;
    if (w === leader) v *= cfg.warCultureLeaderFactor;
    weariness += v;
  }
  add(b, 'Усталость от войны', Math.max(cfg.warMax, weariness));

  const propaganda = state.powers.reduce(
    (n, o) => n + o.effects.filter((e) => e.kind === 'propaganda' && e.target === power && e.until > state.turn).length,
    0,
  );
  add(b, 'Пропаганда врага', Math.max(cfg.propagandaMax, propaganda * cfg.propaganda));
  if (p.gold < 0) add(b, 'Долги', cfg.debts);

  b.total = Math.max(0, Math.min(100, b.total));
  return b;
}

export function refreshStability(state: GameState, power: number): void {
  const p = state.powers[power];
  if (p.alive) p.stability = computeStability(state, power).total;
}

export function refreshAllStability(state: GameState): void {
  for (const p of state.powers) refreshStability(state, p.id);
}

// ---------- Отделение ----------

/** Самый недовольный город: отрезанный от столицы, затем присоединённый, затем самый дальний. */
export function mostDiscontentCity(state: GameState, power: number): City | null {
  const capital = findCity(state, state.powers[power].capitalId);
  const size = mapSize(state);
  const cut = new Set(disconnectedCities(state, power).map((c) => c.id));
  let best: City | null = null;
  let bestScore = -Infinity;
  for (const c of citiesOf(state, power)) {
    if (c.isCapital) continue;
    const score = (cut.has(c.id) ? 1000 : 0) + (c.founder !== power ? 500 : 0) + (capital ? distance(size, c.tile, capital.tile) : 0);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/** К кому уходит город: сосед (с городом не дальше 6 клеток) с самой сильной культурой. */
function strongestCultureNeighbor(state: GameState, from: number, city: City): number {
  const size = mapSize(state);
  let best = NONE;
  let bestCulture = -1;
  for (const p of state.powers) {
    if (!p.alive || p.id === from) continue;
    const near = state.cities.some((c) => c.owner === p.id && distance(size, c.tile, city.tile) <= 6);
    if (near && p.cultureTotal > bestCulture) {
      best = p.id;
      bestCulture = p.cultureTotal;
    }
  }
  return best;
}

/** Новое государство из отделившихся городов. Нация — первая из ещё не игравших; если таких нет — null. */
function createBreakaway(state: GameState, from: number, cities: City[]): number | null {
  const used = new Set(state.powers.map((p) => p.nationId));
  const nation = nations.find((n) => !used.has(n.id));
  if (!nation) return null;
  const id = state.powers.length;
  const tiles = state.map.width * state.map.height;
  const p = blankPower(id, nation.id, false, nationDef(nation.id).tendency, tiles, 0);
  state.powers.push(p);
  p.met = [from];
  state.powers[from].met.push(id);
  for (const c of cities) transferCity(state, c, id);
  const capital = cities.reduce((a, c) => (c.level > a.level ? c : a), cities[0]);
  capital.isCapital = true;
  p.capitalId = capital.id;
  updateExplored(state, id);
  refreshStability(state, id);
  return id;
}

function secede(state: GameState, power: number, city: City): void {
  const p = state.powers[power];
  // Отрезанные от столицы связанные города уходят вместе и образуют новое государство.
  const label = computeNetwork(state, power);
  const cut = disconnectedCities(state, power);
  const group = cut.some((c) => c.id === city.id)
    ? cut.filter((c) => label[c.tile] !== NONE && label[c.tile] === label[city.tile])
    : [city];
  let to = NONE;
  let moved = group;
  if (group.length >= 2) to = createBreakaway(state, power, group) ?? NONE;
  if (to === NONE) {
    moved = [city];
    to = strongestCultureNeighbor(state, power, city);
    if (to === NONE) to = createBreakaway(state, power, moved) ?? NONE;
    if (to === NONE) return;
    if (city.owner === power) transferCity(state, city, to);
  }
  remember(state, power, to, 'seceded', diplomacyConfig.events.seceded);
  log(state, NONE, `Мятежи в державе ${p.name}: ${moved.map((c) => c.name).join(', ')} — теперь ${state.powers[to].name}`);
}

/** Конец хода: предупреждения и отделение при мятежах. */
export function processSecession(state: GameState): void {
  for (const p of [...state.powers]) {
    if (!p.alive) continue;
    if (p.stability >= cfg.secessionBelow || citiesOf(state, p.id).length < 2) {
      if (p.secession) {
        log(state, p.id, 'Угроза отделения миновала');
        p.secession = null;
      }
      continue;
    }
    const warned = p.secession ? findCity(state, p.secession.cityId) : undefined;
    if (!p.secession || !warned || warned.owner !== p.id) {
      const city = mostDiscontentCity(state, p.id);
      if (!city) continue;
      p.secession = { cityId: city.id, due: state.turn + cfg.secessionWarningTurns };
      log(state, p.id, `Мятежи: ${city.name} отделится через ${cfg.secessionWarningTurns} хода, если стабильность не поднимется до ${cfg.secessionBelow}`);
      continue;
    }
    if (state.turn < p.secession.due) continue;
    p.secession = null;
    secede(state, p.id, warned);
    refreshStability(state, p.id);
  }
}
