// Окно дипломатии: встреченные державы, их отношение к игроку с разбивкой, статус, сила,
// предложения от ботов и все дипломатические действия с прогнозом ответа.
// Прогноз считается той же функцией ядра, что и ответ бота, — поэтому они не расходятся.

import {
  NO_TARGET,
  NO_TERMS,
  abilityCost,
  allied,
  pathsConfig,
  accepts,
  atWar,
  characterDef,
  nationTrait,
  citiesOf,
  cultureIncomes,
  dealBlocker,
  dealText,
  deterrenceIndex,
  diplomacyConfig,
  evaluateDeal,
  findPact,
  giftForecast,
  grossGold,
  hasPact,
  hegemonOf,
  inciteBlocker,
  inciteStrength,
  influenceGain,
  influenceOf,
  opinion,
  tourGain,
  pendingProposals,
  refusalText,
  shortfallHint,
  truceLeft,
  turnsWord,
  validate,
  warSides,
  warTurns,
  type Breakdown,
  type Command,
  type Deal,
  type GameState,
  type PeaceTerms,
  type Proposal,
} from '../core';
import { NONE } from '../core/types';
import { inciteForecast } from '../ai/incite';
import { esc, showChoice } from './dialog';
import { escIcons, icon } from './icons';
import { flagFor } from './flags';

export interface DiplomacyHost {
  readonly state: GameState;
  readonly power: number;
  /** Выполняет команду игрока; false — отказ (причина уже показана). */
  dispatch(cmd: Command): boolean;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

function roundGold(x: number): number {
  return Math.max(5, Math.round(x / 5) * 5);
}

function breakdownLines(b: Breakdown): string {
  if (!b.items.length) return '<div class="muted">Ничего особенного</div>';
  return b.items
    .map((i) => `<div class="row"><span>${esc(i.label)}</span><span class="${i.value >= 0 ? 'good' : 'bad'}">${signed(i.value)}</span></div>`)
    .join('');
}

/** Статус пары словами. */
export function statusText(state: GameState, me: number, t: number): string {
  if (atWar(state, me, t)) {
    const n = warTurns(state, me, t);
    return `Война (${n} ${turnsWord(n)})`;
  }
  if (state.powers[me].suzerain === t) return 'Ваш сюзерен';
  if (state.powers[t].suzerain === me) return 'Ваш вассал';
  const parts: string[] = [];
  const alliance = findPact(state, me, t, 'alliance');
  if (alliance) parts.push(`Союз (${state.turn - alliance.since} ${turnsWord(state.turn - alliance.since)})`);
  if (hasPact(state, me, t, 'trade')) parts.push('Торговый договор');
  const truce = truceLeft(state, me, t);
  if (truce) parts.push(`Перемирие ещё ${truce} ${turnsWord(truce)}`);
  return parts.join(', ') || 'Нейтралитет';
}

export class DiplomacyWindow {
  private root: HTMLElement | null = null;
  private target = NONE;
  private peace: PeaceTerms = { ...NO_TERMS };
  private joinGold = 0;
  private giftGold = 50;
  /** Команды кнопок текущей отрисовки: data-i — индекс. */
  private actions: { cmd?: Command; confirm?: () => void }[] = [];
  private onKey = (e: KeyboardEvent) => {
    const backdrops = document.querySelectorAll('.modal-backdrop');
    // Поверх окна может быть подтверждение — тогда Esc закрывает его, а не окно.
    if (e.key !== 'Escape' || !this.root || backdrops[backdrops.length - 1] !== this.root) return;
    e.stopPropagation();
    this.close();
  };

  constructor(
    private host: DiplomacyHost,
    private onClose: () => void,
  ) {}

  get isOpen(): boolean {
    return this.root !== null;
  }

