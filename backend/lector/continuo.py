#!/usr/bin/env python3
"""Lectura continua: cada vuelta lee con Claude lo que bajó la fuente `documentos` (los pedidos `lectura`, del de mayor
monto al de menor) y publica las banderas; para al llegar al tope de gasto o a la fecha límite.

  python -X utf8 backend/lector/continuo.py prod --tope-usd 320 --hasta 2026-11-10T12:00:00-05:00 \
      --logs <carpeta> [--cada-min 60] [--hilos 10] [--rehacer-grandes]

Por vuelta, en este orden (leer.py, cada uno con lo que queda del tope):
  1. buena_pro, y su segunda lectura sólo de las actas con una bandera que se publica;
  2. contrato;
  3. consultas, y su segunda lectura de todas (las banderas salen sólo si coinciden);
  4. bases, y su segunda lectura sólo de las que marcaron algo;
  5. publicar.py, si se leyó algo.
El gasto se cuenta en la base (documento_lectura.costo_usd desde que arrancó), así que sobrevive a un reinicio si se le
pasa el mismo --desde. Corre desacoplado (Start-Process): es reanudable, lo ya leído no se vuelve a leer.
"""
from __future__ import annotations

import argparse
import datetime as dt
import subprocess
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

LEER = RAIZ / "backend" / "lector" / "leer.py"
PUBLICAR = RAIZ / "backend" / "lector" / "publicar.py"
PASOS = [
    ("buena_pro", []),
    ("buena_pro", ["--segunda", "--solo-con-banderas"]),
    ("contrato", []),
    ("consultas", []),
    ("consultas", ["--segunda"]),
    ("bases", []),
    ("bases", ["--segunda", "--solo-con-banderas"]),
]


def ahora() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def gastado(entorno: str, desde: dt.datetime) -> float:
    for intento in range(1, 6):
        try:
            with conexion(entorno) as c:
                cur = c.cursor()
                cur.execute("SELECT COALESCE(sum(costo_usd), 0)::float FROM documento_lectura WHERE leido_at >= %s", (desde,))
                return cur.fetchone()[0]
        except Exception as e:  # noqa: BLE001 — el túnel: se espera y se repite
            print(f"{ahora():%m-%d %H:%M} la base falló ({intento}): {str(e)[:160]}", flush=True)
            time.sleep(30 * intento)
    raise RuntimeError("la base no responde")


def correr(cmd: list[str], log: Path) -> str:
    """Corre un paso con su salida al final del log; devuelve la última línea (el FIN de leer.py)."""
    with open(log, "a", encoding="utf-8") as f:
        f.write(f"\n=== {ahora():%Y-%m-%d %H:%M} {' '.join(cmd[3:])}\n")
        f.flush()
        subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT)
    with open(log, encoding="utf-8") as f:
        lineas = [x.strip() for x in f.readlines()[-3:] if x.strip()]
    return lineas[-1] if lineas else ""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--tope-usd", type=float, required=True, help="lo más que se gasta en total desde --desde")
    ap.add_argument("--hasta", required=True, help="fecha y hora ISO con zona: no se empieza una vuelta después")
    ap.add_argument("--desde", help="desde cuándo se cuenta el gasto (ISO con zona); por defecto, ahora")
    ap.add_argument("--logs", required=True, help="carpeta para los logs de cada clase")
    ap.add_argument("--cada-min", type=int, default=60)
    ap.add_argument("--hilos", type=int, default=10)
    ap.add_argument("--rehacer-grandes", action="store_true", help="en la primera vuelta, los que quedaron «grande»")
    a = ap.parse_args()
    hasta = dt.datetime.fromisoformat(a.hasta)
    desde = dt.datetime.fromisoformat(a.desde) if a.desde else ahora()
    logs = Path(a.logs)
    logs.mkdir(parents=True, exist_ok=True)
    print(f"{ahora():%m-%d %H:%M} lectura continua: tope USD {a.tope_usd}, hasta {hasta.isoformat()}, gasto desde "
          f"{desde.isoformat()}", flush=True)
    vuelta = 0
    while ahora() < hasta:
        vuelta += 1
        t0, leyo = time.time(), False
        for clase, extra in PASOS:
            queda = a.tope_usd - gastado(a.entorno, desde)
            if queda < 0.5:
                print(f"{ahora():%m-%d %H:%M} tope de USD {a.tope_usd} alcanzado: fin", flush=True)
                return
            cmd = [sys.executable, "-X", "utf8", str(LEER), a.entorno, "--clase", clase, "--tope-usd", f"{queda:.2f}",
                   "--hilos", str(a.hilos), *extra]
            if vuelta == 1 and a.rehacer_grandes:
                cmd.append("--rehacer-grandes")
            nombre = clase + ("_2" if "--segunda" in extra else "")
            fin = correr(cmd, logs / f"{nombre}.log")
            if not fin.startswith(f"FIN {clase}: 0 contratos"):
                leyo = True
            print(f"{ahora():%m-%d %H:%M} vuelta {vuelta} {nombre}: {fin[:200]}", flush=True)
        if leyo:
            fin = correr([sys.executable, "-X", "utf8", str(PUBLICAR), a.entorno], logs / "publicar.log")
            print(f"{ahora():%m-%d %H:%M} vuelta {vuelta} publicar: {fin}", flush=True)
        print(f"{ahora():%m-%d %H:%M} vuelta {vuelta} en {round(time.time() - t0)} s; gastado USD "
              f"{gastado(a.entorno, desde):.2f}", flush=True)
        espera = a.cada_min * 60 - (time.time() - t0)
        if espera > 0 and ahora() + dt.timedelta(seconds=espera) < hasta:
            time.sleep(espera)
    print(f"{ahora():%m-%d %H:%M} fecha límite: fin", flush=True)


if __name__ == "__main__":
    main()
