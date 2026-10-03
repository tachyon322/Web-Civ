// Связка ядра, отрисовки и HTML-панелей. Все изменения состояния идут только через команды ядра.

import {
  MILITARY_TYPES,
  NONE,
  SPECIALS,
  TERRAINS,
  atWar,
  attackBlocker,
  balance,
  buildings,
  buildingPrice,
  captureBlocker,
  choiceBlocker,
  citizenPrice,
  cityAt,
  cityGrowthPerTurn,
  cityGrowthThreshold,
  cityMaxDurability,
  citySlots,
  cityStrength,
  cityStrengthParts,
  cityTileLimit,
  cityTiles,
  characterDef,
  checkClaim,
  computeIncome,
  computeNetwork,
  deterrenceIndex,
  distance,
  NO_TARGET,
  PROJECT_STAGES,
  abilityCost,
  buildingBlocker,
  computeStability,
  epochMpBonus,
  epochName,
  epochOf,
  garrisoned,
  nextEpochScience,
  pathsConfig,
  pressureGain,
  pressureSource,
  projectCity,
  projectName,
  projectStageCost,
  stabilityLevel,
  unitEpochName,
  victoryName,
  opinion,
  pendingProposals,
  execute,
  findCity,
  findPath,
  findUnit,
  forecastAttack,
  foundCityPrice,
  hasBuildingEffect,
  plunderCooldown,
  plunderLoot,
  turnsWord,
  reachableTiles,
  stepsThisTurn,
  terrainDefs,
  unitAt,
  unitBaseMp,
  unitMaxStrength,
  unitPeople,
  validate,
  type BuildingDef,
  type Breakdown,
  type CaptureChoice,
  type City,
  type CombatForecast,
  type Command,
  type GameState,
  type MilitaryType,
  type Unit,
} from '../core';
import { BotRunner } from '../ai/client';
import { buildingDef, specialYields, unitDef } from '../core/data';
import { computeVisible } from '../core/visibility';
import { EMPTY_OVERLAY, type MapRenderer, type Overlay } from '../render/MapRenderer';
import type { Minimap } from '../render/minimap';
import { esc, showChoice } from './dialog';
import { PathsWindow } from './paths';
import { DiplomacyWindow, statusText } from './diplomacy';

type Selection = { kind: 'unit'; id: number } | { kind: 'city'; id: number } | null;

/** Что произойдёт по правому клику выбранным юнитом. */
type Intent =
  | { kind: 'attack'; tile: number; blocker: string | null }
  | { kind: 'capture'; city: City; blocker: string | null }
  | { kind: 'merge'; target: Unit }
  | { kind: 'transfer'; city: City }
  | { kind: 'move' };

export interface UiElements {
  topbar: HTMLElement;
  panel: HTMLElement;
  log: HTMLElement;
  tileinfo: HTMLElement;
  forecast: HTMLElement;
  toast: HTMLElement;
  endTurn: HTMLButtonElement;
}

const SPECIAL_NAMES: Record<string, string> = { gold: 'Золотая жила', marble: 'Мрамор', ruins: 'Древние руины' };
const RES_NAMES: Record<string, string> = { gold: 'золото', science: 'наука', culture: 'культура' };
const TYPE_HINTS: Record<MilitaryType, string> = {
  warrior: 'основная пехота, захватывает города; сильнее против всадников',
  archer: 'бьёт с 2 клеток без ответного урона, бонус против городов; сильнее против воинов',
  horseman: 'быстрый, захватывает города; сильнее против лучников',
};

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function breakdownTitle(b: Breakdown): string {
  if (!b.items.length) return 'Пока ничего';
  return b.items.map((i) => `${i.label}: ${signed(i.value)}`).join('\n') + `\nИтого: ${signed(b.total)} за ход`;
}

function deterrenceTitle(intro: string, b: Breakdown): string {
  const parts = b.items.map((i) => `${i.label}: ${fmt(i.value)}`).join('\n');
  return `${intro}\n\n${parts || 'Ни армии, ни обороны'}\nИтого: ${fmt(b.total)}`;
}

/** Название юнита в облике эпохи его державы: воин в античности — мечник. */
function unitTitle(state: GameState, unit: Unit): string {
  const name = unitEpochName(unit.type, epochOf(state.powers[unit.owner]));
  return `${name}${unit.type === 'citizen' ? '' : ` ${unit.level} ур.`}`;
}

function buildingSummary(b: BuildingDef): string {
  if (b.effect === 'barracks') return 'военные юниты сразу 2-го уровня';
  if (b.effect === 'walls') return `+${b.durability ?? 1} к прочности, +${b.strength ?? 0} к силе города`;
  const parts = Object.entries(b.yields).map(([k, v]) => `+${v} ${RES_NAMES[k]}`);
  if (b.stability) parts.push(`+${b.stability} к стабильности`);
  if (b.strength) parts.push(`+${b.strength} к силе города`);
  if (b.upgradeOf) parts.push(`вместо «${buildingDef(b.upgradeOf).name}»`);
  if (b.wonder) parts.unshift('чудо света');
  return parts.join(', ');
}

export class GameController {
  private state!: GameState;
  private selection: Selection = null;
  private hover = NONE;
  private visible: Uint8Array = new Uint8Array(0);
  private toastTimer = 0;
  /** Идёт ход ботов: ввод игрока не принимается. */
  private busy = false;
  private bots = new BotRunner();
  private diplomacy: DiplomacyWindow;
  private paths: PathsWindow;
  /** Команды кнопок панели текущей отрисовки (data-action="cmd", data-i — индекс). */
  private panelCommands: Command[] = [];
  /** Итог партии уже показан (победа или выбывание игрока). */
  private overShown = false;
  onNewGame: (() => void) | null = null;
  /** Кнопка «Меню» в верхней полосе. */
  onMenu: (() => void) | null = null;
  /** Ход завершён (для автосохранения). */
  onTurnEnd: ((state: GameState) => void) | null = null;
  /** Партия закончилась для игрока: победа (своя или чужая) или выбывание. */
  onGameOver: ((state: GameState) => void) | null = null;

