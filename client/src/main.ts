import './ui/styles.css';
import { audio } from './audio';
import { newGame, type GameState } from './core';
import { loadIdentity, apiLogin, sendEvent } from './net/analytics';
import { MapRenderer } from './render/MapRenderer';
import { Minimap } from './render/minimap';
import { AUTO_SLOT, SaveStore } from './save/storage';
import { GameController } from './ui/controller';
import { installIcons } from './ui/icons';
import { attachMapInput } from './ui/input';
import { showLogin, showMainMenu, type MenuHost } from './ui/menu';
import { showNewGameDialog } from './ui/newGame';
import { loadSettings, saveSettings, type Settings } from './ui/settings';

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  document.body.classList.add('no-game');
  installIcons();
  app.innerHTML = `
    <div id="map"></div>
    <header id="topbar" class="panel"></header>
    <aside id="log" class="panel"></aside>
    <section id="panel" class="panel"></section>
    <div id="forecast" class="panel"></div>
    <div id="tileinfo" class="panel"></div>
    <div id="corner" class="panel">
      <button id="endturn">Завершить ход ⏎</button>
      <canvas id="minimap"></canvas>
    </div>
    <div id="toast" class="panel"></div>`;
  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  let settings = loadSettings();
  audio.setVolumes(settings.musicVolume, settings.sfxVolume);
  audio.install();
  const renderer = await MapRenderer.create(el('map'));
  renderer.setSimpleGraphics(settings.simpleGraphics);
  const minimap = new Minimap(el<HTMLCanvasElement>('minimap'), renderer);
  const controller = new GameController(renderer, minimap, {
    topbar: el('topbar'),
    panel: el('panel'),
    log: el('log'),
    tileinfo: el('tileinfo'),
    forecast: el('forecast'),
    toast: el('toast'),
    endTurn: el<HTMLButtonElement>('endturn'),
  });
  attachMapInput(renderer, {
    click: (tile, button) => controller.onTileClick(tile, button),
    hover: (tile) => controller.onTileHover(tile),
  });

  const saves = new SaveStore();
  const autosave = (state: GameState) => {
    saves.save(AUTO_SLOT, state).catch((err: Error) => controller.notify(`Автосохранение не удалось: ${err.message}`));
  };
  const finished = (state: GameState) => !!state.winner || !state.powers[state.humanPower].alive;

  /** Партию, которую не доиграли, бросают, когда начинают новую. */
  const abandonCurrent = () => {
    const current = controller.current;
    if (current && !finished(current)) sendEvent({ type: 'game_abandon', data: { turn: current.turn } });
    else if (!current) {
      const auto = saves.list()[AUTO_SLOT];
      if (auto && !auto.finished) sendEvent({ type: 'game_abandon', data: { turn: auto.turn } });
    }
  };

  const host: MenuHost = {
    saves,
    identity: loadIdentity,
    current: () => controller.current,
    newGame: () =>
      showNewGameDialog(
        (gameSettings) => {
          abandonCurrent();
          const state = newGame(gameSettings);
          controller.start(state);
          const human = state.powers[state.humanPower];
          sendEvent({
            type: 'game_start',
            data: { nation: human.nationId, powers: state.powers.length, difficulty: state.settings.difficulty, seed: state.settings.seed },
          });
          autosave(state);
        },
        () => showMainMenu(host, !!controller.current),
      ),
    load: (state) => {
      controller.start(state);
      autosave(state);
    },
    settings: () => settings,
    applySettings: (next: Settings) => {
      settings = next;
      saveSettings(next);
      renderer.setSimpleGraphics(next.simpleGraphics);
      audio.setVolumes(next.musicVolume, next.sfxVolume);
    },
    notify: (text) => controller.notify(text),
  };

  controller.onNewGame = () => host.newGame();
  controller.onMenu = () => showMainMenu(host, true);
  controller.onTurnEnd = autosave;
  controller.onGameOver = (state) => {
    const w = state.winner;
    const win = !!w && w.power === state.humanPower;
    sendEvent({ type: 'game_end', data: { result: win ? 'win' : 'loss', victory: w ? w.kind : null, turns: state.turn } });
    autosave(state);
  };

  // Отладка в консоли браузера: только в режиме разработки.
  if (import.meta.env.DEV) Object.assign(window, { __civ: { controller, renderer, saves } });

  const identity = loadIdentity();
  if (identity) {
    void apiLogin(identity); // визит отмечается молча; без сервера игра идёт как обычно
    showMainMenu(host, false);
  } else showLogin(null, () => showMainMenu(host, false));
}

void main();
