// Отрисовка карты на PixiJS.
// Скорость: карта делится на куски, каждый кусок рисуется один раз и перерисовывается только
// при изменении (подпись куска); куски за краем экрана отсекаются; кадр рисуется по требованию.

import { Application, Container, Culler, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { distance, neighborInDirection, neighbors, type MapSize } from '../core/hex';
import { buildingDef } from '../core/data';
import { atWar, cityMaxDurability, hasBuildingEffect, unitMaxStrength } from '../core/state';
import { moodLevel, opinion } from '../core/relations';
import { MOOD_H, MOOD_W, moodSvg } from '../ui/moods';
import { epochOf } from '../core/epochs';
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
import { iconSvg, type IconName } from '../ui/icons';
import { EDGE_CORNERS, HEX_SIZE, TILT, hexCorners, pixelToTile, tileCenter, worldSize } from './layout';
import { darken, hexColor, palette } from './palette';
import { ART_ANCHOR, ART_H, ART_W, drawUnitArt, hasUnitArt, unitArtHeight } from './sprites/art';
import { SpriteCache } from './sprites/cache';
import { CITY_ANCHOR, CITY_SPRITE_H, CITY_SPRITE_W, citySvg } from './sprites/cities';
import { UNIT_ANCHOR, UNIT_SPRITE_H, UNIT_SPRITE_W, figuresForLevel, unitSvg } from './sprites/units';

const CHUNK = 16;
const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
/** Ниже этого масштаба подписи и мелкие детали не рисуются. */
const LABEL_MIN_SCALE = 0.45;
/** Масштаб спрайтов на карте (гекс — около 55 пикселей в ширину). */
const UNIT_SCALE = 1;
/** Иконки особых клеток на карте и их размер. */
const SPECIAL_ICONS: Record<number, IconName> = { [S_GOLD]: 'gold', [S_MARBLE]: 'marble', [S_RUINS]: 'ruins' };
const SPECIAL_ICON_SIZE = 20;
const CITY_SCALE = 0.95;
/** Объём (в пикселях мира): обрыв суши к воде и подъём холмов и гор над равниной. */
const COAST_DEPTH = 6;
const ROUGH_LIFT = 3;
const MOUNTAIN_LIFT = 4;

function terrainLift(type: number): number {
  return type === T_ROUGH ? ROUGH_LIFT : type === T_MOUNTAIN ? MOUNTAIN_LIFT : 0;
}

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
  /** Клетки, которые выбранный житель разметит, если войдёт. */
  claimTiles: number[];
}

/** Пустая подсветка — каждый раз новая, чтобы массивы не копились между выделениями. */
export function emptyOverlay(): Overlay {
  return {
    selectedTile: NONE,
    reachable: null,
    path: null,
    networkTiles: [],
    attackTiles: [],
    captureTiles: [],
    mergeTiles: [],
    claimTiles: [],
  };
}

interface Chunk {
  tiles: number[];
  area: Rectangle;
  /** Вода, суша (верх и боковые грани), детали (деревья, горы, тени, особые клетки) — отдельно, чтобы
   * грани и горы соседнего куска не перекрывались его водой и сушей. */
  water: Graphics;
  land: Graphics;
  decor: Graphics;
  territory: Graphics;
  fog: Graphics;
  territorySig: number;
  fogSig: number;
}

interface CityView {
  key: string;
  body: Graphics;
  label: Text;
  /** Спрайт города (нет в простой графике) и ключ его текстуры. */
  sprite: Sprite | null;
  spriteKey: string;
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

const WHITE = 0xffffff;

/** Дуга с собственной начальной точкой: иначе PixiJS тянет к ней линию от предыдущей точки пути. */
function arcFrom(g: Graphics, cx: number, cy: number, r: number, a0: number, a1: number): Graphics {
  return g.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0)).arc(cx, cy, r, a0, a1);
}

