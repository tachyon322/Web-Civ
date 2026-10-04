// Иконки интерфейса: силуэты из набора game-icons.net (CC BY 3.0, авторы — Lorc, Delapouite и др.),
// раскрашенные градиентом с тёмной обводкой. В документ один раз вставляется скрытый SVG со всеми
// иконками (installIcons), а в разметке иконка — короткая ссылка <use> (icon). Пути иконок —
// в game-icons.json; после правки списка ниже: node tools/icons.mjs.

import { esc } from '../dialog';
import paths from './game-icons.json';

interface IconDef {
  /** Имя иконки в game-icons. */
  glyph: string;
  /** Градиент сверху вниз. */
  top: string;
  bottom: string;
}

export const ICONS = {
  gold: { glyph: 'two-coins', top: '#ffe27a', bottom: '#d9951c' },
  science: { glyph: 'erlenmeyer', top: '#a6e1ff', bottom: '#3a8fe0' },
  culture: { glyph: 'drama-masks', top: '#ecccff', bottom: '#a15fe0' },
  epoch: { glyph: 'hourglass', top: '#f8dfa8', bottom: '#c0863a' },
  land: { glyph: 'treasure-map', top: '#e6f2b8', bottom: '#7fae4a' },
  stability: { glyph: 'scales', top: '#f4f6f9', bottom: '#a3aebd' },
  deterrence: { glyph: 'checked-shield', top: '#dbe7f4', bottom: '#6f88a8' },
  war: { glyph: 'crossed-swords', top: '#ffb3a8', bottom: '#d8382c' },
  warning: { glyph: 'hazard-sign', top: '#ffd77f', bottom: '#e8860f' },
  paths: { glyph: 'sparkles', top: '#fff4b8', bottom: '#f0b42a' },
  diplomacy: { glyph: 'shaking-hands', top: '#ffe2bd', bottom: '#d6995a' },
  proposal: { glyph: 'scroll-unfurled', top: '#fcf1d4', bottom: '#c9a564' },
  menu: { glyph: 'hamburger-menu', top: '#f4f6f9', bottom: '#b4bfcd' },
  capture: { glyph: 'flying-flag', top: '#ffffff', bottom: '#c5cbd4' },
  merge: { glyph: 'contract', top: '#e6ccff', bottom: '#a46be0' },
  transfer: { glyph: 'fast-forward-button', top: '#c4e3ff', bottom: '#4c9be6' },
  star: { glyph: 'round-star', top: '#ffe58a', bottom: '#e09a14' },
  marble: { glyph: 'ionic-column', top: '#ffffff', bottom: '#bfc3c9' },
  ruins: { glyph: 'ancient-ruins', top: '#efdcb8', bottom: '#a8875a' },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;

const OUTLINE = '#1a120b';
const GLYPHS = paths as Record<string, string>;

/** Иконка для разметки; размер — от шрифта (класс .icon). */
export function icon(name: IconName, cls = ''): string {
  return `<svg class="icon${cls ? ` ${cls}` : ''}" viewBox="0 0 512 512" aria-hidden="true"><use href="#icon-${name}"/></svg>`;
}

/** Самостоятельный SVG иконки (без общего спрайта) — для карты. */
export function iconSvg(name: IconName, size: number): string {
  const def: IconDef = ICONS[name];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-24 -24 560 560">${gradient(name, def)}${shape(name, def)}</svg>`;
}

function gradient(name: string, def: IconDef): string {
  return `<linearGradient id="icon-grad-${name}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="512"><stop offset="0" stop-color="${def.top}"/><stop offset="1" stop-color="${def.bottom}"/></linearGradient>`;
}

function shape(name: string, def: IconDef): string {
  return `<path d="${GLYPHS[def.glyph]}" fill="url(#icon-grad-${name})" stroke="${OUTLINE}" stroke-width="34" stroke-linejoin="round" paint-order="stroke"/>`;
}

/** Вставить в документ скрытый спрайт со всеми иконками (один раз). */
export function installIcons(): void {
  if (document.getElementById('icon-sprite')) return;
  const entries = Object.entries(ICONS) as [IconName, IconDef][];
  const defs = entries.map(([name, def]) => gradient(name, def)).join('');
  const symbols = entries.map(([name, def]) => `<symbol id="icon-${name}" viewBox="-24 -24 560 560">${shape(name, def)}</symbol>`).join('');
  // Не display:none — иначе браузер не применяет градиенты из спрайта.
  const holder = document.createElement('div');
  holder.innerHTML = `<svg id="icon-sprite" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true"><defs>${defs}</defs>${symbols}</svg>`;
  document.body.prepend(holder.firstElementChild!);
}

const TOKENS: Record<string, IconName> = { '🪙': 'gold', '🔬': 'science', '🎭': 'culture' };
const TOKEN_RE = new RegExp(Object.keys(TOKENS).join('|'), 'gu');

/** Экранировать текст и заменить в нём значки ресурсов (🪙 🔬 🎭) на иконки. Только для содержимого элементов, не атрибутов. */
export function escIcons(text: string): string {
  return esc(text).replace(TOKEN_RE, (m) => icon(TOKENS[m]));
}
