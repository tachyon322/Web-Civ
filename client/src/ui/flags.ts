// Флаги наций: маленькие SVG, нарисованные кодом (картинок в проекте нет).
// Где у нации нет единого исторического флага, взят самый узнаваемый (см. комментарий у каждой).

function star(cx: number, cy: number, r: number, fill: string, rot = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = ((rot + i * 36) * Math.PI) / 180;
    const rad = i % 2 ? r * 0.4 : r;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`;
}

function rect(x: number, y: number, w: number, h: number, fill: string): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
}

function chakra(cx: number, cy: number, r: number, color: string): string {
  let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="0.6"/>`;
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 * Math.PI) / 180;
    s += `<line x1="${cx}" y1="${cy}" x2="${(cx + r * Math.cos(a)).toFixed(2)}" y2="${(cy + r * Math.sin(a)).toFixed(2)}" stroke="${color}" stroke-width="0.3"/>`;
  }
  return s;
}

const FLAGS: Record<string, string> = {
  // Рим: красное знамя с золотыми буквами SPQR.
  rome:
    rect(0, 0, 30, 20, '#b3202a') +
    rect(0, 0, 30, 1.6, '#e0b020') +
    rect(0, 18.4, 30, 1.6, '#e0b020') +
    `<text x="15" y="12.3" text-anchor="middle" font-family="serif" font-weight="bold" font-size="6.5" fill="#e0b020">SPQR</text>`,
  // Монголы: флаг современной Монголии — красное, синее, красное и жёлтый соёмбо.
  mongols:
    rect(0, 0, 10, 20, '#d4202a') +
    rect(10, 0, 10, 20, '#1f4fa8') +
    rect(20, 0, 10, 20, '#d4202a') +
    `<circle cx="5" cy="13.2" r="1.6" fill="#f2c500"/>` +
    `<polygon points="5,3 3.6,6.6 6.4,6.6" fill="#f2c500"/>` +
    rect(2.4, 8, 0.9, 7, '#f2c500') +
    rect(6.7, 8, 0.9, 7, '#f2c500') +
    rect(3.2, 16.4, 3.6, 0.9, '#f2c500'),
  // Япония: красный круг на белом (Хиномару).
  japan: rect(0, 0, 30, 20, '#ffffff') + `<circle cx="15" cy="10" r="6" fill="#bc002d"/>`,
  // Китай: красное полотнище с жёлтыми звёздами.
  china:
    rect(0, 0, 30, 20, '#de2910') +
    star(6, 5.6, 3.2, '#ffde00') +
    star(11.4, 2.2, 1.1, '#ffde00', -70) +
    star(13.4, 4.4, 1.1, '#ffde00', -40) +
    star(13.4, 7.4, 1.1, '#ffde00', -10) +
    star(11.4, 9.6, 1.1, '#ffde00', -80),
  // Арабы: чёрное знамя Аббасидов (панарабский флаг слишком похож на палестинский).
  arabia: rect(0, 0, 30, 20, '#111111') + `<path transform="translate(2.5 0)" d="M12.5 6.5a4.6 4.6 0 1 0 0 7 3.6 3.6 0 1 1 0-7z" fill="#f2f2f2"/>`,
  // Египет: красный, белый, чёрный и золотой орёл Саладина (упрощённо).
  egypt:
    rect(0, 0, 30, 6.67, '#ce1126') +
    rect(0, 6.67, 30, 6.67, '#ffffff') +
    rect(0, 13.33, 30, 6.67, '#000000') +
    `<ellipse cx="15" cy="10" rx="2.2" ry="2.6" fill="#c09300"/>` +
    `<polygon points="10.8,8 15,10 10.8,12.4" fill="#c09300"/>` +
    `<polygon points="19.2,8 15,10 19.2,12.4" fill="#c09300"/>`,
  // Греция: девять полос и белый крест на синем.
  greece:
    Array.from({ length: 9 }, (_, i) => rect(0, i * (20 / 9), 30, 20 / 9 + 0.05, i % 2 ? '#ffffff' : '#0d5eaf')).join('') +
    rect(0, 0, 11.1, 11.12, '#0d5eaf') +
    rect(4.4, 0, 2.3, 11.12, '#ffffff') +
    rect(0, 4.4, 11.1, 2.3, '#ffffff'),
  // Франция: триколор.
  france: rect(0, 0, 10, 20, '#0055a4') + rect(10, 0, 10, 20, '#ffffff') + rect(20, 0, 10, 20, '#ef4135'),
  // Карфаген: единого флага не осталось; знак Танит (треугольник, диск и перекладина) на пурпуре.
  carthage:
    rect(0, 0, 30, 20, '#6a2c7a') +
    `<polygon points="15,4.5 20,14.5 10,14.5" fill="none" stroke="#f0e6f4" stroke-width="1"/>` +
    `<circle cx="15" cy="3.2" r="1.4" fill="#f0e6f4"/>` +
    rect(9.5, 8.6, 11, 0.9, '#f0e6f4'),
  // Индия: шафран, белый, зелёный и синее колесо.
  india:
    rect(0, 0, 30, 6.67, '#ff9933') +
    rect(0, 6.67, 30, 6.67, '#ffffff') +
    rect(0, 13.33, 30, 6.67, '#138808') +
    chakra(15, 10, 2.8, '#000080'),
  // Россия: белая, синяя и красная полосы.
  russia: rect(0, 0, 30, 6.67, '#ffffff') + rect(0, 6.67, 30, 6.67, '#0039a6') + rect(0, 13.33, 30, 6.67, '#d52b1e'),
  // Персия: «Лев и солнце» — зелёный, белый, красный и золотое солнце.
  persia:
    rect(0, 0, 30, 6.67, '#239f40') +
    rect(0, 6.67, 30, 6.67, '#ffffff') +
    rect(0, 13.33, 30, 6.67, '#da0000') +
    `<circle cx="15" cy="10" r="3.1" fill="#e8a800"/>` +
    Array.from({ length: 12 }, (_, i) => {
      const a = (i * 30 * Math.PI) / 180;
      return `<line x1="${(15 + 3.1 * Math.cos(a)).toFixed(2)}" y1="${(10 + 3.1 * Math.sin(a)).toFixed(2)}" x2="${(15 + 4.6 * Math.cos(a)).toFixed(2)}" y2="${(10 + 4.6 * Math.sin(a)).toFixed(2)}" stroke="#e8a800" stroke-width="0.7"/>`;
    }).join(''),
  // Византия: золотое знамя Палеологов с крестом и четырьмя «β».
  byzantium:
    rect(0, 0, 30, 20, '#e2a800') +
    rect(13.7, 2, 2.6, 16, '#6a1b6a') +
    rect(5, 8.7, 20, 2.6, '#6a1b6a') +
    [[9.3, 7], [20.7, 7], [9.3, 16.2], [20.7, 16.2]]
      .map(([x, y]) => `<text x="${x}" y="${y}" text-anchor="middle" font-family="serif" font-weight="bold" font-size="5" fill="#6a1b6a">β</text>`)
      .join(''),
};

/** Флаг нации как inline-SVG; для неизвестной нации — серое полотнище. */
export function flag(nationId: string): string {
  const body = FLAGS[nationId] ?? rect(0, 0, 30, 20, '#7a8190');
  return `<svg class="flag" viewBox="0 0 30 20" width="21" height="14" aria-hidden="true">${body}</svg>`;
}

/** Флаг с цветной полоской державы под ним (по цвету державу узнают на карте). */
export function flagFor(nationId: string, color: string): string {
  return `<span class="flagbox" style="border-bottom-color:${color}">${flag(nationId)}</span>`;
}