  open(target = NONE): void {
    const met = this.metPowers();
    const pending = pendingProposals(this.host.state, this.host.power)[0];
    this.target = target !== NONE ? target : (pending?.from ?? (met.includes(this.target) ? this.target : (met[0] ?? NONE)));
    this.resetBuilders();
    if (!this.root) {
      this.root = document.createElement('div');
      this.root.className = 'modal-backdrop';
      this.root.addEventListener('click', (e) => this.onClick(e));
      this.root.addEventListener('change', (e) => this.onChange(e));
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

  /** Перерисовка, если окно открыто (после хода или чужих изменений). */
  update(): void {
    if (this.root) this.render();
  }

  private resetBuilders(): void {
    this.peace = { ...NO_TERMS };
    this.joinGold = 0;
  }

  private metPowers(): number[] {
    const { state, power } = this.host;
    return state.powers[power].met.filter((p) => state.powers[p].alive).sort((a, b) => a - b);
  }

  // ---------- События ----------

  private onClick(e: MouseEvent): void {
    const el = e.target as HTMLElement;
    if (el === this.root || el.closest('.close')) {
      this.close();
      return;
    }
    const pick = el.closest<HTMLElement>('[data-target]');
    if (pick) {
      this.target = Number(pick.dataset.target);
      this.resetBuilders();
      this.render();
      return;
    }
    const btn = el.closest<HTMLButtonElement>('button[data-i]');
    if (!btn || btn.disabled) return;
    const action = this.actions[Number(btn.dataset.i)];
    if (action.confirm) {
      action.confirm();
      return;
    }
    if (action.cmd) this.run(action.cmd);
  }

  private run(cmd: Command): void {
    if (this.host.dispatch(cmd)) {
      if (cmd.type === 'Propose' && cmd.deal.kind === 'peace') this.resetBuilders();
      this.render();
    }
  }

  private onChange(e: Event): void {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const field = el.dataset.field;
    if (!field) return;
    const { power } = this.host;
    if (field === 'vassalMe' || field === 'vassalThem') {
      const on = (el as HTMLInputElement).checked;
      this.peace.vassal = on ? (field === 'vassalMe' ? power : this.target) : NONE;
    } else {
      const v = Math.max(0, Math.floor(Number(el.value)) || 0);
      if (field === 'joinGold') this.joinGold = v;
      else if (field === 'giftGold') this.giftGold = v;
      else (this.peace as unknown as Record<string, number>)[field] = v;
    }
    this.render();
  }

  // ---------- Отрисовка ----------

  private button(label: string, cmd: Command, opts: { blocker?: string | null; confirm?: () => void; cls?: string } = {}): string {
    const v = validate(this.host.state, cmd);
    const reason = opts.blocker ?? (v.ok ? null : v.reason);
    const i = this.actions.push({ cmd, confirm: opts.confirm }) - 1;
    return `<button data-i="${i}" class="${opts.cls ?? ''}" ${reason ? 'disabled' : ''} title="${esc(reason ?? '')}">${escIcons(label)}</button>`;
  }

  /** Применяет подсказку «чего не хватает»: подставляет сумму в форму. */
  private applyHint(deal: Deal): void {
    if (deal.kind === 'peace') this.peace = { ...deal.terms };
    else if (deal.kind === 'joinWar') this.joinGold = deal.gold;
    this.render();
  }

  /** Прогноз ответа бота на сделку: «согласятся» или «Нет: …» с разбивкой во всплывающей подсказке и подсказкой, чего не хватает. */
  private forecast(deal: Deal, to = this.target): { ok: boolean; html: string } {
    const { state, power } = this.host;
    const blocker = dealBlocker(state, power, to, deal);
    if (blocker) return { ok: false, html: `<div class="reason">${esc(blocker)}</div>` };
    const score = evaluateDeal(state, power, to, deal);
    const tip = score.items.map((i) => `${i.label}: ${signed(i.value)}`).join('\n') + `\nИтого: ${signed(score.total)}`;
    if (accepts(score)) return { ok: true, html: `<div class="good small" title="${esc(tip)}">✓ согласятся (счёт ${signed(score.total)})</div>` };
    let html = `<div class="reason" title="${esc(tip)}">${esc(refusalText(state, power, to, score))}</div>`;
    const hint = shortfallHint(state, power, to, deal);
    if (hint) {
      const i = this.actions.push({ confirm: () => this.applyHint(hint.deal) }) - 1;
      html += `<div class="hint small">${esc(hint.text)} <button data-i="${i}" class="link">Подставить</button></div>`;
    }
    return { ok: false, html };
  }

  private render(): void {
    if (!this.root) return;
    this.actions = [];
    const { state, power } = this.host;
    const met = this.metPowers();
    const pending = pendingProposals(state, power);
    const list = met
      .map((p) => {
        const pw = state.powers[p];
        const op = opinion(state, p, power).total;
        const badge = pending.some((pr) => pr.from === p) ? ` ${icon('proposal')}` : '';
        return `<li data-target="${p}" class="${p === this.target ? 'selected' : ''}">
          ${flagFor(pw.nationId, pw.color)}
          <span class="name">${esc(pw.name)}${badge}</span>
          <span class="op ${op >= 0 ? 'good' : 'bad'}">${signed(op)}</span>
          <span class="status">${esc(statusText(state, power, p))}</span>
        </li>`;
      })
      .join('');
    this.root.innerHTML = `
      <div class="panel modal diplo">
        <div class="diplo-head"><h1>Дипломатия</h1><button class="close" title="Закрыть (Esc)">✕</button></div>
        ${
          met.length
            ? `<div class="diplo-body"><ul class="powers">${list}</ul><div class="detail">${this.detail()}</div></div>`
            : '<p class="muted">Вы ещё ни с кем не встречались. Дипломатия с державой открывается после встречи на карте.</p>'
        }
      </div>`;
  }

  private detail(): string {
    const { state, power } = this.host;
    const t = this.target;
    if (t === NONE || !state.powers[t]?.alive) return '<p class="muted">Выберите державу слева.</p>';
    const pt = state.powers[t];
    const me = state.powers[power];
    const op = opinion(state, t, power);
    const deterrence = deterrenceIndex(state, t);
    const character = pt.character ? characterDef(pt.character) : null;
    let html = `<h2>${flagFor(pt.nationId, pt.color)}${esc(pt.name)}</h2>
      <div class="sub">${character ? `${esc(character.name)} — ${esc(character.description)}` : 'игрок'}</div>
      <div class="row"><span>Черта нации</span><span title="${esc(nationTrait(state, t).description)}">${esc(nationTrait(state, t).name)}: ${esc(nationTrait(state, t).description)}</span></div>
      <div class="row"><span>Статус</span><span>${esc(statusText(state, power, t))}</span></div>`;
    if (pt.suzerain !== NONE && pt.suzerain !== power) {
      html += `<div class="row"><span>Сюзерен</span><span>${esc(state.powers[pt.suzerain].name)}</span></div>`;
    }
    const wars = pt.wars.map((w) => state.powers[w].name);
    if (wars.length) html += `<div class="row"><span>Воюет с</span><span>${esc(wars.join(', '))}</span></div>`;
    html += `<div class="row" title="${esc(deterrence.items.map((i) => `${i.label}: ${i.value}`).join('\n'))}"><span>Индекс сдерживания</span><span>${deterrence.total} (ваш ${deterrenceIndex(state, power).total})</span></div>
      <div class="row" title="По нему оцениваются подарки: ценность — в ходах дохода получателя"><span>Доход золота</span><span>${grossGold(state, t)} за ход</span></div>
      ${this.influenceRows()}
      <h3>Их отношение к вам: <span class="${op.total >= 0 ? 'good' : 'bad'}">${signed(op.total)}</span></h3>
      <div class="breakdown">${breakdownLines(op)}</div>`;

    const proposals = pendingProposals(state, power).filter((pr) => pr.from === t);
    if (proposals.length) html += `<h3>Предложения вам</h3>${proposals.map((pr) => this.proposalBlock(pr)).join('')}`;

    if (atWar(state, power, t)) {
      html += this.peaceBlock();
      html += this.helpBlock(t);
    } else {
      html += this.giftsBlock();
      html += this.pactsBlock();
      html += this.joinWarBlock();
      html += this.tributeBlock();
    }
    html += this.abilitiesBlock();
    html += this.inciteBlock();
    if (!atWar(state, power, t) && me.suzerain === NONE && pt.suzerain !== power && me.suzerain !== t) {
      html += `<h3>Война</h3><div class="actions">${this.button(`Объявить войну: ${pt.name}`, { type: 'DeclareWar', power, target: t }, {
        confirm: () => this.confirmWar(t),
        cls: 'danger',
      })}</div>`;
    }
    return html;
  }

  /** Влияние на народы: ваше на них (с приростом за ход), их гегемон, их влияние на вас. */
  private influenceRows(): string {
    const { state, power } = this.host;
    const t = this.target;
    const gain = influenceGain(state, power, t, cultureIncomes(state));
    const tip = gain.items.length
      ? [...gain.items.map((i) => `${i.label}: +${i.value}`), `× ${gain.ratio} — соотношение доходов культуры`, ...(gain.curtain ? [`−${Math.round(gain.curtain * 100)}% — их цифровой занавес`] : [])].join('\n')
      : 'Прироста нет: нужны доход культуры и торговый договор, общая граница или чудеса; во время войны влияние не растёт';
    const hegemon = hegemonOf(state, t);
    const hegemonText = hegemon === NONE ? 'нет' : hegemon === power ? 'вы' : state.powers[hegemon].name;
    const theirs = Math.round(influenceOf(state, power, t));
    return `<div class="row" title="${esc(tip)}"><span>Ваше влияние на них</span><span>${Math.round(influenceOf(state, t, power))}%${gain.total ? ` (+${gain.total} за ход)` : ''}</span></div>
      <div class="row"><span>Их культурный гегемон</span><span class="${hegemon === power ? 'good' : ''}">${esc(hegemonText)}</span></div>
      ${theirs ? `<div class="row"><span>Их влияние на вас</span><span>${theirs}%</span></div>` : ''}`;
  }

  /** Способности против этой державы: разведка, пропаганда, призыв к миру, гастроли. */
  private abilitiesBlock(): string {
    const { state, power } = this.host;
    const t = this.target;
    const a = pathsConfig.abilities;
    const use = (ability: 'recon' | 'propaganda' | 'callPeace' | 'tour' | 'jammer', victim = NONE) => ({ ...NO_TARGET, ability, target: t, victim });
    const row = (label: string, u: ReturnType<typeof use>, note: string) => {
      const res = a[u.ability].path === 'science' ? '🔬' : '🎭';
      return `<div class="deal">${this.button(`${label} (${abilityCost(state, power, u)} ${res})`, { type: 'UseAbility', power, ...u })}<div class="muted small">${esc(note)}</div></div>`;
    };
    let html = '<h3>Способности</h3>';
    html += row('Разведка', use('recon'), `${a.recon.turns} ходов видны все их юниты`);
    html += row('Глушилка', use('jammer'), `${a.jammer.turns} ходов никто не может применять к ним гастроли и подстрекательство`);
    if (!atWar(state, power, t)) {
      html += row('Гастроли', use('tour'), `ваше влияние на них +${tourGain(state, power, t)}%; повторные в течение ${a.tour.repeatWindow} ходов слабее`);
    }
    if (!allied(state, power, t)) html += row('Пропаганда', use('propaganda'), `их стабильность ${pathsConfig.stability.propaganda} на ${a.propaganda.turns} ходов; они это запомнят`);
    // Призыв к миру — против войн, которые начала эта держава.
    for (const v of state.powers[t].wars) {
      if (findPact(state, t, v, 'war')?.by !== t) continue;
      html += row(`Призыв к миру с державой ${state.powers[v].name}`, use('callPeace', v), 'откажутся — испортят отношения со всеми');
    }
    return html;
  }

  /** Подстрекательство: натравить эту державу (бота) на другую. Применить можно только при положительном прогнозе. */
  private inciteBlock(): string {
    const { state, power } = this.host;
    const t = this.target;
    const pt = state.powers[t];
    if (pt.isHuman) return '';
    const cfg = pathsConfig.abilities.incite;
    const victims = state.powers.filter((v) => v.alive && v.id !== t && v.id !== power && state.powers[power].met.includes(v.id) && pt.met.includes(v.id));
    const strength = inciteStrength(state, power, t);
    let html = `<h3>Подстрекательство</h3><div class="muted small">Обида на цель и порог войны ниже на ${cfg.turns} ходов. Нужно влияние на них от ${cfg.minInfluence}%, полная сила — от ${cfg.fullInfluence}%${strength ? ` (сейчас сила ${Math.round(strength * 100)}%)` : ''}. Если культура цели выше вашей — она узнает, кто это сделал.</div>`;
    if (!victims.length) return html + '<div class="muted small">Им не на кого: общих знакомых нет.</div>';
    for (const v of victims) {
      const use = { ...NO_TARGET, ability: 'incite' as const, target: t, victim: v.id };
      const rule = inciteBlocker(state, power, t, v.id);
      const f = rule ? null : inciteForecast(state, power, t, v.id);
      const blocker = rule ?? (f && !f.ok ? 'Прогноз: ничего не изменится' : null);
      const note = rule ?? `${f!.text}.${f!.exposed ? ` ${v.name} узнает, что это вы.` : ' Никто не узнает.'}`;
      html += `<div class="deal">${this.button(`Натравить на державу ${v.name} (${abilityCost(state, power, use)} 🎭)`, { type: 'UseAbility', power, ...use }, { blocker })}<div class="muted small ${f?.ok ? 'good' : ''}">${esc(note)}</div></div>`;
    }
    return html;
  }

  private proposalBlock(pr: Proposal): string {
    const { state, power } = this.host;
    let note = '';
    if (pr.deal.kind === 'tribute') note = `Отказ испортит отношения (${diplomacyConfig.events.tributeRefused}); дань тоже оставит обиду.`;
    if (pr.deal.kind === 'joinWar') note = 'Если согласитесь, вы объявите войну — с её последствиями.';
    if (pr.deal.kind === 'peace' && pr.deal.terms.vassal === power) note = 'Вассал платит 20% дохода, воюет на стороне сюзерена и не заключает союзов.';
    const fresh = pr.turn === state.turn - 1 || pr.turn === state.turn;
    return `<div class="proposal">
      <div><b>${esc(dealText(state, pr.from, power, pr.deal))}</b>${fresh ? '' : ' <span class="muted">(истекает в этом ходу)</span>'}</div>
      ${note ? `<div class="muted small">${esc(note)}</div>` : ''}
      <div class="actions two">
        ${this.button('Принять', { type: 'Respond', power, proposalId: pr.id, accept: true }, { cls: 'ok' })}
        ${this.button('Отклонить', { type: 'Respond', power, proposalId: pr.id, accept: false })}
      </div>
    </div>`;
  }

  private giftsBlock(): string {
    const { state, power } = this.host;
    const t = this.target;
    const me = state.powers[power];
    const gold = [25, 50, 100, 250].filter((g, i) => i === 0 || g <= me.gold);
    const culture = [10, 25, 50].filter((c, i) => i === 0 || c <= me.culture);
    const giftBtn = (amount: number, resource: 'gold' | 'culture') => {
      const f = giftForecast(state, power, t, amount, resource);
      const cmd: Command =
        resource === 'gold' ? { type: 'Gift', power, target: t, gold: amount } : { type: 'CultureExchange', power, target: t, culture: amount };
      const label = `${amount} ${resource === 'gold' ? '🪙' : '🎭'} → ${signed(f.value)}`;
      const v = validate(state, cmd);
      const i = this.actions.push({ cmd }) - 1;
      const tip = v.ok ? f.notes.join('\n') : v.reason;
      return `<button data-i="${i}" ${v.ok ? '' : 'disabled'} title="${esc(tip)}">${escIcons(label)}</button>`;
    };
    return `<h3>Подарки</h3>
      <div class="muted small">Ценность — в ходах дохода получателя; повторный подарок за ${diplomacyConfig.gift.repeatWindow} ходов вдвое слабее, максимум +${diplomacyConfig.gift.max}.</div>
      <div class="actions row-buttons">${gold.map((g) => giftBtn(g, 'gold')).join('')}</div>
      <div class="custom-gift"><label class="small">Своя сумма (у вас ${me.gold}) <input type="number" min="0" max="${me.gold}" step="5" value="${this.giftGold}" data-field="giftGold"></label>${this.giftGold > 0 ? giftBtn(this.giftGold, 'gold') : ''}</div>
      <div class="muted small">Культурный обмен (тратит культуру):</div>
      <div class="actions row-buttons">${culture.map((c) => giftBtn(c, 'culture')).join('')}</div>`;
  }

  private dealRow(label: string, deal: Deal, to = this.target): string {
    const { power } = this.host;
    const f = this.forecast(deal, to);
    const cmd: Command = { type: 'Propose', power, target: to, deal };
    const human = this.host.state.powers[to].isHuman;
    return `<div class="deal">${this.button(label, cmd, { blocker: f.ok || human || deal.kind === 'tribute' ? null : 'Откажут' })}${f.html}</div>`;
  }

  private pactsBlock(): string {
    const { state, power } = this.host;
    const t = this.target;
    let html = '<h3>Договоры</h3>';
    if (hasPact(state, power, t, 'trade')) {
      html += `<div class="deal">${this.button('Расторгнуть торговый договор', { type: 'CancelPact', power, target: t, kind: 'trade' })}<div class="muted small">партнёр это запомнит (${diplomacyConfig.events.treatyCancelled})</div></div>`;
    } else {
      const cfg = diplomacyConfig.trade;
      html += this.dealRow(`Торговый договор (+${cfg.goldBase} 🪙 обоим, +${cfg.goldBorder} при общей границе)`, { kind: 'trade' });
    }
    if (hasPact(state, power, t, 'alliance')) {
      html += `<div class="deal">${this.button('Расторгнуть союз', { type: 'CancelPact', power, target: t, kind: 'alliance' })}</div>`;
      html += this.dealRow('Уния: они входят в вашу державу', { kind: 'union' });
    } else {
      html += this.dealRow('Союз: общая сеть, обзор и оборона', { kind: 'alliance' });
    }
    return html;
  }

  private joinGoldInput(): string {
    const me = this.host.state.powers[this.host.power];
    this.joinGold = Math.min(this.joinGold, me.gold);
    return `<label class="small">Ваша плата золотом за помощь (у вас ${me.gold}) <input type="number" min="0" max="${me.gold}" step="5" value="${this.joinGold}" data-field="joinGold"></label>`;
  }

  /** Просьба к этой державе вступить в войну против любого из ваших врагов. */
  private joinWarBlock(): string {
    const { state, power } = this.host;
    const enemies = state.powers[power].wars.filter((e) => e !== this.target);
    if (!enemies.length) return '';
    let html = `<h3>Попросить помощи в войне</h3>
      <div class="muted small">Чем лучше отношения и слабее враг, тем охотнее соглашаются; плата золотом помогает уговорить.</div>${this.joinGoldInput()}`;
    for (const e of enemies) {
      html += this.dealRow(`Вступить в войну против: ${state.powers[e].name}`, { kind: 'joinWar', enemy: e, gold: this.joinGold });
    }
    return html;
  }

  /** С кем вы воюете, у кого попросить помощи: все знакомые державы с прогнозом ответа. */
  private helpBlock(enemy: number): string {
    const { state, power } = this.host;
    const others = this.metPowers().filter((h) => h !== enemy);
    const helpers = others.filter((h) => state.powers[h].suzerain === NONE);
    let html = `<h3>Попросить помощи против державы ${esc(state.powers[enemy].name)}</h3>
      <div class="muted small">Попросите другие державы вступить в эту войну на вашей стороне. Лучше всего соглашаются те, у кого хорошие отношения с вами.</div>`;
    if (!helpers.length) {
      const why = others.length ? 'остальные известные вам державы — вассалы и сами просить не могут' : 'вы пока не встретили никого, кроме этой державы (дипломатия открывается после встречи на карте)';
      return html + `<div class="muted small">Просить помощи не у кого: ${why}.</div>`;
    }
    html += this.joinGoldInput();
    for (const h of helpers.sort((a, b) => opinion(state, b, power).total - opinion(state, a, power).total)) {
      const op = opinion(state, h, power).total;
      html += this.dealRow(`${state.powers[h].name} (отношения ${signed(op)})`, { kind: 'joinWar', enemy, gold: this.joinGold }, h);
    }
    return html;
  }

  private tributeBlock(): string {
    const { state } = this.host;
    const income = Math.max(diplomacyConfig.gift.minIncome, grossGold(state, this.target));
    const amounts = [...new Set([2, 5, 10].map((k) => roundGold(income * k)))];
    let html = `<h3>Потребовать дань</h3><div class="muted small">Платят, только если вы намного сильнее; отказ портит отношения обеим сторонам.</div>`;
    for (const gold of amounts) html += this.dealRow(`Дань ${gold} 🪙`, { kind: 'tribute', gold });
    return html;
  }

  private peaceBlock(): string {
    const { state, power } = this.host;
    const t = this.target;
    const me = state.powers[power];
    const pt = state.powers[t];
    const cityOptions = (owner: number, value: number) =>
      [`<option value="${NONE}">нет</option>`]
        .concat(
          citiesOf(state, owner)
            .filter((c) => !c.isCapital && me.explored[c.tile])
            .map((c) => `<option value="${c.id}" ${c.id === value ? 'selected' : ''}>${esc(c.name)} (ур. ${c.level})</option>`),
        )
        .join('');
    const p = this.peace;
    p.giveGold = Math.min(p.giveGold, me.gold);
    p.takeGold = Math.min(p.takeGold, pt.gold);
    const gold = (field: string, value: number, max: number) =>
      `<label>Золото (максимум ${max})<input type="number" min="0" max="${max}" step="5" value="${value}" data-field="${field}"></label>`;
    const deal: Deal = { kind: 'peace', terms: { ...p } };
    const f = this.forecast(deal);
    return `<h3>Мир</h3>
      <div class="muted small">Соберите условия: слева то, что вы отдаёте, справа то, что получаете. Пустые колонки — мир без условий. После мира перемирие на ${diplomacyConfig.truceTurns} ходов, столицу по договору не отдают.</div>
      <div class="terms">
        <div class="col-title">Вы отдаёте</div>
        <div class="col-title">Вы получаете</div>
        <div class="col">
          ${gold('giveGold', p.giveGold, me.gold)}
          <label>Город<select data-field="giveCity">${cityOptions(power, p.giveCity)}</select></label>
          <label class="check"><input type="checkbox" data-field="vassalMe" ${p.vassal === power ? 'checked' : ''}> Стать их вассалом</label>
        </div>
        <div class="col">
          ${gold('takeGold', p.takeGold, pt.gold)}
          <label>Город<select data-field="takeCity">${cityOptions(t, p.takeCity)}</select></label>
          <label class="check"><input type="checkbox" data-field="vassalThem" ${p.vassal === t ? 'checked' : ''}> Сделать их своим вассалом</label>
        </div>
      </div>
      <div class="terms-summary"><b>Итог:</b> ${esc(this.summary(p))}</div>
      <div class="deal">${this.button('Предложить мир', { type: 'Propose', power, target: t, deal }, { blocker: f.ok ? null : 'Откажут' })}${f.html}</div>`;
  }

  /** Условия мира словами с точки зрения игрока. */
  private summary(p: PeaceTerms): string {
    const { state, power } = this.host;
    const t = this.target;
    const city = (id: number) => state.cities.find((c) => c.id === id)?.name ?? '?';
    const give: string[] = [];
    const get: string[] = [];
    if (p.giveGold) give.push(`${p.giveGold} золота`);
    if (p.giveCity !== NONE) give.push(`город ${city(p.giveCity)}`);
    if (p.vassal === power) give.push('вассалитет');
    if (p.takeGold) get.push(`${p.takeGold} золота`);
    if (p.takeCity !== NONE) get.push(`город ${city(p.takeCity)}`);
    if (p.vassal === t) get.push('вассалитет (они — ваши вассалы)');
    return `вы отдаёте: ${give.join(', ') || 'ничего'}; вы получаете: ${get.join(', ') || 'ничего'}; война заканчивается.`;
  }

  private confirmWar(target: number): void {
    const { state, power } = this.host;
    const sides = warSides(state, power, target);
    const name = (p: number) => state.powers[p].name;
    const lines: string[] = [];
    const others = sides.defenders.filter((d) => d !== target);
    if (others.length) lines.push(`Вместе с ней — сюзерен и вассалы: ${others.map(name).join(', ')}.`);
    if (sides.allies.length) lines.push(`На её стороне вступят союзники: ${sides.allies.map(name).join(', ')}.`);
    if (sides.betrayed.length) {
      const ev = diplomacyConfig.events;
      lines.push(`Вы нарушите договор: ${name(target)} запомнит (${ev.betrayalVictim}), остальные знакомые — тоже (${ev.betrayalSeen} и сильнее, если вы сильнее их).`);
    }
    if (state.powers[target].character === 'trader') lines.push(`Война с торговцем портит отношения со всеми (${diplomacyConfig.events.attackedTrader}).`);
    lines.push(`Мир возможен только по согласию; после него — перемирие ${diplomacyConfig.truceTurns} ходов.`);
    showChoice(
      `Объявить войну: ${name(target)}?`,
      lines.join(' '),
      [{ value: target, label: 'Объявить войну', description: `юниты и города державы ${name(target)} станут целями` }],
      (t) => this.run({ type: 'DeclareWar', power, target: t }),
    );
  }
}
