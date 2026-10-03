// Текстуры спрайтов: SVG растрируется в canvas с запасом по разрешению (для приближения)
// при первом запросе и кэшируется по ключу. Пока текстура грузится, get() возвращает null —
// отрисовка показывает упрощённую фишку и перерисовывается, когда текстура готова.

import { CanvasSource, Texture } from 'pixi.js';

/** Во сколько раз растр крупнее логического размера спрайта. */
const RESOLUTION = 3;

export class SpriteCache {
  private textures = new Map<string, Texture | null>();
  private notifyQueued = false;
  /** Вызывается (не чаще раза за кадр), когда догрузились новые текстуры. */
  onLoad: (() => void) | null = null;

  get(key: string, width: number, height: number, svg: () => string): Texture | null {
    const cached = this.textures.get(key);
    if (cached !== undefined) return cached;
    this.textures.set(key, null);
    void this.load(key, width, height, svg());
    return null;
  }

  private async load(key: string, width: number, height: number, svg: string): Promise<void> {
    try {
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = width * RESOLUTION;
      canvas.height = height * RESOLUTION;
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const source = new CanvasSource({ resource: canvas, resolution: RESOLUTION, autoGenerateMipmaps: true, scaleMode: 'linear' });
      this.textures.set(key, new Texture({ source }));
    } catch (err) {
      console.warn('Спрайт не загрузился', key, err);
      return;
    }
    if (this.notifyQueued) return;
    this.notifyQueued = true;
    requestAnimationFrame(() => {
      this.notifyQueued = false;
      this.onLoad?.();
    });
  }
}
