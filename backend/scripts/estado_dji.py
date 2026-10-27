#!/usr/bin/env python3
"""Estado de la captura de familiares (DJI) sin depender de nadie: procesos vivos, avance del ledger y últimas líneas.

Lee dataset/declaracion_jurada/procesos.json (PID, qué es, su log), mira si cada PID sigue vivo y cuánto va el ledger
`dji_descargas` en prod. Los procesos corren desacoplados de cualquier sesión (sin padre ni job): no mueren si se cierra
la terminal o la sesión de Claude; sí con un reinicio de la PC.

  MSYS_NO_PATHCONV=1 AWS_PROFILE=founder.edwin PYTHONIOENCODING=utf-8 PATH="/c/Users/usuario/bin:$PATH" \\
    python backend/scripts/estado_dji.py [--sin-base]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATOS = ROOT / "dataset" / "declaracion_jurada"
PROCESOS = DATOS / "procesos.json"


def vivo(pid: int) -> bool:
    r = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True, errors="replace")
    return str(pid) in r.stdout


def cola(archivo: Path, n: int = 3) -> list[str]:
    if not archivo.exists():
        return ["(sin log)"]
    lineas = [x for x in archivo.read_text(encoding="utf-8", errors="replace").splitlines()
              if x.strip() and not x.startswith(("  File", "    ", "Traceback", "Exception in thread", "Execute called"))]
    return lineas[-n:]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sin-base", action="store_true", help="no consultar el ledger (sin túnel)")
    a = ap.parse_args()
    procesos = json.loads(PROCESOS.read_text(encoding="utf-8")) if PROCESOS.exists() else []
    for p in procesos:
        print(f"{'VIVO  ' if vivo(p['pid']) else 'muerto'} PID {p['pid']:>6}  {p['que']}")
        for linea in cola(ROOT / p["log"]):
            print(f"         {linea[:150]}")
    if a.sin_base:
        return
    sys.path.insert(0, str(ROOT / "infrastructure" / "aws"))
    from tunel_rds import conexion  # noqa: E402
    with conexion("prod") as c:
        cur = c.cursor()
        cur.execute("SELECT estado, count(*) FROM dji_descargas GROUP BY 1 ORDER BY 2 DESC")
        print("ledger:", ", ".join(f"{e} {n:,}" for e, n in cur.fetchall()))
        cur.execute("SELECT count(*), count(DISTINCT (entidad_ruc, declarante_norm)) FROM dji_vinculos")
        v, d = cur.fetchone()
        cur.execute("SELECT count(*) FROM dji_nepotismo")
        print(f"familiares: {v:,} de {d:,} declarantes; señales de nepotismo: {cur.fetchone()[0]:,}")


if __name__ == "__main__":
    main()
