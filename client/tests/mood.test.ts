import { describe, expect, it } from 'vitest';
import { moodLevel } from '../src/core';

describe('настроение держав', () => {
  it('пять уровней по порогам', () => {
    expect(moodLevel(100)).toBe(0);
    expect(moodLevel(30)).toBe(0);
    expect(moodLevel(29)).toBe(1);
    expect(moodLevel(10)).toBe(1);
    expect(moodLevel(9)).toBe(2);
    expect(moodLevel(0)).toBe(2);
    expect(moodLevel(-9)).toBe(2);
    expect(moodLevel(-10)).toBe(3);
    expect(moodLevel(-39)).toBe(3);
    expect(moodLevel(-40)).toBe(4);
    expect(moodLevel(-100)).toBe(4);
  });
});
