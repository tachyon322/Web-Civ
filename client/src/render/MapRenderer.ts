// Отрисовка карты на PixiJS.
// Скорость: карта делится на куски, каждый кусок рисуется один раз и перерисовывается только
// при изменении (подпись куска); куски за краем экрана отсекаются; кадр рисуется по требованию.

import { Application, Container, Culler, Graphics, Rectangle, Text } from 'pixi.js';
import { neighborInDirection, neighbors, type MapSize } from '../core/hex';
import { atWar, cityMaxDurability, unitMaxStrength } from '../core/state';
import { computeVisible } from '../core/visibility';
import {
  NONE,
  S_GOLD,
  S_MARBLE,
  S_RUINS,
  T_MOUNTAIN,
  T_ROUGH,
  T_WATER,
  type City,
  type GameState,
  type Unit,
  type UnitType,
} from '../core/types';
import { EDGE_CORNERS, HEX_SIZE, TILT, hexCorners, pixelToTile, tileCenter, worldSize } from './layout';
import { hexColor, palette } from './palette';

const CHUNK = 16;
const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
/** Ниже этого масштаба подписи и мелкие детали не рисуются. */
const LABEL_MIN_SCALE = 0.45;

export interface Overlay {
  selectedTile: number;
  /** Клетки, достижимые в этом ходу. */
  reachable: Iterable<number> | null;
  /** Путь без стартовой клетки; первые thisTurn шагов будут пройдены в этом ходу. */
  path: { from: number; tiles: number[]; thisTurn: number } | null;
  /** Клетки городов сети, куда возможна переброска. */
  networkTiles: number[];
  /** Цели, которые выбранный юнит может атаковать. */
  attackTiles: number[];
  /** Города, которые выбранный юнит может захватить. */
  captureTiles: number[];
  /** Свои юниты, с которыми можно слиться. */
  mergeTiles: number[];
}

export const EMPTY_OVERLAY: Overlay = {
  selectedTile: NONE,
  reachable: null,
  path: null,
  networkTiles: [],
  attackTiles: [],
  captureTiles: [],
  mergeTiles: [],
};

interface Chunk {
  tiles: number[];
  area: Rectangle;
  terrain: Graphics;
  territory: Graphics;
  fog: Graphics;
  territorySig: number;
  fogSig: number;
}

interface CityView {
  key: string;
  body: Graphics;
  label: Text;
}

