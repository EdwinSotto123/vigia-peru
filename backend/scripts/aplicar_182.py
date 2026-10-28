"""
Aplica la migración 182 (pariente de un funcionario en su planilla, ascenso exprés, planilla mes a mes y dji_nepotismo
por el rango de la llave) y corre su refresco. Idempotente. Tarda unos 5 minutos: en producción, como proceso aparte (con su PID
en dataset/declaracion_jurada/procesos.json).

    MSYS_NO_PATHCONV=1 AWS_PROFILE=founder.edwin python backend/scripts/aplicar_182.py [--base prod|dev]
"""

from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "infrastructure", "aws"))
from tunel_rds import conexion  # noqa: E402

MIGRACION = os.path.join(os.path.dirname(__file__), "..", "db", "migrations", "182_planilla_familia_ascenso.sql")


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
        for paso in ("refrescar_planilla_extra",):
            t = time.time()
            cur.execute(f"SELECT {paso}()")
            print(f"{paso}: {cur.fetchone()[0]} en {time.time() - t:.0f} s", flush=True)
            for n in c.notices[-8:]:
                print("  ", n.strip(), flush=True)
            del c.notices[:]
        cur.execute("""SELECT s->>'tipo', s->>'severidad', count(*) FROM planilla_persona p, jsonb_array_elements(p.senales) s
                        WHERE s->>'tipo' IN ('pariente_planilla', 'familiar_en_planilla', 'ascenso_expres') GROUP BY 1, 2 ORDER BY 1, 2""")
        print("planilla:", cur.fetchall(), flush=True)
        cur.execute("SELECT count(*), count(DISTINCT entidad_ruc), min(mes), max(mes) FROM planilla_entidad_mes")
        print("planilla mes a mes:", cur.fetchone(), flush=True)
        print("listo", flush=True)


if __name__ == "__main__":
    main()
