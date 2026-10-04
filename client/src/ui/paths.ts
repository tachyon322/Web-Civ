// Окно «Пути»: эпоха, стабильность с разбивкой, способности державы, финальные проекты,
// ход к победам у всех известных держав и чудеса света.

import {
  LAST_EPOCH,
  NO_TARGET,
  PROJECT_STAGES,
  abilityBlocker,
  abilityCost,
  buildings,
  computeStability,
  epochName,
  epochOf,
  findCity,
  nationTrait,
  nextEpochScience,
  pathsConfig,
  projectCity,
  projectName,
  stabilityLevel,
  victoryName,
  victoryProgress,
  wonderCity,
  wondersOwned,
  type AbilityId,
  type Command,
  type GameState,
} from '../core';
import { esc } from './dialog';
import { icon } from './icons';

export interface PathsHost {
  readonly state: GameState;
  readonly power: number;
  dispatch(cmd: Command): boolean;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/** Где применяется способность, если не из этого окна. */
const WHERE: Partial<Record<AbilityId, string>> = {
  recon: 'в окне дипломатии',
  propaganda: 'в окне дипломатии',
  callPeace: 'в окне дипломатии',
  fortify: 'в панели своего города',
  sabotage: 'в панели чужого города',
  convert: 'в панели вражеского юнита',
};

const DESCRIPTIONS: Record<AbilityId, string> = {
  recon: `${pathsConfig.abilities.recon.turns} ходов видны все юниты выбранной державы`,
  fortify: `город ${pathsConfig.abilities.fortify.turns} хода втрое крепче`,
  sabotage: `у врага ${pathsConfig.abilities.sabotage.turns} ходов не работает здание`,
  deterrent: 'нападение на вас — сокрушительный удар по столице агрессора',
  callPeace: 'мировое мнение требует от агрессора мира; отказ испортит ему отношения со всеми',
  propaganda: `стабильность врага ${pathsConfig.stability.propaganda} на ${pathsConfig.abilities.propaganda.turns} ходов`,
  convert: 'вражеский юнит у вашей границы переходит к вам',
  holiday: `+${pathsConfig.abilities.holiday.stability} к стабильности на ${pathsConfig.abilities.holiday.turns} ходов`,
};

export class PathsWindow {
  private root: HTMLElement | null = null;
  private actions: Command[] = [];
  private onKey = (e: KeyboardEvent) => {
    const backdrops = document.querySelectorAll('.modal-backdrop');
    if (e.key !== 'Escape' || !this.root || backdrops[backdrops.length - 1] !== this.root) return;
    e.stopPropagation();
    this.close();
  };

  constructor(
    private host: PathsHost,
    private onClose: () => void,
  ) {}

  open(): void {
    if (!this.root) {
      this.root = document.createElement('div');
      this.root.className = 'modal-backdrop';
      this.root.addEventListener('click', (e) => this.onClick(e));
      window.addEventListener('keydown', this.onKey, true);
      document.body.appendChild(this.root);
    }
    this.render();
  }

  close(): void {
    if (!this.root) return;
    this.root.remove();
    this.root = null;
    window.removeEventListener('keydown', this.onKey, true);
    this.onClose();
  }

  update(): void {
    if (this.root) this.render();
  }

  private onClick(e: MouseEvent): void {
    const el = e.target as HTMLElement;
    if (el === this.root || el.closest('.close')) {
      this.close();
      return;
    }
    const btn = el.closest<HTMLButtonElement>('button[data-i]');
    if (!btn || btn.disabled) return;
    if (this.host.dispatch(this.actions[Number(btn.dataset.i)])) this.render();
  }

  private render(): void {
    if (!this.root) return;
    this.actions = [];
    this.root.innerHTML = `
      <div class="panel modal diplo paths">
        <div class="diplo-head"><h1>Пути: армия, наука, культура</h1><button class="close" title="Закрыть (Esc)">✕</button></div>
        <div class="detail columns">
          <div>${this.epochBlock()}${this.stabilityBlock()}</div>
          <div>${this.abilitiesBlock()}${this.projectsBlock()}${this.victoryBlock()}${this.wondersBlock()}</div>
        </div>
      </div>`;
  }

