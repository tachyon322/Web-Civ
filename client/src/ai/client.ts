// Связь основного потока с ботами. Ходы считаются в Web Worker, чтобы не подвешивать интерфейс;
// если воркер недоступен — в основном потоке на копии состояния.

import type { Command } from '../core/commands';
import type { GameState } from '../core/types';
import { runBots } from './index';

type Reply = { id: number; commands?: Command[]; error?: string };

export class BotRunner {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (c: Command[]) => void; reject: (e: Error) => void }>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<Reply>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.error) p.reject(new Error(e.data.error));
        else p.resolve(e.data.commands ?? []);
      };
      this.worker.onerror = (e) => {
        console.error('Воркер ботов упал, дальше считаем в основном потоке', e);
        this.worker = null;
        for (const p of this.pending.values()) p.reject(new Error('Воркер ботов упал'));
        this.pending.clear();
      };
    } catch {
      this.worker = null;
    }
  }

  /** Команды всех ботов на этот ход. Состояние не меняется — их применяет вызывающий. */
  play(state: GameState): Promise<Command[]> {
    if (!this.worker) return Promise.resolve(runBots(structuredClone(state)));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, state });
    });
  }
}
