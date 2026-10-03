// Публичный вход в игровое ядро. Ядро не зависит от DOM, PixiJS и Web Worker.

export * from './types';
export * from './hex';
export * from './state';
export * from './commands';
export * from './economy';
export * from './network';
export * from './pathfinding';
export * from './territory';
export * from './visibility';
export * from './combat';
export * from './capture';
export * from './diplomacy';
export * from './relations';
export * from './text';
export * from './deterrence';
export { newGame, MAX_POWERS, type NewGameSettings } from './game';
export {
  aiConfig,
  balance,
  buildings,
  characterDef,
  diplomacyConfig,
  diplomacyTraits,
  nations,
  terrainDefs,
  type BuildingDef,
} from './data';
