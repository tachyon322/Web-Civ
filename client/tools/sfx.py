#!/usr/bin/env python3
"""Синтез звуковых эффектов игры: всё рассчитывается из формул, без чужих записей.

Выход: src/assets/sfx/<имя>.mp3
  click          — нажатие кнопки (короткий деревянный щелчок);
  attack-1..3    — атака: свист замаха, удар и звон металла (три варианта, чтобы не приедалось);
  gold           — покупка за золото: звон монет;
  science        — покупка за науку: стеклянное восходящее арпеджио с мерцанием;
  culture        — покупка за культуру: аккорд щипковой лиры;
  sabotage       — саботаж: шипение фитиля, глухой взрыв и нисходящий гул.

Запуск из client/: python3 tools/sfx.py   (нужны numpy и ffmpeg с libmp3lame)
Сид фиксирован: повторный запуск даёт те же звуки.
"""

import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src' / 'assets' / 'sfx'
SR = 44100
rng = np.random.default_rng(20261004)


# ---------- Кирпичики ----------

def t_axis(dur: float) -> np.ndarray:
    return np.arange(int(dur * SR)) / SR


def silence(dur: float) -> np.ndarray:
    return np.zeros(int(dur * SR))


def noise(dur: float) -> np.ndarray:
    return rng.uniform(-1, 1, int(dur * SR))


def env_exp(dur: float, decay: float, attack: float = 0.002) -> np.ndarray:
    """Быстрая атака и экспоненциальное затухание (decay — время спада в e раз)."""
    t = t_axis(dur)
    a = np.clip(t / max(attack, 1e-6), 0, 1)
    return a * np.exp(-t / decay)


def onepole_lp(x: np.ndarray, cutoff: float) -> np.ndarray:
    """Однополюсный ФНЧ; cutoff может быть массивом (плавающий фильтр)."""
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    a = 1 - np.exp(-2 * np.pi * c / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def bandpass(x: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """Полосовой фильтр в частотной области (для шумовых составляющих — достаточно)."""
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    gain = 1 / np.sqrt(1 + (lo / np.maximum(f, 1)) ** 4) / np.sqrt(1 + (f / hi) ** 4)
    return np.fft.irfft(spec * gain, len(x))


def mix(*parts: tuple[float, np.ndarray]) -> np.ndarray:
    """Сведение: (время начала, сигнал). Хвост каждой части гасится, чтобы обрыв не щёлкал."""
    end = max(int(start * SR) + len(sig) for start, sig in parts)
    out = np.zeros(end)
    for start, sig in parts:
        sig = sig.copy()
        n = min(int(0.04 * SR), len(sig))
        sig[-n:] *= np.linspace(1, 0, n)
        i = int(start * SR)
        out[i:i + len(sig)] += sig
    return out


def reverb(x: np.ndarray, length: float, decay: float, wet: float, brightness: float = 6000) -> np.ndarray:
    """Свёртка с затухающим шумом — небольшое помещение."""
    ir = noise(length) * np.exp(-t_axis(length) / decay)
    ir = onepole_lp(ir, brightness)
    ir[: int(0.008 * SR)] = 0  # ранние отражения чуть позже прямого звука
    ir /= np.sqrt(np.sum(ir ** 2))
    n = len(x) + len(ir)
    wet_sig = np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(ir, n), n)
    out = np.zeros(n)
    out[: len(x)] += x
    return out + wet * wet_sig


def finish(x: np.ndarray, peak: float = 0.89, fade: float = 0.03) -> np.ndarray:
    """Срез тишины в хвосте, мягкое окончание и нормировка по пику."""
    thr = np.max(np.abs(x)) * 10 ** (-60 / 20)
    last = np.nonzero(np.abs(x) > thr)[0]
    x = x[: last[-1] + 1] if len(last) else x
    n = min(int(fade * SR), len(x))
    x[-n:] *= np.linspace(1, 0, n) ** 2
    x -= np.mean(x)
    return x / np.max(np.abs(x)) * peak


# ---------- Звуки ----------

def click() -> np.ndarray:
    # Щелчок дерева: короткий тональный «ток» + полосовой шум.
    t = t_axis(0.06)
    tone = np.sin(2 * np.pi * 1650 * t) * np.exp(-t / 0.008)
    body = np.sin(2 * np.pi * 420 * t) * np.exp(-t / 0.012) * 0.5
    snap = bandpass(noise(0.06), 1800, 7000) * np.exp(-t / 0.004) * 0.8
    return finish(reverb(tone + body + snap, 0.12, 0.03, 0.12), peak=0.6)


def attack(variant: int) -> np.ndarray:
    # 1) свист замаха — шум, полоса которого едет вверх;
    sw = 0.16 + 0.03 * variant
    t = t_axis(sw)
    whoosh = noise(sw)
    whoosh = onepole_lp(whoosh, 600 + 5000 * (t / sw) ** 2) - onepole_lp(whoosh, 300)
    whoosh *= np.sin(np.pi * t / sw) ** 2 * 0.5
    # 2) удар: низкий «бум» с падающей частотой и треск;
    d = 0.35
    t = t_axis(d)
    f = 110 * np.exp(-t / 0.05) + 45
    thump = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.07)
    crack = bandpass(noise(d), 900, 9000) * np.exp(-t / 0.012) * 0.9
    # 3) звон стали: негармонические призвуки клинка.
    d = 0.9
    t = t_axis(d)
    base = 620 * (1 + 0.07 * (variant - 1)) * rng.uniform(0.97, 1.03)
    ring = np.zeros_like(t)
    for ratio, amp, dec in [(1.0, 0.5, 0.22), (2.32, 0.4, 0.16), (4.25, 0.32, 0.11), (6.63, 0.22, 0.07), (9.38, 0.12, 0.05)]:
        fr = base * ratio * rng.uniform(0.99, 1.01)
        ring += amp * np.sin(2 * np.pi * fr * t + rng.uniform(0, 6.28)) * np.exp(-t / dec) * (1 + 0.15 * np.sin(2 * np.pi * 7 * t))
    ring *= np.clip(t / 0.001, 0, 1)
    hit = sw - 0.01
    x = mix((0, whoosh), (hit, thump * 0.9), (hit, crack), (hit, ring * 0.55))
    return finish(reverb(x, 0.6, 0.15, 0.25))


