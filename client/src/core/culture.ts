// Пассивная сила культуры: ополчение в атакованных городах, мятежи в захваченных городах
// («захватить можно, удержать нельзя») и культурное давление на приграничные города слабых соседей.
// Утечка мозгов считается в доходах (economy.ts).

import { diplomacyConfig, pathsConfig } from './data';
import { cedeCity, logPublic } from './diplomacy';
import { computeIncome } from './economy';
import { createUnit, log } from './entities';
import { throughCurtain } from './curtain';
import { distance } from './hex';
import { nationTrait } from './nations';
import { remember } from './relations';
import { isMilitary, mapSize, unitAt } from './state';
import { NONE, type City, type GameState } from './types';

const cfg = pathsConfig.culture;

/** Ополчение: в атакованном за ход городе культурной державы без защитника бесплатно появляется воин 2-го уровня. */
export function spawnMilitia(state: GameState): void {
  for (const city of state.cities) {
    if (!city.attackedThisTurn || unitAt(state, city.tile) || state.turn < city.militiaReadyAt) continue;
    if (computeIncome(state, city.owner).culture.total < cfg.militiaIncome) continue;
    createUnit(state, city.owner, 'warrior', city.tile, 0, 2);
    city.militiaReadyAt = state.turn + cfg.militiaCooldown;
    log(state, city.owner, `${city.name}: горожане взялись за оружие — ополчение`);
  }
}

/** Гарнизон, подавляющий мятеж: свой военный юнит достаточной силы в городе. */
export function garrisoned(state: GameState, city: City): boolean {
  const u = unitAt(state, city.tile);
  return !!u && u.owner === city.owner && isMilitary(u) && u.strength >= cfg.garrisonMinStrength;
}

/** Причина, по которой в городе может начаться мятеж: прежний владелец с более сильной культурой. */
export function revoltSource(state: GameState, city: City, formerOwner: number): number {
  const former = state.powers[formerOwner];
  if (formerOwner === city.owner || !former?.alive) return NONE;
  return former.cultureTotal > state.powers[city.owner].cultureTotal ? formerOwner : NONE;
}

function revolts(state: GameState): void {
  for (const city of [...state.cities]) {
    if (city.revoltFrom === NONE) continue;
    if (revoltSource(state, city, city.revoltFrom) === NONE) {
      city.revoltFrom = NONE;
      city.revoltProgress = 0;
      continue;
    }
    // Гарнизон и модерация контента сдерживают мятеж.
    if (garrisoned(state, city) || city.moderationTurns > 0) continue;
    city.revoltProgress++;
    if (city.revoltProgress < cfg.revoltTurns) continue;
    const from = city.owner;
    const to = city.revoltFrom;
    city.revoltFrom = NONE;
    city.revoltProgress = 0;
    cedeCity(state, city, to);
    logPublic(state, [from, to], `${city.name} восстаёт и возвращается к державе ${state.powers[to].name}`);
  }
}

/** Кто давит на город культурой сейчас: сосед с городом рядом и намного более сильной культурой. */
export function pressureSource(state: GameState, city: City): { power: number; ratio: number } | null {
  if (city.isCapital) return null;
  const size = mapSize(state);
  const theirs = Math.max(1, state.powers[city.owner].cultureTotal);
  let best: { power: number; ratio: number } | null = null;
  for (const p of state.powers) {
    if (!p.alive || p.id === city.owner || p.cultureTotal < cfg.pressureMinCulture) continue;
    const ratio = p.cultureTotal / theirs;
    if (ratio < cfg.pressureRatio || (best && ratio <= best.ratio)) continue;
    if (!state.cities.some((c) => c.owner === p.id && distance(size, c.tile, city.tile) <= cfg.pressureRadius)) continue;
    best = { power: p.id, ratio };
  }
  return best;
}

/** Прирост давления державы за ход (черта нации может его ускорять; цифровой занавес владельца города — резать). */
export function pressureGain(state: GameState, power: number, ratio: number, owner?: number): number {
  const factor = nationTrait(state, power).pressureFactor ?? 1;
  const raw = Math.min(cfg.pressureMax, cfg.pressurePerRatio * (ratio - 1)) * factor;
  return Math.round((owner === undefined ? raw : throughCurtain(state, owner, power, raw)) * 10) / 10;
}

function pressure(state: GameState): void {
  for (const city of [...state.cities]) {
    // Под модерацией контента давление замирает.
    if (city.moderationTurns > 0) continue;
    const src = pressureSource(state, city);
    if (!src) {
      city.pressure = Math.max(0, city.pressure - cfg.pressureDecay);
      if (city.pressure === 0) city.pressureFrom = NONE;
      continue;
    }
    if (city.pressureFrom !== src.power) {
      city.pressureFrom = src.power;
      city.pressure = 0;
    }
    city.pressure = Math.round((city.pressure + pressureGain(state, src.power, src.ratio, city.owner)) * 10) / 10;
    if (city.pressure < cfg.pressureThreshold) continue;
    const from = city.owner;
    city.pressure = 0;
    city.pressureFrom = NONE;
    cedeCity(state, city, src.power);
    remember(state, from, src.power, 'citySwayed', diplomacyConfig.events.citySwayed);
    logPublic(state, [from, src.power], `${city.name} под культурным влиянием переходит к державе ${state.powers[src.power].name}`);
  }
}

/** Новый ход: мятежи, давление, сроки модерации и саботажа, истёкшие способности. */
export function cultureNewTurn(state: GameState): void {
  revolts(state);
  pressure(state);
  for (const city of state.cities) {
    if (city.moderationTurns > 0) city.moderationTurns--;
    if (city.disabledTurns > 0) city.disabledTurns--;
  }
  for (const p of state.powers) p.effects = p.effects.filter((e) => e.until > state.turn);
}
