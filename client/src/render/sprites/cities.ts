// Спрайты городов: площадка, дома (их больше с уровнем), главное здание столицы, стены.
// Эпоха владельца задаёт стиль: хижины → белёные дома с черепицей → фахверк и замок →
// кирпич и купол дворца → многоэтажки и заводская труба. Цвет нации — флаги и навесы.

import { OUTLINE, WOOD, WOOD_DARK, shade, stroke, svgDoc } from './svg';

export const CITY_SPRITE_W = 100;
export const CITY_SPRITE_H = 84;
/** Центр площадки города в координатах спрайта. */
export const CITY_ANCHOR = { x: 50, y: 64 };

interface Style {
  wall: string;
  roof: string;
  ground: string;
  /** Форма крыши обычных домов. */
  roofKind: 'straw' | 'gable' | 'flat';
  /** Высота стены дома. */
  height: number;
}

const STYLES: Style[] = [
  { wall: '#c9a46a', roof: '#d9b44a', ground: '#b49a6e', roofKind: 'straw', height: 7 },
  { wall: '#efe7d4', roof: '#c4553a', ground: '#bfae8a', roofKind: 'gable', height: 8 },
  { wall: '#e9dcbc', roof: '#5d6274', ground: '#a9a196', roofKind: 'gable', height: 10 },
  { wall: '#b9664a', roof: '#5f636c', ground: '#9e9a92', roofKind: 'gable', height: 11 },
  { wall: '#c4bfb5', roof: '#7a7d84', ground: '#8f8c86', roofKind: 'flat', height: 15 },
];

const DOOR = '#4a2f1a';
const WINDOW = '#ffe7a3';

function flag(x: number, y: number, c: string, h = 12): string {
  return `<path d="M${x},${y} L${x},${y - h}" stroke="${OUTLINE}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<path d="M${x},${y - h} L${x + 8},${y - h + 2} L${x},${y - h + 5} Z" fill="${c}" ${stroke(0.7)}/>`;
}

/** Дом: фасад, боковая стена в перспективе, крыша. (x, y) — середина низа фасада. */
function house(x: number, y: number, w: number, h: number, st: Style, i: number, awning?: string): string {
  const d = w * 0.42;
  const dx = d * 0.85;
  const dy = -d * 0.5;
  const L = x - w / 2;
  const R = x + w / 2;
  let out = `<path d="M${R},${y} L${R + dx},${y + dy} L${R + dx},${y + dy - h} L${R},${y - h} Z" fill="${shade(st.wall, 0.74)}" ${stroke(0.8)}/>`;
  out += `<rect x="${L}" y="${y - h}" width="${w}" height="${h}" fill="${st.wall}" ${stroke(0.8)}/>`;
  if (st.roofKind === 'straw') {
    const rh = h * 0.9;
    out += `<path d="M${L - 2},${y - h + 1} L${x + dx * 0.5},${y - h - rh + dy * 0.5} L${R + dx + 2},${y + dy - h + 1} L${R + 1},${y - h + 2} Z" fill="${st.roof}" ${stroke(0.8)}/>`;
    out += `<path d="M${L + 1},${y - h} L${x + dx * 0.5},${y - h - rh + dy * 0.5} M${x},${y - h + 1} L${x + dx * 0.5},${y - h - rh + dy * 0.5}" stroke="${shade(st.roof, 0.75)}" stroke-width="0.7"/>`;
  } else if (st.roofKind === 'gable') {
    const rh = w * 0.42;
    out += `<path d="M${x},${y - h - rh} L${x + dx},${y - h - rh + dy} L${R + dx + 1},${y + dy - h} L${R + 1},${y - h} Z" fill="${shade(st.roof, 0.82)}" ${stroke(0.8)}/>`;
    out += `<path d="M${L - 1},${y - h} L${x},${y - h - rh} L${R + 1},${y - h} Z" fill="${st.roof}" ${stroke(0.8)}/>`;
  } else {
    out += `<path d="M${L},${y - h} L${R},${y - h} L${R + dx},${y + dy - h} L${L + dx},${y + dy - h} Z" fill="${st.roof}" ${stroke(0.8)}/>`;
  }
  // Фахверк в средневековье.
  if (st === STYLES[2]) out += `<path d="M${L},${y - h * 0.5} H${R} M${L + w * 0.3},${y - h} V${y} M${L + w * 0.7},${y - h} V${y - h * 0.5}" stroke="${WOOD_DARK}" stroke-width="0.9"/>`;
  // Окна: этажей больше у высоких домов.
  const floors = Math.max(1, Math.floor(h / 7));
  for (let f = 0; f < floors; f++) {
    const wy = y - h + 2 + f * 6.5;
    if (f === floors - 1 && floors === 1) out += `<rect x="${x + w * 0.12}" y="${wy}" width="2.4" height="2.4" fill="${WINDOW}" ${stroke(0.5)}/>`;
    else {
      out += `<rect x="${L + w * 0.18}" y="${wy}" width="2.2" height="2.6" fill="${WINDOW}" ${stroke(0.5)}/>`;
      out += `<rect x="${R - w * 0.18 - 2.2}" y="${wy}" width="2.2" height="2.6" fill="${WINDOW}" ${stroke(0.5)}/>`;
    }
  }
  out += `<rect x="${x - 1.6 - (i % 2) * 2}" y="${y - 4.6}" width="3.2" height="4.6" fill="${DOOR}" ${stroke(0.5)}/>`;
  if (awning) out += `<path d="M${L - 0.5},${y - 5.6} L${R + 0.5},${y - 5.6} L${R + 1.5},${y - 3.6} L${L - 1.5},${y - 3.6} Z" fill="${awning}" ${stroke(0.5)}/>`;
  return out;
}

