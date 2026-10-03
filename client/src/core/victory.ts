// Финальные проекты и победы. Проект строится в конкретном городе: каждый этап выкупается очками
// науки или культуры, о нём узнаёт весь мир; если город захватят — прогресс сгорает.
// Победы: завоевание (больше половины исходных столиц), федерация (60% уровней городов вместе
// с вассалами), наука и культура — три этапа своего проекта.

import { wondersOwned } from './buildings';
import { pathsConfig } from './data';
import { log } from './entities';
import { epochName, epochOf, LAST_EPOCH } from './epochs';
import { cityAt, citiesOf, findCity, vassalsOf } from './state';
import { NONE, type City, type GameState, type ProjectKind, type VictoryKind } from './types';

const cfg = pathsConfig.projects;

export function projectName(kind: ProjectKind): string {
  return cfg[kind].name;
}

export const PROJECT_STAGES = cfg.science.stages.length;

/** Город, где держава строит проект этого вида, или null. */
export function projectCity(state: GameState, power: number, kind: ProjectKind): City | null {
  return citiesOf(state, power).find((c) => c.project?.kind === kind) ?? null;
}

export function projectStageCost(city: City, kind: ProjectKind): number | null {
  const done = city.project?.kind === kind ? city.project.stages : 0;
  return done < PROJECT_STAGES ? cfg[kind].stages[done] : null;
}

/** Почему нельзя выкупить следующий этап; null — можно. */
export function projectBlocker(state: GameState, power: number, cityId: number, kind: ProjectKind): string | null {
  const p = state.powers[power];
  const city = findCity(state, cityId);
  if (!city || city.owner !== power) return 'Это не ваш город';
  if (kind === 'science' && epochOf(p) < LAST_EPOCH) return `Великий проект откроется в эпоху «${epochName(LAST_EPOCH)}»`;
  if (kind === 'culture' && wondersOwned(state, power) < cfg.culture.wonders) {
    return `Нужно ${cfg.culture.wonders} чуда света (сейчас ${wondersOwned(state, power)})`;
  }
  const other = projectCity(state, power, kind);
  if (other && other.id !== city.id) return `Проект уже строится в городе ${other.name}`;
  if (city.project && city.project.kind !== kind) return 'В этом городе строится другой проект';
  if (city.purchasedThisTurn) return 'В этом городе уже была покупка в этом ходу';
  const cost = projectStageCost(city, kind);
  if (cost === null) return 'Проект завершён';
  const have = kind === 'science' ? p.science : p.culture;
  if (have < cost) return `Нужно ${cost} ${kind === 'science' ? 'науки' : 'культуры'}`;
  return null;
}

export function buyProjectStage(state: GameState, power: number, cityId: number, kind: ProjectKind): void {
  const p = state.powers[power];
  const city = findCity(state, cityId)!;
  const cost = projectStageCost(city, kind)!;
  if (kind === 'science') p.science -= cost;
  else p.culture -= cost;
  city.purchasedThisTurn = true;
  city.project = { kind, stages: (city.project?.stages ?? 0) + 1 };
  log(state, NONE, `${p.name}: этап ${city.project.stages} из ${PROJECT_STAGES} — «${projectName(kind)}» в городе ${city.name}`);
}

/** Прогресс сгорает, когда город меняет владельца. */
export function burnProject(state: GameState, city: City): void {
  if (!city.project) return;
  log(state, NONE, `${city.name}: прогресс проекта «${projectName(city.project.kind)}» сгорает`);
  city.project = null;
}

/** Сколько исходных столиц (включая свою) контролирует держава. */
export function capitalsHeld(state: GameState, power: number): number {
  return state.map.starts.filter((t) => cityAt(state, t)?.owner === power).length;
}

/** Доля уровней городов мира у державы вместе с её вассалами. */
export function federationShare(state: GameState, power: number): number {
  const bloc = new Set([power, ...vassalsOf(state, power)]);
  let mine = 0;
  let total = 0;
  for (const c of state.cities) {
    total += c.level;
    if (bloc.has(c.owner)) mine += c.level;
  }
  return total ? mine / total : 0;
}

export interface VictoryProgress {
  capitals: number;
  capitalsNeeded: number;
  federation: number;
  vassals: number;
  science: number;
  culture: number;
}

export function victoryProgress(state: GameState, power: number): VictoryProgress {
  return {
    capitals: capitalsHeld(state, power),
    capitalsNeeded: Math.floor(state.map.starts.length / 2) + 1,
    federation: federationShare(state, power),
    vassals: vassalsOf(state, power).length,
    science: projectCity(state, power, 'science')?.project?.stages ?? 0,
    culture: projectCity(state, power, 'culture')?.project?.stages ?? 0,
  };
}

const VICTORY_NAMES: Record<VictoryKind, string> = {
  conquest: 'завоевание',
  federation: 'федерация',
  science: 'наука',
  culture: 'культура',
};

export function victoryName(kind: VictoryKind): string {
  return VICTORY_NAMES[kind];
}

/** Проверка побед; при победе партия заканчивается. */
export function checkVictory(state: GameState): void {
  if (state.winner) return;
  const v = pathsConfig.victory;
  for (const p of state.powers) {
    if (!p.alive) continue;
    const pr = victoryProgress(state, p.id);
    let kind: VictoryKind | null = null;
    if (pr.science >= PROJECT_STAGES) kind = 'science';
    else if (pr.culture >= PROJECT_STAGES) kind = 'culture';
    else if (state.map.starts.length > 1 && pr.capitals >= pr.capitalsNeeded) kind = 'conquest';
    else if (pr.federation >= v.federationShare && pr.vassals >= v.federationMinVassals) kind = 'federation';
    if (!kind) continue;
    state.winner = { power: p.id, kind, turn: state.turn };
    log(state, NONE, `Победа: ${p.name} — ${victoryName(kind)}`);
    return;
  }
}

/** Ближе всех к победе через финальный проект: больше всего выкупленных этапов (NONE — никто не строит). */
export function projectLeader(state: GameState): number {
  let best = NONE;
  let bestStages = 0;
  for (const c of state.cities) {
    if (c.project && c.project.stages > bestStages && state.powers[c.owner].alive) {
      best = c.owner;
      bestStages = c.project.stages;
    }
  }
  return best;
}
