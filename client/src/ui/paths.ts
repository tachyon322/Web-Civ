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
  buildingPrice,
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
import { flagFor } from './flags';

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

type Tab = 'army' | 'science' | 'culture' | 'victory';

export class PathsWindow {
  private tab: Tab = 'army';
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
    const tab = el.closest<HTMLElement>('[data-tab]');
    if (tab) {
      this.tab = tab.dataset.tab as Tab;
      this.render();
      return;
    }
    const btn = el.closest<HTMLButtonElement>('button[data-i]');
    if (!btn || btn.disabled) return;
    if (this.host.dispatch(this.actions[Number(btn.dataset.i)])) this.render();
  }

  private render(): void {
    if (!this.root) return;
    this.actions = [];
    const p = this.host.state.powers[this.host.power];
    const tabs: [Tab, string, string][] = [
      ['army', 'Армия', 'paths'],
      ['science', 'Наука', 'science'],
      ['culture', 'Культура', 'culture'],
      ['victory', 'Победы', 'paths'],
    ];
    const body = { army: () => this.armyTab(), science: () => this.pathTab('science'), culture: () => this.pathTab('culture'), victory: () => this.victoryBlock() }[this.tab]();
    this.root.innerHTML = `
      <div class="panel modal diplo paths">
        <div class="diplo-head"><h1>Пути развития</h1>
          <span class="purse">${icon('science')} ${p.science} &nbsp; ${icon('culture')} ${p.culture}</span>
          <button class="close" title="Закрыть (Esc)">✕</button></div>
        <div class="tabs">${tabs
          .map(([id, name, ic]) => `<button class="tab ${id === this.tab ? 'active' : ''}" data-tab="${id}">${icon(ic as 'science')} ${name}</button>`)
          .join('')}</div>
        <div class="tab-body">${body}</div>
      </div>`;
  }

  private card(title: string, inner: string, hint = ''): string {
    return `<section class="card"><h3>${title}</h3>${hint ? `<div class="muted small hint">${hint}</div>` : ''}${inner}</section>`;
  }

  private armyTab(): string {
    const cfg = pathsConfig.epoch;
    const p = this.host.state.powers[this.host.power];
    const trait = nationTrait(this.host.state, this.host.power);
    const intro = `<div class="intro">Сила армии растёт с эпохой (её двигает наука) и падает, если в державе неспокойно.</div>`;
    const epoch = this.card(
      `Эпоха: ${esc(epochName(epochOf(p)))}`,
      `<ul class="facts">
        <li>Юниты: <b>×${1 + cfg.strengthPerEpoch}</b> к силе за каждую эпоху</li>
        <li>Ход юнитов: <b>+${cfg.mpPerEpoch}</b> за эпоху</li>
        <li>Города без штрафа к стабильности: <b>+${cfg.freeCitiesPerEpoch}</b> за эпоху</li>
        <li>Технологический разрыв: наука в ${pathsConfig.techGap.minRatio}+ раза больше, чем у врага, даёт до <b>+${pathsConfig.techGap.max * 100}%</b> в бою с ним</li>
      </ul>`,
    );
    const nation = this.card(`Черта нации — ${esc(trait.name)}`, `<div>${esc(trait.description)}</div>`);
    return `${intro}<div class="grid2"><div>${epoch}${nation}</div><div>${this.stabilityBlock()}</div></div>`;
  }

  private pathTab(kind: 'science' | 'culture'): string {
    const { state, power } = this.host;
    const p = state.powers[power];
    const ids = (Object.keys(pathsConfig.abilities) as AbilityId[]).filter((id) => pathsConfig.abilities[id].path === kind);
    const intro =
      kind === 'science'
        ? 'Наука открывает эпохи, даёт щит от чужой разведки и способности против врагов. Она же — счёт к научной победе.'
        : 'Культура защищает от пропаганды и переманивания и даёт способности влияния. Она же — счёт к культурной победе.';
    const left =
      kind === 'science'
        ? this.epochCard(p) + this.projectCard('science')
        : this.projectCard('culture') + this.wondersBlock();
    const abilities = ids.map((id) => this.abilityCard(id)).join('');
    return `<div class="intro">${intro} <span class="muted">Каждая трата откладывает финальный проект.</span></div>
      <div class="grid2"><div>${this.card('Способности', abilities, `У вас ${icon(kind)} ${p[kind]}`)}</div><div>${left}</div></div>`;
  }

  private epochCard(p: GameState['powers'][number]): string {
    const e = epochOf(p);
    const next = nextEpochScience(p);
    const pct = next ? Math.min(100, (p.scienceTotal / next) * 100) : 100;
    return this.card(
      `Эпоха: ${esc(epochName(e))}`,
      `<div class="bar"><div style="width:${pct}%"></div></div>
       <div class="row"><span>Заработано науки</span><span>${p.scienceTotal}${next ? ` / ${next}` : ''}</span></div>
       <div class="muted small">${next ? `Следующая эпоха — «${esc(epochName(e + 1))}». ` : 'Последняя эпоха. '}Трата науки эпоху не отнимает.</div>`,
    );
  }

  private abilityCard(id: AbilityId): string {
    const { state, power } = this.host;
    const def = pathsConfig.abilities[id];
    const use = { ...NO_TARGET, ability: id };
    const cost = id === 'convert' ? `${pathsConfig.abilities.convert.costPerPerson} за человека` : String(abilityCost(state, power, use));
    let action = `<span class="where">${esc(WHERE[id] ?? '')}</span>`;
    if (!WHERE[id]) {
      const blocker = abilityBlocker(state, power, use);
      const i = this.actions.push({ type: 'UseAbility', power, ...use }) - 1;
      action = `<button data-i="${i}" ${blocker ? 'disabled' : ''} title="${esc(blocker ?? '')}">Применить</button>`;
      if (blocker) action += `<div class="reason">${esc(blocker)}</div>`;
    }
    return `<div class="ability"><div class="a-main"><div><b>${esc(def.name)}</b> <span class="cost">${icon(def.path === 'science' ? 'science' : 'culture')} ${esc(cost)}</span></div>
      <div class="muted small">${esc(DESCRIPTIONS[id])}</div></div><div class="a-act">${action}</div></div>`;
  }

  private projectCard(kind: 'science' | 'culture'): string {
    const { state, power } = this.host;
    const p = state.powers[power];
    const cfg = pathsConfig.projects;
    const city = projectCity(state, power, kind);
    const stages = city?.project?.stages ?? 0;
    const ok = kind === 'science' ? epochOf(p) >= LAST_EPOCH : wondersOwned(state, power) >= cfg.culture.wonders;
    const cond =
      kind === 'science'
        ? `дойти до эпохи «${esc(epochName(LAST_EPOCH))}»`
        : `владеть ${cfg.culture.wonders} чудесами света (сейчас ${wondersOwned(state, power)})`;
    const pips = Array.from({ length: PROJECT_STAGES }, (_, i) => `<i class="${i < stages ? 'on' : ''}"></i>`).join('');
    return this.card(
      esc(projectName(kind)),
      `<div class="pips">${pips}<span>${stages}/${PROJECT_STAGES}${city ? ` · ${esc(city.name)}` : ''}</span></div>
       <div class="row"><span>Условие</span><span class="${ok ? 'good' : 'bad'}">${ok ? '✓' : '✗'} ${cond}</span></div>
       <div class="row"><span>Цена этапов</span><span>${cfg[kind].stages.join(' / ')} ${icon(kind)}</span></div>
       <div class="muted small">Этап покупается в панели города, одна покупка за ход. Захватят город — прогресс сгорит.</div>`,
    );
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
    return this.card(`Стабильность: ${b.total} — ${esc(level.name)}`, `${warning ? `<div class="reason">${esc(warning.name)} отделится через ${Math.max(0, p.secession!.due - state.turn)} х., если стабильность не поднимется до ${pathsConfig.stability.secessionBelow}</div>` : ''}
      <div class="breakdown">${rows}</div>
      <div class="levels small">${levels}</div>`, 'Из чего сложилась и что она даёт.');
  }

  private victoryBlock(): string {
    const { state, power } = this.host;
    const me = state.powers[power];
    const known = state.powers.filter((p) => p.alive && (p.id === power || me.met.includes(p.id)));
    const fed = pathsConfig.victory;
    const rows = known
      .map((p) => {
        const v = victoryProgress(state, p.id);
        return `<tr><td>${flagFor(p.nationId, p.color)}${esc(p.name)}</td>
          <td>${v.capitals}/${v.capitalsNeeded}</td>
          <td>${Math.round(v.federation * 100)}%${v.vassals ? ` (вассалов ${v.vassals})` : ''}</td>
          <td>${v.science}/${PROJECT_STAGES}</td><td>${v.culture}/${PROJECT_STAGES}</td></tr>`;
      })
      .join('');
    const winner = state.winner;
    return `<div class="intro">Победить можно четырьмя способами. Ваши цифры и цифры известных вам держав:</div>${this.card('Прогресс к победам', `
      ${winner ? `<div class="good">Победа: ${esc(state.powers[winner.power].name)} — ${esc(victoryName(winner.kind))} (ход ${winner.turn})</div>` : ''}
      <table class="victory"><tr><th></th><th title="Больше половины исходных столиц">Столицы</th><th title="Вы и вассалы — ${fed.federationShare * 100}% уровней городов мира, нужен хотя бы ${fed.federationMinVassals} вассал">Федерация</th><th>Наука</th><th>Культура</th></tr>${rows}</table>`)}`;
  }

  private wondersBlock(): string {
    const { state, power } = this.host;
    const explored = state.powers[power].explored;
    const rows = buildings
      .filter((b) => b.wonder)
      .map((b) => {
        const city = wonderCity(state, b.id);
        const where = city ? (explored[city.tile] ? `${city.name} (${state.powers[city.owner].name})` : 'построено где-то в мире') : 'свободно';
        const price = `${buildingPrice(state, power, b.id)} ${icon('gold')}`;
        return `<div class="row"><span>${esc(b.name)} <span class="muted small">с эпохи «${esc(epochName(b.epoch ?? 0))}», ${price}</span></span><span>${esc(where)}</span></div>`;
      })
      .join('');
    return this.card('Чудеса света', rows, `Одно на весь мир, слот не занимает; в городе с мрамором на ${pathsConfig.culture.wonderMarbleDiscount * 100}% дешевле.`);
  }
}