function drawSword(g: Graphics, x: number, y: number, scale = 1): void {
  const k = scale;
  g.poly([x - 1.5 * k, y + 3 * k, x - 1.5 * k, y - 6 * k, x, y - 8.5 * k, x + 1.5 * k, y - 6 * k, x + 1.5 * k, y + 3 * k]).fill(WHITE);
  g.rect(x - 5 * k, y + 2 * k, 10 * k, 2 * k).fill(WHITE);
  g.rect(x - 1 * k, y + 4 * k, 2 * k, 4 * k).fill(WHITE);
}

/** Ружьё по диагонали; со штыком — в последнюю эпоху. */
function drawGun(g: Graphics, x: number, y: number, bayonet: boolean): void {
  g.moveTo(x - 6, y + 7).lineTo(x + 6, y - 7).stroke({ width: 2.2, color: WHITE });
  g.poly([x - 8, y + 6, x - 4, y + 9, x - 2, y + 6, x - 5, y + 4]).fill(WHITE);
  if (bayonet) g.moveTo(x + 6, y - 7).lineTo(x + 9, y - 10.5).stroke({ width: 1.2, color: WHITE });
}

function drawHorseHead(g: Graphics, x: number, y: number): void {
  g.poly([x - 5, y + 7, x - 4, y - 1, x - 1, y - 7, x + 1, y - 9, x + 2, y - 6, x + 7, y - 2, x + 6, y + 1, x + 1, y, x + 2, y + 7]).fill(WHITE);
}

/**
 * Значок юнита белым по цвету державы. Эпоха меняет облик, а не тип: воин — дубина, меч, меч со щитом,
 * мушкет, винтовка со штыком; лучник — лук, лук со стрелами, арбалет, пушка, орудие; всадник — конь,
 * с уздой, с копьём, с султаном, с саблей.
 */
