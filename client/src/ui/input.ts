// Ввод на карте: перетаскивание, зум колесом, клики и наведение по гексам.

import type { MapRenderer } from '../render/MapRenderer';

export interface MapInputHandlers {
  click(tile: number, button: 'left' | 'right'): void;
  hover(tile: number): void;
}

const DRAG_THRESHOLD = 5;
/** Долгое нажатие пальцем — то же, что ПКМ (приказ юниту). */
const LONG_PRESS_MS = 450;

export function attachMapInput(renderer: MapRenderer, handlers: MapInputHandlers): void {
  const canvas = renderer.app.canvas;
  let down: { x: number; y: number; button: number; dragging: boolean } | null = null;
  let lastHover = -2;

  const local = (e: PointerEvent | WheelEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  canvas.style.touchAction = 'none';
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  const touches = new Map<number, { x: number; y: number }>();
  let pinchDist = 0;
  let pressTimer: number | undefined;
  /** Палец зажат дольше порога: стрелка показывает цель, приказ уйдёт при отпускании. */
  let armed = false;
  let armedTile = -1;
  const cancelPress = () => {
    window.clearTimeout(pressTimer);
    pressTimer = undefined;
  };
  const spread = () => {
    const [a, b] = [...touches.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  canvas.addEventListener('pointerdown', (e) => {
    const p = local(e);
    canvas.setPointerCapture(e.pointerId);
    armed = false;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, p);
      if (touches.size === 2) {
        cancelPress();
        down = null;
        pinchDist = spread().d;
        return;
      }
    }
    down = { x: p.x, y: p.y, button: e.button, dragging: false };
    if (e.pointerType === 'touch') {
      pressTimer = window.setTimeout(() => {
        pressTimer = undefined;
        if (!down || down.dragging) return;
        armed = true;
        armedTile = renderer.screenToTile(down.x, down.y);
        handlers.hover(armedTile);
      }, LONG_PRESS_MS);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (touches.has(e.pointerId)) {
      touches.set(e.pointerId, p);
      if (touches.size === 2) {
        const s = spread();
        if (pinchDist > 0) renderer.zoomAt(s.x, s.y, s.d / pinchDist);
        pinchDist = s.d;
        return;
      }
    }
    if (down && armed) {
      armedTile = renderer.screenToTile(p.x, p.y);
      if (armedTile !== lastHover) {
        lastHover = armedTile;
        handlers.hover(armedTile);
      }
      return;
    }
    if (down) {
      const dx = p.x - down.x;
      const dy = p.y - down.y;
      if (!down.dragging && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        down.dragging = true;
        cancelPress();
      }
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

  canvas.addEventListener('pointercancel', (e) => {
    touches.delete(e.pointerId);
    cancelPress();
    armed = false;
    down = null;
  });

  canvas.addEventListener('pointerup', (e) => {
    touches.delete(e.pointerId);
    cancelPress();
    if (armed) {
      armed = false;
      down = null;
      if (armedTile >= 0) handlers.click(armedTile, 'right');
      return;
    }
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
