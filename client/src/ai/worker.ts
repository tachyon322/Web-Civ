// Web Worker ботов: получает копию состояния, играет за всех ботов и возвращает список команд.

import type { GameState } from '../core/types';
import { runBots } from './index';

self.onmessage = (e: MessageEvent<{ id: number; state: GameState }>) => {
  const { id, state } = e.data;
  try {
    const commands = runBots(state);
    self.postMessage({ id, commands });
  } catch (err) {
    self.postMessage({ id, error: String(err instanceof Error ? (err.stack ?? err.message) : err) });
  }
};
