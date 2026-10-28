"""
Aplica la migración 180 («Familia en el Estado» y el índice de la planilla por código de locador) sin frenar las cargas:
el índice CONCURRENTLY primero (el .sql lo crea sin CONCURRENTLY, que con dev.py migrar va en una sola transacción),
después la función, y la corre con los refrescos que la siguen. Antes rehace el nepotismo del mismo gobierno (179) con
los vínculos de la DJI de las últimas rondas. Idempotente. En producción, como proceso aparte (con su PID en
dataset/declaracion_jurada/procesos.json).

    MSYS_NO_PATHCONV=1 AWS_PROFILE=founder.edwin python backend/scripts/aplicar_180.py [--base prod|dev]
"""

from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "infrastructure", "aws"))
from tunel_rds import conexion  # noqa: E402

MIGRACION = os.path.join(os.path.dirname(__file__), "..", "db", "migrations", "180_familia_estado.sql")
INDICE = "CREATE INDEX CONCURRENTLY IF NOT EXISTS planilla_persona_codigo ON planilla_persona (codigo) WHERE codigo IS NOT NULL"


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
        cur.execute(INDICE)
        print(f"índice de la planilla por código: {time.time() - t:.0f} s", flush=True)
        t = time.time()
        cur.execute(sql)
        print(f"migración: {time.time() - t:.1f} s", flush=True)
        for paso in ("refrescar_senales_extra", "refrescar_familia_estado", "refrescar_entidad_senal_politica", "refrescar_personas_resumen"):
            t = time.time()
            cur.execute(f"SELECT {paso}()")
            print(f"{paso}: {cur.fetchone()[0]} en {time.time() - t:.0f} s", flush=True)
            for n in c.notices[-8:]:
                print("  ", n.strip(), flush=True)
            del c.notices[:]
        cur.execute("""SELECT tipo, count(*), count(DISTINCT ruc) FROM persona_senal
                        WHERE tipo IN ('nepotismo', 'nepotismo_gobierno', 'familia_estado') GROUP BY 1 ORDER BY 1""")
        print("personas (señales, locadores):", cur.fetchall(), flush=True)
        print("listo", flush=True)


if __name__ == "__main__":
    main()