/** Главное здание столицы или большого города. */
function landmark(x: number, y: number, epoch: number, c: string, capital: boolean): string {
  switch (epoch) {
    case 0: {
      const st = { ...STYLES[0], height: 9 };
      return house(x, y, 20, 9, st, 0) + flag(x + 13, y - 18, c, 12) + (capital ? `<path d="M${x - 14},${y} L${x - 14},${y - 16}" stroke="${WOOD}" stroke-width="2.4"/><circle cx="${x - 14}" cy="${y - 17}" r="2.4" fill="${c}" ${stroke(0.7)}/>` : '');
    }
    case 1: {
      // Храм с колоннами.
      const w = 24;
      const L = x - w / 2;
      let t = `<rect x="${L - 2}" y="${y - 3}" width="${w + 4}" height="3" fill="#ddd3bd" ${stroke(0.7)}/>`;
      t += `<rect x="${L}" y="${y - 14}" width="${w}" height="11" fill="#c9bea6" ${stroke(0.7)}/>`;
      for (let k = 0; k < 5; k++) t += `<rect x="${L + 1 + k * 5.2}" y="${y - 14}" width="2.4" height="11" fill="#f6f1e4" ${stroke(0.5)}/>`;
      t += `<path d="M${L - 2},${y - 14} L${x},${y - 21} L${L + w + 2},${y - 14} Z" fill="#f2ead8" ${stroke(0.8)}/>`;
      t += `<path d="M${L + 4},${y - 15} L${x},${y - 19} L${L + w - 4},${y - 15} Z" fill="${c}" opacity="0.85"/>`;
      return t + (capital ? flag(x + 14, y - 14, c, 14) : '');
    }
    case 2: {
      // Замок: донжон с зубцами.
      const stone = '#b3ada3';
      let t = house(x - 4, y, 14, 10, { ...STYLES[2], wall: stone, roofKind: 'flat' }, 0);
      t += `<rect x="${x + 2}" y="${y - 28}" width="11" height="28" fill="${stone}" ${stroke(0.8)}/>`;
      t += `<path d="M${x + 13},${y} L${x + 17},${y - 2} L${x + 17},${y - 30} L${x + 13},${y - 28} Z" fill="${shade(stone, 0.74)}" ${stroke(0.8)}/>`;
      for (let k = 0; k < 3; k++) t += `<rect x="${x + 2 + k * 4}" y="${y - 31}" width="3" height="3" fill="${stone}" ${stroke(0.6)}/>`;
      t += `<rect x="${x + 6}" y="${y - 22}" width="2.4" height="4" fill="${DOOR}"/><rect x="${x + 6}" y="${y - 13}" width="2.4" height="4" fill="${DOOR}"/>`;
      return t + flag(x + 7.5, y - 31, c, 13);
    }
    case 3: {
      // Дворец с куполом.
      const wall = '#e6dcc8';
      let t = house(x, y, 26, 12, { ...STYLES[3], wall, roof: '#6d727c' }, 0, c);
      t += `<rect x="${x - 5}" y="${y - 20}" width="10" height="8" fill="${wall}" ${stroke(0.8)}/>`;
      t += `<path d="M${x - 6},${y - 20} Q${x},${y - 31} ${x + 6},${y - 20} Z" fill="#6fa59a" ${stroke(0.8)}/>`;
      return t + flag(x, y - 29, c, 9);
    }
    default: {
      // Высотка и завод с трубой.
      let t = house(x - 6, y, 13, 26, STYLES[4], 0);
      t += `<rect x="${x + 6}" y="${y - 22}" width="4" height="22" fill="#9a5a44" ${stroke(0.8)}/>`;
      t += `<ellipse cx="${x + 10}" cy="${y - 26}" rx="4" ry="2.6" fill="#cfd3d8" opacity="0.8"/><ellipse cx="${x + 14}" cy="${y - 30}" rx="5" ry="3" fill="#dfe2e6" opacity="0.7"/>`;
      t += house(x + 13, y + 2, 12, 9, { ...STYLES[4], wall: '#a8664c', roofKind: 'flat' }, 1);
      return t + flag(x - 6, y - 30, c, 10);
    }
  }
}

