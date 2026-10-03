import { describe, expect, it } from 'vitest';
import { nations } from '../src/core/data';
import { MILITARY_TYPES, type UnitType } from '../src/core/types';
import { citySvg } from '../src/render/sprites/cities';
import { shade } from '../src/render/sprites/svg';
import { figuresForLevel, unitSvg } from '../src/render/sprites/units';

/** Грубая проверка SVG: без NaN и undefined, открывающие и закрывающие g сходятся. */
function checkSvg(svg: string): void {
  expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  expect(svg.startsWith('<svg')).toBe(true);
  expect(svg.match(/<g[\s>]/g)?.length ?? 0).toBe(svg.match(/<\/g>/g)?.length ?? 0);
}

describe('спрайты', () => {
  it('юниты: все типы, эпохи и размеры отряда для всех наций', () => {
    const types: UnitType[] = ['citizen', ...MILITARY_TYPES];
    for (const n of nations) {
      for (const type of types) {
        for (let epoch = 0; epoch < 5; epoch++) {
          for (let figures = 1; figures <= 3; figures++) {
            const svg = unitSvg(type, epoch, n.color, figures);
            checkSvg(svg);
            expect(svg).toContain(n.color);
          }
        }
      }
    }
  });

  it('города: все уровни и эпохи, столица и стены', () => {
    for (let epoch = 0; epoch < 5; epoch++) {
      for (let level = 1; level <= 5; level++) {
        for (const capital of [false, true]) for (const walls of [false, true]) checkSvg(citySvg(level, epoch, '#c0392b', capital, walls));
      }
    }
  });

  it('число фигур отряда растёт с уровнем, житель всегда один', () => {
    expect([1, 2, 3, 4].map((l) => figuresForLevel('warrior', l))).toEqual([1, 1, 2, 3]);
    expect(figuresForLevel('citizen', 1)).toBe(1);
    expect(shade('#808080', 0.5)).toBe('#404040');
    expect(shade('#000000', 2)).toBe('#ffffff');
  });
});
