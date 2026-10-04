// Сводка войны: сравнение вашей державы и противника с флагами.
// Показываются только величины, которые и так видны в окне дипломатии или на карте.

import {
  armyStrength,
  citiesOf,
  deterrenceIndex,
  epochName,
  epochOf,
  grossGold,
  isMilitary,
  sizeOf,
  turnsWord,
  unitsOf,
  warSides,
  warTurns,
  type GameState,
} from '../core';
import { esc } from './dialog';
import { flag } from './flags';

interface Row {
  label: string;
  me: number;
  enemy: number;
  hint?: string;
}

function rows(state: GameState, me: number, enemy: number): Row[] {
  const army = (p: number) => unitsOf(state, p).filter(isMilitary);
  return [
    { label: 'Города', me: citiesOf(state, me).length, enemy: citiesOf(state, enemy).length },
    { label: 'Размер (сумма уровней городов)', me: sizeOf(state, me), enemy: sizeOf(state, enemy) },
    { label: 'Военных юнитов', me: army(me).length, enemy: army(enemy).length },
    {
      label: 'Сила армии',
      me: Math.round(armyStrength(state, me) * 10) / 10,
      enemy: Math.round(armyStrength(state, enemy) * 10) / 10,
      hint: 'Сумма сил военных юнитов',
    },
    {
      label: 'Индекс сдерживания',
      me: deterrenceIndex(state, me).total,
      enemy: deterrenceIndex(state, enemy).total,
      hint: 'Армия, оборона городов, культурный щит — по нему бот решает, нападать ли',
    },
    { label: 'Доход золота за ход', me: grossGold(state, me), enemy: grossGold(state, enemy) },
    { label: 'Эпоха', me: epochOf(state.powers[me]), enemy: epochOf(state.powers[enemy]) },
  ];
}

function rowHtml(r: Row, epochs: boolean): string {
  const total = Math.max(r.me + r.enemy, 0.0001);
  const mePct = Math.round((r.me / total) * 100);
  const cls = (a: number, b: number) => (a > b ? 'lead' : a < b ? 'trail' : '');
  const show = (v: number) => (epochs ? esc(epochName(v)) : String(v));
  return `<div class="ws-row" title="${esc(r.hint ?? '')}">
    <span class="ws-val ${cls(r.me, r.enemy)}">${show(r.me)}</span>
    <div class="ws-mid"><div class="ws-label">${esc(r.label)}</div>
      <div class="ws-bar"><span class="ws-me" style="width:${mePct}%"></span><span class="ws-enemy" style="width:${100 - mePct}%"></span></div></div>
    <span class="ws-val right ${cls(r.enemy, r.me)}">${show(r.enemy)}</span>
  </div>`;
}

/** Открывает окно сводки; onDiplomacy вызывается по кнопке «Дипломатия». */
export function showWarSummary(state: GameState, me: number, enemy: number, onDiplomacy: (target: number) => void): void {
  const pm = state.powers[me];
  const pe = state.powers[enemy];
  const turns = warTurns(state, me, enemy);
  const sides = warSides(state, me, enemy);
  const name = (p: number) => esc(state.powers[p].name);
  const withEnemy = sides.defenders.filter((d) => d !== enemy);
  const body = rows(state, me, enemy)
    .map((r) => rowHtml(r, r.label === 'Эпоха'))
    .join('');
  const note = [
    withEnemy.length ? `Вместе с ними: ${withEnemy.map(name).join(', ')}.` : '',
    sides.allies.length ? `Их союзники могут вступить: ${sides.allies.map(name).join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="panel modal war-summary">
      <div class="ws-head">
        <div class="ws-side">${flag(pm.nationId)}<b>${name(me)}</b><span class="muted small">вы</span></div>
        <div class="ws-vs"><span>⚔</span><span class="muted small">${turns} ${turnsWord(turns)}</span></div>
        <div class="ws-side">${flag(pe.nationId)}<b>${name(enemy)}</b><span class="muted small">противник</span></div>
      </div>
      <div class="ws-body">${body}</div>
      ${note ? `<p class="muted small">${note}</p>` : ''}
      <div class="ws-actions"><button data-act="diplomacy">Дипломатия: мир, помощь</button><button class="cancel">Закрыть (Esc)</button></div>
    </div>`;
  const close = () => {
    backdrop.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el === backdrop || el.closest('.cancel')) return close();
    if (el.closest('[data-act="diplomacy"]')) {
      close();
      onDiplomacy(enemy);
    }
  });
  document.body.appendChild(backdrop);
}
