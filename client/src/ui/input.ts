// Ввод на карте: перетаскивание, зум колесом, клики и наведение по гексам.

import type { MapRenderer } from '../render/MapRenderer';

export interface MapInputHandlers {
  click(tile: number, button: 'left' | 'right'): void;
  hover(tile: number): void;
}

const DRAG_THRESHOLD = 5;

export function attachMapInput(renderer: MapRenderer, handlers: MapInputHandlers): void {
  const canvas = renderer.app.canvas;
  let down: { x: number; y: number; button: number; dragging: boolean } | null = null;
  let lastHover = -2;

  const local = (e: PointerEvent | WheelEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    const p = local(e);
    down = { x: p.x, y: p.y, button: e.button, dragging: false };
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (down) {
      const dx = p.x - down.x;
      const dy = p.y - down.y;
      if (!down.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) down.dragging = true;
      if (down.dragging) {
        renderer.panBy(dx, dy);
        down.x = p.x;
        down.y = p.y;
      }
      return;
    }
    const tile = renderer.screenToTile(p.x, p.y);
    if (tile !== lastHover) {
      lastHover = tile;
      handlers.hover(tile);
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const wasDrag = down.dragging;
    const button = down.button;
    down = null;
    if (wasDrag) return;
    const p = local(e);
    const tile = renderer.screenToTile(p.x, p.y);
    if (tile < 0) return;
    if (button === 0) handlers.click(tile, 'left');
    else if (button === 2) handlers.click(tile, 'right');
  });

  canvas.addEventListener('pointerleave', () => {
    lastHover = -2;
    handlers.hover(-1);
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = local(e);
      renderer.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );
}