function drawStar(g: Graphics, cx: number, cy: number, r: number): void {
  const pts: number[] = [];
  for (let k = 0; k < 10; k++) {
    const rr = k % 2 === 0 ? r : r * 0.45;
    const a = (Math.PI / 5) * k - Math.PI / 2;
    pts.push(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
  }
  g.poly(pts).fill(palette.gold).stroke({ width: 0.8, color: 0x6b5208 });
}

/** Значок типа юнита белым по цвету державы. */
function drawUnitGlyph(g: Graphics, type: UnitType, x: number, y: number): void {
  const white = 0xffffff;
  if (type === 'citizen') {
    g.circle(x, y - 4, 3).fill(white);
    g.roundRect(x - 4, y, 8, 6, 2).fill(white);
  } else if (type === 'warrior') {
    // Меч остриём вверх.
    g.poly([x - 1.5, y + 3, x - 1.5, y - 6, x, y - 8.5, x + 1.5, y - 6, x + 1.5, y + 3]).fill(white);
    g.rect(x - 5, y + 2, 10, 2).fill(white);
    g.rect(x - 1, y + 4, 2, 4).fill(white);
  } else if (type === 'archer') {
    // Лук и стрела.
    g.arc(x + 1, y, 7.5, Math.PI * 0.6, Math.PI * 1.4).stroke({ width: 2, color: white });
    g.moveTo(x - 2.5, y - 7).lineTo(x - 2.5, y + 7).stroke({ width: 1, color: white });
    g.moveTo(x - 4, y).lineTo(x + 7, y).stroke({ width: 1.5, color: white });
    g.poly([x + 7, y - 2.5, x + 9.5, y, x + 7, y + 2.5]).fill(white);
  } else {
    // Голова коня.
    g.poly([x - 5, y + 7, x - 4, y - 1, x - 1, y - 7, x + 1, y - 9, x + 2, y - 6, x + 7, y - 2, x + 6, y + 1, x + 1, y, x + 2, y + 7]).fill(white);
  }
}

function drawHouse(g: Graphics, x: number, y: number): void {
  g.rect(x - 4, y - 3, 8, 7).fill(0xf4efe6).stroke({ width: 1, color: 0x333333 });
  g.poly([x - 6, y - 3, x, y - 9, x + 6, y - 3]).fill(0x9c3d2e).stroke({ width: 1, color: 0x333333 });
}

function mix(h: number, v: number): number {
  return (Math.imul(h ^ v, 0x01000193) + 0x9e3779b9) | 0;
}

export class MapRenderer {
  readonly app: Application;
  readonly world = new Container();
  onViewChange: (() => void) | null = null;

  private terrainLayer = new Container();
  private territoryLayer = new Container();
  private reachLayer = new Graphics();
  private cityLayer = new Container();
  private unitLayer = new Graphics();
  private fogLayer = new Container();
  private labelLayer = new Container();
  private topLayer = new Graphics();

  private state: GameState | null = null;
  private size: MapSize = { width: 0, height: 0 };
  private chunks: Chunk[] = [];
  private cityViews = new Map<number, CityView>();
  private visible: Uint8Array = new Uint8Array(0);
  private overlay: Overlay = EMPTY_OVERLAY;
  private renderQueued = false;

  private constructor(app: Application) {
    this.app = app;
    this.world.addChild(
      this.terrainLayer,
      this.territoryLayer,
      this.reachLayer,
      this.cityLayer,
      this.unitLayer,
      this.fogLayer,
      this.labelLayer,
      this.topLayer,
    );
    app.stage.addChild(this.world);
    window.addEventListener('resize', () => this.requestRender());
  }

  static async create(parent: HTMLElement): Promise<MapRenderer> {
    const app = new Application();
    await app.init({
      resizeTo: parent,
      autoStart: false,
      antialias: true,
      background: palette.background,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    // Без постоянного тикера кадр рисуется только по запросу.
    app.ticker.stop();
    parent.appendChild(app.canvas);
    return new MapRenderer(app);
  }

  /** Новая партия: статичные куски местности рисуются один раз. */
  setGame(state: GameState): void {
    this.state = state;
    this.size = { width: state.map.width, height: state.map.height };
    for (const layer of [this.terrainLayer, this.territoryLayer, this.fogLayer, this.cityLayer, this.labelLayer]) {
      layer.removeChildren().forEach((c) => c.destroy());
    }
    this.cityViews.clear();
    this.chunks = [];
    for (let cr = 0; cr < this.size.height; cr += CHUNK) {
      for (let cc = 0; cc < this.size.width; cc += CHUNK) {
        const tiles: number[] = [];
        for (let r = cr; r < Math.min(cr + CHUNK, this.size.height); r++) {
          for (let c = cc; c < Math.min(cc + CHUNK, this.size.width); c++) tiles.push(r * this.size.width + c);
        }
        const area = this.chunkArea(tiles);
        const chunk: Chunk = {
          tiles,
          area,
          terrain: new Graphics(),
          territory: new Graphics(),
          fog: new Graphics(),
          territorySig: NaN,
          fogSig: NaN,
        };
        for (const g of [chunk.terrain, chunk.territory, chunk.fog]) {
          g.cullable = true;
          g.cullArea = area;
        }
        this.drawTerrain(chunk);
        this.terrainLayer.addChild(chunk.terrain);
        this.territoryLayer.addChild(chunk.territory);
        this.fogLayer.addChild(chunk.fog);
        this.chunks.push(chunk);
      }
    }
    this.overlay = EMPTY_OVERLAY;
    this.refresh(state);
  }

  /** Обновляет изменившиеся куски, города и юниты после команды. */
  refresh(state: GameState): void {
    this.state = state;
    const human = state.humanPower;
    this.visible = computeVisible(state, human);
    const explored = state.powers[human].explored;
    for (const chunk of this.chunks) {
      const tSig = this.territorySignature(chunk, explored);
      if (tSig !== chunk.territorySig) {
        chunk.territorySig = tSig;
        this.drawTerritory(chunk, explored);
      }
      const fSig = this.fogSignature(chunk, explored);
      if (fSig !== chunk.fogSig) {
        chunk.fogSig = fSig;
        this.drawFog(chunk, explored);
      }
    }
    this.drawCities(explored);
    this.drawUnits();
    this.drawOverlay();
    this.requestRender();
  }

  setOverlay(overlay: Overlay): void {
    this.overlay = overlay;
    this.drawUnits();
    this.drawOverlay();
    this.requestRender();
  }

  // ---------- Камера ----------

  get scale(): number {
    return this.world.scale.x;
  }

  screenToTile(sx: number, sy: number): number {
    const x = (sx - this.world.x) / this.scale;
    const y = (sy - this.world.y) / this.scale;
    return pixelToTile(this.size, x, y);
  }

  panBy(dx: number, dy: number): void {
    this.world.x += dx;
    this.world.y += dy;
    this.clampCamera();
    this.viewChanged();
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const old = this.scale;
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, old * factor));
    if (next === old) return;
    const wx = (sx - this.world.x) / old;
    const wy = (sy - this.world.y) / old;
    this.world.scale.set(next);
    this.world.x = sx - wx * next;
    this.world.y = sy - wy * next;
    this.clampCamera();
    this.labelLayer.visible = next >= LABEL_MIN_SCALE;
    this.viewChanged();
  }

  centerOn(tile: number): void {
    const { x, y } = tileCenter(this.size, tile);
    this.centerOnWorld(x, y);
  }

  centerOnWorld(x: number, y: number): void {
    const screen = this.app.screen;
    this.world.x = screen.width / 2 - x * this.scale;
    this.world.y = screen.height / 2 - y * this.scale;
    this.clampCamera();
    this.viewChanged();
  }

  /** Видимая область в мировых координатах — для рамки на мини-карте. */
  viewRect(): Rectangle {
    const s = this.scale;
    const screen = this.app.screen;
    return new Rectangle(-this.world.x / s, -this.world.y / s, screen.width / s, screen.height / s);
  }

  worldSize(): { width: number; height: number } {
    return worldSize(this.size);
  }

  private clampCamera(): void {
    const screen = this.app.screen;
    const w = worldSize(this.size);
    const s = this.scale;
    const margin = 200;
    this.world.x = Math.min(margin, Math.max(screen.width - w.width * s - margin, this.world.x));
    this.world.y = Math.min(margin, Math.max(screen.height - w.height * s - margin, this.world.y));
  }

  private viewChanged(): void {
    this.requestRender();
    this.onViewChange?.();
  }

  requestRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      const screen = this.app.screen;
      Culler.shared.cull(this.world, { x: 0, y: 0, width: screen.width, height: screen.height }, false);
      this.app.render();
    });
  }

  // ---------- Куски карты ----------

  private chunkArea(tiles: number[]): Rectangle {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of tiles) {
      const { x, y } = tileCenter(this.size, t);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    // Запас на сам гекс и на «высоту» гор.
    const pad = HEX_SIZE * 1.6;
    return new Rectangle(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
  }

  private drawTerrain(chunk: Chunk): void {
    const g = chunk.terrain;
    const state = this.state!;
    const { terrain, special } = state.map;
    // Сначала все основания, потом объёмные детали — чтобы горы не перекрывались соседними гексами.
    for (const t of chunk.tiles) {
      const { x, y } = tileCenter(this.size, t);
      const pts = hexCorners(x, y, 1.01);
      const type = terrain[t];
      let color: number;
      if (type === T_WATER) {
        const coast = neighbors(this.size, t).some((n) => terrain[n] !== T_WATER);
        color = coast ? palette.shallowWater : palette.deepWater;
      } else if (type === T_ROUGH) {
        color = palette.rough;
      } else if (type === T_MOUNTAIN) {
        color = palette.mountainShade;
      } else {
        color = (t * 2654435761) >>> 0 > 2147483648 ? palette.plains : palette.plainsAlt;
      }
      g.poly(pts).fill(color);
      if (type !== T_WATER) g.poly(hexCorners(x, y, 1)).stroke({ width: 1, color: palette.gridLine, alpha: 0.12 });
    }
    for (const t of chunk.tiles) {
      const { x, y } = tileCenter(this.size, t);
      const type = terrain[t];
      if (type === T_ROUGH) this.drawTrees(g, x, y, t);
      else if (type === T_MOUNTAIN) this.drawMountain(g, x, y);
      const sp = special[t];
      if (sp !== 0) this.drawSpecial(g, x, y, sp);
    }
  }

  private drawTrees(g: Graphics, x: number, y: number, seed: number): void {
    const offsets = [
      [-9, 2],
      [6, -4],
      [3, 8],
    ];
    offsets.forEach(([dx, dy], i) => {
      const jitter = ((seed * (i + 3) * 7919) % 5) - 2;
      const tx = x + dx + jitter;
      const ty = y + dy * TILT;
      g.poly([tx, ty - 10, tx + 6, ty + 2, tx - 6, ty + 2]).fill(palette.tree);
      g.rect(tx - 1, ty + 2, 2, 3).fill(0x4a3626);
    });
  }

  private drawMountain(g: Graphics, x: number, y: number): void {
    const base = y + 8;
    g.poly([x - 18, base, x - 2, y - 22, x + 16, base]).fill(palette.mountain);
    g.poly([x - 2, y - 22, x + 16, base, x + 4, base]).fill(palette.mountainShade);
    g.poly([x - 7, y - 11, x - 2, y - 22, x + 3, y - 12, x - 2, y - 14]).fill(palette.snow);
  }

  private drawSpecial(g: Graphics, x: number, y: number, sp: number): void {
    const cx = x + 12;
    const cy = y - 10;
    g.circle(cx, cy, 8).fill({ color: 0x000000, alpha: 0.35 });
    if (sp === S_GOLD) {
      g.circle(cx, cy, 6).fill(palette.gold).stroke({ width: 1.5, color: 0x8a6a10 });
      g.rect(cx - 1, cy - 3, 2, 6).fill(0x8a6a10);
    } else if (sp === S_MARBLE) {
      g.poly([cx, cy - 7, cx + 6, cy, cx, cy + 7, cx - 6, cy]).fill(palette.marble).stroke({ width: 1.5, color: 0x8f8f8f });
    } else if (sp === S_RUINS) {
      g.rect(cx - 6, cy - 6, 12, 2).fill(palette.ruins);
      g.rect(cx - 5, cy - 4, 2, 9).fill(palette.ruins);
      g.rect(cx + 3, cy - 4, 2, 9).fill(palette.ruins);
      g.rect(cx - 7, cy + 5, 14, 2).fill(palette.ruins);
    }
  }

  private territorySignature(chunk: Chunk, explored: number[]): number {
    const { owner } = this.state!.territory;
    let h = 17;
    for (const t of chunk.tiles) {
      h = mix(h, owner[t] + 2 + explored[t] * 64);
      for (const n of neighbors(this.size, t)) h = mix(h, owner[n] + 2);
    }
    return h;
  }

  private fogSignature(chunk: Chunk, explored: number[]): number {
    let h = 31;
    for (const t of chunk.tiles) h = mix(h, explored[t] * 2 + this.visible[t]);
    return h;
  }

  private drawTerritory(chunk: Chunk, explored: number[]): void {
    const g = chunk.territory;
    g.clear();
    const state = this.state!;
    const { owner } = state.territory;
    for (const t of chunk.tiles) {
      const o = owner[t];
      if (o === NONE || !explored[t]) continue;
      const color = hexColor(state.powers[o].color);
      const { x, y } = tileCenter(this.size, t);
      g.poly(hexCorners(x, y, 1)).fill({ color, alpha: 0.22 });
      const inner = hexCorners(x, y, 0.92);
      for (let dir = 0; dir < 6; dir++) {
        const n = neighborInDirection(this.size, t, dir);
        if (n >= 0 && owner[n] === o) continue;
        const [a, b] = EDGE_CORNERS[dir];
        g.moveTo(inner[a * 2], inner[a * 2 + 1]).lineTo(inner[b * 2], inner[b * 2 + 1]);
      }
      g.stroke({ width: 3, color, alpha: 0.95, cap: 'round' });
    }
  }

  private drawFog(chunk: Chunk, explored: number[]): void {
    const g = chunk.fog;
    g.clear();
    for (const t of chunk.tiles) {
      if (this.visible[t]) continue;
      const { x, y } = tileCenter(this.size, t);
      if (!explored[t]) g.poly(hexCorners(x, y, 1.04)).fill(palette.unexplored);
      else g.poly(hexCorners(x, y, 1.01)).fill({ color: 0x000000, alpha: palette.fogAlpha });
    }
  }

  // ---------- Города и юниты ----------

  private drawCities(explored: number[]): void {
    const state = this.state!;
    const alive = new Set<number>();
    for (const city of state.cities) {
      if (!explored[city.tile]) continue;
      alive.add(city.id);
      const key = `${city.owner}|${city.level}|${city.name}|${city.isCapital}|${city.durability}|${cityMaxDurability(city)}`;
      let view = this.cityViews.get(city.id);
      if (view && view.key !== key) {
        view.body.destroy();
        view.label.destroy();
        view = undefined;
      }
      if (!view) {
        view = this.createCityView(city, key);
        this.cityViews.set(city.id, view);
      }
    }
    for (const [id, view] of this.cityViews) {
      if (alive.has(id)) continue;
      view.body.destroy();
      view.label.destroy();
      this.cityViews.delete(id);
    }
  }

  private createCityView(city: City, key: string): CityView {
    const state = this.state!;
    const color = hexColor(state.powers[city.owner].color);
    const { x, y } = tileCenter(this.size, city.tile);
    const body = new Graphics();
    body.poly(hexCorners(x, y, 0.7)).fill(color).stroke({ width: 2, color: 0x1a1a1a });
    // Домики: число растёт с уровнем города.
    const houses = Math.min(3, 1 + Math.floor(city.level / 2));
    for (let i = 0; i < houses; i++) {
      const hx = x - (houses - 1) * 6 + i * 12;
      const hy = y + (i % 2 === 0 ? 0 : -4);
      drawHouse(body, hx, hy);
    }
    if (city.isCapital) {
      const sx = x;
      const sy = y - 20;
      const star: number[] = [];
      for (let k = 0; k < 10; k++) {
        const r = k % 2 === 0 ? 6 : 2.6;
        const a = (Math.PI / 5) * k - Math.PI / 2;
        star.push(sx + r * Math.cos(a), sy + r * Math.sin(a));
      }
      body.poly(star).fill(palette.gold).stroke({ width: 1, color: 0x6b5208 });
    }
    // Прочность — квадратики над городом: заполненные — оставшаяся.
    const maxDur = cityMaxDurability(city);
    for (let i = 0; i < maxDur; i++) {
      const px = x - (maxDur * 7) / 2 + i * 7;
      body.rect(px, y + 10, 5, 4).fill(i < city.durability ? 0xe8e8e8 : 0x3a3a3a).stroke({ width: 1, color: 0x111111 });
    }
    body.cullable = true;
    this.cityLayer.addChild(body);

    const label = new Text({
      text: `${city.name} · ${city.level}`,
      style: {
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        fontWeight: '600',
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
      },
      resolution: 2,
    });
    label.anchor.set(0.5, 0);
    label.position.set(x, y + 16);
    label.cullable = true;
    this.labelLayer.addChild(label);
    return { key, body, label };
  }

  private drawUnits(): void {
    const g = this.unitLayer;
    g.clear();
    const state = this.state;
    if (!state) return;
    for (const unit of state.units) {
      if (unit.owner !== state.humanPower && !this.visible[unit.tile]) continue;
      this.drawUnit(g, unit, unit.tile === this.overlay.selectedTile);
    }
  }

  private drawUnit(g: Graphics, unit: Unit, selected: boolean): void {
    const state = this.state!;
    const { x, y } = tileCenter(this.size, unit.tile);
    const onCity = state.cities.some((c) => c.tile === unit.tile);
    const ux = onCity ? x - 15 : x;
    const uy = onCity ? y + 2 : y - 4;
    const color = hexColor(state.powers[unit.owner].color);
    const enemy = atWar(state, state.humanPower, unit.owner);
    g.ellipse(ux, uy + 12, 11, 4).fill({ color: 0x000000, alpha: 0.3 });
    if (selected) g.circle(ux, uy, 16).stroke({ width: 3, color: palette.highlight });
    g.circle(ux, uy, 12).fill(color).stroke({ width: enemy ? 3 : 2, color: enemy ? 0xe0342b : 0x141414 });
    drawUnitGlyph(g, unit.type, ux, uy);

    // Уровень — точки над фишкой, сила — полоска под ней.
    for (let i = 0; i < unit.level; i++) {
      g.circle(ux - (unit.level - 1) * 3 + i * 6, uy - 16, 2).fill(0xffffff).stroke({ width: 1, color: 0x141414 });
    }
    const share = Math.max(0, Math.min(1, unit.strength / unitMaxStrength(unit)));
    g.rect(ux - 11, uy + 14, 22, 4).fill(0x1a1a1a);
    g.rect(ux - 11, uy + 14, 22 * share, 4).fill(share > 0.6 ? 0x5fe36b : share > 0.3 ? 0xf5c542 : 0xe0342b);
    for (let i = 0; i < unit.stars; i++) drawStar(g, ux - 16, uy - 8 + i * 7, 3.2);

    if (unit.owner === state.humanPower) {
      const dot = unit.routeTarget !== NONE ? 0x7fb3ff : unit.mp > 0 ? 0x5fe36b : 0x8a8a8a;
      g.circle(ux + 10, uy + 9, 3.5).fill(dot).stroke({ width: 1, color: 0x141414 });
      if (unit.fortified) g.rect(ux + 7, uy - 13, 6, 6).fill(0xb8c4d6).stroke({ width: 1, color: 0x141414 });
    }
  }

  private drawOverlay(): void {
    const reach = this.reachLayer;
    const top = this.topLayer;
    reach.clear();
    top.clear();
    const o = this.overlay;
    if (o.reachable) {
      for (const t of o.reachable) {
        const { x, y } = tileCenter(this.size, t);
        reach.poly(hexCorners(x, y, 0.9)).fill({ color: palette.reach, alpha: 0.16 });
      }
    }
    const ring = (tiles: number[], color: number) => {
      for (const t of tiles) {
        const { x, y } = tileCenter(this.size, t);
        top.poly(hexCorners(x, y, 0.95)).stroke({ width: 3, color, alpha: 0.9 });
      }
    };
    ring(o.networkTiles, palette.network);
    ring(o.mergeTiles, palette.merge);
    ring(o.attackTiles, palette.attack);
    ring(o.captureTiles, palette.capture);
    if (o.selectedTile !== NONE) {
      const { x, y } = tileCenter(this.size, o.selectedTile);
      top.poly(hexCorners(x, y, 0.97)).stroke({ width: 2.5, color: palette.highlight });
    }
    if (o.path && o.path.tiles.length) {
      let prev = tileCenter(this.size, o.path.from);
      o.path.tiles.forEach((t, i) => {
        const cur = tileCenter(this.size, t);
        const now = i < o.path!.thisTurn;
        top.moveTo(prev.x, prev.y).lineTo(cur.x, cur.y).stroke({
          width: now ? 4 : 3,
          color: now ? palette.path : palette.pathLater,
          alpha: now ? 0.95 : 0.7,
          cap: 'round',
        });
        prev = cur;
      });
      const end = tileCenter(this.size, o.path.tiles[o.path.tiles.length - 1]);
      const done = o.path.thisTurn === o.path.tiles.length;
      top.circle(end.x, end.y, 6).fill(done ? palette.path : palette.pathLater).stroke({ width: 2, color: 0x141414 });
    }
  }
}
