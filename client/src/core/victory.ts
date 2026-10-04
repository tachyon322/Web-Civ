// Финальный проект и победы. Великий проект строится в конкретном городе: каждый этап выкупается очками
// науки, о нём узнаёт весь мир; если город захватят — прогресс сгорает.
// Победы: завоевание (больше половины исходных столиц), федерация (60% уровней городов вместе
// с вассалами), наука — три этапа проекта, культура — гегемония над больше чем половиной держав 10 ходов подряд.

import { pathsConfig } from './data';
import { log } from './entities';
import { logPublic } from './diplomacy';
import { hegemonyOver } from './influence';
import { epochName, epochOf, LAST_EPOCH } from './epochs';
import { cityAt, citiesOf, findCity, vassalsOf } from './state';
import { turnsWord } from './text';
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

/** Сколько ходов ждать до следующего этапа (0 — можно сейчас). */
export function projectCooldown(state: GameState, city: City, kind: ProjectKind): number {
  const last = city.project?.kind === kind ? city.project.stageTurn : undefined;
  if (last === undefined) return 0;
  return Math.max(0, last + cfg[kind].cooldown - state.turn);
}

/** Почему нельзя выкупить следующий этап; null — можно. */
export function projectBlocker(state: GameState, power: number, cityId: number, kind: ProjectKind): string | null {
  const p = state.powers[power];
  const city = findCity(state, cityId);
  if (!city || city.owner !== power) return 'Это не ваш город';
  if (epochOf(p) < LAST_EPOCH) return `Великий проект откроется в эпоху «${epochName(LAST_EPOCH)}»`;
  const other = projectCity(state, power, kind);
  if (other && other.id !== city.id) return `Проект уже строится в городе ${other.name}`;
  if (city.project && city.project.kind !== kind) return 'В этом городе строится другой проект';
  if (city.purchasedThisTurn) return 'В этом городе уже была покупка в этом ходу';
  const wait = projectCooldown(state, city, kind);
  if (wait > 0) return `Следующий этап — через ${wait} ${turnsWord(wait)}`;
  const cost = projectStageCost(city, kind);
  if (cost === null) return 'Проект завершён';
  if (p.science < cost) return `Нужно ${cost} науки`;
  return null;
}

export function buyProjectStage(state: GameState, power: number, cityId: number, kind: ProjectKind): void {
  const p = state.powers[power];
  const city = findCity(state, cityId)!;
  const cost = projectStageCost(city, kind)!;
  p.science -= cost;
  city.purchasedThisTurn = true;
  city.project = { kind, stages: (city.project?.stages ?? 0) + 1, stageTurn: state.turn };
  log(state, NONE, `${p.name}: этап ${city.project.stages} из ${PROJECT_STAGES} — «${projectName(kind)}» в городе ${city.name}`);
  stageEffect(state, city.project.stages);
}

/** Этапы Великого проекта меняют правила мира: обвал влияния, затем планетарная глушилка. */
function stageEffect(state: GameState, stage: number): void {
  const cfg = pathsConfig.projects.science;
  if (stage === 1) {
    for (const p of state.powers) p.influence = p.influence.map((v) => Math.round(v * (1 - cfg.influenceCrash) * 100) / 100);
    log(state, NONE, `Обвал базы данных: всё культурное влияние в мире падает на ${Math.round(cfg.influenceCrash * 100)}%`);
  }
  if (stage === cfg.jamStage) log(state, NONE, 'Планетарная глушилка: пока стоит Великий проект, гастроли и подстрекательство невозможны');
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
  /** Для скольких держав гегемон, сколько нужно и сколько ходов осталось до победы (null — отсчёта нет). */
  hegemony: number;
  hegemonyNeeded: number;
  hegemonyLeft: number | null;
}

export function victoryProgress(state: GameState, power: number): VictoryProgress {
  return {
    capitals: capitalsHeld(state, power),
    capitalsNeeded: Math.floor(state.map.starts.length / 2) + 1,
    federation: federationShare(state, power),
    vassals: vassalsOf(state, power).length,
    science: projectCity(state, power, 'science')?.project?.stages ?? 0,
    hegemony: hegemonyOver(state, power).length,
    hegemonyNeeded: hegemonyNeeded(state),
    hegemonyLeft: hegemonyLeft(state, power),
  };
}

// ---------- Культурная гегемония ----------

/** Для скольких держав нужно быть гегемоном: больше половины живых, не считая себя. */
export function hegemonyNeeded(state: GameState): number {
  const others = state.powers.filter((p) => p.alive).length - 1;
  return Math.floor(others * pathsConfig.victory.hegemonyShare) + 1;
}

export function hasHegemony(state: GameState, power: number): boolean {
  return state.powers[power].alive && hegemonyOver(state, power).length >= hegemonyNeeded(state);
}

/** Сколько ходов осталось до культурной победы; null — отсчёт не идёт. */
export function hegemonyLeft(state: GameState, power: number): number | null {
  const since = state.powers[power].hegemonySince;
  return since ? Math.max(0, since + pathsConfig.victory.hegemonyTurns - state.turn) : null;
}

/** Конец хода: отсчёт гегемонии начинается, когда условие выполнено, и сбрасывается, если хоть на ход нарушено. */
export function hegemonyNewTurn(state: GameState): void {
  for (const p of state.powers) {
    const held = hasHegemony(state, p.id);
    if (held && !p.hegemonySince) {
      p.hegemonySince = state.turn;
      logPublic(state, [p.id], `${p.name} — культурный гегемон мира: победа через ${pathsConfig.victory.hegemonyTurns} ходов, если удержит`);
    } else if (!held && p.hegemonySince) {
      p.hegemonySince = 0;
      if (p.alive) logPublic(state, [p.id], `${p.name} теряет культурную гегемонию: отсчёт сброшен`);
    }
  }
}

/** Держава, у которой идёт отсчёт гегемонии (раньше всех начавшая), или NONE. */
export function hegemonyLeader(state: GameState): number {
  let best = NONE;
  for (const p of state.powers) {
    if (p.alive && p.hegemonySince && (best === NONE || p.hegemonySince < state.powers[best].hegemonySince)) best = p.id;
  }
  return best;
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
    else if (pr.hegemonyLeft === 0) kind = 'culture';
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