def coin(freq: float, dur: float = 0.45) -> np.ndarray:
    t = t_axis(dur)
    x = np.zeros_like(t)
    for ratio, amp, dec in [(1.0, 0.6, 0.11), (1.51, 0.35, 0.08), (2.76, 0.3, 0.06), (4.07, 0.18, 0.04), (5.4, 0.1, 0.03)]:
        x += amp * np.sin(2 * np.pi * freq * ratio * t + rng.uniform(0, 6.28)) * np.exp(-t / dec)
    tick = bandpass(noise(dur), 4000, 12000) * np.exp(-t / 0.003) * 0.6
    return (x + tick) * np.clip(t / 0.0008, 0, 1)


def gold() -> np.ndarray:
    # Монеты падают одна на другую: неровные интервалы, разные высоты, последняя — дребезжит.
    times = [0.0, 0.055, 0.1, 0.16, 0.2, 0.245]
    parts = []
    for i, start in enumerate(times):
        f = rng.uniform(2300, 3400)
        parts.append((start + rng.uniform(0, 0.012), coin(f) * rng.uniform(0.55, 1.0)))
    # дребезг монеты, оседающей на стол
    for k in range(5):
        parts.append((0.3 + 0.07 * k * (1 - 0.12 * k), coin(2900 + 40 * k, 0.15) * 0.35 * (0.75 ** k)))
    return finish(reverb(mix(*parts), 0.5, 0.12, 0.3))


def glass(freq: float, dur: float) -> np.ndarray:
    t = t_axis(dur)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t)
    ph = 2 * np.pi * freq * np.cumsum(vib) / SR
    fm = np.sin(ph * 3.5) * 1.2 * np.exp(-t / 0.15)  # искристая атака
    x = np.sin(ph + fm) * 0.7 + np.sin(2 * ph) * 0.2 + np.sin(4.2 * ph) * 0.08 * np.exp(-t / 0.1)
    return x * env_exp(dur, 0.35, 0.004)


def science() -> np.ndarray:
    # Восходящее арпеджио (до-мажорная пентатоника) — «открытие».
    notes = [1046.5, 1318.5, 1568.0, 2093.0]
    parts = [(0.07 * i, glass(f, 0.9) * (0.7 + 0.1 * i)) for i, f in enumerate(notes)]
    # тихий шлейф мерцания
    d = 0.8
    t = t_axis(d)
    sparkle = bandpass(noise(d), 6000, 14000) * np.exp(-t / 0.25) * 0.08
    sparkle *= 0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 23 * t))
    parts.append((0.15, sparkle))
    return finish(reverb(mix(*parts), 1.0, 0.3, 0.45, 9000))


