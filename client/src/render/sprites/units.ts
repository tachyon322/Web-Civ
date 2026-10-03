// Спрайты юнитов: фигурки в цвете нации на подставке. Эпоха меняет облик (одежда, шлем, оружие),
// а не тип. Уровень отряда виден по числу фигур: 1–2 уровень — одна, 3 — две, 4 — три.
// Координаты фигуры — локальные: ступни в (0, 0), рост около 42, лицом вправо-к зрителю.

import type { UnitType } from '../../core/types';
import { BRONZE, GOLD, LEATHER, METAL, METAL_DARK, OUTLINE, SKIN, WOOD, WOOD_DARK, shade, stroke, svgDoc } from './svg';

export const UNIT_SPRITE_W = 72;
export const UNIT_SPRITE_H = 64;
/** Точка опоры спрайта (центр подставки) в его координатах. */
export const UNIT_ANCHOR = { x: 36, y: 56 };

interface Look {
  tunic: string;
  trousers: string;
  boots: string;
  sleeve: string;
  /** Что за спиной (колчан), под телом. */
  behind?: string;
  /** Поверх туловища: ремни, кольчуга, пояс. */
  torso?: string;
  /** Головной убор поверх головы. */
  head?: string;
  /** Предмет в дальней руке (щит) — поверх туловища. */
  left?: string;
  /** Оружие в ближней руке — под кистью. */
  weapon?: string;
  /** Где кисть ближней руки. */
  hand?: [number, number];
}

