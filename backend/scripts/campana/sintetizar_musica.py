#!/usr/bin/env python3
"""Música ORIGINAL para los videos de la campaña de Vigía Perú, por síntesis (numpy y scipy, sin
muestras ni material de terceros: no hay derechos que pedir).

Cada pista combina cuatro voces sintetizadas:
  * colchón de cuerdas (pad): armónicos sumados con ligera desafinación entre izquierda y derecha;
  * pulso grave (latido): un bombo sinusoidal que cae de 90 a 45 Hz;
  * charango: cuerda pulsada por el algoritmo de Karplus y Strong, en arpegios;
  * quena: flauta de sonido casi sinusoidal, con vibrato y aire, que dibuja frases pentatónicas.
Todo pasa por una reverberación sintética y un limitador suave. La INTENSIDAD (0 a 1) de cada
instante sale de una curva configurable por escena: es lo que hace que una pista nazca tensa y se
resuelva en esperanza, o que crezca con el relato.

Las cuatro pistas de la campaña (30 s, 44,1 kHz, estéreo, WAV):
  T1  tensa que se resuelve en esperanza: la raíz pasa de La menor a Do mayor (mismas cinco notas
      de la pentatónica, otra gravedad) hacia el segundo 17;
  T2  curiosa y luminosa: pentatónica mayor, arpegios claros y rápidos;
  T3  ligera, que avanza: pulso constante y arpegios en corcheas;
  T4  cálida y emotiva: colchón amplio, quena al frente y latido suave.

Uso:
    python sintetizar_musica.py --pista todas --duracion 30 --salida ../../../../campanas-vigia/audio/musica
    python sintetizar_musica.py --pista T1 --duracion 8 --salida .      # prueba corta

Determinista: la misma semilla da exactamente el mismo audio.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, lfilter, sosfilt

SR = 44100
NIVEL_PICO = 0.45  # pico del archivo: unos -19 LUFS integrados, nivel de cama (la voz va encima)


# ── utilidades ────────────────────────────────────────────────────────────────────────────────────
def hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def pasabajos(x: np.ndarray, corte: float, orden: int = 4) -> np.ndarray:
    return sosfilt(butter(orden, corte, btype="low", fs=SR, output="sos"), x)


def pasabanda(x: np.ndarray, lo: float, hi: float, orden: int = 2) -> np.ndarray:
    return sosfilt(butter(orden, [lo, hi], btype="band", fs=SR, output="sos"), x)


def adsr(n: int, a: float, d: float, s: float, r: float) -> np.ndarray:
    """Envolvente con ataque, caída, sostenido (s) y relajación (a, d, r en segundos)."""
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    ns = max(0, n - na - nd - nr)
    return np.concatenate([
        np.linspace(0, 1, max(na, 1), endpoint=False),
        np.linspace(1, s, max(nd, 1), endpoint=False),
        np.full(ns, s),
        np.linspace(s, 0, max(nr, 1)),
    ])[:n]


def poner(destino: np.ndarray, senal: np.ndarray, inicio_s: float, ganancia: float, pan: float = 0.0) -> None:
    """Suma una señal mono en un buffer estéreo (2, n) con panorama pan en [-1, 1]."""
    i = int(inicio_s * SR)
    if i >= destino.shape[1]:
        return
    fin = min(i + len(senal), destino.shape[1])
    seg = senal[: fin - i] * ganancia
    ang = (pan + 1) * math.pi / 4
    destino[0, i:fin] += seg * math.cos(ang)
    destino[1, i:fin] += seg * math.sin(ang)


# ── voces ─────────────────────────────────────────────────────────────────────────────────────────
def cuerdas(midis: list[float], dur: float, rng: np.random.Generator) -> np.ndarray:
    """Colchón de cuerdas estéreo (2, n): armónicos sumados, desafinados distinto a cada lado."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros((2, n))
    for m in midis:
        for lado, cents in ((0, -7), (1, +7)):
            f = hz(m) * 2 ** (cents / 1200)
            for h in range(1, 7):
                fase = rng.uniform(0, 2 * math.pi)
                out[lado] += np.sin(2 * math.pi * f * h * t + fase) / (h ** 1.25)
    trem = 1 + 0.06 * np.sin(2 * math.pi * 0.23 * t)
    out *= trem
    out = np.stack([pasabajos(out[0], 1800), pasabajos(out[1], 1800)])
    return out / (len(midis) * 1.8)


