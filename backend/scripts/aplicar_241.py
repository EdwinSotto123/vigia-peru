#!/usr/bin/env python3
"""Migración 241 (las visitas de las empresas fuera del refresco diario) y la puesta al día de lo que dejó de correr.

Del 28-10 al 03-11 el paso refrescar_empresas de oece_ocds no terminó, y con él tampoco refrescar_visita_empresa ni
refrescar_poder. Esto aplica el SQL y corre, en orden y cada uno en su transacción: el resumen de empresas (ya sin las
visitas), las visitas de las empresas por tramos, lo que ganaron después de visitar y el mapa de poder. Va directo a la
base (sin el corte de la conexión del Worker). Tarda ~15-20 min en producción: correrlo desacoplado.
  python -X utf8 backend/scripts/aplicar_241.py dev
  python -X utf8 backend/scripts/aplicar_241.py prod
  python -X utf8 backend/scripts/aplicar_241.py prod --sin-sql     # sólo la puesta al día
"""
import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

SQL = (ROOT / "backend/db/migrations/241_visitas_empresas_aparte.sql").read_text(encoding="utf-8")
PASOS = ["refrescar_empresas", "visitas", "refrescar_visita_empresa", "refrescar_poder"]
# Ids de visita por transacción. Todo de una vez (refrescar_empresa_visitas) tardó más de 30 min en producción y el túnel
# SSM se cortó a mitad (2026-11-03): por tramos, cada uno se guarda y un corte sólo repite el suyo.
TRAMO = 1_000_000


def visitas(env: str) -> None:
    with conexion(env) as c:
        cur = c.cursor()
        cur.execute("SET statement_timeout = 0")
        t0 = time.time()
        cur.execute("SELECT refrescar_empresa_visitas_preparar()")
        plan = cur.fetchone()[0]
        c.commit()
    print(f"{env}: visitas, preparar → {json.dumps(plan)} ({time.time() - t0:.0f} s)", flush=True)
    desde, total = int(plan["desde"]), 0
    while desde < int(plan["hasta"]):
        hasta = min(desde + TRAMO, int(plan["hasta"]))
        for intento in range(1, 4):
            try:
                with conexion(env) as c:
                    cur = c.cursor()
                    cur.execute("SET statement_timeout = 0")
                    t0 = time.time()
                    cur.execute("SELECT refrescar_empresa_visitas_tramo(%s, %s)", (desde, hasta))
                    n = cur.fetchone()[0]
                    c.commit()
                total += n
                print(f"{env}: visitas {desde}-{hasta} → {n} ({time.time() - t0:.0f} s; van {total})", flush=True)
                break
            except Exception as e:  # noqa: BLE001
                print(f"{env}: visitas {desde}-{hasta} falló (intento {intento}): {str(e).strip()[:200]}", flush=True)
                time.sleep(30)
        else:
            raise SystemExit(f"{env}: el tramo {desde}-{hasta} no terminó")
        desde = hasta
    with conexion(env) as c:
        cur = c.cursor()
        cur.execute("SET statement_timeout = 0")
        cur.execute("SELECT refrescar_empresa_visitas_cerrar(%s, %s)", (int(plan["desde"]), int(plan["hasta"])))
        print(f"{env}: visitas, cerrar → {cur.fetchone()[0]} empresas con conteo nuevo", flush=True)
        c.commit()


def correr(env: str, funcion: str) -> None:
    for intento in range(1, 4):
        try:
            with conexion(env) as c:
                cur = c.cursor()
                cur.execute("SET statement_timeout = 0")
                cur.execute("SELECT to_regprocedure(%s) IS NOT NULL", (f"{funcion}()",))
                if not cur.fetchone()[0]:
                    print(f"{env}: {funcion}() no existe: se salta", flush=True)
                    return
                t0 = time.time()
                cur.execute(f"SELECT {funcion}()")
                r = cur.fetchone()[0]
                c.commit()
                print(f"{env}: {funcion} → {json.dumps(r, ensure_ascii=False, default=str)} ({time.time() - t0:.0f} s)", flush=True)
                return
        except Exception as e:  # noqa: BLE001 — el túnel o la conexión se cayó: se repite ese paso (cada uno rehace lo suyo)
            print(f"{env}: {funcion} falló (intento {intento}): {str(e).strip()[:300]}", flush=True)
            time.sleep(30)
    raise SystemExit(f"{env}: {funcion} no terminó")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--sin-sql", action="store_true", help="no aplicar la migración (ya está)")
    ap.add_argument("--desde-paso", choices=PASOS, default=PASOS[0], help="empezar en este paso (los anteriores ya corrieron)")
    a = ap.parse_args()
    if not a.sin_sql:
        with conexion(a.entorno) as c:
            cur = c.cursor()
            cur.execute("SET statement_timeout = 0")
            cur.execute(SQL)
            c.commit()
        print(f"{a.entorno}: migración 241 aplicada", flush=True)
    for funcion in PASOS[PASOS.index(a.desde_paso):]:
        visitas(a.entorno) if funcion == "visitas" else correr(a.entorno, funcion)
    with conexion(a.entorno) as c:
        cur = c.cursor()
        cur.execute("""SELECT via, count(*), count(entidad_ruc) FROM empresa_visita GROUP BY via ORDER BY 1""")
        print(f"{a.entorno}: empresa_visita por vía (filas, a clientes): {cur.fetchall()}", flush=True)
        cur.execute("SELECT count(*), count(*) FILTER (WHERE visitas > 0), sum(visitas) FROM empresa_resumen")
        print(f"{a.entorno}: empresa_resumen (empresas, con visitas, visitas): {cur.fetchone()}", flush=True)
    print("FIN", flush=True)


if __name__ == "__main__":
    main()
