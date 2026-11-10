#!/usr/bin/env python3
"""Lee con Workers AI (GLM 5.3 flash) todo lo pendiente de las cuatro clases, una tras otra, con su segunda lectura
de las que encontraron banderas, y al final publica las banderas (publicar.py). Cada paso con su tope en USD.

  python -X utf8 backend/lector/orquestar_workers.py prod [--hilos 8] [--factor 1.0]

Pensado para correr desacoplado (Start-Process) hasta que se acaben los créditos de Workers AI: se puede cortar y volver
a lanzar, porque cada lector salta lo que ya está leído.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
LEER = str(RAIZ / "backend" / "lector" / "leer.py")
PUBLICAR = str(RAIZ / "backend" / "lector" / "publicar.py")

# (clase, argumentos extra, tope en USD): lo pendiente al 2026-11-10 con GLM 5.3 flash cuesta ~US$ 0,001-0,003 por lectura.
PASOS = [
    ("buena_pro", [], 45),
    ("buena_pro", ["--segunda", "--solo-con-banderas"], 15),
    ("contrato", [], 30),
    ("consultas", [], 25),
    ("consultas", ["--segunda", "--solo-con-banderas"], 15),
    ("bases", [], 40),
    ("bases", ["--segunda", "--solo-con-banderas"], 15),
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--hilos", type=int, default=8)
    ap.add_argument("--factor", type=float, default=1.0, help="multiplica los topes en USD")
    # El trabajo es de CPU (PyMuPDF con el GIL tomado): para ir más rápido, varias cadenas en paralelo con --clases
    # distintas (cada proceso, su núcleo), nunca dos con la misma clase.
    ap.add_argument("--clases", default="", help="sólo estas clases, separadas por comas")
    ap.add_argument("--modelo", default="", help="el modelo de Workers AI (@cf/…); cada modelo tiene su propio tope por minuto")
    ap.add_argument("--sin-publicar", action="store_true", help="sin publicar al final (la cadena diaria lo hace igual)")
    a = ap.parse_args()
    t0 = time.time()
    clases = {c.strip() for c in a.clases.split(",") if c.strip()}
    for clase, extra, tope in PASOS:
        if clases and clase not in clases:
            continue
        cmd =[sys.executable, "-X", "utf8", LEER, a.entorno, "--clase", clase, "--motor", "workers",
               "--hilos", str(a.hilos), "--tope-usd", str(round(tope * a.factor, 2)), *extra, *(["--modelo", a.modelo] if a.modelo else [])]
        print(f"\n== {clase} {' '.join(extra)} (tope USD {round(tope * a.factor, 2)}) {time.strftime('%H:%M')}", flush=True)
        r = subprocess.run(cmd)
        print(f"== fin {clase} {' '.join(extra)}: código {r.returncode}, {round((time.time() - t0) / 60)} min", flush=True)
    if not a.sin_publicar:
        print(f"\n== publicar {time.strftime('%H:%M')}", flush=True)
        subprocess.run([sys.executable, "-X", "utf8", PUBLICAR, a.entorno])
    print(f"== FIN {round((time.time() - t0) / 60)} min", flush=True)


if __name__ == "__main__":
    main()