  private epochBlock(): string {
    const p = this.host.state.powers[this.host.power];
    const e = epochOf(p);
    const next = nextEpochScience(p);
    const cfg = pathsConfig.epoch;
    const pct = next ? Math.min(100, (p.scienceTotal / next) * 100) : 100;
    const trait = nationTrait(this.host.state, this.host.power);
    return `<div class="row"><span>Черта нации — ${esc(trait.name)}</span><span>${esc(trait.description)}</span></div>
      <h3>Эпоха: ${esc(epochName(e))}</h3>
      <div class="row"><span>Заработано науки</span><span>${p.scienceTotal}${next ? ` / ${next} до эпохи «${esc(epochName(e + 1))}»` : ' — последняя эпоха'}</span></div>
      <div class="bar"><div style="width:${pct}%"></div></div>
      <div class="muted small">Каждая эпоха: юнитам ×${1 + cfg.strengthPerEpoch} к силе и +${cfg.mpPerEpoch} к ходу, +${cfg.freeCitiesPerEpoch} город без штрафа к стабильности, новые здания и чудеса.
      Технологический разрыв: если ваша наука в ${pathsConfig.techGap.minRatio}+ раза больше, чем у врага, — до +${pathsConfig.techGap.max * 100}% в бою с ним.</div>`;
  }

  private stabilityBlock(): string {
    const { state, power } = this.host;
    const p = state.powers[power];
    const b = computeStability(state, power);
    const level = stabilityLevel(b.total);
    const rows = b.items
      .map((i) => `<div class="row"><span>${esc(i.label)}</span><span class="${i.value >= 0 ? 'good' : 'bad'}">${signed(i.value)}</span></div>`)
      .join('');
    const levels = pathsConfig.stability.levels
      .map((l) => {
        const eff = l.income ? `${signed(Math.round(l.income * 100))}% доходов` : 'без эффектов';
        const combat = l.combat !== 1 ? `, боевой дух ×${l.combat}` : '';
        const riots = l.min < pathsConfig.stability.secessionBelow ? ', города отделяются' : '';
        return `<div class="row ${l === level ? 'current' : ''}"><span>от ${l.min}: ${esc(l.name)}</span><span>${eff}${combat}${riots}</span></div>`;
      })
      .join('');
    const warning = p.secession ? findCity(state, p.secession.cityId) : undefined;
    return `<h3>Стабильность: ${b.total} — ${esc(level.name)}</h3>
      ${warning ? `<div class="reason">${esc(warning.name)} отделится через ${Math.max(0, p.secession!.due - state.turn)} х., если стабильность не поднимется до ${pathsConfig.stability.secessionBelow}</div>` : ''}
      <div class="breakdown">${rows}</div>
      <div class="levels small">${levels}</div>`;
  }

  private abilitiesBlock(): string {
    const { state, power } = this.host;
    const p = state.powers[power];
    const list = (Object.keys(pathsConfig.abilities) as AbilityId[]).map((id) => {
      const def = pathsConfig.abilities[id];
      const res = icon(def.path === 'science' ? 'science' : 'culture');
      const use = { ...NO_TARGET, ability: id };
      const cost = id === 'convert' ? `${pathsConfig.abilities.convert.costPerPerson} за человека` : String(abilityCost(state, power, use));
      let action = `<span class="muted small">${esc(WHERE[id] ?? '')}</span>`;
      if (!WHERE[id]) {
        const cmd: Command = { type: 'UseAbility', power, ...use };
        const blocker = abilityBlocker(state, power, use);
        const i = this.actions.push(cmd) - 1;
        action = `<button data-i="${i}" ${blocker ? 'disabled' : ''} title="${esc(blocker ?? '')}">Применить</button>${blocker ? `<div class="reason">${esc(blocker)}</div>` : ''}`;
      }
      return `<div class="ability"><div><b>${esc(def.name)}</b> <span class="muted">${res} ${esc(cost)}</span><div class="muted small">${esc(DESCRIPTIONS[id])}</div></div><div>${action}</div></div>`;
    });
    return `<h3>Способности <span class="muted small">(у вас ${icon('science')} ${p.science}, ${icon('culture')} ${p.culture})</span></h3>
      <div class="muted small">Наука и культура — и счёт к победе, и валюта: каждая трата отодвигает финальный проект.</div>
      ${list.join('')}`;
  }

