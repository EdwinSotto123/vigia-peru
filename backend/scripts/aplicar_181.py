"""
Aplica la migración 181 (el locador socio de un proveedor de su entidad y la gestión actual de cada entidad) y corre sus
refrescos con el resumen de personas. Idempotente. Tarda unos 5 minutos: en producción, como proceso aparte (con su PID
en dataset/declaracion_jurada/procesos.json).

    MSYS_NO_PATHCONV=1 AWS_PROFILE=founder.edwin python backend/scripts/aplicar_181.py [--base prod|dev]
"""

from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "infrastructure", "aws"))
from tunel_rds import conexion  # noqa: E402

MIGRACION = os.path.join(os.path.dirname(__file__), "..", "db", "migrations", "181_socio_proveedor_y_gestion.sql")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="prod", choices=["prod", "dev"])
    args = ap.parse_args()
    sql = open(MIGRACION, encoding="utf-8").read()
    with conexion(args.base) as c:
        c.autocommit = True
        cur = c.cursor()
        cur.execute("SET statement_timeout = 0")
        t = time.time()
        cur.execute(sql)
        print(f"migración: {time.time() - t:.1f} s", flush=True)
        for paso in ("refrescar_entidad_gestion", "refrescar_socio_proveedor_locador", "refrescar_personas_resumen"):
            t = time.time()
            cur.execute(f"SELECT {paso}()")
            print(f"{paso}: {cur.fetchone()[0]} en {time.time() - t:.0f} s", flush=True)
            for n in c.notices[-8:]:
                print("  ", n.strip(), flush=True)
            del c.notices[:]
        cur.execute("SELECT nivel, count(*) FROM entidad_gestion GROUP BY 1 ORDER BY 1")
        print("gestiones:", cur.fetchall(), flush=True)
        cur.execute("""SELECT severidad, count(*), count(DISTINCT ruc) FROM persona_senal WHERE tipo = 'socio_proveedor'
                        GROUP BY 1 ORDER BY 1""")
        print("socio de un proveedor (severidad, pares, locadores):", cur.fetchall(), flush=True)
        print("listo", flush=True)


if __name__ == "__main__":
    main()
