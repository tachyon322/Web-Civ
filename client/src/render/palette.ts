// Цвета карты. Графика рисуется кодом, внешних картинок нет.

export const palette = {
  background: 0x0b1020,
  deepWater: 0x24527d,
  shallowWater: 0x3a78a8,
  plains: 0x93bf63,
  plainsAlt: 0x8ab65c,
  rough: 0x6b9a4a,
  tree: 0x3f6e33,
  mountain: 0x8c8378,
  mountainShade: 0x6a6259,
  snow: 0xf2f2f2,
  cliff: 0x6b5638,
  wall: 0xb9b2a6,
  gridLine: 0x000000,
  unexplored: 0x0b1020,
  fogAlpha: 0.45,
  gold: 0xf5c542,
  marble: 0xeeeeea,
  ruins: 0xb39b7a,
  highlight: 0xfff3a0,
  reach: 0xffffff,
  path: 0xffffff,
  pathLater: 0xb8c4d6,
  network: 0x7fe3ff,
  attack: 0xff4a3d,
  capture: 0xff9f1c,
  merge: 0xc58bff,
  claim: 0xb6f07a,
  improvement: 0xf2c94c,
};

export function hexColor(css: string): number {
  return parseInt(css.replace('#', ''), 16);
}

/** Тот же цвет темнее (factor < 1) или светлее (factor > 1). */
export function darken(color: number, factor: number): number {
  const ch = (shift: number) => Math.max(0, Math.min(255, Math.round(((color >> shift) & 0xff) * factor)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
