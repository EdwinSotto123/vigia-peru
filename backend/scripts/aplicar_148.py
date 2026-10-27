#!/usr/bin/env python3
"""Migración 148 (órdenes por entidad y año) y su primer refresco, un año por vez.

Corre desacoplado (Start-Process): cada año recorre millones de órdenes de CONOSCE y las ordena (en DEV, 2025 y 2026
juntos tardaron 16 min). Un año por sentencia y por transacción: si el túnel se corta, se reconecta y se repite sólo
ese año (la función borra e inserta el año: repetirla no duplica nada).
  python backend/scripts/aplicar_148.py prod                 # el SQL y todos los años desde 2018
  python backend/scripts/aplicar_148.py dev --desde 2025     # DEV es de prueba: con dos años alcanza
  python backend/scripts/aplicar_148.py dev --sin-refresco   # sólo el SQL
"""
import argparse
import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

SQL = (ROOT / "backend/db/migrations/148_entidad_orden_anual.sql").read_text(encoding="utf-8")
MUESTRA = ("20601429706", "20172357271")  # UNA Chupaca (124 órdenes en 2026) y Arahuay (504)


def refrescar(env: str, anio: int, ultimo: bool) -> None:
    # El año en curso va sin tope: lleva también las de un mes adelante (en diciembre, las de enero del que viene).
    hasta = None if ultimo else date(anio, 12, 31)
    for intento in range(1, 4):
        try:
            with conexion(env) as c:
                cur = c.cursor()
                cur.execute("SET statement_timeout = 0")
                t0 = time.time()
                cur.execute("SELECT refrescar_entidad_ordenes(%s, %s)", (date(anio, 1, 1), hasta))
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
        print(f"{env}: migración 148 aplicada", flush=True)
        if a.sin_refresco:
            continue
        hoy = date.today()
        for anio in range(max(a.desde, 2018), hoy.year + 1):
            refrescar(env, anio, anio == hoy.year)
        with conexion(env) as c:
            cur = c.cursor()
            cur.execute("SELECT count(*), count(DISTINCT entidad_ruc), sum(ordenes) FROM entidad_orden_anual")
            print(f"{env}: total (filas, entidades, órdenes) {cur.fetchone()}", flush=True)
            cur.execute("SELECT entidad_ruc, anio, ordenes, monto FROM entidad_orden_anual WHERE entidad_ruc IN %s AND anio = %s",
                        (MUESTRA, hoy.year))
            print(f"{env}: muestra {cur.fetchall()}", flush=True)


if __name__ == "__main__":
    main()
