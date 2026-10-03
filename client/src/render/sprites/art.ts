// Рисованные спрайты юнитов (сгенерированы ИИ, нарезаны tools/sprites.py): атлас фигур по эпохам
// и маска цвета нации. Юнит собирается в canvas: тень под ногами, фигура, одежда,
// перекрашенная маской (умножение цвета нации на яркость маски). Типы без атласа рисуются SVG.

import type { UnitType } from '../../core/types';
import meta from './art/units.json';
import { RESOLUTION } from './cache';
import { UNIT_ANCHOR, UNIT_SPRITE_H, UNIT_SPRITE_W } from './units';

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Точка опоры (середина ступней) в пикселях атласа от левого верхнего угла кадра. */
  ax: number;
  ay: number;
}

interface Sheet {
  /** Рост типичной фигуры в атласе, px. */
  height: number;
  frames: Frame[];
}

const SHEETS = meta as Partial<Record<UnitType, Sheet>>;
const URLS = import.meta.glob('./art/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** Рост фигуры на карте в логических пикселях спрайта. */
const FIGURE_HEIGHT = 50;
/** Ступни — в точке опоры спрайта. */
const FEET_Y = UNIT_ANCHOR.y;

export function hasUnitArt(type: UnitType): boolean {
  return !!SHEETS[type];
}

const images = new Map<string, Promise<HTMLImageElement>>();

function image(src: string): Promise<HTMLImageElement> {
  let p = images.get(src);
  if (!p) {
    const img = new Image();
    img.src = src;
    p = img.decode().then(() => img);
    images.set(src, p);
  }
  return p;
}

/** Canvas юнита размером UNIT_SPRITE_W × UNIT_SPRITE_H (× RESOLUTION) с опорой в UNIT_ANCHOR. */
export async function drawUnitArt(type: UnitType, epoch: number, color: string): Promise<HTMLCanvasElement> {
  const sheet = SHEETS[type];
  if (!sheet) throw new Error(`нет атласа для ${type}`);
  const frame = sheet.frames[Math.max(0, Math.min(sheet.frames.length - 1, epoch))];
  const [base, mask] = await Promise.all([image(URLS[`./art/${type}.png`]), image(URLS[`./art/${type}-mask.png`])]);

  const canvas = document.createElement('canvas');
  canvas.width = UNIT_SPRITE_W * RESOLUTION;
  canvas.height = UNIT_SPRITE_H * RESOLUTION;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  // Тень под ногами вместо подставки.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.beginPath();
  ctx.ellipse((UNIT_ANCHOR.x + 1.5) * RESOLUTION, (FEET_Y - 0.5) * RESOLUTION, 14 * RESOLUTION, 4 * RESOLUTION, 0, 0, Math.PI * 2);
  ctx.fill();

  const k = (FIGURE_HEIGHT * RESOLUTION) / sheet.height;
  const dx = UNIT_ANCHOR.x * RESOLUTION - frame.ax * k;
  const dy = FEET_Y * RESOLUTION - frame.ay * k;
  const dw = frame.w * k;
  const dh = frame.h * k;
  ctx.drawImage(base, frame.x, frame.y, frame.w, frame.h, dx, dy, dw, dh);

  // Одежда: маска × цвет нации, альфа маски сохраняется.
  const tint = document.createElement('canvas');
  tint.width = Math.ceil(dw);
  tint.height = Math.ceil(dh);
  const t = tint.getContext('2d')!;
  t.imageSmoothingQuality = 'high';
  t.drawImage(mask, frame.x, frame.y, frame.w, frame.h, 0, 0, dw, dh);
  t.globalCompositeOperation = 'multiply';
  t.fillStyle = color;
  t.fillRect(0, 0, tint.width, tint.height);
  t.globalCompositeOperation = 'destination-in';
  t.drawImage(mask, frame.x, frame.y, frame.w, frame.h, 0, 0, dw, dh);
  ctx.drawImage(tint, dx, dy);
  return canvas;
}
