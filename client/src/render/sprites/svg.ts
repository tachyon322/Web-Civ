// Общее для SVG-спрайтов: цвета и обводка.

export const OUTLINE = '#2a1d14';
export const SKIN = '#e8b48a';
export const WOOD = '#8b5a2b';
export const WOOD_DARK = '#5e3b1c';
export const LEATHER = '#7a4a24';
export const METAL = '#c3c9d1';
export const METAL_DARK = '#7d858f';
export const BRONZE = '#c7923e';
export const GOLD = '#f5c542';

/** Цвет темнее (factor < 1) или светлее (factor > 1); вход и выход — «#rrggbb». */
export function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const v = (n >> shift) & 0xff;
    const out = factor <= 1 ? v * factor : v + (255 - v) * (factor - 1);
    return Math.max(0, Math.min(255, Math.round(out)));
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** Обводка для фигур. */
export function stroke(width = 1): string {
  return `stroke="${OUTLINE}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"`;
}

export function svgDoc(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}