function person(o: Look): string {
  const [hx, hy] = o.hand ?? [9, -17];
  const arm = (d: string, color: string) =>
    `<path d="${d}" fill="none" stroke="${OUTLINE}" stroke-width="5.4" stroke-linecap="round"/>` +
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="3.6" stroke-linecap="round"/>`;
  return `
    ${o.behind ?? ''}
    <path d="M-4.5,-14 L-5.5,-3 L-1.5,-3 L-0.5,-12 L0.5,-12 L1.5,-3 L5.5,-3 L4.5,-14 Z" fill="${o.trousers}" ${stroke()}/>
    <path d="M-6.8,-3.6 h5.6 v3.6 h-6.6 z M1.2,-3.6 h5.4 l1.4,3.6 h-6.8 z" fill="${o.boots}" ${stroke(0.8)}/>
    ${arm('M-6,-27 Q-9,-22 -8.5,-16', o.sleeve)}
    <circle cx="-8.5" cy="-15.5" r="1.9" fill="${SKIN}" ${stroke(0.8)}/>
    <path d="M-7,-29 Q0,-31.5 7,-29 L8,-13 Q0,-11 -8,-13 Z" fill="${o.tunic}" ${stroke()}/>
    <path d="M3,-29.8 Q5.5,-29.6 7,-29 L8,-13 Q5.5,-12.2 3,-11.9 Z" fill="#000" opacity="0.18"/>
    ${o.torso ?? ''}
    <rect x="-1.6" y="-32.2" width="3.2" height="3.4" fill="${SKIN}"/>
    <circle cx="0" cy="-36" r="5.2" fill="${SKIN}" ${stroke()}/>
    <circle cx="2.4" cy="-36.6" r="0.75" fill="${OUTLINE}"/>
    ${o.head ?? ''}
    ${o.left ?? ''}
    ${o.weapon ?? ''}
    ${arm(`M6,-27 L${hx},${hy}`, o.sleeve)}
    <circle cx="${hx}" cy="${hy}" r="1.9" fill="${SKIN}" ${stroke(0.8)}/>`;
}

// ---------- Головные уборы и снаряжение ----------

const hair = `<path d="M-5.2,-36.5 Q-5,-42 0,-41.5 Q4.6,-41.4 5.2,-37.5 Q2,-39.5 -1,-38.6 Q-3,-38 -5.2,-36.5 Z" fill="#4a2e1a" ${stroke(0.8)}/>`;
const headband = (c: string) => `${hair}<path d="M-5.3,-38 Q0,-40 5.3,-38.4" fill="none" stroke="${c}" stroke-width="1.6"/>`;
const strawHat = `<ellipse cx="0" cy="-39" rx="8.5" ry="2.2" fill="#e2c15a" ${stroke(0.8)}/><path d="M-4.4,-39.3 Q-4,-44.5 0,-44.5 Q4,-44.5 4.4,-39.3 Z" fill="#e8ca66" ${stroke(0.8)}/>`;
const bronzeHelmet = (c: string) =>
  `<path d="M-5.6,-36 Q-5.6,-42.6 0,-42.6 Q5.6,-42.6 5.6,-36 L3.8,-36 L3.8,-33 L1.8,-33 L1.8,-37.6 L-5.6,-36 Z" fill="${BRONZE}" ${stroke(0.9)}/>` +
  `<path d="M-6,-42 Q0,-49.5 6,-42.5 Q0,-45.5 -6,-42 Z" fill="${c}" ${stroke(0.8)}/>`;
const steelHelmet = `<path d="M-5.8,-35.5 Q-5.8,-43.2 0,-43.2 Q5.8,-43.2 5.8,-35.5 Z" fill="${METAL}" ${stroke(0.9)}/><rect x="1.4" y="-36.2" width="1.4" height="4.5" fill="${METAL_DARK}" ${stroke(0.6)}/>`;
const kettleHat = `<ellipse cx="0" cy="-38.6" rx="8" ry="1.9" fill="${METAL}" ${stroke(0.9)}/><path d="M-4.6,-38.8 Q-4.6,-44 0,-44 Q4.6,-44 4.6,-38.8 Z" fill="${METAL}" ${stroke(0.9)}/>`;
const tricorne = `<path d="M-7.5,-38.4 Q0,-36.6 7.5,-38.4 L5.6,-43.4 Q0,-41.6 -5.6,-43.4 Z" fill="#1e1e24" ${stroke(0.9)}/><path d="M-5.4,-40 Q0,-38.8 5.4,-40" fill="none" stroke="${GOLD}" stroke-width="0.8"/>`;
const bicorne = (c: string) => `<path d="M-8,-39 Q0,-48 8,-39 Q0,-41 -8,-39 Z" fill="#1e1e24" ${stroke(0.9)}/><circle cx="0.5" cy="-42" r="1.3" fill="${c}"/>`;
const brodie = `<ellipse cx="0" cy="-39.3" rx="8.4" ry="1.8" fill="#4d5a3e" ${stroke(0.9)}/><path d="M-5,-39.4 Q-4.6,-44.2 0,-44.2 Q4.6,-44.2 5,-39.4 Z" fill="#56643f" ${stroke(0.9)}/>`;
const peakedCap = (c: string) => `<path d="M-5.2,-39 Q-5.4,-43.6 0,-43.8 Q5.4,-43.6 5.4,-39.4 Z" fill="${c}" ${stroke(0.8)}/><path d="M1,-39.3 L8,-38.4 L1,-38.2 Z" fill="#1e1e24" ${stroke(0.6)}/>`;
const hood = (c: string) => `<path d="M-5.8,-34 Q-7,-44 0,-43.6 Q6.4,-43.4 5.6,-37 Q3,-41 -2,-40 Q-4.6,-38 -4.2,-33 Z" fill="${shade(c, 0.75)}" ${stroke(0.9)}/>`;

const mail = `<path d="M-7,-29 Q0,-31.5 7,-29 L7.4,-25 Q0,-27 -7.4,-25 Z" fill="${METAL}" ${stroke(0.6)}/><path d="M-8,-13 Q0,-11 8,-13 L8.2,-10.6 Q0,-8.8 -8.2,-10.6 Z" fill="${METAL}" ${stroke(0.6)}/>`;
const belt = `<rect x="-8" y="-18.4" width="16" height="2.2" fill="${LEATHER}" ${stroke(0.6)}/>`;
const crossbelts = `<path d="M-6,-29 L6.5,-15 M6,-29 L-6.5,-15" stroke="#f2efe6" stroke-width="1.8"/>`;
const coatButtons = `<circle cx="0" cy="-25" r="0.6" fill="${GOLD}"/><circle cx="0" cy="-21" r="0.6" fill="${GOLD}"/><circle cx="0" cy="-17" r="0.6" fill="${GOLD}"/>`;
const tabardCross = `<path d="M-1,-27 h2 v4 h4 v2 h-4 v6 h-2 v-6 h-4 v-2 h4 z" fill="#f2efe6" opacity="0.9"/>`;
const quiver = `<g transform="rotate(-18 -5 -24)"><rect x="-8" y="-34" width="5" height="16" rx="1.5" fill="${LEATHER}" ${stroke(0.8)}/><path d="M-7,-34 l-1,-3 l1.5,1 M-5.5,-34 l0,-3.5 l1,1.5 M-4,-34 l1,-3 l0.5,1.6" stroke="#f2efe6" stroke-width="1" fill="none"/></g>`;

const roundShield = (c: string, rim: string) =>
  `<circle cx="-7" cy="-21" r="7.2" fill="${c}" ${stroke()}/><circle cx="-7" cy="-21" r="7.2" fill="none" stroke="${rim}" stroke-width="1.4"/><circle cx="-7" cy="-21" r="1.8" fill="${rim}" ${stroke(0.6)}/>`;
const kiteShield = (c: string) =>
  `<path d="M-13,-28 Q-7,-30 -1.5,-28 Q-1.5,-17 -7.2,-10 Q-13,-17 -13,-28 Z" fill="${c}" ${stroke()}/><path d="M-7.6,-27.5 h1 v6 h4 v1 h-4 v7 h-1 v-7 h-4.4 v-1 h4.4 z" fill="#f2efe6"/>`;
const hideShield = `<ellipse cx="-7" cy="-21" rx="5.6" ry="7.4" fill="#a87b4f" ${stroke()}/><path d="M-7,-27 v12" stroke="${WOOD_DARK}" stroke-width="1"/>`;

const club = `<path d="M8.5,-15 L12,-33" stroke="${OUTLINE}" stroke-width="3.6" stroke-linecap="round"/><path d="M8.5,-15 L12,-33" stroke="${WOOD}" stroke-width="2.2" stroke-linecap="round"/><ellipse cx="12.4" cy="-34.5" rx="3" ry="4" transform="rotate(12 12.4 -34.5)" fill="${WOOD}" ${stroke(0.9)}/>`;
const sword = (len = 18) =>
  `<path d="M9.6,-18 L${9.6 + len * 0.18},${-18 - len}" stroke="${OUTLINE}" stroke-width="3.2" stroke-linecap="round"/><path d="M9.6,-18 L${9.6 + len * 0.18},${-18 - len}" stroke="${METAL}" stroke-width="1.8" stroke-linecap="round"/><path d="M6.6,-19.2 L12.8,-18.2" stroke="${BRONZE}" stroke-width="2" stroke-linecap="round"/>`;
const musket = (bayonet: boolean, wood = WOOD) =>
  `<path d="M8.6,-6 L11.4,-46" stroke="${OUTLINE}" stroke-width="3.2" stroke-linecap="round"/><path d="M8.6,-6 L10,-26" stroke="${wood}" stroke-width="2" stroke-linecap="round"/><path d="M10,-26 L11.4,-46" stroke="${METAL_DARK}" stroke-width="1.6" stroke-linecap="round"/><path d="M7.6,-6.5 L9.6,-4 L10,-9 Z" fill="${wood}" ${stroke(0.6)}/>` +
  (bayonet ? `<path d="M11.4,-46 L12,-53" stroke="${METAL}" stroke-width="1.2" stroke-linecap="round"/>` : '');
const bow = (recurve: boolean) =>
  (recurve
    ? `<path d="M11,-39 Q16,-37 14.6,-31 Q19,-24 14.6,-17 Q16,-11 11,-9" fill="none" stroke="${OUTLINE}" stroke-width="3"/><path d="M11,-39 Q16,-37 14.6,-31 Q19,-24 14.6,-17 Q16,-11 11,-9" fill="none" stroke="${WOOD}" stroke-width="1.7"/>`
    : `<path d="M10.5,-39 Q20,-24 10.5,-9" fill="none" stroke="${OUTLINE}" stroke-width="3"/><path d="M10.5,-39 Q20,-24 10.5,-9" fill="none" stroke="${WOOD}" stroke-width="1.7"/>`) +
  `<path d="M10.8,-38.6 L10.8,-9.4" stroke="#f2efe6" stroke-width="0.6"/>`;
const crossbow = `<path d="M2,-24.5 L16,-22" stroke="${OUTLINE}" stroke-width="3.4" stroke-linecap="round"/><path d="M2,-24.5 L16,-22" stroke="${WOOD}" stroke-width="2" stroke-linecap="round"/><path d="M14.6,-31 Q18.5,-23 14.4,-14.4" fill="none" stroke="${OUTLINE}" stroke-width="2.8"/><path d="M14.6,-31 Q18.5,-23 14.4,-14.4" fill="none" stroke="${METAL_DARK}" stroke-width="1.5"/><path d="M14.6,-31 L12.4,-22.6 L14.4,-14.4" fill="none" stroke="#f2efe6" stroke-width="0.6"/>`;
const shovel = `<path d="M10,-6 L10.6,-34" stroke="${OUTLINE}" stroke-width="2.8" stroke-linecap="round"/><path d="M10,-6 L10.6,-34" stroke="${WOOD}" stroke-width="1.5" stroke-linecap="round"/><path d="M7.6,-7 L12.4,-7 L12,-1 Q10,1 8,-1 Z" fill="${METAL}" ${stroke(0.8)}/>`;
const ramrod = `<path d="M7,-6 L16,-40" stroke="${OUTLINE}" stroke-width="2.4" stroke-linecap="round"/><path d="M7,-6 L16,-40" stroke="${WOOD}" stroke-width="1.2" stroke-linecap="round"/><ellipse cx="16.2" cy="-40.4" rx="1.8" ry="2.6" transform="rotate(15 16.2 -40.4)" fill="#3a3a3a" ${stroke(0.6)}/>`;

// ---------- Пехота ----------

function footman(type: UnitType, epoch: number, c: string): string {
  const dark = shade(c, 0.62);
  const base = { tunic: c, trousers: '#5b4636', boots: '#3a2a1f', sleeve: c };
  if (type === 'citizen') return person({ ...base, trousers: '#7a5b3e', boots: '#5a3f28', head: strawHat, torso: belt, weapon: shovel, hand: [10, -20] });
  if (type === 'warrior') {
    switch (epoch) {
      case 0:
        return person({ ...base, sleeve: SKIN, trousers: '#8a6a48', boots: '#6b4a2e', head: headband(c), torso: belt, left: hideShield, weapon: club });
      case 1:
        return person({ ...base, sleeve: SKIN, trousers: SKIN, boots: LEATHER, head: bronzeHelmet(c), torso: `${belt}<path d="M-7,-29 h14 v3 h-14 z" fill="${BRONZE}" opacity="0.85"/>`, left: roundShield(c, BRONZE), weapon: sword(17) });
      case 2:
        return person({ ...base, sleeve: METAL, trousers: METAL_DARK, boots: '#3a3a40', head: steelHelmet, torso: `${mail}${tabardCross}${belt}`, left: kiteShield(c), weapon: sword(21) });
      case 3:
        return person({ ...base, trousers: '#ece6d6', boots: '#1e1e24', head: tricorne, torso: `${crossbelts}${coatButtons}`, weapon: musket(false), hand: [9.6, -20] });
      default:
        return person({ ...base, tunic: dark, sleeve: dark, trousers: shade(c, 0.5), boots: '#1e1e24', head: brodie, torso: `${belt}<rect x="-5" y="-26" width="4" height="3" fill="${shade(c, 0.45)}"/>`, weapon: musket(true, '#6b4a2e'), hand: [9.6, -20] });
    }
  }
  // Лучники: лук, сложный лук в капюшоне, арбалет. Пушки — отдельно.
  switch (epoch) {
    case 0:
      return person({ ...base, sleeve: SKIN, trousers: '#8a6a48', boots: '#6b4a2e', head: headband(c), torso: belt, behind: quiver, weapon: bow(false), hand: [11, -24] });
    case 1:
      return person({ ...base, trousers: '#6f5a44', head: hood(c), torso: belt, behind: quiver, weapon: bow(true), hand: [12, -24] });
    default:
      return person({ ...base, sleeve: METAL, trousers: METAL_DARK, boots: '#3a3a40', head: kettleHat, torso: `${mail}${belt}`, weapon: crossbow, hand: [8, -23] });
  }
}

// ---------- Пушки ----------

function cannon(epoch: number, c: string): string {
  const modern = epoch >= 4;
  const barrel = modern ? '#5a6068' : BRONZE;
  const wheel = modern ? '#2b2b30' : WOOD;
  const spokes = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return `M0,-7 L${(6 * Math.cos(a)).toFixed(2)},${(-7 + 6 * Math.sin(a)).toFixed(2)}`;
  }).join(' ');
  return `
    <path d="M-2,-8 L-15,-1.5 L-13.5,0.5 L0,-5 Z" fill="${WOOD_DARK}" ${stroke(0.9)}/>
    <path d="M-5,-10 L${modern ? 18 : 13},-${modern ? 20 : 18} L${modern ? 19 : 14.5},-${modern ? 16.5 : 14} L-3,-6 Z" fill="${barrel}" ${stroke()}/>
    <path d="M-5,-10 L${modern ? 18 : 13},-${modern ? 20 : 18}" stroke="#fff" stroke-width="0.8" opacity="0.4"/>
    ${modern ? `<path d="M3,-17 L9,-19 L9,-5 L3,-4 Z" fill="${shade(c, 0.55)}" ${stroke(0.9)}/>` : `<circle cx="-5" cy="-8" r="2.4" fill="${barrel}" ${stroke(0.8)}/>`}
    <circle cx="0" cy="-7" r="7" fill="${wheel}" ${stroke()}/>
    <circle cx="0" cy="-7" r="5" fill="none" stroke="${shade(wheel, 0.7)}" stroke-width="1"/>
    <path d="${spokes}" stroke="${shade(wheel, 0.65)}" stroke-width="1"/>
    <circle cx="0" cy="-7" r="1.4" fill="${METAL_DARK}" ${stroke(0.5)}/>`;
}

function gunner(epoch: number, c: string): string {
  if (epoch >= 4) {
    const shell = `<rect x="7.4" y="-25" width="4" height="8.5" rx="1.8" fill="${BRONZE}" ${stroke(0.8)}/>`;
    return person({ tunic: shade(c, 0.62), sleeve: shade(c, 0.62), trousers: shade(c, 0.5), boots: '#1e1e24', head: peakedCap(shade(c, 0.5)), torso: belt, weapon: shell, hand: [9, -21] });
  }
  return person({ tunic: c, sleeve: c, trousers: '#ece6d6', boots: '#1e1e24', head: tricorne, torso: coatButtons, weapon: ramrod, hand: [10.5, -22] });
}

// ---------- Всадники ----------

function horse(epoch: number, c: string): string {
  const coat = epoch % 2 ? '#6b4428' : '#8f5f36';
  const mane = '#3a2414';
  const leg = (x: number, front: boolean) =>
    `<path d="M${x},-11 L${x + (front ? 0.8 : -0.6)},-1.6" stroke="${OUTLINE}" stroke-width="3.6" stroke-linecap="round"/><path d="M${x},-11 L${x + (front ? 0.8 : -0.6)},-1.6" stroke="${coat}" stroke-width="2.2" stroke-linecap="round"/><rect x="${x - 1.6 + (front ? 0.8 : -0.6)}" y="-1.8" width="3.2" height="1.8" fill="#2a2a2a"/>`;
  const caparison =
    epoch === 2
      ? `<path d="M-12.6,-20 Q0,-23.5 12.6,-20 L13.2,-10.4 L9.6,-8.4 L6,-10.4 L2.4,-8.4 L-1.2,-10.4 L-4.8,-8.4 L-8.4,-10.4 L-12,-8.6 Z" fill="${c}" ${stroke(0.9)}/><path d="M-12.4,-17 Q0,-20 12.6,-17" fill="none" stroke="${GOLD}" stroke-width="1"/>`
      : epoch >= 1
        ? `<path d="M-6,-21.4 L5,-21.4 L5.6,-12.6 L-6.4,-12.6 Z" fill="${c}" ${stroke(0.8)}/><path d="M-6.2,-14.4 L5.4,-14.4" stroke="${GOLD}" stroke-width="0.8"/>`
        : `<path d="M-5,-21.4 L4,-21.4 L4,-15 L-5,-15 Z" fill="#a87b4f" ${stroke(0.7)}/>`;
  return `
    <path d="M-12,-17 Q-18,-13 -15.6,-4.6 Q-13.6,-11 -11,-13.6 Z" fill="${mane}" ${stroke(0.8)}/>
    ${leg(-9, false)}${leg(7.6, true)}
    <ellipse cx="0" cy="-15" rx="12.8" ry="6.6" fill="${coat}" ${stroke()}/>
    <path d="M7,-18.4 L11.6,-29.4 L16.4,-27.6 L12.6,-13.6 Z" fill="${coat}" ${stroke()}/>
    <path d="M11.6,-30.4 Q15,-33.8 21.4,-27.8 Q22.6,-25.4 20.2,-24.8 L13.8,-25.4 Z" fill="${coat}" ${stroke()}/>
    <path d="M12.6,-31 L13.4,-35 L15,-31.6 Z" fill="${coat}" ${stroke(0.7)}/>
    <circle cx="16.2" cy="-29.4" r="0.7" fill="${OUTLINE}"/>
    <path d="M7.6,-19 L11.4,-30.6 L13.2,-30 L9.6,-17.6 Z" fill="${mane}"/>
    ${epoch >= 1 ? `<path d="M14,-28.6 L20.4,-25.6 M13,-24.4 L9,-21" stroke="${OUTLINE}" stroke-width="0.7" fill="none"/>` : ''}
    ${leg(-5.4, false)}${leg(10.8, true)}
    ${caparison}`;
}

/** Всадник: верхняя половина человека, сидящего на коне (таз — на спине коня, на высоте ~-21). */
function rider(epoch: number, c: string): string {
  const lance = (pennant: string) =>
    `<path d="M-8,-22 L27,-40" stroke="${OUTLINE}" stroke-width="3" stroke-linecap="round"/><path d="M-8,-22 L27,-40" stroke="${WOOD}" stroke-width="1.7" stroke-linecap="round"/>` +
    `<path d="M26,-41.4 L31.6,-42.8 L27.6,-38.4 Z" fill="${METAL}" ${stroke(0.7)}/><path d="M21,-37.6 L24,-44.6 L18.4,-41.8 Z" fill="${pennant}" ${stroke(0.6)}/>`;
  const riderSpear =
    `<path d="M5,-12 L15,-58" stroke="${OUTLINE}" stroke-width="2.8" stroke-linecap="round"/><path d="M5,-12 L15,-58" stroke="${WOOD}" stroke-width="1.5" stroke-linecap="round"/>` +
    `<path d="M14.3,-57 L15.8,-63.6 L16.5,-56.6 Z" fill="${METAL}" ${stroke(0.7)}/>`;
  const sabre =
    `<path d="M9.4,-31 Q10,-43 16,-50" fill="none" stroke="${OUTLINE}" stroke-width="2.8" stroke-linecap="round"/><path d="M9.4,-31 Q10,-43 16,-50" fill="none" stroke="${METAL}" stroke-width="1.5" stroke-linecap="round"/>` +
    `<path d="M7.4,-30.8 L11.8,-30.8" stroke="${GOLD}" stroke-width="1.6" stroke-linecap="round"/>`;
  const looks = [
    { tunic: c, sleeve: SKIN, legs: '#6f5a44', head: headband(c), torso: '', weapon: riderSpear, hand: [8.2, -31] },
    { tunic: c, sleeve: c, legs: '#6f5a44', head: bronzeHelmet(c), torso: `<path d="M-6.6,-29 h13.2 v2.6 h-13.2 z" fill="${BRONZE}" opacity="0.85"/>`, weapon: riderSpear, hand: [8.2, -31] },
    { tunic: c, sleeve: METAL, legs: METAL_DARK, head: steelHelmet, torso: `<path d="M-6.6,-29 Q0,-31.4 6.6,-29 L6.8,-25.6 Q0,-27.6 -6.8,-25.6 Z" fill="${METAL}" ${stroke(0.6)}/>${tabardCross}`, weapon: lance(c), hand: [6, -27] },
    { tunic: c, sleeve: c, legs: '#ece6d6', head: bicorne(GOLD), torso: `<path d="M-5.6,-29 L5.8,-20.4 M5.6,-29 L-5.8,-20.4" stroke="#f2efe6" stroke-width="1.6"/>`, weapon: sabre, hand: [9.4, -31] },
    { tunic: shade(c, 0.62), sleeve: shade(c, 0.62), legs: shade(c, 0.5), head: peakedCap(shade(c, 0.5)), torso: '', weapon: sabre, hand: [9.4, -31] },
  ];
  const l = looks[Math.min(4, epoch)];
  const [hx, hy] = l.hand;
  const arm = (d: string, color: string) =>
    `<path d="${d}" fill="none" stroke="${OUTLINE}" stroke-width="5.2" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${color}" stroke-width="3.4" stroke-linecap="round"/>`;
  return `
    <path d="M0,-20 L2.6,-11.4 L5.8,-11.4" fill="none" stroke="${OUTLINE}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M0,-20 L2.6,-11.4 L5.8,-11.4" fill="none" stroke="${l.legs}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <g transform="translate(-1 -1)">
      ${arm('M-5.6,-27 Q-8,-23 -5,-19.6', l.sleeve)}
      <path d="M-6.6,-29 Q0,-31.4 6.6,-29 L7,-19.6 Q0,-18 -7,-19.6 Z" fill="${l.tunic}" ${stroke()}/>
      <path d="M3,-29.8 Q5,-29.6 6.6,-29 L7,-19.6 Q5,-19 3,-18.8 Z" fill="#000" opacity="0.18"/>
      ${l.torso}
      <rect x="-1.6" y="-32.2" width="3.2" height="3.4" fill="${SKIN}"/>
      <circle cx="0" cy="-36" r="5.2" fill="${SKIN}" ${stroke()}/>
      <circle cx="2.4" cy="-36.6" r="0.75" fill="${OUTLINE}"/>
      ${l.head}
    </g>
    ${l.weapon}
    ${arm(`M4.6,-28 L${hx},${hy}`, l.sleeve)}
    <circle cx="${hx}" cy="${hy}" r="1.9" fill="${SKIN}" ${stroke(0.8)}/>`;
}

