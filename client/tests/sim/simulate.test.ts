// Симуляция: боты играют партию сами с собой (за игрока тоже). Запуск: npm run sim
// Параметры через окружение: SEED, TURNS, POWERS, DIFFICULTY, PASSIVE=1 (игрок ничего не делает).

import { it } from 'vitest';
import { runBots } from '../../src/ai';
import { execute } from '../../src/core/commands';
import { armyStrength } from '../../src/core/deterrence';
import { newGame } from '../../src/core/game';
import { citiesOf, unitsOf } from '../../src/core/state';
import type { Difficulty } from '../../src/core/types';

const env = ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

it.skipIf(!env.SIM)('симуляция партии ботов', () => {
  const seed = Number(env.SEED ?? 5);
  const turns = Number(env.TURNS ?? 150);
  const s = newGame({
    seed,
    powers: Number(env.POWERS ?? 12),
    humanNation: null,
    difficulty: (env.DIFFICULTY as Difficulty | undefined) ?? 'normal',
  });
  let total = 0;
  let slowest = 0;
  const report = () => {
    console.log(`Ход ${s.turn}: в среднем ${(total / (s.turn - 1)).toFixed(0)} мс, максимум ${slowest.toFixed(0)} мс`);
    for (const p of s.powers) {
      const cities = citiesOf(s, p.id);
      console.log(
        `  ${p.name.padEnd(10)} ${(p.character ?? 'игрок').padEnd(12)} ${p.alive ? '' : '[выбыл] '}` +
          `городов ${cities.length} (${cities.map((c) => c.level).join('')}), золото ${p.gold}, ` +
          `жителей ${unitsOf(s, p.id).filter((u) => u.type === 'citizen').length}, армия ${armyStrength(s, p.id)}, ` +
          `войны: ${p.wars.map((w) => s.powers[w].name).join(', ') || '—'}` +
          `${p.suzerain >= 0 ? `, сюзерен: ${s.powers[p.suzerain].name}` : ''}`,
      );
    }
    const pacts = (kind: string) =>
      s.pacts.filter((x) => x.kind === kind).map((x) => `${s.powers[x.a].name}—${s.powers[x.b].name}`).join(', ') || '—';
    console.log(`  Торговля: ${pacts('trade')}`);
    console.log(`  Союзы: ${pacts('alliance')}`);
    console.log(`  Перемирия: ${pacts('truce')}`);
  };
  for (let t = 0; t < turns; t++) {
    const t0 = performance.now();
    runBots(s, { includeHuman: !env.PASSIVE, budgetMs: 1e9 });
    const ms = performance.now() - t0;
    total += ms;
    slowest = Math.max(slowest, ms);
    execute(s, { type: 'EndTurn', power: 0 });
    if (s.turn % 25 === 1) report();
  }
  console.log('\nСобытия:');
  const seen = new Set<string>();
  for (const e of s.log.filter((x) => /Объявлена война|вступает в войну|выбывает|захвачен державой|разграблен державой|освобождён державой|^Мир|^Союз|вассалом|унию|дань|коалиция|восстаёт|расторгает/.test(x.text))) {
    const key = `${e.turn}:${e.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  ${e.turn}: ${e.text}`);
  }
}, 600000);