  private projectsBlock(): string {
    const { state, power } = this.host;
    const p = state.powers[power];
    const cfg = pathsConfig.projects;
    const row = (kind: 'science' | 'culture') => {
      const city = projectCity(state, power, kind);
      const stages = city?.project?.stages ?? 0;
      const cond =
        kind === 'science'
          ? `эпоха «${epochName(LAST_EPOCH)}» (${epochOf(p) >= LAST_EPOCH ? 'есть' : 'нет'})`
          : `${cfg.culture.wonders} чуда света (у вас ${wondersOwned(state, power)})`;
      return `<div class="row"><span>${esc(projectName(kind))}: ${stages}/${PROJECT_STAGES}${city ? ` в городе ${esc(city.name)}` : ''}</span>
        <span>этапы ${cfg[kind].stages.join(' / ')} ${icon(kind)}</span></div>
        <div class="muted small">Условие: ${esc(cond)}. Этап выкупается в панели города (одна покупка за ход); если город захватят — прогресс сгорает.</div>`;
    };
    return `<h3>Финальные проекты</h3>${row('science')}${row('culture')}`;
  }

  private victoryBlock(): string {
    const { state, power } = this.host;
    const me = state.powers[power];
    const known = state.powers.filter((p) => p.alive && (p.id === power || me.met.includes(p.id)));
    const fed = pathsConfig.victory;
    const rows = known
      .map((p) => {
        const v = victoryProgress(state, p.id);
        return `<tr><td><span class="swatch" style="background:${p.color}"></span>${esc(p.name)}</td>
          <td>${v.capitals}/${v.capitalsNeeded}</td>
          <td>${Math.round(v.federation * 100)}%${v.vassals ? ` (вассалов ${v.vassals})` : ''}</td>
          <td>${v.science}/${PROJECT_STAGES}</td><td>${v.culture}/${PROJECT_STAGES}</td></tr>`;
      })
      .join('');
    const winner = state.winner;
    return `<h3>Победы</h3>
      ${winner ? `<div class="good">Победа: ${esc(state.powers[winner.power].name)} — ${esc(victoryName(winner.kind))} (ход ${winner.turn})</div>` : ''}
      <table class="victory"><tr><th></th><th title="Больше половины исходных столиц">Столицы</th><th title="Вы и вассалы — ${fed.federationShare * 100}% уровней городов мира, нужен хотя бы ${fed.federationMinVassals} вассал">Федерация</th><th>Наука</th><th>Культура</th></tr>${rows}</table>`;
  }

  private wondersBlock(): string {
    const { state, power } = this.host;
    const explored = state.powers[power].explored;
    const rows = buildings
      .filter((b) => b.wonder)
      .map((b) => {
        const city = wonderCity(state, b.id);
        const where = city ? (explored[city.tile] ? `${city.name} (${state.powers[city.owner].name})` : 'построено где-то в мире') : 'свободно';
        return `<div class="row"><span>${esc(b.name)} <span class="muted small">с эпохи «${esc(epochName(b.epoch ?? 0))}», ${b.basePrice} ${icon('gold')}</span></span><span>${esc(where)}</span></div>`;
      })
      .join('');
    return `<h3>Чудеса света</h3><div class="muted small">Одно на весь мир; в городе с мрамором на ${pathsConfig.culture.wonderMarbleDiscount * 100}% дешевле.</div>${rows}`;
  }
}
