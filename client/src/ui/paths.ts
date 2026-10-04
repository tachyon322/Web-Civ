// Окно «Пути»: эпоха, стабильность с разбивкой, способности державы, финальные проекты,
// ход к победам у всех известных держав и чудеса света.

import {
  LAST_EPOCH,
  NONE,
  NO_TARGET,
  PROJECT_STAGES,
  abilityBlocker,
  abilityCost,
  buildings,
  computeStability,
  epochName,
  epochOf,
  findCity,
  foreignInfluence,
  hegemonyLeft,
  hegemonyNeeded,
  hegemonOf,
  hegemonyOver,
  influenceOf,
  nationTrait,
  buildingPrice,
  nextEpochScience,
  pathsConfig,
  projectCity,
  projectCooldown,
  turnsWord,
  projectName,
  stabilityLevel,
  victoryName,
  victoryProgress,
  wonderCity,
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
  moderation: 'в панели своего города',
  sabotage: 'в панели чужого города',
  convert: 'в панели вражеского юнита',
  tour: 'в окне дипломатии',
  incite: 'в окне дипломатии',
};

const DESCRIPTIONS: Record<AbilityId, string> = {
  recon: `${pathsConfig.abilities.recon.turns} ходов видны все юниты выбранной державы`,
  moderation: `свой город ${pathsConfig.abilities.moderation.turns} ходов не поддаётся культурному давлению и мятежам; на бой не влияет`,
  sabotage: `в чужом городе ${pathsConfig.abilities.sabotage.turns} ходов не работают храмы, театры, оперы и музеи`,
  deanon: 'раскрывает все нераскрытые подстрекательства против вас и ваших союзников',
  jammer: `${pathsConfig.abilities.jammer.turns} ходов никто не может применять к державе гастроли и подстрекательство; здесь — на себя, на другую державу — в окне дипломатии`,
  callPeace: 'мировое мнение требует от агрессора мира; отказ испортит ему отношения со всеми',
  propaganda: `стабильность врага ${pathsConfig.stability.propaganda} на ${pathsConfig.abilities.propaganda.turns} ходов`,
  convert: 'вражеский юнит у вашей границы переходит к вам',
  holiday: `+${pathsConfig.abilities.holiday.stability} к стабильности на ${pathsConfig.abilities.holiday.turns} ходов`,
  incite: `натравить бота на другую державу: обида и ниже порог войны на ${pathsConfig.abilities.incite.turns} ходов; нужно влияние на него от ${pathsConfig.abilities.incite.minInfluence}%, полная сила — от ${pathsConfig.abilities.incite.fullInfluence}%`,
  tour: `+${pathsConfig.abilities.tour.gain}% вашего влияния на выбранную державу; цена — ${pathsConfig.abilities.tour.incomeTurns} хода её дохода культуры; повторные в ту же страну слабее`,
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
    const intro = `<div class="intro">Армия бьёт науку: у учёных нет боевых бонусов. Сила армии падает, если в державе неспокойно.</div>`;
    const epoch = this.card(
      `Эпоха: ${esc(epochName(epochOf(p)))}`,
      `<ul class="facts">
        <li>Ход юнитов: <b>+${cfg.mpPerEpoch}</b> за эпоху</li>
        <li>Города без штрафа к стабильности: <b>+${cfg.freeCitiesPerEpoch}</b> за эпоху</li>
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
        ? `Наука открывает эпохи и гасит чужую культуру: цифровой занавес режет чужое влияние, давление и утечку мозгов (до −${Math.round(pathsConfig.curtain.max * 100)}%), когда ваша наука выше их культуры. Она же — счёт к научной победе.`
        : 'Культура защищает от пропаганды и переманивания, даёт влияние на народы и способности. Победа культуры — гегемония над большинством держав.';
    const left =
      kind === 'science'
        ? this.epochCard(p) + this.projectCard('science')
        : this.influenceCard() + this.wondersBlock();
    const abilities = ids.map((id) => this.abilityCard(id)).join('');
    const spend = kind === 'science' ? ' <span class="muted">Каждая трата откладывает Великий проект.</span>' : '';
    return `<div class="intro">${intro}${spend}</div>
      <div class="grid2"><div>${this.card('Способности', abilities, `У вас ${icon(kind)} ${p[kind]}`)}</div><div>${left}</div></div>`;
  }

  /** Ваше влияние на встреченные державы и чьё влияние на вас. */
  private influenceCard(): string {
    const { state, power } = this.host;
    const me = state.powers[power];
    const rows = me.met
      .filter((id) => state.powers[id].alive)
      .map((id) => ({ id, share: influenceOf(state, id, power), hegemon: hegemonOf(state, id) }))
      .sort((a, b) => b.share - a.share || a.id - b.id)
      .map(({ id, share, hegemon }) => {
        const pt = state.powers[id];
        const who = hegemon === power ? ' <span class="good">гегемон</span>' : hegemon !== NONE ? ` <span class="muted">(гегемон — ${esc(state.powers[hegemon].name)})</span>` : '';
        return `<div class="row"><span>${flagFor(pt.nationId, pt.color)}${esc(pt.name)}</span><span>${Math.round(share)}%${who}</span></div>`;
      })
      .join('');
    const over = hegemonyOver(state, power).length;
    const need = hegemonyNeeded(state);
    const left = hegemonyLeft(state, power);
    const mine = hegemonOf(state, power);
    const foreign = Math.round(foreignInfluence(state, power));
    return this.card(
      `Влияние на народы`,
      `${rows || '<div class="muted small">Вы ещё ни с кем не встречались.</div>'}
       <div class="row"><span>Вы гегемон для</span><span class="${over >= need ? 'good' : ''}">${over} из ${need} нужных</span></div>
       ${left !== null ? `<div class="row"><span>Культурная победа</span><span class="good">через ${left} ${turnsWord(left)}</span></div>` : ''}
       <div class="row"><span>Чужое влияние на вас</span><span>${foreign}%${mine !== NONE ? ` · гегемон — ${esc(state.powers[mine].name)}` : ''}</span></div>
       <div class="muted small">Больше ${pathsConfig.influence.hegemonShare}% — гегемон: к вам лучше относятся, войну вам объявить — минус стабильность. Растёт от торговли, общей границы, чудес и гастролей. Культурная победа — быть гегемоном для ${need} держав и удержать это ${pathsConfig.victory.hegemonyTurns} ходов подряд.</div>`,
    );
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
    const use = { ...NO_TARGET, ability: id, target: id === 'jammer' ? power : NONE };
    const cost =
      id === 'convert'
        ? `${pathsConfig.abilities.convert.costPerPerson} за человека`
        : id === 'tour'
          ? `от ${pathsConfig.abilities.tour.minCost}`
          : id === 'incite'
            ? `от ${Math.round(pathsConfig.abilities.incite.cost * pathsConfig.abilities.incite.sizeMin)}`
          : String(abilityCost(state, power, use));
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

  private projectCard(kind: 'science'): string {
    const { state, power } = this.host;
    const p = state.powers[power];
    const cfg = pathsConfig.projects;
    const city = projectCity(state, power, kind);
    const stages = city?.project?.stages ?? 0;
    const ok = epochOf(p) >= LAST_EPOCH;
    const cond = `дойти до эпохи «${esc(epochName(LAST_EPOCH))}»`;
    const cooldown = cfg[kind].cooldown;
    const wait = city ? projectCooldown(state, city, kind) : 0;
    const pips = Array.from({ length: PROJECT_STAGES }, (_, i) => `<i class="${i < stages ? 'on' : ''}"></i>`).join('');
    return this.card(
      esc(projectName(kind)),
      `<div class="pips">${pips}<span>${stages}/${PROJECT_STAGES}${city ? ` · ${esc(city.name)}` : ''}</span></div>
       <div class="row"><span>Условие</span><span class="${ok ? 'good' : 'bad'}">${ok ? '✓' : '✗'} ${cond}</span></div>
       <div class="row"><span>Цена этапов</span><span>${cfg[kind].stages.join(' / ')} ${icon(kind)}</span></div>
       ${cooldown ? `<div class="row"><span>Между этапами</span><span>${wait > 0 ? `ещё ${wait} ${turnsWord(wait)}` : `${cooldown} ${turnsWord(cooldown)}`}</span></div>` : ''}
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
          <td>${v.science}/${PROJECT_STAGES}</td><td>${v.hegemony}/${v.hegemonyNeeded}${v.hegemonyLeft !== null ? ` · ${v.hegemonyLeft} х.` : ''}</td></tr>`;
      })
      .join('');
    const winner = state.winner;
    return `<div class="intro">Победить можно четырьмя способами. Ваши цифры и цифры известных вам держав:</div>${this.card('Прогресс к победам', `
      ${winner ? `<div class="good">Победа: ${esc(state.powers[winner.power].name)} — ${esc(victoryName(winner.kind))} (ход ${winner.turn})</div>` : ''}
      <table class="victory"><tr><th></th><th title="Больше половины исходных столиц">Столицы</th><th title="Вы и вассалы — ${fed.federationShare * 100}% уровней городов мира, нужен хотя бы ${fed.federationMinVassals} вассал">Федерация</th><th title="Этапы Великого проекта">Наука</th><th title="Гегемон для скольких держав из нужных; при отсчёте — сколько ходов до победы">Культура</th></tr>${rows}</table>`)}`;
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
