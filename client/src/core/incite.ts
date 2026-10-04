// Подстрекательство: держава тратит культуру и натравливает бота A на державу B. A не обязан напасть:
// у него появляется обида на B и на несколько ходов снижается порог силы для войны против B, а решает он
// по своему обычному расчёту. Сила зависит от влияния подстрекателя на A и характера A. Если A и B
// в союзе и обида опускает отношение ниже порога союза, A расторгает союз; если ниже нуля — и торговый договор. Если культура B выше, чем
// у подстрекателя, B узнаёт, кто стоял за интригой. Все интриги запоминаются (для научного деанона).

import { diplomacyConfig, diplomacyTraits, pathsConfig } from './data';
import { cancelPact, hasMet, logPublic } from './diplomacy';
import { log } from './entities';
import { influenceOf } from './influence';
import { opinion, remember, sizeOf } from './relations';
import { allied, hasPact } from './state';
import { turnsWord } from './text';
import type { GameState, Intrigue } from './types';

const cfg = pathsConfig.abilities.incite;

/** Сила подстрекательства 0..: доля от полной по влиянию на A, умноженная на податливость характера A. */
export function inciteStrength(state: GameState, by: number, a: number): number {
  const inf = influenceOf(state, a, by);
  if (inf < cfg.minInfluence) return 0;
  const share = Math.min(1, inf / cfg.fullInfluence);
  return Math.round(share * diplomacyTraits(state.powers[a].character).inciteFactor * 100) / 100;
}

/** Цена: база, умноженная на размер A относительно подстрекателя (в пределах sizeMin..sizeMax). */
export function inciteCost(state: GameState, by: number, a: number): number {
  const ratio = sizeOf(state, a) / Math.max(1, sizeOf(state, by));
  return Math.round(cfg.cost * Math.max(cfg.sizeMin, Math.min(cfg.sizeMax, ratio)));
}

/** Сколько ходов ждать до следующего подстрекательства этой державы (0 — можно). */
export function inciteCooldown(state: GameState, by: number, a: number): number {
  const last = state.intrigues.filter((x) => x.by === by && x.a === a).reduce((m, x) => Math.max(m, x.turn), -Infinity);
  return Math.max(0, last + cfg.cooldown - state.turn);
}

/** Почему нельзя натравить a на b (без учёта цены); null — можно. */
export function inciteBlocker(state: GameState, by: number, a: number, b: number): string | null {
  const pa = state.powers[a];
  const pb = state.powers[b];
  if (!pa?.alive || a === by) return 'Выберите другую державу';
  if (pa.isHuman) return 'Игроком управляет он сам — подстрекать можно только ботов';
  if (!pb?.alive || b === a || b === by) return 'Выберите, на кого натравить';
  if (!hasMet(state, by, a) || !hasMet(state, by, b)) return 'Вы встречались не со всеми';
  if (!hasMet(state, a, b)) return `${pa.name} ещё не встречал державу ${pb.name}`;
  if (pa.wars.includes(b)) return 'Они уже воюют';
  if (inciteStrength(state, by, a) <= 0) return `Нужно влияние на них от ${cfg.minInfluence}%`;
  const wait = inciteCooldown(state, by, a);
  if (wait) return `Снова подстрекать их можно через ${wait} ${turnsWord(wait)}`;
  return null;
}

/** Узнает ли b, кто стоит за интригой: да, если её культура выше, чем у подстрекателя. */
export function inciteExposed(state: GameState, by: number, b: number): boolean {
  return state.powers[b].cultureTotal > state.powers[by].cultureTotal;
}

/** Обида A на B от подстрекательства (отрицательное число). */
export function inciteGrievance(strength: number): number {
  return -Math.round(cfg.grievance * strength);
}

/** Применяет подстрекательство (культура уже списана). Возвращает запись интриги. */
export function applyIncite(state: GameState, by: number, a: number, b: number): Intrigue {
  const strength = inciteStrength(state, by, a);
  const exposed = inciteExposed(state, by, b);
  const intrigue: Intrigue = { by, a, b, turn: state.turn, until: state.turn + cfg.turns, strength, revealed: exposed };
  state.intrigues = state.intrigues.filter((x) => x.turn > state.turn - cfg.keepTurns);
  state.intrigues.push(intrigue);
  const pa = state.powers[a];
  const pb = state.powers[b];
  remember(state, a, b, 'incited', inciteGrievance(strength), `Обида на них`);
  if (allied(state, a, b) && opinion(state, a, b).total < diplomacyConfig.deals.allianceOpinion) cancelPact(state, a, b, 'alliance');
  // Санкции: если обида опустила отношение ниже нуля, A рвёт и торговый договор.
  if (hasPact(state, a, b, 'trade') && opinion(state, a, b).total < cfg.tradeBreakOpinion) cancelPact(state, a, b, 'trade');
  log(state, by, `Подстрекательство: ${pa.name} теперь обижен на державу ${pb.name}${exposed ? ' — но они узнали, что это мы' : ''}`);
  if (exposed) revealIntrigue(state, intrigue);
  return intrigue;
}

/** Раскрытие: жертва помнит подстрекателя, остальные встречавшие — немного хуже о нём думают. */
export function revealIntrigue(state: GameState, intrigue: Intrigue): void {
  intrigue.revealed = true;
  const { by, a, b } = intrigue;
  remember(state, b, by, 'incitedAgainst', cfg.exposedMemory);
  for (const o of state.powers) {
    if (!o.alive || o.id === by || o.id === b || !o.met.includes(by)) continue;
    remember(state, o.id, by, 'intrigueSeen', cfg.seenMemory);
  }
  logPublic(state, [b, by], `Раскрыта интрига: ${state.powers[by].name} натравливает державу ${state.powers[a].name} на державу ${state.powers[b].name}`);
}

/** Во сколько раз снижен порог силы для войны a против b из-за действующих интриг (1 — не снижен). */
export function inciteWarFactor(state: GameState, a: number, b: number): number {
  let f = 1;
  for (const x of state.intrigues) {
    if (x.a === a && x.b === b && x.until > state.turn) f = Math.min(f, 1 - (1 - cfg.warFactor) * Math.min(1, x.strength));
  }
  return f;
}

/** Действует ли сейчас подстрекательство a против b. */
export function incited(state: GameState, a: number, b: number): boolean {
  return state.intrigues.some((x) => x.a === a && x.b === b && x.until > state.turn);
}