  constructor(
    private renderer: MapRenderer,
    private minimap: Minimap,
    private ui: UiElements,
  ) {
    const controller = this;
    this.diplomacy = new DiplomacyWindow(
      {
        get state() {
          return controller.state;
        },
        get power() {
          return controller.power;
        },
        dispatch: (cmd) => this.dispatch(cmd),
      },
      () => this.refresh(),
    );
    this.paths = new PathsWindow(
      {
        get state() {
          return controller.state;
        },
        get power() {
          return controller.power;
        },
        dispatch: (cmd) => this.dispatch(cmd),
      },
      () => this.refresh(),
    );
    ui.endTurn.addEventListener('click', () => this.endTurn());
    ui.panel.addEventListener('click', (e) => this.onPanelClick(e));
    ui.topbar.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-action="menu"]')) this.onMenu?.();
      if (target.closest('[data-action="diplomacy"]')) this.diplomacy.open();
      if (target.closest('[data-action="paths"]')) this.paths.open();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    renderer.onViewChange = () => minimap.drawView();
  }

  get current(): GameState | null {
    return this.state ?? null;
  }

  get power(): number {
    return this.state.humanPower;
  }

  start(state: GameState): void {
    this.diplomacy.close();
    this.paths.close();
    this.overShown = !!state.winner || !state.powers[state.humanPower].alive;
    this.state = state;
    this.selection = null;
    document.body.classList.remove('no-game');
    this.renderer.setGame(state);
    const capital = findCity(state, state.powers[this.power].capitalId);
    if (capital) this.renderer.centerOn(capital.tile);
    this.selectNextUnit(false);
    this.refresh();
  }

  // ---------- Команды ----------

  private dispatch(cmd: Command): boolean {
    if (this.busy) return false;
    const result = execute(this.state, cmd);
    if (!result.ok) {
      this.toast(result.reason);
      return false;
    }
    const sel = this.selection;
    if (sel?.kind === 'unit' && !findUnit(this.state, sel.id)) this.selection = null;
    this.refresh();
    this.checkGameOver();
    return true;
  }

  /** Итог партии: победа (своя или чужая) — один раз. */
  private checkGameOver(): void {
    const w = this.state.winner;
    if (!w || this.overShown) return;
    this.overShown = true;
    this.onGameOver?.(this.state);
    const name = this.state.powers[w.power].name;
    const mine = w.power === this.power;
    showChoice(
      mine ? 'Победа!' : 'Поражение',
      `${mine ? 'Ваша держава' : name} побеждает на ходу ${w.turn}: ${victoryName(w.kind)}. Можно посмотреть на карту или начать заново.`,
      [{ value: 'new', label: 'Новая партия', description: 'выбрать нацию, сложность и сид' }],
      () => this.onNewGame?.(),
    );
  }

  /** Конец хода: боты ходят в воркере, их команды применяются здесь через ядро, затем общий переход хода. */
  private async endTurn(): Promise<void> {
    if (this.busy || !this.state.powers[this.power].alive || this.state.winner) return;
    const state = this.state;
    const warsBefore = [...state.powers[this.power].wars];
    this.setBusy(true);
    try {
      const commands = await this.bots.play(state);
      if (this.state !== state) return; // за это время началась новая партия
      for (const cmd of commands) {
        const v = execute(state, cmd);
        if (!v.ok) console.warn('Команда бота отклонена', cmd, v.reason);
      }
      execute(state, { type: 'EndTurn', power: this.power });
    } catch (err) {
      console.error(err);
      this.toast('Ошибка в ходе ботов — подробности в консоли');
    } finally {
      this.setBusy(false);
    }
    if (this.state !== state) return;
    const sel = this.selection;
    if (sel?.kind === 'unit' && !findUnit(state, sel.id)) this.selection = null;
    this.refresh();
    const declared = state.powers[this.power].wars.filter((w) => !warsBefore.includes(w)).map((w) => state.powers[w].name);
    if (declared.length) this.toast(`Новая война: ${declared.join(', ')} — подробности в журнале`);
    this.onTurnEnd?.(state);
    if (state.winner) this.checkGameOver();
    else if (!state.powers[this.power].alive) this.showDefeat();
    else {
      this.selectNextUnit(false);
      // Предложения ботов ждут ответа до конца хода — показываем их сразу.
      if (pendingProposals(state, this.power).length) this.diplomacy.open();
      else this.diplomacy.update();
    }
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    this.ui.endTurn.disabled = busy;
    this.ui.endTurn.textContent = busy ? 'Ходят другие державы…' : 'Завершить ход ⏎';
  }

  private showDefeat(): void {
    if (this.overShown) return;
    this.overShown = true;
    this.onGameOver?.(this.state);
    showChoice(
      'Ваша держава выбыла',
      `Все города потеряны на ходу ${this.state.turn}. Можно посмотреть на карту или начать заново.`,
      [{ value: 'new', label: 'Новая партия', description: 'выбрать нацию, сложность и сид' }],
      () => this.onNewGame?.(),
    );
  }

  private refresh(): void {
    this.visible = computeVisible(this.state, this.power);
    this.renderer.refresh(this.state);
    this.minimap.update(this.state);
    this.updateOverlay();
    this.renderTopbar();
    this.renderPanel();
    this.renderLog();
    this.renderTileInfo();
    this.diplomacy.update();
    this.paths.update();
  }

  // ---------- Ввод ----------

  onTileClick(tile: number, button: 'left' | 'right'): void {
    if (!this.state) return;
    if (button === 'right') {
      this.onRightClick(tile);
      return;
    }
    const state = this.state;
    const unit = unitAt(state, tile);
    const city = cityAt(state, tile);
    const explored = state.powers[this.power].explored[tile];
    const sel = this.selection;
    const unitVisible = unit && (unit.owner === this.power || this.visible[tile]);
    if (unit && unitVisible && !(sel?.kind === 'unit' && sel.id === unit.id)) {
      this.selection = { kind: 'unit', id: unit.id };
    } else if (city && explored) {
      this.selection = { kind: 'city', id: city.id };
    } else {
      this.selection = null;
    }
    this.updateOverlay();
    this.renderPanel();
  }

  private onRightClick(tile: number): void {
    const unit = this.selectedUnit();
    if (!unit) return;
    const intent = this.intentFor(unit, tile);
    switch (intent.kind) {
      case 'attack':
        if (intent.blocker) this.toast(this.explainBlocker(intent.blocker, tile));
        else this.dispatch({ type: 'Attack', power: this.power, unitId: unit.id, target: tile });
        return;
      case 'capture':
        if (intent.blocker) this.toast(this.explainBlocker(intent.blocker, tile));
        else this.openCaptureDialog(unit, intent.city);
        return;
      case 'merge':
        this.openMergeDialog(unit, intent.target);
        return;
      case 'transfer':
        this.dispatch({ type: 'Transfer', power: this.power, unitId: unit.id, cityId: intent.city.id });
        return;
      case 'move':
        this.dispatch({ type: 'Move', power: this.power, unitId: unit.id, target: tile });
    }
  }

  /** К причине «нет войны» добавляем подсказку, где её объявить. */
  private explainBlocker(reason: string, tile: number): string {
    if (reason !== 'С этой державой нет войны') return reason;
    const owner = (unitAt(this.state, tile) ?? cityAt(this.state, tile))?.owner;
    const name = owner !== undefined ? this.state.powers[owner].name : '';
    return `С державой ${name} нет войны — объявить её можно в окне дипломатии (D)`;
  }

  onTileHover(tile: number): void {
    if (!this.state) return;
    this.hover = tile;
    this.updateOverlay();
    this.renderTileInfo();
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.state || document.querySelector('.modal-backdrop')) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      this.endTurn();
    } else if (e.key === 'Escape') {
      this.selection = null;
      this.updateOverlay();
      this.renderPanel();
    } else if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') {
      const unit = this.selectedUnit();
      if (unit) this.foundCity(unit);
    } else if (e.key === 'n' || e.key === 'N' || e.key === 'т' || e.key === 'Т') {
      this.selectNextUnit(true);
    } else if (e.key === 'd' || e.key === 'D' || e.key === 'в' || e.key === 'В') {
      this.diplomacy.open();
    } else if (e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З') {
      this.paths.open();
    }
  }

  private onPanelClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;
    const sel = this.selection;
    if (action === 'found') {
      const unit = this.selectedUnit();
      if (unit) this.foundCity(unit);
    } else if (action === 'cancel-route' && sel?.kind === 'unit') {
      this.dispatch({ type: 'CancelRoute', power: this.power, unitId: sel.id });
    } else if (action === 'buy-citizen' && sel?.kind === 'city') {
      this.dispatch({ type: 'BuyCitizen', power: this.power, cityId: sel.id });
    } else if (action === 'buy-building' && sel?.kind === 'city') {
      this.dispatch({ type: 'BuyBuilding', power: this.power, cityId: sel.id, buildingId: btn.dataset.building! });
    } else if (action === 'buy-military' && sel?.kind === 'city') {
      const unitType = btn.dataset.unit as MilitaryType;
      this.dispatch({ type: 'BuyMilitary', power: this.power, cityId: sel.id, unitType });
    } else if (action === 'cmd') {
      this.dispatch(this.panelCommands[Number(btn.dataset.i)]);
    } else if (action === 'diplomacy') {
      this.diplomacy.open(Number(btn.dataset.target));
    } else if (action === 'select-city') {
      const unit = this.selectedUnit();
      const city = unit && cityAt(this.state, unit.tile);
      if (city) {
        this.selection = { kind: 'city', id: city.id };
        this.updateOverlay();
        this.renderPanel();
      }
    }
  }

  private foundCity(unit: Unit): void {
    const tile = unit.tile;
    if (this.dispatch({ type: 'FoundCity', power: this.power, unitId: unit.id })) {
      const city = cityAt(this.state, tile);
      this.selection = city ? { kind: 'city', id: city.id } : null;
      this.updateOverlay();
      this.renderPanel();
    }
  }

  /** Следующий юнит, у которого остались очки хода и нет маршрута. */
  private selectNextUnit(center: boolean): void {
    const idle = this.state.units
      .filter((u) => u.owner === this.power && u.mp > 0 && u.routeTarget === NONE)
      .sort((a, b) => a.id - b.id);
    if (!idle.length) {
      if (center) this.toast('Все юниты уже походили');
      return;
    }
    const current = this.selection?.kind === 'unit' ? this.selection.id : -1;
    const next = idle.find((u) => u.id > current) ?? idle[0];
    this.selection = { kind: 'unit', id: next.id };
    if (center) this.renderer.centerOn(next.tile);
    this.updateOverlay();
    this.renderPanel();
  }

  private selectedUnit(): Unit | null {
    const sel = this.selection;
    if (sel?.kind !== 'unit') return null;
    const unit = findUnit(this.state, sel.id);
    return unit && unit.owner === this.power ? unit : null;
  }

  // ---------- Диалоги ----------

  private openMergeDialog(unit: Unit, target: Unit): void {
    const level = unit.level + 1;
    const strength = fmt(unit.strength + target.strength);
    const options = MILITARY_TYPES.map((type) => {
      const cmd: Command = { type: 'Merge', power: this.power, unitId: unit.id, targetId: target.id, into: type };
      const v = validate(this.state, cmd);
      return {
        value: type,
        label: `${unitDef(type).name} ${level} ур.`,
        description: TYPE_HINTS[type],
        disabledReason: v.ok ? null : v.reason,
      };
    });
    showChoice(
      'В кого превратить?',
      `Слияние: ${unitTitle(this.state, unit)} + ${unitTitle(this.state, target)} → ${level} уровень, сила ${strength} из ${2 ** (level - 1)}. Военный юнит обратно в жителей не превращается.`,
      options,
      (into) => {
        if (!this.dispatch({ type: 'Merge', power: this.power, unitId: unit.id, targetId: target.id, into })) return;
        this.selection = { kind: 'unit', id: target.id };
        this.updateOverlay();
        this.renderPanel();
      },
    );
  }

  private openCaptureDialog(unit: Unit, city: City): void {
    const loot = plunderLoot(city);
    const founder = this.state.powers[city.founder];
    const options: { value: CaptureChoice; label: string; description: string; disabledReason: string | null }[] = [
      {
        value: 'annex',
        label: 'Присоединить',
        description: 'город и его клетки становятся вашими',
        disabledReason: choiceBlocker(this.state, unit, city, 'annex'),
      },
      {
        value: 'plunder',
        label: 'Разграбить',
        description: `+${loot.gold} золота, +${loot.science} науки, +${loot.culture} культуры; город падает на уровень (не ниже 1-го), остаётся у владельца с полной прочностью и ${balance.capture.plunderCooldownTurns} ходов защищён от грабежа`,
        disabledReason: choiceBlocker(this.state, unit, city, 'plunder'),
      },
      {
        value: 'liberate',
        label: 'Освободить',
        description: `вернуть город основателю — державе ${founder.name}`,
        disabledReason: choiceBlocker(this.state, unit, city, 'liberate'),
      },
    ];
    showChoice(`${city.name}: город взят`, '', options, (choice) =>
      this.dispatch({ type: 'CaptureCity', power: this.power, unitId: unit.id, cityId: city.id, choice }),
    );
  }

  // ---------- Намерения и подсветки ----------

  private intentFor(unit: Unit, tile: number): Intent {
    const state = this.state;
    const other = unitAt(state, tile);
    const city = cityAt(state, tile);
    const foreignUnit = other && other.owner !== this.power && this.visible[tile] ? other : undefined;
    const foreignCity = city && city.owner !== this.power && state.powers[this.power].explored[tile] ? city : undefined;
    if (foreignCity && !foreignUnit && foreignCity.durability <= 0) {
      return { kind: 'capture', city: foreignCity, blocker: captureBlocker(state, unit, foreignCity) };
    }
    if (foreignUnit || foreignCity) return { kind: 'attack', tile, blocker: attackBlocker(state, unit, tile) };
    if (
      other &&
      other.owner === this.power &&
      other.id !== unit.id &&
      other.level === unit.level &&
      unit.level < balance.units.maxLevel &&
      distance(state.map, unit.tile, tile) === 1
    ) {
      return { kind: 'merge', target: other };
    }
    if (city && city.owner === this.power && this.transferTargets(unit).includes(tile)) return { kind: 'transfer', city };
    return { kind: 'move' };
  }

  /** Города сети, куда юнит может перебраться из своего города прямо сейчас. */
  private transferTargets(unit: Unit): number[] {
    const state = this.state;
    const from = cityAt(state, unit.tile);
    if (!from || from.owner !== this.power) return [];
    // Сеть считается один раз; validate проверяет остальные условия.
    const label = computeNetwork(state, this.power);
    if (label[from.tile] === NONE) return [];
    return state.cities
      .filter((c) => c.owner === this.power && c.id !== from.id && label[c.tile] === label[from.tile])
      .filter((c) => validate(state, { type: 'Transfer', power: this.power, unitId: unit.id, cityId: c.id }).ok)
      .map((c) => c.tile);
  }

  private updateOverlay(): void {
    const state = this.state;
    const overlay: Overlay = { ...EMPTY_OVERLAY };
    const unit = this.selectedUnit();
    const sel = this.selection;
    if (unit) {
      overlay.selectedTile = unit.tile;
      overlay.reachable = reachableTiles(state, unit).keys();
      overlay.networkTiles = this.transferTargets(unit);
      const range = unitDef(unit.type).range;
      for (const other of state.units) {
        if (other.owner === this.power) {
          if (this.intentFor(unit, other.tile).kind === 'merge') overlay.mergeTiles.push(other.tile);
        } else if (distance(state.map, unit.tile, other.tile) <= range && !attackBlocker(state, unit, other.tile)) {
          overlay.attackTiles.push(other.tile);
        }
      }
      for (const city of state.cities) {
        if (city.owner === this.power || unitAt(state, city.tile)) continue;
        if (distance(state.map, unit.tile, city.tile) > range) continue;
        if (!captureBlocker(state, unit, city)) overlay.captureTiles.push(city.tile);
        else if (!attackBlocker(state, unit, city.tile)) overlay.attackTiles.push(city.tile);
      }
      const h = this.hover;
      if (h >= 0 && h !== unit.tile && this.intentFor(unit, h).kind === 'move') {
        const path = findPath(state, unit, h);
        if (path) overlay.path = { from: unit.tile, tiles: path, thisTurn: stepsThisTurn(state, unit, path) };
      }
    } else if (sel?.kind === 'city') {
      const city = findCity(state, sel.id);
      if (city) {
        overlay.selectedTile = city.tile;
        if (city.owner === this.power) {
          const label = computeNetwork(state, this.power);
          overlay.networkTiles = state.cities
            .filter((c) => c.owner === this.power && c.id !== city.id && label[c.tile] !== NONE && label[c.tile] === label[city.tile])
            .map((c) => c.tile);
        }
      }
    } else if (sel?.kind === 'unit') {
      const other = findUnit(state, sel.id);
      if (other) overlay.selectedTile = other.tile;
    }
    this.renderer.setOverlay(overlay);
    this.renderForecast();
  }

  // ---------- Прогноз ----------

  private renderForecast(): void {
    const unit = this.selectedUnit();
    const h = this.hover;
    const el = this.ui.forecast;
    if (!unit || h < 0 || h === unit.tile) {
      el.innerHTML = '';
      return;
    }
    const intent = this.intentFor(unit, h);
    if (intent.kind === 'attack') {
      el.innerHTML = intent.blocker
        ? `<div class="title">⚔ Атака невозможна</div><div class="reason">${esc(this.explainBlocker(intent.blocker, h))}</div>`
        : this.forecastHtml(forecastAttack(this.state, unit, h));
    } else if (intent.kind === 'capture') {
      el.innerHTML = intent.blocker
        ? `<div class="title">🏳 ${esc(intent.city.name)}: прочность 0</div><div class="reason">${esc(intent.blocker)}</div>`
        : `<div class="title">🏳 Захватить ${esc(intent.city.name)} — ПКМ</div><div class="mods">присоединить, разграбить или освободить</div>`;
    } else if (intent.kind === 'merge') {
      const level = unit.level + 1;
      el.innerHTML = `<div class="title">⇄ Слияние — ПКМ</div>
        <div class="mods">${esc(unitTitle(this.state, unit))} + ${esc(unitTitle(this.state, intent.target))} → ${level} ур., сила ${fmt(unit.strength + intent.target.strength)} из ${2 ** (level - 1)}</div>`;
    } else if (intent.kind === 'transfer') {
      el.innerHTML = `<div class="title">⇢ Переброска в ${esc(intent.city.name)} — ПКМ</div>
        <div class="mods">по сети городов за ${balance.units.transferCost} очко хода</div>`;
    } else {
      el.innerHTML = '';
    }
  }

  /** «сила города: уровень 1 + столица 1 = 2». */
  private cityStrengthText(cityId: number): string {
    const city = findCity(this.state, cityId)!;
    const parts = cityStrengthParts(city);
    return `сила города: ${parts.map((p) => `${p.label} ${p.value}`).join(' + ')} = ${cityStrength(city)}`;
  }

  private forecastHtml(f: CombatForecast): string {
    const mods = (list: { label: string; factor: number }[]) =>
      list.length ? list.map((m) => `${esc(m.label)} ×${fmt(m.factor)}`).join(' · ') : 'без модификаторов';
    const side = (label: string, before: number, after: number, unitWord: string) =>
      `<span>${label}: ${unitWord} ${fmt(before)} → <span class="${after < before ? 'loss' : ''}">${fmt(after)}</span>${after <= 0 && unitWord === 'сила' ? ' (гибнет)' : ''}</span>`;
    const defWord = f.target === 'city' ? 'прочность' : 'сила';
    return `<div class="title">⚔ ${esc(f.attacker.name)} → ${esc(f.defender.name)}${f.ranged ? ' (без ответа)' : ''}</div>
      <div class="side">${side('Вы', f.attacker.before, f.attacker.after, 'сила')}<span>в бою ${fmt(f.attacker.effective)}</span></div>
      <div class="mods">${mods(f.attacker.modifiers)}</div>
      <div class="side">${side('Враг', f.defender.before, f.defender.after, defWord)}<span>в бою ${fmt(f.defender.effective)}</span></div>
      <div class="mods">${f.target === 'city' ? `${esc(this.cityStrengthText(f.defenderCityId!))}${f.defender.after === f.defender.before ? '; чтобы снять прочность, нужно быть не слабее' : ''}` : mods(f.defender.modifiers)}</div>`;
  }

  // ---------- Панели ----------

  private renderTopbar(): void {
    const state = this.state;
    const p = state.powers[this.power];
    const income = computeIncome(state, this.power);
    const res = (id: 'gold' | 'science' | 'culture', icon: string, value: number) => `
      <span class="res ${id}" title="${esc(`${RES_NAMES[id]}: ${value}\n\n${breakdownTitle(income[id])}`)}">
        ${icon} <b>${value}</b><span class="delta">(${signed(income[id].total)})</span>
      </span>`;
    const wars = p.wars.map((w) => state.powers[w].name);
    const pending = pendingProposals(state, this.power).length;
    const deterrence = deterrenceIndex(state, this.power);
    const epoch = epochOf(p);
    const next = nextEpochScience(p);
    const epochTitle = `Эпоха: ${epochName(epoch)}\nЗаработано науки: ${p.scienceTotal}${next ? `\nСледующая эпоха — ${epochName(epoch + 1)} при ${next}` : '\nПоследняя эпоха'}`;
    const stab = computeStability(state, this.power);
    const level = stabilityLevel(p.stability);
    const stabilityTitle = `Стабильность: ${p.stability} — ${level.name}\n\n${stab.items.map((i) => `${i.label}: ${signed(i.value)}`).join('\n')}\n\nПодробнее — в окне «Пути» (P)`;
    this.ui.topbar.innerHTML = `
      <span class="power"><span class="swatch" style="background:${p.color}"></span>${esc(p.name)}</span>
      ${res('gold', '🪙', p.gold)}
      ${res('science', '🔬', p.science)}
      ${res('culture', '🎭', p.culture)}
      <span class="res" title="${esc(epochTitle)}">⏳ <b>${esc(epochName(epoch))}</b></span>
      <span class="res stability ${level.combat !== 1 ? 'bad' : ''}" title="${esc(stabilityTitle)}">⚖ <b>${p.stability}</b> ${esc(level.name.toLowerCase())}</span>
      <span class="res" title="${esc(deterrenceTitle('Индекс сдерживания: насколько дорого на вас напасть. Боты нападают, если их армия сильнее.', deterrence))}">🛡 <b>${fmt(deterrence.total)}</b></span>
      ${wars.length ? `<span class="wars">⚔ Война: ${esc(wars.join(', '))}</span>` : ''}
      ${p.suzerain !== NONE ? `<span class="wars" title="Вассал платит дань, воюет на стороне сюзерена и не заключает союзов">Вассал державы ${esc(state.powers[p.suzerain].name)}</span>` : ''}
      ${state.coalitionLeader !== NONE ? `<span class="wars" title="Держава близка к победе: остальные собирают коалицию">⚠ Лидер: ${esc(state.powers[state.coalitionLeader].name)}</span>` : ''}
      ${p.secession ? `<span class="wars" title="Стабильность ниже ${pathsConfig.stability.secessionBelow}: самый недовольный город отделится">⚠ Мятежи: ${esc(findCity(state, p.secession.cityId)?.name ?? '')} через ${Math.max(0, p.secession.due - state.turn)} х.</span>` : ''}
      <span class="spacer"></span>
      <button data-action="paths" title="Эпоха, стабильность, способности, проекты и победы (P)">✨ Пути</button>
      <button data-action="diplomacy" title="Отношения, договоры, мир и войны (D)">🤝 Дипломатия${pending ? ` · 📜 ${pending}` : ''}</button>
      <span class="turn">Ход ${state.turn} · сид ${state.settings.seed}</span>
      <button data-action="menu" title="Сохранить, загрузить, настройки, новая партия">☰ Меню</button>`;
  }

  private renderLog(): void {
    const me = this.power;
    const entries = this.state.log
      .filter((e) => e.power === me || (e.power === NONE && (!e.audience || e.audience.includes(me))))
      .slice(-60)
      .reverse();
    this.ui.log.innerHTML = entries
      .map((e) => `<div class="entry"><span class="t">${e.turn}</span>${esc(e.text)}</div>`)
      .join('');
  }

  private renderPanel(): void {
    this.panelCommands = [];
    const sel = this.selection;
    if (sel?.kind === 'unit') {
      const unit = findUnit(this.state, sel.id);
      this.ui.panel.innerHTML = unit ? this.unitPanel(unit) : '';
    } else if (sel?.kind === 'city') {
      const city = findCity(this.state, sel.id);
      this.ui.panel.innerHTML = city ? this.cityPanel(city) : '';
    } else {
      this.ui.panel.innerHTML = '';
    }
  }

  /** Кнопка произвольной команды ядра (способности, проекты): причина отказа — из validate. */
  private cmdButton(label: string, price: string | null, cmd: Command, showReason = true): string {
    const v = validate(this.state, cmd);
    const reason = v.ok ? '' : v.reason;
    const i = this.panelCommands.push(cmd) - 1;
    return `<button data-action="cmd" data-i="${i}" ${v.ok ? '' : 'disabled'} title="${esc(reason)}">
      ${esc(label)}${price !== null ? `<span class="price">${esc(price)}</span>` : ''}
    </button>${reason && showReason ? `<div class="reason">${esc(reason)}</div>` : ''}`;
  }

  /** Кнопка действия; причина отказа берётся из validate. showReason=false — причина уже сказана выше. */
  private actionButton(action: string, label: string, price: number | null, cmd: Command, extra = '', showReason = true): string {
    const v = validate(this.state, cmd);
    const reason = v.ok ? '' : v.reason;
    return `<button data-action="${action}" ${extra} ${v.ok ? '' : 'disabled'} title="${esc(reason)}">
      ${esc(label)}${price !== null ? `<span class="price">${price} 🪙</span>` : ''}
    </button>${reason && showReason ? `<div class="reason">${esc(reason)}</div>` : ''}`;
  }

  /** Статус отношений с чужой державой и вход в окно дипломатии. */
  private relationBlock(owner: number): string {
    const state = this.state;
    const p = state.powers[owner];
    const deterrence = deterrenceIndex(state, owner);
    const character = p.character ? characterDef(p.character) : null;
    let html = character
      ? `<div class="row" title="${esc(character.description)}"><span>Характер</span><span>${esc(character.name)}</span></div>`
      : '';
    html += `<div class="row" title="${esc(deterrenceTitle('Насколько дорого на них напасть', deterrence))}"><span>Индекс сдерживания</span><span>${fmt(deterrence.total)}</span></div>`;
    html += `<div class="row"><span>Статус</span><span class="${atWar(state, this.power, owner) ? 'reason' : ''}">${esc(statusText(state, this.power, owner))}</span></div>`;
    if (!state.powers[this.power].met.includes(owner)) return html;
    const op = opinion(state, owner, this.power);
    html += `<div class="row" title="${esc(breakdownTitle(op).replace(/ за ход$/, ''))}"><span>Отношение к вам</span><span>${signed(op.total)}</span></div>`;
    return html + `<div class="actions"><button data-action="diplomacy" data-target="${owner}">🤝 Дипломатия: ${esc(p.name)} (D)</button></div>`;
  }

  private unitPanel(unit: Unit): string {
    const state = this.state;
    const owner = state.powers[unit.owner];
    const own = unit.owner === this.power;
    const city = cityAt(state, unit.tile);
    const max = unitMaxStrength(unit);
    const stars = unit.stars ? ` <span class="stars">${'★'.repeat(unit.stars)}</span>` : '';
    let html = `<h2>${esc(unitTitle(this.state, unit))}${stars}</h2><div class="sub">${esc(owner.name)}${
      unit.type !== 'citizen' ? ` · людей ${unitPeople(unit)}` : ''
    }</div>
      <div class="row"><span>Сила</span><span>${fmt(unit.strength)} / ${max}</span></div>
      <div class="bar"><div style="width:${Math.min(100, (unit.strength / max) * 100)}%"></div></div>`;
    if (unit.fortified) html += `<div class="row"><span>Укрепился</span><span>+${balance.combat.fortifiedBonus * 100}% к защите</span></div>`;
    if (!own) {
      if (unit.type !== 'citizen' && atWar(state, this.power, unit.owner)) {
        const use = { ...NO_TARGET, ability: 'convert' as const, unitId: unit.id };
        html += `<div class="actions">${this.cmdButton('Переманить на свою сторону', `${abilityCost(state, this.power, use)} 🎭`, { type: 'UseAbility', power: this.power, ...use })}</div>`;
      }
      return html + this.relationBlock(unit.owner);
    }

    html += `<div class="row"><span>Очки хода</span><span title="Базово ${unitBaseMp(state, unit)}, +${epochMpBonus(state, unit.owner)} от эпохи, +${balance.units.ownTerritoryMpBonus} если ход начат на своей земле">${unit.mp}</span></div>`;
    if (unit.routeTarget !== NONE) html += `<div class="row"><span>Маршрут</span><span>идёт к цели</span></div>`;
    html += `<h3>Действия</h3><div class="actions">`;
    if (unit.type === 'citizen') {
      html += this.actionButton('found', 'Основать город (F)', foundCityPrice(state, this.power), {
        type: 'FoundCity',
        power: this.power,
        unitId: unit.id,
      });
    }
    if (unit.routeTarget !== NONE) html += `<button data-action="cancel-route">Отменить маршрут</button>`;
    if (city && city.owner === this.power) html += `<button data-action="select-city">Открыть город ${esc(city.name)}</button>`;
    html += `</div><div class="note">ПКМ по клетке — идти (дальние цели — маршрутом).`;
    if (unit.type === 'citizen') html += ` Проходя нейтральную клетку у границы, житель размечает её для ближайшего города со свободным лимитом.`;
    if (unit.level < balance.units.maxLevel) html += ` Фиолетовая рамка — слияние с соседом того же уровня.`;
    if (unitDef(unit.type).military || unit.type === 'citizen') html += ` Красная — цель атаки, оранжевая — город можно захватить.`;
    if (this.transferTargets(unit).length) html += ` Голубая — переброска по сети за ${balance.units.transferCost} очко хода.`;
    html += `</div>`;
    return html;
  }

  private cityIncome(city: City): Record<'gold' | 'science' | 'culture', number> {
    const result = { gold: balance.city.goldByLevel[city.level - 1], science: balance.city.sciencePerCity, culture: 0 };
    for (const id of city.buildings) {
      const y = buildingDef(id).yields;
      result.gold += y.gold ?? 0;
      result.science += y.science ?? 0;
      result.culture += y.culture ?? 0;
    }
    for (const t of cityTiles(this.state, city.id)) {
      const sp = SPECIALS[this.state.map.special[t]];
      if (!sp) continue;
      const y = specialYields[sp];
      result.gold += y.gold ?? 0;
      result.science += y.science ?? 0;
      result.culture += y.culture ?? 0;
    }
    return result;
  }

  private cityPanel(city: City): string {
    const state = this.state;
    const owner = state.powers[city.owner];
    const own = city.owner === this.power;
    let html = `<h2>${esc(city.name)}</h2>
      <div class="sub">${esc(owner.name)} · уровень ${city.level}${city.isCapital ? ' · столица' : ''}</div>
      <div class="row"><span>Прочность</span><span>${city.durability} / ${cityMaxDurability(city)}</span></div>
      <div class="row"><span>Сила обороны и выстрела</span><span title="${esc(this.cityStrengthText(city.id))}">${cityStrength(city)}</span></div>`;
    const cooldown = plunderCooldown(state, city);
    if (cooldown > 0) {
      html += `<div class="row" title="Разграбленный город какое-то время нельзя грабить снова — никому"><span>Недавно разграблен</span><span>грабить нельзя ещё ${cooldown} ${turnsWord(cooldown)}</span></div>`;
    }
    html += this.cityStatus(city);
    if (!own) return html + this.foreignCityActions(city) + this.relationBlock(city.owner);

    const threshold = cityGrowthThreshold(city);
    const perTurn = cityGrowthPerTurn(state, city);
    if (threshold !== null) {
      const pct = Math.min(100, (city.growth / threshold) * 100);
      const turns = perTurn > 0 ? Math.ceil((threshold - city.growth) / perTurn) : '∞';
      html += `<div class="row"><span>Рост</span><span>${city.growth} / ${threshold} (+${perTurn} за ход, ещё ${turns} х.)</span></div>
        <div class="bar"><div style="width:${pct}%"></div></div>`;
    } else {
      html += `<div class="row"><span>Рост</span><span>максимальный уровень</span></div>`;
    }
    const tiles = cityTiles(state, city.id).length;
    html += `<div class="row"><span>Клетки</span><span>${tiles} / ${cityTileLimit(state, city)}</span></div>
      <div class="row"><span>Слоты зданий</span><span>${city.buildings.length} / ${citySlots(city)}</span></div>`;
    const inc = this.cityIncome(city);
    html += `<div class="row"><span>Даёт за ход</span><span>🪙 ${inc.gold} · 🔬 ${inc.science} · 🎭 ${inc.culture}</span></div>`;
    const capital = findCity(state, owner.capitalId);
    if (capital && capital.id !== city.id) {
      const label = computeNetwork(state, this.power);
      const linked = label[city.tile] !== NONE && label[city.tile] === label[capital.tile];
      html += `<div class="row"><span>Связь со столицей</span><span>${linked ? 'есть' : 'нет'}</span></div>`;
    }
    if (city.buildings.length) {
      html +=
        `<h3>Здания</h3>` +
        city.buildings
          .map((b) => `<div class="row"><span>${esc(buildingDef(b).name)}</span><span>${esc(buildingSummary(buildingDef(b)))}</span></div>`)
          .join('');
    }
    html += `<h3>Покупки${city.purchasedThisTurn ? ' (в этом ходу уже была)' : ' (одна за ход)'}</h3><div class="actions">`;
    const showReason = !city.purchasedThisTurn;
    html += this.actionButton(
      'buy-citizen',
      'Житель',
      citizenPrice(state, this.power),
      { type: 'BuyCitizen', power: this.power, cityId: city.id },
      '',
      showReason,
    );
    if (hasBuildingEffect(city, 'barracks')) {
      for (const type of MILITARY_TYPES) {
        html += this.actionButton(
          'buy-military',
          `${unitDef(type).name} ${balance.units.barracksLevel} ур.`,
          citizenPrice(state, this.power) * balance.units.barracksPriceInCitizens,
          { type: 'BuyMilitary', power: this.power, cityId: city.id, unitType: type },
          `data-unit="${type}"`,
          showReason,
        );
      }
    }
    const epoch = epochOf(state.powers[this.power]);
    for (const b of buildings) {
      // Не показываем то, что здесь уже не купить: построенное, чужие чудеса, неподходящие улучшения,
      // и то, что откроется позже следующей эпохи.
      const blocker = buildingBlocker(state, this.power, city, b);
      if (blocker && /^(Здание уже|Уже есть улучш|Сначала нужно|Чудо уже)/.test(blocker)) continue;
      if ((b.epoch ?? 0) > epoch + 1) continue;
      html += this.actionButton(
        'buy-building',
        `${b.name} (${buildingSummary(b)})`,
        buildingPrice(state, this.power, b.id, city),
        { type: 'BuyBuilding', power: this.power, cityId: city.id, buildingId: b.id },
        `data-building="${b.id}"`,
        showReason,
      );
    }
    html += `</div>`;
    html += this.projectBlock(city);
    if (city.fortifyTurns <= 0) {
      const use = { ...NO_TARGET, ability: 'fortify' as const, cityId: city.id };
      html += `<h3>Способности</h3><div class="actions">${this.cmdButton(
        `Фортификация: город втрое крепче на ${pathsConfig.abilities.fortify.turns} хода`,
        `${abilityCost(state, this.power, use)} 🔬`,
        { type: 'UseAbility', power: this.power, ...use },
      )}</div>`;
    }
    return html;
  }

  /** Мятеж, культурное давление, саботаж, фортификация, угроза отделения — для любого известного города. */
  private cityStatus(city: City): string {
    const state = this.state;
    const name = (p: number) => state.powers[p].name;
    const cfg = pathsConfig.culture;
    let html = '';
    if (city.fortifyTurns > 0) html += `<div class="row"><span>Фортификация</span><span>ещё ${city.fortifyTurns} ${turnsWord(city.fortifyTurns)}</span></div>`;
    if (city.disabledTurns > 0 && city.disabledBuilding) {
      html += `<div class="row"><span>Саботаж</span><span class="reason">«${esc(buildingDef(city.disabledBuilding).name)}» не работает ${city.disabledTurns} ${turnsWord(city.disabledTurns)}</span></div>`;
    }
    if (city.revoltFrom !== NONE) {
      const left = cfg.revoltTurns - city.revoltProgress;
      const held = garrisoned(state, city);
      html += `<div class="row" title="Культура прежнего владельца сильнее. Гарнизон — свой военный юнит силой от ${cfg.garrisonMinStrength} в городе — сдерживает мятеж"><span>Мятеж</span><span class="reason">${
        held ? 'сдерживает гарнизон' : `вернётся к державе ${esc(name(city.revoltFrom))} через ${left} ${turnsWord(left)}`
      }</span></div>`;
    }
    if (city.pressureFrom !== NONE && city.pressure > 0) {
      const src = pressureSource(state, city);
      const gain = src && src.power === city.pressureFrom ? ` (+${pressureGain(state, src.power, src.ratio)} за ход)` : ' (ослабевает)';
      html += `<div class="row" title="Сосед с намного более сильной культурой постепенно склоняет приграничный город к себе"><span>Культурное давление</span><span>${esc(name(city.pressureFrom))}: ${city.pressure} / ${cfg.pressureThreshold}${gain}</span></div>`;
    }
    if (city.project) {
      html += `<div class="row"><span>${esc(projectName(city.project.kind))}</span><span>этап ${city.project.stages} из ${PROJECT_STAGES}</span></div>`;
    }
    const p = state.powers[city.owner];
    if (city.owner === this.power && p.secession?.cityId === city.id) {
      html += `<div class="reason">Мятежи: город отделится через ${Math.max(0, p.secession.due - state.turn)} х., если стабильность не поднимется до ${pathsConfig.stability.secessionBelow}</div>`;
    }
    return html;
  }

  /** Финальные проекты в своём городе. */
  private projectBlock(city: City): string {
    const state = this.state;
    let html = '';
    for (const kind of ['science', 'culture'] as const) {
      const elsewhere = projectCity(state, this.power, kind);
      if (elsewhere && elsewhere.id !== city.id) continue;
      if (city.project && city.project.kind !== kind) continue;
      const cost = projectStageCost(city, kind);
      if (cost === null) continue;
      const cmd: Command = { type: 'BuyProjectStage', power: this.power, cityId: city.id, kind };
      const stage = (city.project?.kind === kind ? city.project.stages : 0) + 1;
      html += this.cmdButton(`${projectName(kind)}: этап ${stage} из ${PROJECT_STAGES}`, `${cost} ${kind === 'science' ? '🔬' : '🎭'}`, cmd);
    }
    return html ? `<h3>Финальные проекты</h3><div class="actions">${html}</div>` : '';
  }

  /** Саботаж в чужом городе. */
  private foreignCityActions(city: City): string {
    const state = this.state;
    if (!state.powers[this.power].met.includes(city.owner) || !city.buildings.length) return '';
    let html = '';
    for (const b of city.buildings) {
      const use = { ...NO_TARGET, ability: 'sabotage' as const, cityId: city.id, building: b };
      html += this.cmdButton(`Саботаж: «${buildingDef(b).name}»`, `${abilityCost(state, this.power, use)} 🔬`, { type: 'UseAbility', power: this.power, ...use }, false);
    }
    return `<h3>Саботаж (${pathsConfig.abilities.sabotage.turns} ходов)</h3><div class="actions">${html}</div>`;
  }

  private renderTileInfo(): void {
    const t = this.hover;
    const state = this.state;
    if (t < 0 || !state.powers[this.power].explored[t]) {
      this.ui.tileinfo.textContent = '';
      return;
    }
    const def = terrainDefs[TERRAINS[state.map.terrain[t]]];
    const parts: string[] = [def.name];
    if (def.moveCost === null) parts.push('непроходимо');
    else parts.push(def.land ? `движение ${def.moveCost}` : 'погрузка с берега заканчивает ход');
    if (def.defenseBonus) parts.push(`+${def.defenseBonus * 100}% защитнику`);
    const sp = SPECIALS[state.map.special[t]];
    if (sp) {
      const y = Object.entries(specialYields[sp]).map(([k, v]) => `+${v} ${RES_NAMES[k]}`).join(', ');
      parts.push(`${SPECIAL_NAMES[sp]} (${y} городу)`);
    }
    const owner = state.territory.owner[t];
    if (owner !== NONE) {
      const city = findCity(state, state.territory.city[t]);
      parts.push(`${state.powers[owner].name}${city ? `, ${city.name}` : ''}`);
    }
    const unit = this.selectedUnit();
    if (unit && unit.type === 'citizen' && owner === NONE && def.land && def.moveCost !== null) {
      const claim = checkClaim(state, this.power, t);
      parts.push(claim.ok ? `житель разметит → ${claim.city.name}` : `не разметить: ${claim.reason.toLowerCase()}`);
    }
    if (!this.visible[t]) parts.push('вне обзора');
    this.ui.tileinfo.textContent = parts.join(' · ');
  }

  /** Короткое сообщение поверх карты. */
  notify(text: string): void {
    this.toast(text);
  }

  private toast(text: string): void {
    const el = this.ui.toast;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
  }
}
