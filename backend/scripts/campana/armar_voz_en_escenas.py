#!/usr/bin/env python3
"""Coloca la voz de cada escena en su tramo del video (inicio de escena + desfase) y deja un voz_total.wav de la
duración exacta del video, para que mezclar.py la use tal cual.

    python armar_voz_en_escenas.py <carpeta_voz> --tramos 3.0,3.5,... [--desfase 0.3] [--salida voz_total_escenas.wav]
"""
import argparse
import wave
from pathlib import Path

import numpy as np


def leer(p: Path) -> np.ndarray:
    with wave.open(str(p)) as w:
        assert w.getsampwidth() == 2 and w.getframerate() == 44100
        a = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768
        return a.reshape(-1, w.getnchannels()).mean(axis=1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("carpeta", type=Path)
    ap.add_argument("--tramos", required=True, help="duración de cada escena en segundos, separadas por coma")
    ap.add_argument("--desfase", type=float, default=0.3)
    ap.add_argument("--salida", type=Path, default=None)
    a = ap.parse_args()
    tramos = [float(x) for x in a.tramos.split(",")]
    sr = 44100
    total = int(round(sum(tramos) * sr))
    pista = np.zeros(total, dtype=np.float32)
    t = 0.0
    for i, d in enumerate(tramos, 1):
        wav = a.carpeta / f"escena_e{i}.wav"
        x = leer(wav)
        ini = int(round((t + a.desfase) * sr))
        fin = min(total, ini + len(x))
        pista[ini:fin] += x[: fin - ini]
        print(f"e{i}: escena {t:.2f}-{t + d:.2f} s, voz {a.desfase:.2f}-{a.desfase + len(x) / sr:.2f} s dentro de la escena" + ("  ¡SE PASA DE LA ESCENA!" if a.desfase + len(x) / sr > d else ""))
        t += d
    out = a.salida or (a.carpeta / "voz_total_escenas.wav")
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((np.clip(pista, -1, 1) * 32767).astype("<i2").tobytes())
    print("escrito", out, f"{total / sr:.2f} s")


if __name__ == "__main__":
    main()
