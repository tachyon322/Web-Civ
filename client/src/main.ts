import './ui/styles.css';
import { newGame } from './core';
import { MapRenderer } from './render/MapRenderer';
import { Minimap } from './render/minimap';
import { GameController } from './ui/controller';
import { attachMapInput } from './ui/input';
import { showNewGameDialog } from './ui/newGame';

async function main(): Promise<void> {
  const app = document.getElementById('app')!;
  document.body.classList.add('no-game');
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

  const renderer = await MapRenderer.create(el('map'));
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

  const startDialog = (canCancel: boolean) =>
    showNewGameDialog((settings) => controller.start(newGame(settings)), canCancel);
  controller.onNewGame = () => startDialog(true);
  // Отладка в консоли браузера: только в режиме разработки.
  if (import.meta.env.DEV) Object.assign(window, { __civ: { controller, renderer } });
  startDialog(false);
}

void main();
