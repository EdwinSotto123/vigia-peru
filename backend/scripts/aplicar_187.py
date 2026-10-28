#!/usr/bin/env python3
"""Migración 187 (órdenes por mes de cada entidad y de cada empresa) y su primer refresco, un año por vez.

Corre desacoplado (Start-Process): cada año recorre millones de órdenes de CONOSCE. Un año por sentencia y por
transacción: si el túnel se corta, se reconecta y se repite sólo ese año (la función borra e inserta sus meses: repetirla
no duplica nada).
  python backend/scripts/aplicar_187.py prod                 # el SQL y todos los años desde 2018
  python backend/scripts/aplicar_187.py dev --desde 2025     # DEV es de prueba: con dos años alcanza
  python backend/scripts/aplicar_187.py dev --sin-refresco   # sólo el SQL
"""
import argparse
import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

SQL = (ROOT / "backend/db/migrations/187_ordenes_por_mes.sql").read_text(encoding="utf-8")
MUESTRA = ("20613796909", "20211843579")  # UNA Chupaca (124 órdenes en 2026) y Arahuay, como en la 148


def refrescar(env: str, anio: int, ultimo: bool) -> None:
    # El año en curso va sin tope: lleva también las de un mes adelante.
    hasta = None if ultimo else date(anio, 12, 31)
    for intento in range(1, 4):
        try:
            with conexion(env) as c:
                cur = c.cursor()
                cur.execute("SET statement_timeout = 0")
                t0 = time.time()
                cur.execute("SELECT refrescar_ordenes_mes(%s, %s)", (date(anio, 1, 1), hasta))
                n = cur.fetchone()[0]
                c.commit()
                print(f"{env}: {anio} → {n} filas ({time.time() - t0:.0f} s)", flush=True)
                return
        except Exception as e:  # noqa: BLE001 — el túnel o la conexión se cayó: se repite ese año
            print(f"{env}: {anio} falló (intento {intento}): {str(e).strip()[:200]}", flush=True)
            time.sleep(30)
    raise SystemExit(f"{env}: {anio} no se pudo refrescar")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entornos", nargs="+", choices=["dev", "prod"])
    ap.add_argument("--desde", type=int, default=2018, help="primer año a refrescar")
    ap.add_argument("--sin-refresco", action="store_true", help="sólo aplicar el SQL")
    a = ap.parse_args()
    for env in a.entornos:
        with conexion(env) as c:
            cur = c.cursor()
            cur.execute("SET statement_timeout = 0")
            cur.execute(SQL)
            c.commit()
        print(f"{env}: migración 187 aplicada", flush=True)
        if a.sin_refresco:
            continue
        hoy = date.today()
        for anio in range(hoy.year, max(a.desde, 2018) - 1, -1):  # lo reciente primero: es lo que más se mira
            refrescar(env, anio, anio == hoy.year)
        with conexion(env) as c:
            cur = c.cursor()
            cur.execute("SELECT count(*), count(DISTINCT entidad_ruc), sum(ordenes) FROM entidad_orden_mes")
            print(f"{env}: entidad_orden_mes (filas, entidades, órdenes) {cur.fetchone()}", flush=True)
            cur.execute("SELECT count(*), count(DISTINCT ruc), sum(ordenes) FROM empresa_orden_mes")
            print(f"{env}: empresa_orden_mes (filas, empresas, órdenes) {cur.fetchone()}", flush=True)
            # Lo mismo que la tabla por año (148): el mismo número de órdenes por entidad y año.
            cur.execute("""SELECT a.entidad_ruc, a.anio, a.ordenes, m.n FROM entidad_orden_anual a
                             JOIN LATERAL (SELECT sum(ordenes) AS n FROM entidad_orden_mes x
                                            WHERE x.entidad_ruc = a.entidad_ruc AND extract(year FROM x.mes) = a.anio) m ON true
                            WHERE a.entidad_ruc IN %s AND a.anio = %s""", (MUESTRA, hoy.year))
            print(f"{env}: muestra (por año contra por mes) {cur.fetchall()}", flush=True)


if __name__ == "__main__":
    main()