def pluck(freq: float, dur: float, brightness: float = 0.5) -> np.ndarray:
    """Струна по Карплусу — Стронгу."""
    n = int(dur * SR)
    period = SR / freq
    p = int(period)
    frac = period - p
    buf = onepole_lp(rng.uniform(-1, 1, p), 2000 + 8000 * brightness)
    out = np.empty(n)
    out[:p] = buf
    damp = 0.996
    for i in range(p, n):
        a = out[i - p]
        b = out[i - p - 1] if i - p - 1 >= 0 else 0.0
        out[i] = damp * ((1 - frac) * 0.5 * (a + b) + frac * 0.5 * (b + (out[i - p - 2] if i - p - 2 >= 0 else 0.0)))
    out -= onepole_lp(out, 60)
    return out * env_exp(dur, 0.6, 0.001)


def culture() -> np.ndarray:
    # Лира: ре-мажорный аккорд, взятый «перебором» снизу вверх, и верхняя нота-ответ.
    notes = [293.66, 369.99, 440.0, 587.33, 739.99]
    parts = [(0.045 * i, pluck(f, 1.4, 0.35 + 0.1 * i) * (0.8 - 0.05 * i)) for i, f in enumerate(notes)]
    parts.append((0.3, pluck(880.0, 1.2, 0.6) * 0.55))
    return finish(reverb(mix(*parts), 1.2, 0.35, 0.35, 5000))


def sabotage() -> np.ndarray:
    # 1) шипение фитиля с искрами;
    d = 0.45
    t = t_axis(d)
    hiss = bandpass(noise(d), 2500, 9000) * (0.25 + 0.15 * np.sin(2 * np.pi * 13 * t) ** 2)
    sparks = np.zeros_like(t)
    for _ in range(14):
        i = rng.integers(0, len(t) - 600)
        sparks[i:i + 600] += bandpass(noise(600 / SR), 3000, 12000) * np.exp(-np.arange(600) / 60) * rng.uniform(0.4, 1)
    fuse = (hiss + sparks) * np.clip(t / 0.05, 0, 1)
    # 2) глухой взрыв: падающий тон и тёмный шум;
    d = 1.2
    t = t_axis(d)
    f = 70 * np.exp(-t / 0.15) + 32
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.3)
    rumble = onepole_lp(noise(d), 380 * np.exp(-t / 0.4) + 80) * np.exp(-t / 0.35) * 3.0
    debris = bandpass(noise(d), 800, 5000) * np.exp(-t / 0.08) * 0.35
    # 3) зловещий нисходящий гул — что-то сломалось.
    d = 1.0
    t = t_axis(d)
    fd = 220 * 2 ** (-1.5 * t)
    ph = 2 * np.pi * np.cumsum(fd) / SR
    drone = (np.sin(ph) + 0.5 * np.sin(1.5 * ph + 0.3) + 0.25 * np.sin(2.01 * ph)) * np.sin(np.pi * np.clip(t / d, 0, 1)) * 0.22
    x = mix((0, fuse), (0.42, boom), (0.42, rumble), (0.42, debris), (0.5, drone))
    return finish(reverb(x, 1.0, 0.3, 0.3, 3500))


# ---------- Запись ----------

def write_mp3(name: str, x: np.ndarray) -> None:
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        wav_path = Path(tmp.name)
    with wave.open(str(wav_path), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    out = OUT / f'{name}.mp3'
    subprocess.run(
        ['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav_path), '-codec:a', 'libmp3lame', '-q:a', '4', str(out)],
        check=True,
    )
    wav_path.unlink()
    print(f'{out.relative_to(ROOT)}: {len(x) / SR:.2f} с, {out.stat().st_size // 1024} КБ')


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sounds = {
        'click': click,
        'attack-1': lambda: attack(0),
        'attack-2': lambda: attack(1),
        'attack-3': lambda: attack(2),
        'gold': gold,
        'science': science,
        'culture': culture,
        'sabotage': sabotage,
    }
    only = set(sys.argv[1:])
    for name, make in sounds.items():
        if not only or name in only:
            write_mp3(name, make())


if __name__ == '__main__':
    main()
