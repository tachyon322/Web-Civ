#!/usr/bin/env python3
"""Нарезка листов юнитов, сгенерированных ИИ, в атласы для игры.

Вход:  art-src/<тип>.(png|webp) — 5 фигур в ряд (эпохи 0–4), одежда цвета нации — пурпур #FF00FF,
       фон прозрачный или белый.
Выход: src/render/sprites/art/<тип>.png       — фигуры, пурпур заменён серым;
       src/render/sprites/art/<тип>-mask.png  — маска цвета нации (яркость пурпура + альфа);
       src/render/sprites/art/units.json      — рамки фигур в атласах и точки опоры (ступни).

Запуск из client/: python3 tools/sprites.py   (нужны pillow, numpy, scipy)
"""

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'art-src'
OUT = ROOT / 'src' / 'render' / 'sprites' / 'art'
TYPES = ['citizen', 'warrior', 'archer', 'horseman']
EPOCHS = 5
# Рост фигуры в атласе, px: на карте фигура ~48 px, запас — для приближения.
TARGET_HEIGHT = 144
PAD = 2
# Замкнутые куски белого фона внутри фигуры (между луком и тетивой) от этой площади (px исходника)
# тоже считаются фоном. Только для листов, где белого в самих фигурах крупными пятнами нет.
HOLES = {'archer': 1000}
# Мелкий кусок дальше этого расстояния от крупной фигуры — мусор фона, а не кончик оружия.
ATTACH_DISTANCE = 6


def load(path: Path, holes: int | None = None) -> np.ndarray:
    img = np.asarray(Image.open(path).convert('RGBA')).astype(np.float32) / 255
    if img[..., 3].min() < 0.5:
        return img
    # Белый фон: заливка от краёв по почти белым пикселям, кайма — «цвет в альфу».
    rgb = img[..., :3]
    whitish = rgb.min(axis=2) > 0.9
    labels, _ = ndimage.label(whitish)
    edge = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))) - {0}
    bg = np.isin(labels, list(edge))
    if holes:
        sizes = ndimage.sum(whitish, labels, range(1, labels.max() + 1))
        bg |= np.isin(labels, [i + 1 for i, size in enumerate(sizes) if size >= holes])
    near = ndimage.binary_dilation(bg, iterations=2) & ~bg
    alpha = np.ones(rgb.shape[:2], np.float32)
    alpha[bg] = 0
    a = np.clip(1 - rgb.min(axis=2), 0, 1)
    alpha[near] = a[near]
    safe = np.maximum(alpha, 1e-3)[..., None]
    rgb = np.where(near[..., None], np.clip((rgb - (1 - safe)) / safe, 0, 1), rgb)
    return np.dstack([rgb, alpha])


def figures(img: np.ndarray) -> list[np.ndarray]:
    """Фигуры слева направо (каждая — изображение с прозрачным всем чужим): связные области,
    мелкие куски (кончик штыка, перо) примыкают к ближайшей по расстоянию фигуре."""
    alpha = img[..., 3]
    labels, n = ndimage.label(alpha > 0.02, structure=np.ones((3, 3)))
    sizes = ndimage.sum(np.ones_like(alpha), labels, range(1, n + 1))
    big = [int(i) + 1 for i in np.argsort(-sizes)[:EPOCHS]]
    if len(big) < EPOCHS or sizes[big[-1] - 1] < sizes[big[0] - 1] * 0.15:
        sys.exit(f'ожидалось {EPOCHS} фигур, нашлось крупных: {sum(s > sizes.max() * 0.15 for s in sizes)}')
    # Ближайшая крупная фигура для каждого пикселя.
    dist = np.stack([ndimage.distance_transform_edt(labels != b) for b in big])
    owner = np.array(big)[dist.argmin(axis=0)]
    member = np.where(labels > 0, owner, 0)
    # Куски, ни одним пикселем не подходящие к фигуре ближе ATTACH_DISTANCE, — мусор.
    near = ndimage.minimum(dist.min(axis=0), labels, range(1, n + 1))
    junk = [i + 1 for i, d in enumerate(near) if d > ATTACH_DISTANCE]
    member[np.isin(labels, junk)] = 0
    out = []
    for b in sorted(big, key=lambda b: ndimage.center_of_mass(labels == b)[1]):
        ys, xs = ndimage.find_objects((member == b).astype(int))[0]
        crop = img[ys, xs].copy()
        crop[..., 3] *= member[ys, xs] == b
        out.append(crop)
    return out


