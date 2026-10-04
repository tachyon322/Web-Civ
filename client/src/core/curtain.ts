// Цифровой занавес — пассивный щит науки от чужой культуры. Чем выше наука державы относительно культуры
// того, кто на неё влияет, тем сильнее режется всё его культурное воздействие: рост влияния (пассивный
// и гастроли), культурное давление на её города и утечка мозгов. Предел — curtain.max.

import { pathsConfig } from './data';
import type { GameState } from './types';

/** Какую долю культурного воздействия from на target режет занавес target: 0..max. */
export function curtainCut(state: GameState, target: number, from: number): number {
  const cfg = pathsConfig.curtain;
  const ratio = state.powers[target].scienceTotal / Math.max(1, state.powers[from].cultureTotal);
  return Math.round(Math.max(0, Math.min(cfg.max, (ratio - 1) * cfg.perRatio)) * 100) / 100;
}

/** Сколько воздействия проходит сквозь занавес: value × (1 − срез). */
export function throughCurtain(state: GameState, target: number, from: number, value: number): number {
  return value * (1 - curtainCut(state, target, from));
}
