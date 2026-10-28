#!/usr/bin/env python3
"""Migración 188 (visitas 2.0 y la ola tras un cambio de gestión) en un entorno, con sus refrescos en orden.

Corre desacoplado (Start-Process): rehace la visita previa con quién recibió, las visitas de familiares de funcionarios y
las olas; y después lo que lee esos cruces (el mismo orden que refrescarCasosCruce del Worker): dedup, casos_cruce, los
antecedentes por entidad y, con --empresas, empresa_resumen (empresa_visita incluida) y el mapa de poder.
  python -u backend/scripts/aplicar_188.py prod --empresas
  python -u backend/scripts/aplicar_188.py prod --sin-sql --empresas      # sólo los refrescos (tras cargar visitas)
"""
import argparse
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

SQL = (ROOT / "backend/db/migrations/188_visitas_y_olas.sql").read_text(encoding="utf-8")
PASOS = [
    "refrescar_cruce_visita_previa",
    "refrescar_visita_pariente",
    "refrescar_ola_gestion",
    "dedup_cruces_proveedor",
    "refrescar_casos_cruce_base",
    "refrescar_entidad_antecedentes",
]
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
    ap.add_argument("--sin-sql", action="store_true", help="sólo los refrescos")
    ap.add_argument("--empresas", action="store_true", help="también empresa_resumen y el mapa de poder (minutos)")
    a = ap.parse_args()
    if not a.sin_sql:
        with conexion(a.entorno) as c:
            cur = c.cursor()
            cur.execute("SET statement_timeout = 0")
            cur.execute(SQL)
            c.commit()
        print(f"{a.entorno}: migración 188 aplicada", flush=True)
    for fn in PASOS + (EMPRESAS if a.empresas else []):
        paso(a.entorno, fn)
    with conexion(a.entorno) as c:
        cur = c.cursor()
        cur.execute("""SELECT severidad, (detalle->>'decisor')::boolean, count(*) FROM cruces_proveedor
                        WHERE tipo = 'visita_previa' GROUP BY 1, 2 ORDER BY 1, 2""")
        print(f"{a.entorno}: visita previa por severidad y decisor {cur.fetchall()}", flush=True)
        cur.execute("SELECT count(*), count(DISTINCT entidad_ruc), count(*) FILTER (WHERE proveedor) FROM entidad_visita_pariente")
        print(f"{a.entorno}: visitas de familiares (visitas, entidades, que además le venden) {cur.fetchone()}", flush=True)
        cur.execute("SELECT severidad, count(*), count(DISTINCT entidad_ruc) FROM entidad_ola_gestion GROUP BY 1")
        print(f"{a.entorno}: olas tras un cambio de gestión {cur.fetchall()}", flush=True)


if __name__ == "__main__":
    main()
