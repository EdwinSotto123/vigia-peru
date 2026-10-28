#!/usr/bin/env python3
"""Migración 189 (redes y conflictos) en un entorno, con sus refrescos en orden.

Corre desacoplado (Start-Process): el familiar declarado de un funcionario que es socio del ganador y los postores
vinculados que se turnan para ganar, y después lo que lee esos cruces (el mismo orden que refrescarCasosCruce del
Worker): dedup, casos_cruce y los antecedentes por entidad; con --empresas, empresa_resumen y el mapa de poder.
  python -u backend/scripts/aplicar_189.py prod --empresas
"""
import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

SQL = (ROOT / "backend/db/migrations/189_redes.sql").read_text(encoding="utf-8")
PASOS = ["refrescar_cruce_pariente_funcionario", "refrescar_cruce_turno_postores", "dedup_cruces_proveedor",
         "refrescar_casos_cruce_base", "refrescar_entidad_antecedentes"]
EMPRESAS = ["refrescar_empresas", "refrescar_poder"]


def paso(env: str, fn: str) -> None:
    for intento in range(1, 4):
        try:
            with conexion(env) as c:
                cur = c.cursor()
                cur.execute("SET statement_timeout = 0")
                t0 = time.time()
                cur.execute(f"SELECT {fn}()")
                n = cur.fetchone()[0]
                c.commit()
                print(f"{env}: {fn} → {n} ({time.time() - t0:.0f} s)", flush=True)
                return
        except Exception as e:  # noqa: BLE001 — el túnel o la conexión: se repite el paso
            print(f"{env}: {fn} falló (intento {intento}): {str(e).strip()[:200]}", flush=True)
            time.sleep(30)
    raise SystemExit(f"{env}: {fn} no se pudo")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--sin-sql", action="store_true")
    ap.add_argument("--empresas", action="store_true")
    a = ap.parse_args()
    if not a.sin_sql:
        with conexion(a.entorno) as c:
            cur = c.cursor()
            cur.execute("SET statement_timeout = 0")
            cur.execute(SQL)
            c.commit()
        print(f"{a.entorno}: migración 189 aplicada", flush=True)
    for fn in PASOS + (EMPRESAS if a.empresas else []):
        paso(a.entorno, fn)
    with conexion(a.entorno) as c:
        cur = c.cursor()
        cur.execute("""SELECT tipo, severidad, count(*), count(DISTINCT ruc_empresa) FROM cruces_proveedor
                        WHERE tipo IN ('pariente_funcionario', 'turno_postores') GROUP BY 1, 2 ORDER BY 1, 2""")
        print(f"{a.entorno}: cruces nuevos {cur.fetchall()}", flush=True)


if __name__ == "__main__":
    main()
