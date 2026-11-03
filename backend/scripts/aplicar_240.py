#!/usr/bin/env python3
"""Migración 240 (una sola lista de compras, sin repetidas) y su primer cálculo, un año por vez.

Cada año recorre millones de órdenes de CONOSCE y las junta con el catálogo, los menores y los procesos. Un año por
sentencia y por transacción: si el túnel se corta, se reconecta y se repite sólo ese año (la función borra e inserta sus
años: repetirla no duplica nada). Correrlo desacoplado: tarda varios minutos por año.
  python -X utf8 backend/scripts/aplicar_240.py dev                  # el SQL y todos los años (2015 en adelante)
  python -X utf8 backend/scripts/aplicar_240.py dev --desde 2025     # sólo desde 2025
  python -X utf8 backend/scripts/aplicar_240.py dev --sin-sql        # sólo el cálculo (la migración ya está)
"""
import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

SQL = (ROOT / "backend/db/migrations/240_compras_unificadas.sql").read_text(encoding="utf-8")
# Gobierno Regional de Ucayali, una entidad grande (EsSalud no: tiene ~1 M de órdenes) y una empresa de catálogo.
MUESTRA = ("20393066386", "20131369124")


def refrescar(env: str, anio: int) -> None:
    for intento in range(1, 4):
        try:
            with conexion(env) as c:
                cur = c.cursor()
                cur.execute("SET statement_timeout = 0")
                t0 = time.time()
                cur.execute("SELECT refrescar_compras(%s, %s)", (date(anio, 1, 1), date(anio, 12, 31)))
                r = cur.fetchone()[0]
                c.commit()
                print(f"{env}: {anio} → {json.dumps(r, ensure_ascii=False)} ({time.time() - t0:.0f} s)", flush=True)
                return
        except Exception as e:  # noqa: BLE001 — el túnel o la conexión se cayó: se repite ese año
            print(f"{env}: {anio} falló (intento {intento}): {str(e).strip()[:300]}", flush=True)
            time.sleep(30)
    raise SystemExit(f"{env}: {anio} no se pudo calcular")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--desde", type=int, default=2015, help="primer año a calcular")
    ap.add_argument("--hasta", type=int, default=date.today().year, help="último año a calcular")
    ap.add_argument("--sin-sql", action="store_true", help="no aplicar la migración (ya está)")
    a = ap.parse_args()
    if not a.sin_sql:
        with conexion(a.entorno) as c:
            cur = c.cursor()
            cur.execute("SET statement_timeout = 0")
            cur.execute(SQL)
            c.commit()
        print(f"{a.entorno}: migración 240 aplicada", flush=True)
    # Del más reciente al más viejo: lo que más se mira queda listo primero.
    for anio in range(a.hasta, max(a.desde, 2015) - 1, -1):
        refrescar(a.entorno, anio)
    with conexion(a.entorno) as c:
        cur = c.cursor()
        cur.execute("SELECT clase, regla, count(*) FROM compra_vinculo GROUP BY 1, 2 ORDER BY 1, 2")
        print(f"{a.entorno}: vínculos {cur.fetchall()}", flush=True)
        cur.execute("SELECT entidad_ruc, clase, sum(compras), round(sum(monto)) FROM compra_resumen WHERE entidad_ruc IN %s "
                    "GROUP BY 1, 2 ORDER BY 1, 2", (MUESTRA,))
        print(f"{a.entorno}: muestra {cur.fetchall()}", flush=True)


if __name__ == "__main__":
    main()