function drawUnitGlyph(g: Graphics, type: UnitType, epoch: number, x: number, y: number): void {
  if (type === 'citizen') {
    g.circle(x, y - 4, 3).fill(WHITE);
    g.roundRect(x - 4, y, 8, 6, 2).fill(WHITE);
  } else if (type === 'warrior') {
    if (epoch === 0) {
      g.poly([x - 1.2, y + 8, x - 2.5, y - 3, x - 1, y - 8, x + 2.5, y - 8, x + 3.5, y - 3, x + 1.2, y + 8]).fill(WHITE);
    } else if (epoch === 1) drawSword(g, x, y);
    else if (epoch === 2) {
      g.poly([x - 8, y - 6, x - 1, y - 6, x - 1, y + 1, x - 4.5, y + 7, x - 8, y + 1]).fill(WHITE);
      drawSword(g, x + 4, y, 0.85);
    } else drawGun(g, x, y, epoch >= 4);
  } else if (type === 'archer') {
    if (epoch <= 1) {
      arcFrom(g, x + 1, y, 7.5, Math.PI * 0.6, Math.PI * 1.4).stroke({ width: 2, color: WHITE });
      g.moveTo(x - 2.5, y - 7).lineTo(x - 2.5, y + 7).stroke({ width: 1, color: WHITE });
      g.moveTo(x - 4, y).lineTo(x + 7, y).stroke({ width: 1.5, color: WHITE });
      g.poly([x + 7, y - 2.5, x + 9.5, y, x + 7, y + 2.5]).fill(WHITE);
      if (epoch === 1) {
        g.moveTo(x - 4, y + 4).lineTo(x + 6, y + 4).stroke({ width: 1.2, color: WHITE });
        g.poly([x + 6, y + 2.5, x + 8, y + 4, x + 6, y + 5.5]).fill(WHITE);
      }
    } else if (epoch === 2) {
      arcFrom(g, x, y + 2, 8, Math.PI * 1.15, Math.PI * 1.85).stroke({ width: 2, color: WHITE });
      g.rect(x - 1.2, y - 6, 2.4, 14).fill(WHITE);
      g.moveTo(x - 7, y - 1).lineTo(x + 7, y - 1).stroke({ width: 1, color: WHITE });
    } else {
      // Пушка: ствол и колесо; в последнюю эпоху ствол длиннее.
      const len = epoch >= 4 ? 13 : 10;
      g.poly([x - 6, y + 1, x - 6 + len, y - 6, x - 4 + len, y - 3, x - 4, y + 4]).fill(WHITE);
      g.circle(x - 3, y + 4, 4).stroke({ width: 1.8, color: WHITE });
      if (epoch >= 4) g.rect(x - 9, y + 6, 4, 2).fill(WHITE);
    }
  } else {
    drawHorseHead(g, x, y);
    if (epoch === 1) g.moveTo(x - 3, y - 4).lineTo(x + 5, y + 1).stroke({ width: 1, color: 0x141414 });
    else if (epoch === 2) g.moveTo(x - 9, y + 8).lineTo(x + 9, y - 10).stroke({ width: 1.5, color: WHITE });
    else if (epoch === 3) g.poly([x, y - 8, x - 2, y - 13, x + 3, y - 10]).fill(WHITE);
    else if (epoch >= 4) arcFrom(g, x - 9, y - 2, 8, -Math.PI * 0.45, Math.PI * 0.1).stroke({ width: 1.6, color: WHITE });
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

  private waterLayer = new Container();
  private landLayer = new Container();
  private decorLayer = new Container();
  /** Иконки особых клеток (золото, мрамор, руины) — спрайты поверх деталей местности. */
  private specialLayer = new Container();
  /** Сколько сооружений нарисовано (перерисовать иконки, когда появилось новое). */
  private improvementCount = 0;
  private territoryLayer = new Container();
  private reachLayer = new Graphics();
  private cityLayer = new Container();
  /** Под юнитами — кольца выделения и врага; над ними — полоски силы и значки. */
  private unitUnder = new Graphics();
  private unitSprites = new Container();
  private unitLayer = new Graphics();
  private unitPool: Sprite[] = [];
  private sprites = new SpriteCache();
  private fogLayer = new Container();
  private labelLayer = new Container();
  private moodLayer = new Container();
  private topLayer = new Graphics();

  private state: GameState | null = null;
  private size: MapSize = { width: 0, height: 0 };
  private chunks: Chunk[] = [];
  private cityViews = new Map<number, CityView>();
  private visible: Uint8Array = new Uint8Array(0);
  private overlay: Overlay = emptyOverlay();
  private renderQueued = false;
  /** «Простая графика»: плоские гексы без граней, теней и объёмных деталей. */
  private simple = false;

  private constructor(app: Application) {
    this.app = app;
    this.world.addChild(
      this.waterLayer,
      this.landLayer,
      this.territoryLayer,
      this.decorLayer,
      this.specialLayer,
      this.reachLayer,
      this.cityLayer,
      this.unitUnder,
      this.unitSprites,
      this.unitLayer,
      this.fogLayer,
      this.labelLayer,
      this.moodLayer,
      this.topLayer,
    );
    app.stage.addChild(this.world);
    this.sprites.onLoad = () => this.onSpritesLoaded();
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
    for (const layer of [this.waterLayer, this.landLayer, this.decorLayer, this.specialLayer, this.territoryLayer, this.fogLayer, this.cityLayer, this.labelLayer, this.moodLayer]) {
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
          water: new Graphics(),
          land: new Graphics(),
          decor: new Graphics(),
          territory: new Graphics(),
          fog: new Graphics(),
          territorySig: NaN,
          fogSig: NaN,
        };
        for (const g of [chunk.water, chunk.land, chunk.decor, chunk.territory, chunk.fog]) {
          g.cullable = true;
          g.cullArea = area;
        }
        this.drawTerrain(chunk);
        this.waterLayer.addChild(chunk.water);
        this.landLayer.addChild(chunk.land);
        this.decorLayer.addChild(chunk.decor);
        this.territoryLayer.addChild(chunk.territory);
        this.fogLayer.addChild(chunk.fog);
        this.chunks.push(chunk);
      }
    }
    this.drawSpecials();
    this.overlay = emptyOverlay();
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
    if (state.improvements.length !== this.improvementCount) this.drawSpecials();
    this.drawCities(explored);
    this.drawUnits();
    this.drawOverlay();
    this.requestRender();
  }

  /** Переключает «простую графику»: местность перерисовывается, остальное — при следующем кадре. */
  setSimpleGraphics(simple: boolean): void {
    if (simple === this.simple) return;
    this.simple = simple;
    for (const chunk of this.chunks) this.drawTerrain(chunk);
    this.drawSpecials();
    for (const view of this.cityViews.values()) view.key = '';
    if (this.state) this.refresh(this.state);
  }

  get simpleGraphics(): boolean {
    return this.simple;
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
    const { water, land, decor } = chunk;
    for (const g of [water, land, decor]) g.clear();
    const state = this.state!;
    const { terrain, special } = state.map;
    const simple = this.simple;
    // Вода — ниже суши: в объёмном виде её гекс опущен, а у берега видна боковая грань суши.
    for (const t of chunk.tiles) {
      if (terrain[t] !== T_WATER) continue;
      const { x, y } = tileCenter(this.size, t);
      const coast = neighbors(this.size, t).some((n) => terrain[n] !== T_WATER);
      water.poly(hexCorners(x, y, 1.01)).fill(coast ? palette.shallowWater : palette.deepWater);
      if (coast && !simple) water.poly(hexCorners(x, y, 0.75)).fill({ color: 0xffffff, alpha: 0.05 });
    }
    // Суша по рядам сверху вниз: нижний ряд перекрывает грани верхнего.
    for (const t of chunk.tiles) {
      const type = terrain[t];
      if (type === T_WATER) continue;
      const { x, y } = tileCenter(this.size, t);
      let color: number;
      if (type === T_ROUGH) color = palette.rough;
      else if (type === T_MOUNTAIN) color = simple ? palette.mountain : palette.mountainShade;
      else color = (t * 2654435761) >>> 0 > 2147483648 ? palette.plains : palette.plainsAlt;
      const lift = simple ? 0 : terrainLift(type);
      if (!simple) this.drawSides(land, t, x, y - lift, lift, color);
      land.poly(hexCorners(x, y - lift, 1.01)).fill(color);
      land.poly(hexCorners(x, y - lift, 1)).stroke({ width: 1, color: palette.gridLine, alpha: 0.12 });
    }
    // Детали поверх: тени, деревья, горы, особые клетки.
    for (const t of chunk.tiles) {
      const { x, y } = tileCenter(this.size, t);
      const type = terrain[t];
      if (simple) {
        if (type === T_MOUNTAIN) decor.poly([x - 10, y + 6, x, y - 10, x + 10, y + 6]).fill(palette.mountainShade);
        else if (type === T_ROUGH) decor.poly([x - 5, y + 4, x, y - 6, x + 5, y + 4]).fill(palette.tree);
      } else if (type === T_ROUGH) this.drawTrees(decor, x, y - ROUGH_LIFT, t);
      else if (type === T_MOUNTAIN) this.drawMountain(decor, x, y - MOUNTAIN_LIFT);
      // Подложка под иконку особой клетки (сама иконка — спрайт в specialLayer).
      if (special[t] !== 0) decor.circle(x + 13, y - (simple ? 0 : terrainLift(type)) - 12, 12.5).fill({ color: 0x000000, alpha: 0.4 });
    }
  }

  /**
   * Боковые грани гекса: нижние рёбра, вытянутые вниз до соседа ниже. Высота грани — разница высот:
   * у берега — обрыв к воде, у холма — его подъём над равниной.
   */
  private drawSides(g: Graphics, t: number, x: number, y: number, lift: number, color: number): void {
    const { terrain } = this.state!.map;
    const top = hexCorners(x, y, 1.01);
    // Нижние рёбра: углы 1→2 (юго-восток) и 2→3 (юго-запад); соседи — направления 5 (ЮВ) и 4 (ЮЗ).
    const edges: [number, number, number][] = [
      [1, 2, 5],
      [2, 3, 4],
    ];
    for (const [a, b, dir] of edges) {
      const n = neighborInDirection(this.size, t, dir);
      const below = n < 0 || terrain[n] === T_WATER ? -COAST_DEPTH : terrainLift(terrain[n]);
      const h = lift - below;
      if (h <= 0) continue;
      const shade = below < 0 ? palette.cliff : darken(color, 0.72);
      const [ax, ay, bx, by] = [top[a * 2], top[a * 2 + 1], top[b * 2], top[b * 2 + 1]];
      g.poly([ax, ay, bx, by, bx, by + h, ax, ay + h]).fill(dir === 5 ? shade : darken(shade, 0.85));
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
      g.ellipse(tx + 3, ty + 3, 6, 2.2).fill({ color: 0x000000, alpha: 0.18 });
      g.poly([tx, ty - 10, tx + 6, ty + 2, tx - 6, ty + 2]).fill(palette.tree);
      g.poly([tx, ty - 10, tx + 6, ty + 2, tx + 1, ty + 2]).fill({ color: 0x000000, alpha: 0.15 });
      g.rect(tx - 1, ty + 2, 2, 3).fill(0x4a3626);
    });
  }

  private drawMountain(g: Graphics, x: number, y: number): void {
    const base = y + 8;
    g.poly([x - 2, y - 22, x + 16, base, x + 26, base + 3, x + 6, base + 3]).fill({ color: 0x000000, alpha: 0.18 });
    g.poly([x - 18, base, x - 2, y - 22, x + 16, base]).fill(palette.mountain);
    g.poly([x - 2, y - 22, x + 16, base, x + 4, base]).fill(palette.mountainShade);
    g.poly([x - 7, y - 11, x - 2, y - 22, x + 3, y - 12, x - 2, y - 14]).fill(palette.snow);
  }

  /** Иконки особых клеток; сооружение на клетке — золотое кольцо вокруг иконки.
   *  Перерисовываются целиком: таких клеток мало. */
  private drawSpecials(): void {
    this.specialLayer.removeChildren().forEach((c) => c.destroy());
    const state = this.state;
    if (!state) return;
    this.improvementCount = state.improvements.length;
    const { terrain, special } = state.map;
    const rings = new Graphics();
    for (const t of state.improvements) {
      const { x, y } = tileCenter(this.size, t);
      rings.circle(x + 13, y - (this.simple ? 0 : terrainLift(terrain[t])) - 12, 13.5).stroke({ color: palette.improvement, width: 2.5 });
    }
    this.specialLayer.addChild(rings);
    for (let t = 0; t < special.length; t++) {
      const name = SPECIAL_ICONS[special[t]];
      if (!name) continue;
      const texture = this.sprites.get(`i|${name}`, SPECIAL_ICON_SIZE, SPECIAL_ICON_SIZE, () => iconSvg(name, SPECIAL_ICON_SIZE));
      if (!texture) continue;
      const { x, y } = tileCenter(this.size, t);
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.position.set(x + 13, y - (this.simple ? 0 : terrainLift(terrain[t])) - 12);
      this.specialLayer.addChild(sprite);
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
      const key = [
        city.owner,
        city.level,
        city.name,
        city.isCapital,
        city.durability,
        cityMaxDurability(city),
        hasBuildingEffect(city, 'walls'),
        city.buildings.filter((b) => buildingDef(b).wonder).length,
        city.project ? `${city.project.kind}${city.project.stages}` : '',
        epochOf(state.powers[city.owner]),
        this.simple,
      ].join('|');
      let view = this.cityViews.get(city.id);
      if (view && view.key !== key) {
        this.destroyCityView(view);
        view = undefined;
      }
      if (!view) {
        view = this.createCityView(city, key);
        this.cityViews.set(city.id, view);
      }
    }
    for (const [id, view] of this.cityViews) {
      if (alive.has(id)) continue;
      this.destroyCityView(view);
      this.cityViews.delete(id);
    }
    this.drawMoods(explored);
  }

  /** Смайлик отношения над столицей державы, а если её не видели — над самым крупным из увиденных городов. */
  private drawMoods(explored: number[]): void {
    const state = this.state!;
    this.moodLayer.removeChildren().forEach((c) => c.destroy());
    const human = state.humanPower;
    const met = state.powers[human].met;
    const shown = new Map<number, (typeof state.cities)[number]>();
    for (const city of state.cities) {
      if (city.owner === human || !explored[city.tile] || !met.includes(city.owner)) continue;
      const best = shown.get(city.owner);
      const better = !best || (city.isCapital && !best.isCapital) || (city.isCapital === best.isCapital && (city.level > best.level || (city.level === best.level && city.id < best.id)));
      if (better) shown.set(city.owner, city);
    }
    for (const [owner, city] of shown) {
      if (!state.powers[owner].alive) continue;
      const level = moodLevel(opinion(state, owner, human).total);
      const texture = this.sprites.get(`mood|${level}`, MOOD_W, MOOD_H, () => moodSvg(level));
      if (!texture) continue;
      const { x, y } = tileCenter(this.size, city.tile);
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 1);
      sprite.scale.set(1);
      sprite.position.set(x, y - (this.simple ? 20 : 32));
      this.moodLayer.addChild(sprite);
    }
  }

  private destroyCityView(view: CityView): void {
    view.body.destroy();
    view.label.destroy();
    view.sprite?.destroy();
  }

  /** Догрузились текстуры: подставить их городам и перерисовать юнитов. */
  private onSpritesLoaded(): void {
    for (const view of this.cityViews.values()) {
      if (view.sprite && view.sprite.texture === Texture.EMPTY) {
        view.sprite.texture = this.sprites.get(view.spriteKey, CITY_SPRITE_W, CITY_SPRITE_H, () => '') ?? Texture.EMPTY;
      }
    }
    this.drawSpecials();
    this.drawUnits();
    if (this.state) this.drawMoods(this.state.powers[this.state.humanPower].explored);
    this.requestRender();
  }

  private createCityView(city: City, key: string): CityView {
    const state = this.state!;
    const owner = state.powers[city.owner];
    const color = hexColor(owner.color);
    const { x, y } = tileCenter(this.size, city.tile);
    const body = new Graphics();
    let sprite: Sprite | null = null;
    let spriteKey = '';
    if (!this.simple) {
      const walls = hasBuildingEffect(city, 'walls');
      const epoch = epochOf(owner);
      spriteKey = `c|${city.level}|${epoch}|${owner.color}|${city.isCapital}|${walls}`;
      const texture = this.sprites.get(spriteKey, CITY_SPRITE_W, CITY_SPRITE_H, () =>
        citySvg(city.level, epoch, owner.color, city.isCapital, walls),
      );
      sprite = new Sprite(texture ?? Texture.EMPTY);
      sprite.anchor.set(CITY_ANCHOR.x / CITY_SPRITE_W, CITY_ANCHOR.y / CITY_SPRITE_H);
      sprite.scale.set(CITY_SCALE);
      sprite.position.set(x, y + 2);
      sprite.cullable = true;
      this.cityLayer.addChild(sprite);
    } else this.drawFlatCity(body, city, x, y, color);
    // Чудеса света — золотые купола справа, финальный проект — флаг слева.
    const wonders = city.buildings.filter((b) => buildingDef(b).wonder).length;
    for (let i = 0; i < Math.min(3, wonders); i++) {
      const wx = x + 22 + i * 3;
      const wy = y - 4 - i * 5;
      arcFrom(body, wx, wy, 4, Math.PI, 0).fill(palette.gold).stroke({ width: 1, color: 0x6b5208 });
      body.rect(wx - 4, wy, 8, 2).fill(palette.gold).stroke({ width: 0.8, color: 0x6b5208 });
    }
    if (city.project) {
      const fx = x - 26;
      const fy = y - 20;
      body.rect(fx, fy, 1.5, 16).fill(0x222222);
      body.poly([fx + 1.5, fy, fx + 11, fy + 3, fx + 1.5, fy + 7]).fill(city.project.kind === 'science' ? 0x7fb3ff : 0xd58bff);
      for (let i = 0; i < city.project.stages; i++) body.circle(fx + 4 + i * 3, fy + 10, 1.2).fill(0xffffff);
    }
    // Прочность — квадратики под городом: заполненные — оставшаяся.
    const maxDur = cityMaxDurability(city);
    for (let i = 0; i < maxDur; i++) {
      const px = x - (maxDur * 7) / 2 + i * 7;
      body.rect(px, y + (this.simple ? 10 : 18), 5, 4).fill(i < city.durability ? 0xe8e8e8 : 0x3a3a3a).stroke({ width: 1, color: 0x111111 });
    }
    body.cullable = true;
    this.cityLayer.addChild(body);

    const label = new Text({
      text: `${city.isCapital && !this.simple ? '★ ' : ''}${city.name} · ${city.level}`,
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
    label.position.set(x, y + (this.simple ? 16 : 23));
    label.cullable = true;
    this.labelLayer.addChild(label);
    return { key, body, label, sprite, spriteKey };
  }

  /** Город в простой графике: шестиугольник цвета державы с домиками. */
  private drawFlatCity(body: Graphics, city: City, x: number, y: number, color: number): void {
    body.poly(hexCorners(x, y, 0.7)).fill(color).stroke({ width: 2, color: 0x1a1a1a });
    if (hasBuildingEffect(city, 'walls')) {
      body.poly(hexCorners(x, y, 0.78)).stroke({ width: 3, color: palette.wall });
      const c = hexCorners(x, y, 0.78);
      for (let k = 0; k < 6; k++) body.rect(c[k * 2] - 2.5, c[k * 2 + 1] - 2.5, 5, 5).fill(palette.wall).stroke({ width: 1, color: 0x333333 });
    }
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
  }

  private drawUnits(): void {
    const g = this.unitLayer;
    g.clear();
    this.unitUnder.clear();
    const state = this.state;
    let used = 0;
    if (state) {
      // Нижние ряды рисуются поверх верхних — фигурки не залезают друг на друга.
      const list = state.units
        .filter((u) => u.owner === state.humanPower || this.visible[u.tile])
        .sort((a, b) => a.tile - b.tile);
      for (const unit of list) used = this.drawUnit(g, unit, unit.tile === this.overlay.selectedTile, used);
    }
    for (let i = used; i < this.unitPool.length; i++) this.unitPool[i].visible = false;
  }

  /** Юнит: спрайт отряда (или фишка в простой графике и пока спрайт грузится) и значки. Возвращает число занятых спрайтов. */
  private drawUnit(g: Graphics, unit: Unit, selected: boolean, used: number): number {
    const state = this.state!;
    const { x, y } = tileCenter(this.size, unit.tile);
    const onCity = state.cities.some((c) => c.tile === unit.tile);
    const owner = state.powers[unit.owner];
    const color = hexColor(owner.color);
    const epoch = epochOf(owner);
    const enemy = atWar(state, state.humanPower, unit.owner);
    const figures = figuresForLevel(unit.type, unit.level);
    const art = hasUnitArt(unit.type);
    const texture = this.simple
      ? null
      : art
        ? this.sprites.getDrawn(`ua|${unit.type}|${epoch}|${owner.color}`, () => drawUnitArt(unit.type, epoch, owner.color))
        : this.sprites.get(`u|${unit.type}|${epoch}|${owner.color}|${figures}`, UNIT_SPRITE_W, UNIT_SPRITE_H, () =>
            unitSvg(unit.type, epoch, owner.color, figures),
          );

    let cx: number; // центр значков по горизонтали
    let top: number; // верх фигуры — над ним точки уровня
    let bottom: number; // низ подставки — под ним полоска силы
    if (texture) {
      const bx = onCity ? x - 22 : x;
      const by = onCity ? y + 15 : y + 12;
      const u = this.unitUnder;
      if (selected) u.ellipse(bx, by, 22, 8).stroke({ width: 3, color: palette.highlight });
      if (enemy) u.ellipse(bx, by + 0.5, 20, 7).fill({ color: 0xe0342b, alpha: 0.35 }).stroke({ width: 2.5, color: 0xe0342b });
      let sprite = this.unitPool[used];
      if (!sprite) {
        sprite = new Sprite();
        sprite.scale.set(UNIT_SCALE);
        this.unitPool.push(sprite);
        this.unitSprites.addChild(sprite);
      }
      sprite.texture = texture;
      if (art) sprite.anchor.set(ART_ANCHOR.x / ART_W, ART_ANCHOR.y / ART_H);
      else sprite.anchor.set(UNIT_ANCHOR.x / UNIT_SPRITE_W, UNIT_ANCHOR.y / UNIT_SPRITE_H);
      sprite.position.set(bx, by);
      sprite.visible = true;
      used++;
      cx = bx;
      top = by - (art ? unitArtHeight(unit.type) + 2 : 50) * UNIT_SCALE;
      bottom = by + 5 * UNIT_SCALE;
    } else {
      const ux = onCity ? x - 15 : x;
      const uy = onCity ? y + 2 : y - 4;
      const outline = { width: enemy ? 3 : 2, color: enemy ? 0xe0342b : 0x141414 };
      if (selected) g.circle(ux, uy, 16).stroke({ width: 3, color: palette.highlight });
      if (this.simple) g.circle(ux, uy, 12).fill(color).stroke(outline);
      else {
        g.ellipse(ux + 3, uy + 13, 12, 4).fill({ color: 0x000000, alpha: 0.3 });
        g.circle(ux, uy + 3, 12).fill(darken(color, 0.6)).stroke(outline);
        g.circle(ux, uy, 12).fill(color).stroke(outline);
      }
      drawUnitGlyph(g, unit.type, epoch, ux, uy);
      cx = ux;
      top = uy - 12;
      bottom = uy + 13;
    }

    // Уровень — точки над фигурой, сила — полоска под подставкой, звёзды — слева.
    for (let i = 0; i < unit.level; i++) {
      g.circle(cx - (unit.level - 1) * 3 + i * 6, top - 4, 2).fill(0xffffff).stroke({ width: 1, color: 0x141414 });
    }
    const share = Math.max(0, Math.min(1, unit.strength / unitMaxStrength(unit)));
    g.rect(cx - 11, bottom + 1, 22, 4).fill(0x1a1a1a);
    g.rect(cx - 11, bottom + 1, 22 * share, 4).fill(share > 0.6 ? 0x5fe36b : share > 0.3 ? 0xf5c542 : 0xe0342b);
    for (let i = 0; i < unit.stars; i++) drawStar(g, cx - 17, top + 6 + i * 7, 3.2);

    if (unit.owner === state.humanPower) {
      const dot = unit.routeTarget !== NONE ? 0x7fb3ff : unit.mp > 0 ? 0x5fe36b : 0x8a8a8a;
      g.circle(cx + 14, bottom - 3, 3.5).fill(dot).stroke({ width: 1, color: 0x141414 });
      if (unit.fortified) g.rect(cx + 11, top + 4, 6, 6).fill(0xb8c4d6).stroke({ width: 1, color: 0x141414 });
    }
    return used;
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
    for (const t of o.claimTiles) {
      const { x, y } = tileCenter(this.size, t);
      reach.poly(hexCorners(x, y, 0.8)).fill({ color: palette.claim, alpha: 0.3 }).stroke({ width: 2, color: palette.claim, alpha: 0.8 });
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
      let prevTile = o.path.from;
      o.path.tiles.forEach((t, i) => {
        const cur = tileCenter(this.size, t);
        const now = i < o.path!.thisTurn;
        const style = { width: now ? 4 : 3, color: now ? palette.path : palette.pathLater, alpha: now ? 0.95 : 0.7, cap: 'round' as const };
        if (distance(this.size, prevTile, t) > 1) {
          // Переброска по сети — дуга цвета сети.
          const lift = Math.min(70, Math.hypot(cur.x - prev.x, cur.y - prev.y) * 0.3);
          top
            .moveTo(prev.x, prev.y)
            .quadraticCurveTo((prev.x + cur.x) / 2, (prev.y + cur.y) / 2 - lift, cur.x, cur.y)
            .stroke({ ...style, color: palette.network });
        } else {
          top.moveTo(prev.x, prev.y).lineTo(cur.x, cur.y).stroke(style);
        }
        prev = cur;
        prevTile = t;
      });
      const end = tileCenter(this.size, o.path.tiles[o.path.tiles.length - 1]);
      const done = o.path.thisTurn === o.path.tiles.length;
      top.circle(end.x, end.y, 6).fill(done ? palette.path : palette.pathLater).stroke({ width: 2, color: 0x141414 });
    }
  }
}
