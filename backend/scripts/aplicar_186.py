"""
Aplica la migración 186 (organigrama: diccionario de nombres de oficinas y visitas por entidad) en producción y la corre.

    MSYS_NO_PATHCONV=1 AWS_PROFILE=founder.edwin python backend/scripts/aplicar_186.py
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

MIGRACION = ROOT / "backend" / "db" / "migrations" / "186_organigrama.sql"


def main() -> None:
    with conexion("prod") as c:
        c.autocommit = True
        cur = c.cursor()
        cur.execute("SET statement_timeout = 0")
        t = time.time()
        cur.execute(MIGRACION.read_text(encoding="utf-8"))
        print(f"migración: {time.time() - t:.1f} s", flush=True)
        for f in ("refrescar_organo_nombre_global", "refrescar_visita_entidad_ruc", "refrescar_dji_jefatura"):
            t = time.time()
            cur.execute(f"SELECT {f}()")
            print(f"{f}: {cur.fetchone()[0]} en {time.time() - t:.0f} s", flush=True)
        cur.execute("SELECT fuente, count(*) FROM organo_nombre_global GROUP BY 1")
        print("nombres:", cur.fetchall(), flush=True)
        cur.execute("SELECT count(DISTINCT ruc) FROM visita_entidad_ruc")
        print("entidades con visitas:", cur.fetchone()[0], flush=True)
        cur.execute("SELECT count(*), count(DISTINCT ruc) FROM dji_jefatura")
        print("jefaturas DJI (filas, entidades):", cur.fetchone(), flush=True)


if __name__ == "__main__":
    os.environ.setdefault("AWS_PROFILE", "founder.edwin")
    main()
