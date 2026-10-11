#!/usr/bin/env python3
"""Efectos de sonido ORIGINALES para los videos de la campaña de Vigía Perú, por síntesis
(numpy y scipy; sin muestras ni bibliotecas de terceros).

Efectos: viento, pasos en tierra, papel, clic de celular, monedas, latido, whoosh (transición),
golpe sordo y campana suave (para los cierres de esperanza). Cada uno sale como WAV estéreo de
44,1 kHz con el pico en -2 dBFS, listo para colocarse en la mezcla con mezclar.py (lista `--sfx`).

    python sintetizar_sfx.py --salida ../../../../campanas-vigia/audio/sfx
    python sintetizar_sfx.py --solo whoosh,monedas --salida .

Determinista: la semilla fija el resultado.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

SR = 44100


def pasabajos(x, c, o=4):
    return sosfilt(butter(o, c, btype="low", fs=SR, output="sos"), x)


def pasaaltos(x, c, o=4):
    return sosfilt(butter(o, c, btype="high", fs=SR, output="sos"), x)


def pasabanda(x, lo, hi, o=2):
    return sosfilt(butter(o, [lo, hi], btype="band", fs=SR, output="sos"), x)


def tiempo(dur):
    return np.arange(int(dur * SR)) / SR


def estereo(mono: np.ndarray, rng: np.random.Generator, ancho: float = 0.25) -> np.ndarray:
    """Mono a estéreo con una pequeña diferencia entre canales (retardo y nivel)."""
    d = int(rng.integers(8, 40))
    izq = mono
    der = np.concatenate([np.zeros(d), mono[:-d]]) * (1 - ancho * 0.3)
    return np.stack([izq, der]).T


def normalizar(x: np.ndarray, pico_db: float = -2.0) -> np.ndarray:
    return (x * (10 ** (pico_db / 20)) / (np.max(np.abs(x)) + 1e-9)).astype(np.float32)


def viento(rng, dur=6.0):
    t = tiempo(dur)
    base = rng.normal(0, 1, len(t))
    lento = 0.55 + 0.45 * np.sin(2 * math.pi * 0.17 * t + 1.3) * np.sin(2 * math.pi * 0.071 * t + 0.4)
    y = pasabanda(base, 180, 1400) * lento
    y += pasabanda(rng.normal(0, 1, len(t)), 900, 3200) * 0.25 * (lento ** 2)
    env = np.minimum(1, np.minimum(t / 0.8, (dur - t) / 1.0))
    return estereo(y * env, rng, 0.6)


def pasos_tierra(rng, n_pasos=6, cada=0.56):
    dur = n_pasos * cada + 0.4
    y = np.zeros(int(dur * SR))
    for i in range(n_pasos):
        ini = int((0.1 + i * cada + rng.uniform(-0.03, 0.03)) * SR)
        m = int(0.22 * SR)
        tt = np.arange(m) / SR
        roce = pasabanda(rng.normal(0, 1, m), 350, 3200) * np.exp(-tt * 26)
        golpe = np.sin(2 * math.pi * (70 - 25 * tt * 4) * tt) * np.exp(-tt * 30) * 0.8
        grano = pasaaltos(rng.normal(0, 1, m), 4000) * np.exp(-tt * 60) * 0.25
        y[ini:ini + m] += (roce + golpe + grano) * (0.75 + 0.25 * rng.random())
    return estereo(y, rng, 0.3)


def papel(rng, dur=1.4):
    y = np.zeros(int(dur * SR))
    t = 0.0
    while t < dur - 0.1:
        m = int(rng.uniform(0.012, 0.06) * SR)
        ini = int(t * SR)
        tt = np.arange(m) / SR
        y[ini:ini + m] += pasaaltos(rng.normal(0, 1, m), 2200) * np.exp(-tt * rng.uniform(40, 120)) * rng.uniform(0.3, 1.0)
        t += rng.uniform(0.01, 0.09)
    y *= np.minimum(1, (dur - tiempo(dur)) / 0.3)
    return estereo(y, rng, 0.5)


def clic_celular(rng):
    m = int(0.18 * SR)
    t = np.arange(m) / SR
    tic = pasaaltos(rng.normal(0, 1, m), 1500) * np.exp(-t * 900)
    toc = np.sin(2 * math.pi * 3800 * t) * np.exp(-t * 160) * 0.5
    cuerpo = np.sin(2 * math.pi * 520 * t) * np.exp(-t * 90) * 0.25
    return estereo(tic + toc + cuerpo, rng, 0.1)


def monedas(rng, n=6):
    dur = 0.35 * n + 0.6
    y = np.zeros(int(dur * SR))
    for i in range(n):
        ini = int((0.08 + i * rng.uniform(0.16, 0.3)) * SR)
        if ini + int(0.6 * SR) > len(y):
            break
        m = int(0.6 * SR)
        t = np.arange(m) / SR
        base = rng.uniform(2200, 3300)
        moneda = sum(np.sin(2 * math.pi * base * r * t) * a * np.exp(-t * d)
                     for r, a, d in ((1.0, 1.0, 11), (2.76, 0.6, 16), (5.4, 0.4, 24), (8.9, 0.2, 38)))
        golpe = pasaaltos(rng.normal(0, 1, m), 3000) * np.exp(-t * 400) * 0.5
        y[ini:ini + m] += (moneda + golpe) * rng.uniform(0.55, 1.0)
    return estereo(y, rng, 0.5)


def latido(rng, n=2):
    dur = 0.9 * n + 0.2
    y = np.zeros(int(dur * SR))
    for i in range(n):
        for off, f0, g in ((0.0, 62, 1.0), (0.27, 82, 0.65)):
            ini = int((0.05 + i * 0.9 + off) * SR)
            m = int(0.3 * SR)
            t = np.arange(m) / SR
            f = f0 - 22 * (1 - np.exp(-t * 14))
            y[ini:ini + m] += np.sin(2 * math.pi * np.cumsum(f) / SR) * np.exp(-t * 14) * g
    return estereo(pasabajos(y, 220), rng, 0.0)


def whoosh(rng, dur=0.7):
    n = int(dur * SR)
    t = np.arange(n) / SR
    ruido = rng.normal(0, 1, n)
    y = np.zeros(n)
    trozos = 14
    paso = n // trozos
    for i in range(trozos):
        f = 250 * (14 ** (i / (trozos - 1)))
        a, b = i * paso, (i + 1) * paso if i < trozos - 1 else n
        y[a:b] = pasabanda(ruido[a:b], f * 0.6, min(f * 1.6, 12000))
    env = np.sin(math.pi * np.clip(t / dur, 0, 1)) ** 1.6
    return estereo(y * env, rng, 0.7)


def golpe_sordo(rng):
    m = int(0.9 * SR)
    t = np.arange(m) / SR
    f = 36 + 40 * np.exp(-t * 22)
    y = np.sin(2 * math.pi * np.cumsum(f) / SR) * np.exp(-t * 5.5)
    y += pasabajos(rng.normal(0, 1, m), 400) * np.exp(-t * 40) * 0.8
    return estereo(y, rng, 0.0)


def campana_suave(rng):
    m = int(3.2 * SR)
    t = np.arange(m) / SR
    base = 523.25  # do
    y = sum(np.sin(2 * math.pi * base * r * t) * a * np.exp(-t * d)
            for r, a, d in ((1.0, 1.0, 1.6), (2.0, 0.45, 2.2), (2.76, 0.35, 3.0), (4.1, 0.2, 4.4), (5.4, 0.1, 6.0)))
    y *= np.minimum(1, t / 0.004)
    return estereo(y, rng, 0.4)


EFECTOS = {
    "viento": viento,
    "pasos_tierra": pasos_tierra,
    "papel": papel,
    "clic_celular": clic_celular,
    "monedas": monedas,
    "latido": latido,
    "whoosh": whoosh,
    "golpe_sordo": golpe_sordo,
    "campana_suave": campana_suave,
}


def main() -> None:
    ap = argparse.ArgumentParser(description="Sintetiza los efectos de sonido de la campaña.")
    ap.add_argument("--salida", default=".", help="carpeta de salida")
    ap.add_argument("--solo", default="", help="lista separada por comas; vacío = todos")
    ap.add_argument("--semilla", type=int, default=2026)
    a = ap.parse_args()
    nombres = [x for x in a.solo.split(",") if x] or list(EFECTOS)
    destino = Path(a.salida)
    destino.mkdir(parents=True, exist_ok=True)
    for i, nombre in enumerate(nombres):
        rng = np.random.default_rng(a.semilla + i)
        audio = normalizar(EFECTOS[nombre](rng))
        ruta = destino / f"sfx_{nombre}.wav"
        wavfile.write(str(ruta), SR, (audio * 32767).astype(np.int16))
        print(f"{nombre:14s} {len(audio) / SR:5.2f} s  ->  {ruta}")


if __name__ == "__main__":
    main()