def latido(dur: float = 0.42) -> np.ndarray:
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = 45 + 45 * np.exp(-t * 28)
    fase = 2 * math.pi * np.cumsum(f) / SR
    return np.sin(fase) * np.exp(-t * 9)


def pulsada(freq: float, dur: float, brillo: float, rng: np.random.Generator) -> np.ndarray:
    """Cuerda pulsada (Karplus y Strong) con un filtro en el bucle: sonido de charango."""
    n = int(dur * SR)
    N = max(2, int(SR / freq))
    exc = rng.uniform(-1, 1, N)
    exc = pasabajos(np.concatenate([exc, np.zeros(10)]), 2500 + 6000 * brillo)[:N]
    x = np.zeros(n)
    x[:N] = exc
    g = 0.996 - 0.004 * (1 - brillo)
    a = np.zeros(N + 2)
    a[0] = 1.0
    a[N] = -g / 2
    a[N + 1] = -g / 2
    y = lfilter([1.0], a, x)
    return y / (np.max(np.abs(y)) + 1e-9)


def quena(freq: float, dur: float, rng: np.random.Generator) -> np.ndarray:
    """Flauta de aire: casi sinusoidal, con vibrato que entra tarde y un soplido filtrado."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    vib = np.sin(2 * math.pi * 5.4 * t) * 0.0045 * np.clip(t / 0.45, 0, 1)
    fase = 2 * math.pi * np.cumsum(freq * (1 + vib)) / SR
    tono = np.sin(fase) + 0.22 * np.sin(2 * fase) + 0.07 * np.sin(3 * fase)
    soplo = pasabanda(rng.normal(0, 1, n), 1800, 4200) * 0.06
    env = adsr(n, 0.09, 0.12, 0.8, min(0.4, dur * 0.5))
    return (tono + soplo) * env / 1.4


def reverberacion(x: np.ndarray, rng: np.random.Generator, cola: float = 2.0, humedo: float = 0.28) -> np.ndarray:
    n = int(cola * SR)
    t = np.arange(n) / SR
    ir = np.stack([rng.normal(0, 1, n) * np.exp(-t * 3.4) for _ in range(2)])
    ir = np.stack([pasabajos(ir[0], 5000), pasabajos(ir[1], 5000)])
    ir /= np.max(np.abs(ir)) + 1e-9
    mojado = np.stack([fftconvolve(x[c], ir[c])[: x.shape[1]] * 0.07 for c in range(2)])
    return x * (1 - humedo * 0.5) + mojado * humedo * 2


# ── configuración de las cuatro pistas ────────────────────────────────────────────────────────────
# Acordes en notas MIDI (La menor y Do mayor comparten la pentatónica A C D E G).
Am = [45, 52, 57, 60]
F = [41, 48, 53, 57]
Dm = [38, 45, 50, 53]
Em = [40, 47, 52, 55]
C = [48, 55, 60, 64]
G = [43, 50, 55, 59]
Am7 = [45, 52, 55, 60]
D = [50, 57, 62, 66]

PENT_LA_MENOR = [57, 60, 62, 64, 67, 69, 72, 74, 76]   # A C D E G
PENT_DO_MAYOR = [60, 62, 64, 67, 69, 72, 74, 76, 79]   # C D E G A

PISTAS: dict[str, dict] = {
    "T1": dict(
        nombre="La pista que no llega: tensa que se resuelve en esperanza",
        bpm=60,
        acordes=[(0, [Am, Am, F, Dm]), (17, [C, G, Am7, F, C])],
        escala=[(0, PENT_LA_MENOR), (17, PENT_DO_MAYOR)],
        curva=[(0, 0.10), (6, 0.25), (12, 0.55), (16.5, 0.8), (17.5, 0.55), (22, 0.85), (27, 0.6), (30, 0.2)],
        latido=True, latido_cada=2, charango=0.55, quena=(0.5, 0.9), semilla=11,
    ),
    "T2": dict(
        nombre="Por qué nació Vigía: curiosa y luminosa",
        bpm=96,
        acordes=[(0, [C, G, Am7, F])],
        escala=[(0, PENT_DO_MAYOR)],
        curva=[(0, 0.25), (6, 0.55), (14, 0.8), (22, 0.9), (27, 0.6), (30, 0.2)],
        latido=False, latido_cada=0, charango=0.95, quena=(0.55, 0.7), semilla=23,
    ),
    "T3": dict(
        nombre="Tú también puedes mirar: ligera, avanzando",
        bpm=112,
        acordes=[(0, [G, D, Em, C])],
        escala=[(0, [55, 57, 59, 62, 64, 67, 69, 71, 74])],
        curva=[(0, 0.3), (5, 0.6), (12, 0.75), (22, 0.9), (27, 0.65), (30, 0.2)],
        latido=True, latido_cada=1, charango=1.0, quena=(0.7, 0.5), semilla=37,
    ),
    "T4": dict(
        nombre="S/ 3: cálida y emotiva",
        bpm=72,
        acordes=[(0, [C, Am7, F, G])],
        escala=[(0, PENT_DO_MAYOR)],
        curva=[(0, 0.2), (7, 0.45), (15, 0.7), (23, 0.95), (28, 0.55), (30, 0.15)],
        latido=True, latido_cada=2, charango=0.4, quena=(0.35, 1.0), semilla=53,
    ),
}


def acordes_en(t: float, plan: list[tuple[float, list[list[float]]]], bar_s: float) -> list[float]:
    """Acorde que suena en el instante t: el compás actual de la progresión vigente."""
    inicio, prog = plan[0]
    for ini, p in plan:
        if t >= ini:
            inicio, prog = ini, p
    return prog[int((t - inicio) // bar_s) % len(prog)]


def escala_en(t: float, plan: list[tuple[float, list[float]]]) -> list[float]:
    vigente = plan[0][1]
    for ini, e in plan:
        if t >= ini:
            vigente = e
    return vigente


def sintetizar(clave: str, duracion: float, semilla: int | None = None) -> np.ndarray:
    cfg = PISTAS[clave]
    rng = np.random.default_rng(cfg["semilla"] if semilla is None else semilla)
    n = int(duracion * SR)
    escala_t = duracion / 30.0  # las curvas están pensadas para 30 s: se estiran a la duración pedida
    curva = np.array(cfg["curva"]) * np.array([escala_t, 1.0])
    plan_ac = [(i * escala_t, p) for i, p in cfg["acordes"]]
    plan_es = [(i * escala_t, e) for i, e in cfg["escala"]]
    beat = 60.0 / cfg["bpm"]
    bar = beat * 4
    mezcla = np.zeros((2, n))

    def I(t: float) -> float:
        return float(np.interp(t, curva[:, 0], curva[:, 1]))

    # 1) colchón de cuerdas: un acorde por compás, con cruce suave
    t = 0.0
    while t < duracion:
        ac = acordes_en(t, plan_ac, bar)
        seg = min(bar + 1.2, duracion - t + 1.2)
        pad = cuerdas(ac, seg, rng)
        env = adsr(pad.shape[1], 1.1, 0.5, 0.9, 1.3)
        g = 0.20 + 0.22 * I(t + bar / 2)
        for c in range(2):
            ini = int(t * SR)
            fin = min(ini + pad.shape[1], n)
            mezcla[c, ini:fin] += pad[c, : fin - ini] * env[: fin - ini] * g
        t += bar

    # 2) latido
    if cfg["latido"]:
        pulso = latido()
        paso = beat * cfg["latido_cada"]
        t = 0.0
        while t < duracion - 0.4:
            poner(mezcla, pulso, t, 0.10 + 0.5 * I(t) ** 1.3)
            if cfg["latido_cada"] == 2:  # latido doble, como un corazón
                poner(mezcla, pulso * 0.6, t + beat * 0.42, 0.06 + 0.32 * I(t) ** 1.3)
            t += paso

    # 3) charango en arpegios de corcheas; aparece con la intensidad
    cuerda_cfg = cfg["charango"]
    corchea = beat / 2
    k = 0
    t = 0.0
    while t < duracion - 0.3:
        inten = I(t)
        ac = acordes_en(t, plan_ac, bar)
        esc = escala_en(t, plan_es)
        prob = np.clip((inten - 0.18) * 1.7 * cuerda_cfg, 0, 0.95)
        if rng.random() < prob:
            if k % 4 == 0:
                m = ac[(k // 4) % len(ac)] + 24
            else:
                m = esc[int(rng.integers(0, len(esc)))] + (12 if rng.random() < 0.35 else 0)
            nota = pulsada(hz(m), 0.9, inten, rng)
            poner(mezcla, nota, t, 0.16 + 0.16 * inten, pan=-0.45 if k % 2 == 0 else 0.45)
        t += corchea
        k += 1

    # 4) quena: frases largas sobre la pentatónica, cuando hay intensidad
    umbral, gq = cfg["quena"]
    t = beat * 2
    idx = 3
    while t < duracion - 1.0:
        inten = I(t)
        esc = escala_en(t, plan_es)
        dur_nota = float(rng.choice([beat * 2, beat * 3, beat * 4]))
        if inten >= umbral * 0.7 and rng.random() < 0.8:
            idx = int(np.clip(idx + rng.choice([-2, -1, 1, 2]), 0, len(esc) - 1))
            nota = quena(hz(esc[idx] + 12), min(dur_nota, duracion - t), rng)
            poner(mezcla, nota, t, 0.16 * gq * (0.5 + 0.7 * inten), pan=0.12)
        t += dur_nota + beat * float(rng.choice([0, 1, 2]))

    # 5) aire suave y reverberación
    aire = pasabanda(rng.normal(0, 1, n), 500, 3000)
    mezcla += np.stack([aire, np.roll(aire, 900)]) * 0.012 * np.interp(np.arange(n) / SR, curva[:, 0], curva[:, 1])
    mezcla = reverberacion(mezcla, rng)

    # 6) cierre: entrada y salida suaves, pasa-altos, limitador y nivel
    fade_in, fade_out = min(1.5, duracion * 0.15), min(2.5, duracion * 0.2)
    ganancia = np.ones(n)
    ganancia[: int(fade_in * SR)] = np.linspace(0, 1, int(fade_in * SR))
    ganancia[-int(fade_out * SR):] = np.linspace(1, 0, int(fade_out * SR))
    mezcla *= ganancia
    mezcla = np.stack([sosfilt(butter(2, 35, btype="high", fs=SR, output="sos"), mezcla[c]) for c in range(2)])
    mezcla = np.tanh(mezcla * 1.4) / np.tanh(1.4)
    mezcla *= NIVEL_PICO / (np.max(np.abs(mezcla)) + 1e-9)
    return mezcla.T.astype(np.float32)


def guardar(ruta: Path, audio: np.ndarray) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(str(ruta), SR, (audio * 32767).astype(np.int16))


def main() -> None:
    ap = argparse.ArgumentParser(description="Sintetiza la música original de la campaña (T1 a T4).")
    ap.add_argument("--pista", default="todas", help="T1, T2, T3, T4 o todas")
    ap.add_argument("--duracion", type=float, default=30.0, help="segundos (las curvas se estiran)")
    ap.add_argument("--salida", default=".", help="carpeta de salida")
    ap.add_argument("--semilla", type=int, default=None, help="cambia la semilla para otra variación")
    a = ap.parse_args()
    claves = list(PISTAS) if a.pista.lower() == "todas" else [a.pista.upper()]
    for c in claves:
        audio = sintetizar(c, a.duracion, a.semilla)
        destino = Path(a.salida) / f"musica_{c}_{int(a.duracion)}s.wav"
        guardar(destino, audio)
        print(f"{c}  {PISTAS[c]['nombre']}  ->  {destino}  ({a.duracion:.0f} s, pico {np.max(np.abs(audio)):.2f})")


if __name__ == "__main__":
    main()
