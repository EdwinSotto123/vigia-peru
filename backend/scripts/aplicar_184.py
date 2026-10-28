"""
Aplica la migración 184 (empresa espejo, cada proceso de CONOSCE ya juntado y lo que declararon funcionarios sobre cada
empresa) y corre sus refrescos con la cadena que lleva el cruce nuevo a los casos y al resumen de empresas
(dedup_cruces_proveedor, refrescar_casos_cruce_base, refrescar_empresas). Idempotente. Tarda unos 10 minutos: en
producción, como proceso aparte (con su PID en dataset/declaracion_jurada/procesos.json).

    MSYS_NO_PATHCONV=1 AWS_PROFILE=founder.edwin python backend/scripts/aplicar_184.py [--base prod|dev]
"""

from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "infrastructure", "aws"))
from tunel_rds import conexion  # noqa: E402

MIGRACION = os.path.join(os.path.dirname(__file__), "..", "db", "migrations", "184_empresa_espejo_postulaciones.sql")
PASOS = ("refrescar_proceso_resumen", "refrescar_cruce_empresa_espejo", "dedup_cruces_proveedor", "refrescar_casos_cruce_base",
         "refrescar_empresas")


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
        for paso in PASOS:
            t = time.time()
            cur.execute(f"SELECT {paso}()")
            print(f"{paso}: {cur.fetchone()[0]} en {time.time() - t:.0f} s", flush=True)
            for n in c.notices[-6:]:
                print("  ", n.strip(), flush=True)
            del c.notices[:]
        cur.execute("""SELECT severidad, count(*), count(DISTINCT ruc_empresa) FROM cruces_proveedor WHERE tipo = 'empresa_espejo'
                        GROUP BY 1 ORDER BY 1""")
        print("empresa espejo (severidad, contratos, empresas):", cur.fetchall(), flush=True)
        cur.execute("SELECT count(*), count(DISTINCT ruc) FROM empresa_dji_declarada")
        print("declaraciones DJI sobre empresas (filas, empresas):", cur.fetchone(), flush=True)
        print("listo", flush=True)


if __name__ == "__main__":
    main()
