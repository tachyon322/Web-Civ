// Создание новой партии: карта по сиду, державы, столицы и стартовые жители.

import { generateMap } from '../mapgen/generate';
import { aiConfig, balance, nationDef, nations, unitDef } from './data';
import { blankPower, createCity, createUnit, probeUnit } from './entities';
import { neighbors } from './hex';
import { canStop } from './pathfinding';
import { createRng, deriveSeed } from './rng';
import { isLand } from './state';
import { CHARACTERS, NONE, type Character, type Difficulty, type GameSettings, type GameState } from './types';
import { refreshAllStability } from './stability';
import { updateExplored } from './visibility';

export const MAX_POWERS = 12;

export type NewGameSettings = Omit<GameSettings, 'difficulty'> & { difficulty?: Difficulty };

export function newGame(settings: NewGameSettings): GameState {
  const powersCount = Math.max(2, Math.min(MAX_POWERS, settings.powers));
  const map = generateMap(settings.seed, powersCount);
  const n = map.width * map.height;

  // Нации: игрок — выбранная (или случайная), остальные — случайные без повторов.
  const rng = createRng(deriveSeed(settings.seed, 1));
  const pool = rng.shuffle(nations.map((nat) => nat.id));
  const human = settings.humanNation && pool.includes(settings.humanNation) ? settings.humanNation : pool[0];
  const order = [human, ...pool.filter((id) => id !== human)].slice(0, powersCount);
  // Характеры ботов: случайные, но склонность нации выпадает чаще.
  const charRng = createRng(deriveSeed(settings.seed, 2));
  const characters: (Character | null)[] = order.map((nationId, i) => {
    if (i === 0) return null;
    return charRng.next() < aiConfig.tendencyChance ? nationDef(nationId).tendency : charRng.pick(CHARACTERS);
  });

  const state: GameState = {
    version: 1,
    settings: { ...settings, powers: powersCount, difficulty: settings.difficulty ?? 'normal' },
    turn: 1,
    humanPower: 0,
    map: { width: map.width, height: map.height, terrain: map.terrain, special: map.special, starts: map.starts },
    territory: { owner: new Array<number>(n).fill(NONE), city: new Array<number>(n).fill(NONE) },
    powers: order.map((nationId, id) => blankPower(id, nationId, id === 0, characters[id], n, balance.start.gold)),
    cities: [],
    units: [],
    pacts: [],
    proposals: [],
    coalitionLeader: NONE,
    winner: null,
    nextId: 1,
    log: [],
  };

  state.powers.forEach((power, i) => {
    const start = map.starts[i];
    createCity(state, power.id, start, true);
    let placed = 0;
    for (const t of neighbors(map, start)) {
      if (placed >= balance.start.citizens) break;
      if (!isLand(state, t) || !canStop(state, probeUnit(power.id, t), t)) continue;
      createUnit(state, power.id, 'citizen', t, unitDef('citizen').mp + balance.units.ownTerritoryMpBonus);
      placed++;
    }
  });
  for (const power of state.powers) updateExplored(state, power.id);
  refreshAllStability(state);
  state.log.push({ turn: 1, power: NONE, text: 'Партия началась' });
  return state;
}