// ---------- Отряд ----------

/** Расстановка фигур отряда: задние раньше, передние позже. */
const FORMATIONS: Record<number, [number, number, number][]> = {
  1: [[36, 56, 1]],
  2: [
    [27, 52, 0.84],
    [44, 57, 0.9],
  ],
  3: [
    [24, 50, 0.76],
    [46, 50, 0.76],
    [35, 58, 0.84],
  ],
};

const HORSE_FORMATIONS: Record<number, [number, number, number][]> = {
  1: [[34, 56, 0.92]],
  2: [
    [27, 51, 0.74],
    [41, 58, 0.8],
  ],
  3: [
    [22, 49, 0.64],
    [46, 49, 0.64],
    [33, 58, 0.72],
  ],
};

/** Сколько фигур рисовать для уровня юнита. */
export function figuresForLevel(type: UnitType, level: number): number {
  if (type === 'citizen') return 1;
  return Math.max(1, Math.min(3, level - 1));
}

function place(x: number, y: number, s: number, body: string): string {
  return `<g transform="translate(${x} ${y}) scale(${s})">${body}</g>`;
}

/** Подставка в цвет нации с тенью. */
function podium(color: string): string {
  return `
    <ellipse cx="38" cy="58.4" rx="21" ry="5.6" fill="#000" opacity="0.3"/>
    <ellipse cx="36" cy="57" rx="20" ry="5.6" fill="${shade(color, 0.55)}" ${stroke()}/>
    <ellipse cx="36" cy="55.8" rx="20" ry="5.4" fill="${color}" ${stroke()}/>
    <ellipse cx="33" cy="54.6" rx="11" ry="2.2" fill="#fff" opacity="0.18"/>`;
}

/** SVG юнита: тип, эпоха владельца, цвет нации, число фигур. */
export function unitSvg(type: UnitType, epoch: number, color: string, figures: number): string {
  const n = Math.max(1, Math.min(3, figures));
  const base = podium(color);
  let body = '';
  if (type === 'horseman') {
    for (const [x, y, s] of HORSE_FORMATIONS[n]) body += place(x, y, s, horse(epoch, color) + rider(epoch, color));
  } else if (type === 'archer' && epoch >= 3) {
    // Пушка и расчёт: число людей при орудии показывает уровень.
    body += place(41, 56, 0.95, cannon(epoch, color));
    const crew: [number, number, number][] = n === 1 ? [[22, 55, 0.8]] : n === 2 ? [[18, 52, 0.72], [27, 57, 0.78]] : [[16, 50, 0.66], [26, 50, 0.66], [21, 58, 0.74]];
    body = crew.map(([x, y, s]) => place(x, y, s, gunner(epoch, color))).join('') + body;
  } else {
    for (const [x, y, s] of FORMATIONS[n]) body += place(x, y, s, footman(type, epoch, color));
  }
  return svgDoc(UNIT_SPRITE_W, UNIT_SPRITE_H, base + body);
}