/** Места под дома (низ фасада): по важности; рисуются потом по глубине. */
const SLOTS: [number, number][] = [
  [50, 60],
  [31, 62],
  [69, 62],
  [41, 71],
  [60, 71],
  [21, 68],
  [79, 68],
  [50, 76],
  [37, 55],
  [64, 55],
];
const BUILDINGS_BY_LEVEL = [2, 3, 5, 7, 10];

function walls(epoch: number, front: boolean): string {
  const cx = 50;
  const cy = 64;
  const rx = 45;
  const ry = 16;
  const arc = front ? `M${cx - rx},${cy} A${rx},${ry} 0 0 0 ${cx + rx},${cy}` : `M${cx - rx},${cy} A${rx},${ry} 0 0 1 ${cx + rx},${cy}`;
  if (epoch === 0) {
    // Частокол.
    return `<path d="${arc}" fill="none" stroke="${OUTLINE}" stroke-width="5"/><path d="${arc}" fill="none" stroke="${WOOD}" stroke-width="3.4"/>` +
      `<path d="${arc}" fill="none" stroke="${shade(WOOD, 1.3)}" stroke-width="3.4" stroke-dasharray="1.2 2.2" transform="translate(0 -2)"/>`;
  }
  const stone = epoch >= 3 ? '#a59c90' : '#b7b0a4';
  let out = `<path d="${arc}" fill="none" stroke="${OUTLINE}" stroke-width="6.4"/><path d="${arc}" fill="none" stroke="${stone}" stroke-width="4.8"/>` +
    `<path d="${arc}" fill="none" stroke="${stone}" stroke-width="2.4" stroke-dasharray="2.4 2.4" transform="translate(0 -3)"/>`;
  if (front) {
    const tower = (x: number, y: number) =>
      `<rect x="${x - 3.6}" y="${y - 11}" width="7.2" height="11" fill="${stone}" ${stroke(0.8)}/><rect x="${x - 4.4}" y="${y - 13.4}" width="8.8" height="2.8" fill="${shade(stone, 1.1)}" ${stroke(0.7)}/>`;
    out += tower(cx - rx, cy + 1) + tower(cx + rx, cy + 1) + tower(cx - 26, cy + 13.5) + tower(cx + 26, cy + 13.5);
    out += `<path d="M${cx - 4},${cy + ry + 1} L${cx - 4},${cy + ry - 6} Q${cx},${cy + ry - 10} ${cx + 4},${cy + ry - 6} L${cx + 4},${cy + ry + 1} Z" fill="${DOOR}" ${stroke(0.7)}/>`;
  }
  return out;
}

/** SVG города: уровень 1–5, эпоха владельца, цвет нации, столица, стены. */
export function citySvg(level: number, epoch: number, color: string, capital: boolean, hasWalls: boolean): string {
  const e = Math.max(0, Math.min(4, epoch));
  const st = STYLES[e];
  const count = BUILDINGS_BY_LEVEL[Math.max(0, Math.min(4, level - 1))];
  let body = `<ellipse cx="51" cy="66" rx="44" ry="14" fill="#000" opacity="0.18"/>`;
  body += `<ellipse cx="50" cy="64" rx="42" ry="13.5" fill="${st.ground}" ${stroke(0.8)}/>`;
  body += `<ellipse cx="50" cy="63" rx="30" ry="8.5" fill="${shade(st.ground, 1.12)}"/>`;
  if (hasWalls) body += walls(e, false);
  // Главное здание — у столицы и у больших городов; остальное — дома разной высоты.
  const withLandmark = capital || level >= 4;
  const slots = SLOTS.slice(0, count)
    .map((p, i) => ({ x: p[0], y: p[1], i }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const s of slots) {
    if (s.i === 0 && withLandmark) {
      body += landmark(s.x, s.y, e, color, capital);
      continue;
    }
    const w = 11 + ((s.i * 7) % 4);
    const tall = e === 4 ? 6 + ((s.i * 5) % 3) * 4 : (s.i * 5) % 3;
    const h = st.height + tall;
    body += house(s.x, s.y, w, h, st, s.i, s.i % 3 === 1 ? color : undefined);
  }
  if (hasWalls) body += walls(e, true);
  return svgDoc(CITY_SPRITE_W, CITY_SPRITE_H, body);
}
