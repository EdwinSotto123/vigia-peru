#!/usr/bin/env python3
"""Coloca la voz de cada escena en el instante en que EMPIEZA esa escena del video.

generar_voz.py deja un WAV por escena (escena_<id>.wav) y `marcas.json`. Este script los alinea con las duraciones
reales de las escenas del montaje (las que se usan en Moda) y escribe:

  voz_alineada.wav        la voz de todo el video (44,1 kHz mono), con silencio donde no se habla
  marcas_alineadas.json   inicio y fin de cada escena y de cada palabra, en segundos del video

    python colocar_voz.py --voz-dir ../../../../campanas-vigia/audio/voz/T1 \
        --ventanas 3.4,3.6,3.0,3.6,4.0,4.0,4.0,4.4 --desfase 0.2 --total 30

Falla si alguna frase no cabe en su ventana (con 0,15 s de aire al final).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from scipy.io import wavfile

SR = 44100


def leer_wav(ruta: Path) -> np.ndarray:
    sr, x = wavfile.read(ruta)
    if x.dtype == np.int16:
        x = x.astype(np.float32) / 32768.0
    elif x.dtype != np.float32:
        x = x.astype(np.float32)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if sr != SR:
        raise SystemExit(f"{ruta.name}: se esperaba {SR} Hz y trae {sr}")
    return x


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--voz-dir", required=True)
    ap.add_argument("--ventanas", required=True, help="duración de cada escena en segundos, separadas por coma")
    ap.add_argument("--desfase", type=float, default=0.2, help="segundos de aire antes de que empiece la voz en cada escena")
    ap.add_argument("--total", type=float, default=30.0)
    a = ap.parse_args()

    d = Path(a.voz_dir)
    marcas = json.loads((d / "marcas.json").read_text(encoding="utf-8"))
    ventanas = [float(v) for v in a.ventanas.split(",")]
    escenas = marcas["escenas"]
    if len(ventanas) != len(escenas):
        raise SystemExit(f"{len(ventanas)} ventanas para {len(escenas)} escenas")
    if abs(sum(ventanas) - a.total) > 0.01:
        raise SystemExit(f"las ventanas suman {sum(ventanas):.2f} s y el video dura {a.total} s")

    pista = np.zeros(int(a.total * SR) + SR, dtype=np.float32)
    salida = []
    t0 = 0.0
    for esc, win in zip(escenas, ventanas):
        x = leer_wav(d / f"escena_{esc['id']}.wav")
        dur = len(x) / SR
        ini = t0 + a.desfase
        if a.desfase + dur > win - 0.15:
            raise SystemExit(f"{esc['id']}: la voz dura {dur:.2f} s y la ventana {win:.2f} s no alcanza")
        i = int(ini * SR)
        pista[i:i + len(x)] += x
        # los tiempos de palabra del JSON son relativos al inicio de la escena dentro de voz_total.wav
        base = esc["inicio_s"]
        palabras = [{"texto": p["texto"], "inicio_s": round(ini + (p["inicio_s"] - base), 3), "fin_s": round(ini + (p["fin_s"] - base), 3)}
                    for p in esc["palabras"]]
        salida.append({"id": esc["id"], "texto": esc["texto"], "escena_inicio_s": round(t0, 3), "escena_fin_s": round(t0 + win, 3),
                       "voz_inicio_s": round(ini, 3), "voz_fin_s": round(ini + dur, 3), "palabras": palabras})
        t0 += win

    pista = pista[: int(a.total * SR)]
    pico = float(np.max(np.abs(pista))) or 1.0
    if pico > 0.98:
        pista *= 0.98 / pico
    wavfile.write(d / "voz_alineada.wav", SR, (pista * 32767).astype(np.int16))
    (d / "marcas_alineadas.json").write_text(json.dumps({"id": marcas["id"], "total_s": a.total, "escenas": salida}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"voz_alineada.wav {a.total:.1f} s  ->  {d}")
    for e in salida:
        print(f"  {e['id']}  escena {e['escena_inicio_s']:5.2f} a {e['escena_fin_s']:5.2f}   voz {e['voz_inicio_s']:5.2f} a {e['voz_fin_s']:5.2f}")


if __name__ == "__main__":
    main()