def split_mask(rgba: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Пурпур → маска (серый по яркости, альфа по «пурпурности»); в основе он становится серым."""
    r, g, b, a = (rgba[..., k] for k in range(4))
    hi = np.maximum(r, b)
    lo = np.minimum(r, b)
    purity = (lo - g) / np.maximum(hi, 1e-3)
    balance = lo / np.maximum(hi, 1e-3)
    smooth = lambda x, e0, e1: np.clip((x - e0) / (e1 - e0), 0, 1)
    w = smooth(purity, 0.3, 0.6) * smooth(balance, 0.45, 0.7)
    value = np.clip(hi / 0.92, 0, 1)
    mask = np.dstack([value, value, value, w * a])
    gray = (0.6 * value)[..., None]
    base = rgba.copy()
    base[..., :3] = rgba[..., :3] * (1 - w[..., None]) + gray * w[..., None]
    return base, mask


def to_image(arr: np.ndarray) -> Image.Image:
    return Image.fromarray(np.clip(arr * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA')


def resize(img: Image.Image, scale: float) -> Image.Image:
    size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
    return img.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA')


def process(kind: str, path: Path) -> dict:
    img = load(path, HOLES.get(kind))
    crops = figures(img)
    heights = sorted(c.shape[0] for c in crops)
    scale = TARGET_HEIGHT / heights[len(heights) // 2]
    bases, masks, frames = [], [], []
    for crop in crops:
        # Точка опоры: низ фигуры, по горизонтали — середина нижних 8% (ступни).
        solid = crop[..., 3] > 0.5
        rows = np.where(solid.any(axis=1))[0]
        bottom = rows[-1]
        feet = solid[max(0, bottom - int(len(rows) * 0.08)) : bottom + 1]
        cols = np.where(feet.any(axis=0))[0]
        ax, ay = (cols[0] + cols[-1] + 1) / 2, bottom + 1
        base, mask = split_mask(crop)
        bases.append(resize(to_image(base), scale))
        masks.append(resize(to_image(mask), scale))
        frames.append({'ax': ax * scale, 'ay': ay * scale})
    width = sum(b.width + 2 * PAD for b in bases)
    height = max(b.height for b in bases) + 2 * PAD
    atlas = Image.new('RGBA', (width, height))
    atlas_mask = Image.new('RGBA', (width, height))
    x = 0
    for frame, base, mask in zip(frames, bases, masks):
        atlas.paste(base, (x + PAD, PAD))
        atlas_mask.paste(mask, (x + PAD, PAD))
        frame.update(x=x + PAD, y=PAD, w=base.width, h=base.height)
        frame['ax'] = round(frame['ax'], 1)
        frame['ay'] = round(frame['ay'], 1)
        x += base.width + 2 * PAD
    atlas.save(OUT / f'{kind}.png', optimize=True)
    atlas_mask.save(OUT / f'{kind}-mask.png', optimize=True)
    return {'height': TARGET_HEIGHT, 'frames': frames}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {}
    for kind in TYPES:
        src = next((p for p in (SRC / f'{kind}.png', SRC / f'{kind}.webp') if p.exists()), None)
        if src:
            meta[kind] = process(kind, src)
            print(kind, 'ok', [f"{f['w']}x{f['h']}" for f in meta[kind]['frames']])
    (OUT / 'units.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()
