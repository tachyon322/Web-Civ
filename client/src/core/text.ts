// Мелкие помощники для текстов ядра: склонения, «N ходов назад».

/** «ход», «хода», «ходов» по числу. */
export function turnsWord(n: number): string {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return 'ход';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'хода';
  return 'ходов';
}

export function turnsAgo(n: number): string {
  return n <= 0 ? 'в этом ходу' : `${n} ${turnsWord(n)} назад`;
}
