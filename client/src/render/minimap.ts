// Мини-карта: обычный canvas 2D, по прямоугольнику на клетку, рамка видимой области.

import type { GameState } from '../core/types';
import { NONE, T_MOUNTAIN, T_ROUGH, T_WATER } from '../core/types';
import type { MapRenderer } from './MapRenderer';

const COLORS: Record<number, string> = {
  [T_WATER]: '#2b5d8a',
  [T_ROUGH]: '#5f8a45',
  [T_MOUNTAIN]: '#8a8178',
};
const PLAINS = '#8fb862';

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement;
  private state: GameState | null = null;
  private dragging = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private renderer: MapRenderer,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    const jump = (e: PointerEvent) => {
      if (!this.state) return;
      const rect = canvas.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      const w = renderer.worldSize();
      renderer.centerOnWorld(fx * w.width, fy * w.height);
    };
    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
      jump(e);
    });
    canvas.addEventListener('pointermove', (e) => this.dragging && jump(e));
    canvas.addEventListener('pointerup', () => (this.dragging = false));
  }

  /** Перерисовывает подложку (местность, территории, туман) — после каждой команды. */
  update(state: GameState): void {
    this.state = state;
    const { width, height } = state.map;
    // Клетка — 2×2 пикселя, нечётные ряды сдвинуты на пиксель, как гексы.
    // Пропорции мини-карты — как у мира, ширина задана стилями.
    const world = this.renderer.worldSize();
    this.canvas.style.height = `${Math.round((this.canvas.clientWidth * world.height) / world.width)}px`;
    const pw = width * 2 + 1;
    const ph = height * 2;
    this.base.width = pw;
    this.base.height = ph;
    const ctx = this.base.getContext('2d')!;
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, pw, ph);
    const explored = state.powers[state.humanPower].explored;
    const { owner } = state.territory;
    for (let t = 0; t < width * height; t++) {
      if (!explored[t]) continue;
      const row = Math.floor(t / width);
      const col = t % width;
      const x = col * 2 + (row & 1);
      const y = row * 2;
      const o = owner[t];
      ctx.fillStyle = o !== NONE ? state.powers[o].color : (COLORS[state.map.terrain[t]] ?? PLAINS);
      ctx.fillRect(x, y, 2, 2);
    }
    for (const city of state.cities) {
      if (!explored[city.tile]) continue;
      const row = Math.floor(city.tile / width);
      const col = city.tile % width;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(col * 2 + (row & 1), row * 2, 2, 2);
    }
    this.drawView();
  }

  /** Перерисовывает рамку видимой области — при каждом движении камеры. */
  drawView(): void {
    if (!this.state) return;
    const { canvas, ctx } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(canvas.clientWidth * dpr);
    const ch = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(this.base, 0, 0, cw, ch);
    const w = this.renderer.worldSize();
    const v = this.renderer.viewRect();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeRect((v.x / w.width) * cw, (v.y / w.height) * ch, (v.width / w.width) * cw, (v.height / w.height) * ch);
  }
}
