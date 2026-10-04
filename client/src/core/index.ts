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
export * from './epochs';
export * from './stability';
export * from './buildings';
export * from './specialists';
export * from './improvements';
export * from './culture';
export * from './abilities';
export * from './victory';
export * from './deterrence';
export * from './nations';
export { newGame, MAX_POWERS, type NewGameSettings } from './game';
export {
  aiConfig,
  balance,
  buildings,
  characterDef,
  diplomacyConfig,
  diplomacyTraits,
  pathsConfig,
  nations,
  nationDef,
  terrainDefs,
  traits,
  traitDef,
  type AbilityId,
  type BuildingDef,
  type Currency,
  type TraitDef,
} from './data';
