"""
Aplica la migración 179 (cinco señales nuevas de personas y planilla) sin frenar las cargas: el índice parcial de la
franja de «al borde del tope» CONCURRENTLY primero (el .sql lo crea sin CONCURRENTLY, que con dev.py migrar va en una
sola transacción), después la función, y la corre con los refrescos que dependen de ella. Idempotente. Tarda de 6 a 10
minutos: en producción, como proceso aparte (con su PID en dataset/declaracion_jurada/procesos.json).

    MSYS_NO_PATHCONV=1 AWS_PROFILE=founder.edwin python backend/scripts/aplicar_179.py [--base prod|dev]
"""

from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "infrastructure", "aws"))
from tunel_rds import conexion  # noqa: E402

MIGRACION = os.path.join(os.path.dirname(__file__), "..", "db", "migrations", "179_mas_senales.sql")
INDICE = """CREATE INDEX CONCURRENTLY IF NOT EXISTS conosce_ordenes_borde_tope ON conosce_ordenes (entidad_ruc, ruc_contratista)
  WHERE tipo_orden = 'Orden de Servicio' AND monto >= 31540 AND monto < 44000 AND ruc_contratista LIKE '10%'"""


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
        print(f"índice de la franja: {time.time() - t:.0f} s", flush=True)
        t = time.time()
        cur.execute(sql)
        print(f"migración: {time.time() - t:.1f} s", flush=True)
        for paso in ("refrescar_senales_extra", "refrescar_entidad_senal_politica", "refrescar_personas_resumen"):
            t = time.time()
            cur.execute(f"SELECT {paso}()")
            print(f"{paso}: {cur.fetchone()[0]} en {time.time() - t:.0f} s", flush=True)
            for n in c.notices[-8:]:
                print("  ", n.strip(), flush=True)
            del c.notices[:]
        cur.execute("""SELECT tipo, severidad, count(*) FROM persona_senal WHERE tipo IN ('nepotismo_gobierno', 'al_borde_del_tope')
                        GROUP BY 1, 2 ORDER BY 1, 2""")
        print("personas:", cur.fetchall(), flush=True)
        cur.execute("""SELECT s->>'tipo', s->>'severidad', count(*) FROM planilla_persona p, jsonb_array_elements(p.senales) s
                        WHERE s->>'tipo' IN ('doble_planilla', 'socio_proveedor', 'pariente_locador') GROUP BY 1, 2 ORDER BY 1, 2""")
        print("planilla:", cur.fetchall(), flush=True)
        print("listo", flush=True)


if __name__ == "__main__":
    main()
