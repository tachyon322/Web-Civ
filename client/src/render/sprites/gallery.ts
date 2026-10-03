// Галерея спрайтов для разработки: npm run dev → http://localhost:5173/sprites.html

import { nations } from '../../core/data';
import type { UnitType } from '../../core/types';
import { citySvg } from './cities';
import { unitSvg } from './units';

const out = document.getElementById('out')!;
const scale = Number(new URLSearchParams(location.search).get('scale') ?? 1.5);

function img(svg: string, w: number, h: number): string {
  return `<img width="${w * scale}" height="${h * scale}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`;
}

const types: UnitType[] = ['citizen', 'warrior', 'archer', 'horseman'];
const colors = nations.slice(0, 4).map((n) => n.color);
let html = '<h2>Юниты: эпохи 0–4, отряды 1–3 фигуры</h2>';
for (const type of types) {
  for (const figures of [1, 3]) {
    html += `<div class="row"><span>${type} ×${figures}</span>`;
    for (let epoch = 0; epoch < 5; epoch++) html += img(unitSvg(type, epoch, colors[epoch % colors.length], figures), 72, 64);
    html += '</div>';
  }
}
html += '<h2>Города: уровни 1–5 по эпохам (последний — столица со стенами)</h2>';
for (let epoch = 0; epoch < 5; epoch++) {
  html += `<div class="row"><span>эпоха ${epoch}</span>`;
  for (let level = 1; level <= 5; level++) html += img(citySvg(level, epoch, colors[epoch % colors.length], false, level === 5), 100, 84);
  html += img(citySvg(3, epoch, colors[epoch % colors.length], true, true), 100, 84);
  html += '</div>';
}
out.innerHTML = html;
