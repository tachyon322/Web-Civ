// Выбирает нужные иконки из набора game-icons.net (CC BY 3.0, пакет @iconify-json/game-icons)
// и пишет их пути в src/ui/icons/game-icons.json — в сборку попадают только они.
// Запуск из client/: node tools/icons.mjs   (после правки списка ICONS в src/ui/icons/index.ts)

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const set = require('@iconify-json/game-icons/icons.json');
const source = readFileSync(new URL('../src/ui/icons/index.ts', import.meta.url), 'utf8');
const names = [...new Set([...source.matchAll(/glyph: '([a-z0-9-]+)'/g)].map((m) => m[1]))].sort();

const out = {};
for (const name of names) {
  const icon = set.icons[name];
  if (!icon) throw new Error(`нет иконки ${name} в game-icons`);
  // Все иконки набора — один или несколько path с fill="currentColor"; цвет задаёт игра.
  out[name] = [...icon.body.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join(' ');
}
writeFileSync(new URL('../src/ui/icons/game-icons.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`иконок: ${names.length}`);
