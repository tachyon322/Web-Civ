// Смайлики настроения держав: пять лиц, нарисованных кодом (не стандартные эмодзи).
// 0 — «окей», 1 — довольны, 2 — спокойны, 3 — скрежещут зубами, 4 — злые.

import { OUTLINE } from '../render/sprites/svg';

const FACE: string[] = ['#7fd35a', '#d3e05a', '#f2cf5c', '#f09a3e', '#e5473a'];
const O = `stroke="${OUTLINE}" stroke-linecap="round" stroke-linejoin="round"`;

/** Ширина и высота SVG лица (с хвостиком-указателем снизу). */
export const MOOD_W = 32;
export const MOOD_H = 38;

function features(level: number): string {
  switch (level) {
    case 0: // «окей»: сияющие глаза, широкая улыбка, румянец и большой палец
      return `<path d="M8 13 Q11 9 14 13 M18 13 Q21 9 24 13" fill="none" ${O} stroke-width="2"/>
        <path d="M8 18 Q16 29 24 18 Z" fill="#fff" ${O} stroke-width="1.6"/>
        <circle cx="7" cy="18" r="2" fill="#ff8a8a" opacity=".7"/><circle cx="25" cy="18" r="2" fill="#ff8a8a" opacity=".7"/>
        <path d="M23 3 l2 4 l4 .6 l-3 3 l.8 4 l-3.8 -2 l-3.8 2 l.8 -4 l-3 -3 l4 -.6 z" fill="#ffd23f" ${O} stroke-width="1" transform="translate(-3 -3) scale(.7)"/>`;
    case 1: // довольны: тёплая улыбка
      return `<circle cx="11" cy="13" r="2" fill="${OUTLINE}"/><circle cx="21" cy="13" r="2" fill="${OUTLINE}"/>
        <path d="M9 20 Q16 26 23 20" fill="none" ${O} stroke-width="2"/>`;
    case 2: // спокойны: ровный рот
      return `<circle cx="11" cy="13" r="2" fill="${OUTLINE}"/><circle cx="21" cy="13" r="2" fill="${OUTLINE}"/>
        <path d="M10 22 H22" fill="none" ${O} stroke-width="2"/>`;
    case 3: // скрежет зубами: прищур и оскал со стиснутыми зубами
      return `<path d="M8 12 L14 14 M24 12 L18 14" fill="none" ${O} stroke-width="2"/>
        <circle cx="11" cy="15" r="1.6" fill="${OUTLINE}"/><circle cx="21" cy="15" r="1.6" fill="${OUTLINE}"/>
        <rect x="8" y="19" width="16" height="7" rx="2" fill="#fff" ${O} stroke-width="1.6"/>
        <path d="M12 19 V26 M16 19 V26 M20 19 V26 M8 22.5 H24" fill="none" ${O} stroke-width="1"/>
        <path d="M27 6 l2 -3 M29 10 l3 -1" ${O} stroke-width="1.4" fill="none"/>`;
    default: // злые: сведённые брови, красное лицо, пар
      return `<path d="M7 9 L14 13 M25 9 L18 13" fill="none" ${O} stroke-width="2.6"/>
        <circle cx="11.5" cy="16" r="1.8" fill="${OUTLINE}"/><circle cx="20.5" cy="16" r="1.8" fill="${OUTLINE}"/>
        <path d="M9 25 Q16 19 23 25" fill="none" ${O} stroke-width="2.4"/>
        <path d="M4 5 q-2 -3 1 -4 M28 5 q2 -3 -1 -4" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".85"/>`;
  }
}

export function moodSvg(level: number, size?: number): string {
  const l = Math.max(0, Math.min(4, level));
  const dim = size ? `width="${size}" height="${Math.round((size * MOOD_H) / MOOD_W)}"` : `width="${MOOD_W}" height="${MOOD_H}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" ${dim} viewBox="0 0 ${MOOD_W} ${MOOD_H}">
    <path d="M12 30 L16 37 L20 30 Z" fill="${FACE[l]}" ${O} stroke-width="1.6"/>
    <circle cx="16" cy="16" r="14" fill="${FACE[l]}" ${O} stroke-width="2"/>
    <path d="M6 12 Q9 4 16 4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".45"/>
    ${features(l)}
  </svg>`;
}

/** Лицо для списков и панелей. */
export function moodFor(level: number, size = 18): string {
  return `<span class="moodbox">${moodSvg(level, size)}</span>`;
}
