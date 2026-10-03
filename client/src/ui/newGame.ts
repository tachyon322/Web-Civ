// Экран новой партии: нация, число держав, сложность, сид карты.

import { DIFFICULTIES, MAX_POWERS, balance, characterDef, nations, traitDef, type Difficulty, type GameSettings } from '../core';

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

export function showNewGameDialog(onStart: (settings: GameSettings) => void, onCancel: () => void): void {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  const nationOptions = nations.map((n) => `<option value="${n.id}">${n.name}</option>`).join('');
  const difficultyOptions = DIFFICULTIES.map((d) => {
    const def = balance.difficulty[d];
    const bonus = def.botIncomeBonus ? ` (доход ботов ${def.botIncomeBonus > 0 ? '+' : ''}${Math.round(def.botIncomeBonus * 100)}%)` : '';
    return `<option value="${d}" ${d === 'normal' ? 'selected' : ''}>${def.name}${bonus}</option>`;
  }).join('');
  backdrop.innerHTML = `
    <div class="panel modal">
      <h1>Новая партия</h1>
      <label for="ng-nation">Нация</label>
      <select id="ng-nation"><option value="">Случайная</option>${nationOptions}</select>
      <div class="hint" id="ng-trait"></div>
      <label for="ng-powers">Число держав</label>
      <input id="ng-powers" type="number" min="2" max="${MAX_POWERS}" value="${MAX_POWERS}" />
      <label for="ng-difficulty">Сложность</label>
      <select id="ng-difficulty">${difficultyOptions}</select>
      <label for="ng-seed">Сид карты</label>
      <div class="seed">
        <input id="ng-seed" type="number" min="0" value="${randomSeed()}" />
        <button id="ng-reroll" title="Случайный сид">⟳</button>
      </div>
      <button class="start" id="ng-start">Начать</button>
      <button class="start secondary" id="ng-cancel">Назад</button>
      <div class="hint">ЛКМ — выбрать, ПКМ — идти или перебросить, колесо — масштаб, перетаскивание — сдвиг карты.
      Enter — завершить ход, F — основать город, N — следующий юнит, D — дипломатия, P — пути (эпоха, стабильность, способности, победы), Esc — снять выбор.</div>
    </div>`;
  document.body.appendChild(backdrop);
  const $ = <T extends HTMLElement>(id: string) => backdrop.querySelector<T>(`#${id}`)!;
  const showTrait = () => {
    const id = $<HTMLSelectElement>('ng-nation').value;
    const n = nations.find((x) => x.id === id);
    $('ng-trait').textContent = n
      ? `${traitDef(n.trait).name}: ${traitDef(n.trait).description}. Боты этой нации чаще — ${characterDef(n.tendency).name.toLowerCase()}.`
      : `Случайная из ${nations.length}. У каждой нации одна черта — её видно и у соперников в окне дипломатии.`;
  };
  $('ng-nation').addEventListener('change', showTrait);
  showTrait();
  $('ng-reroll').addEventListener('click', () => {
    $<HTMLInputElement>('ng-seed').value = String(randomSeed());
  });
  $('ng-start').addEventListener('click', () => {
    const powers = Math.max(2, Math.min(MAX_POWERS, Number($<HTMLInputElement>('ng-powers').value) || MAX_POWERS));
    const seed = Math.abs(Math.floor(Number($<HTMLInputElement>('ng-seed').value))) || 0;
    const nation = $<HTMLSelectElement>('ng-nation').value || null;
    const difficulty = $<HTMLSelectElement>('ng-difficulty').value as Difficulty;
    backdrop.remove();
    onStart({ seed, powers, humanNation: nation, difficulty });
  });
  $('ng-cancel').addEventListener('click', () => {
    backdrop.remove();
    onCancel();
  });
}
