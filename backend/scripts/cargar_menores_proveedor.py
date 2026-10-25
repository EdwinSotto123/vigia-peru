"""Carga la identidad SUNAT de los proveedores de contratos menores a `seace_proveedor_sunat` (migración 132),
desde el CSV de la consulta múltiple SUNAT (API Perú) que arma el usuario fuera del repo.

  python backend/scripts/cargar_menores_proveedor.py --entorno dev --csv "C:\\Users\\usuario\\ruc-fichas\\scraper_contratos_menores\\data_rucs\\proveedores_ganadores_con_sunat.csv"
  python backend/scripts/cargar_menores_proveedor.py --entorno prod   # usa el CSV por defecto

El CSV es ;-separado y utf-8-sig. Campos sunat_*; «-» y «» → NULL. Requiere psycopg2 y el túnel (tunel_rds.py).
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
CSV_DEF = r"C:\Users\usuario\ruc-fichas\scraper_contratos_menores\data_rucs\proveedores_ganadores_con_sunat.csv"

COLS = ["ruc", "razon_social", "tipo_persona", "tipo_contribuyente", "estado", "condicion", "fecha_inscripcion",
        "fecha_inicio_actividades", "departamento", "provincia", "distrito", "direccion", "actividad_ciiu",
        "nombre_comercial", "nro_trabajadores"]

SQL = f"""
INSERT INTO seace_proveedor_sunat ({", ".join(COLS)}) VALUES %s
ON CONFLICT (ruc) DO UPDATE SET {", ".join(f"{c}=EXCLUDED.{c}" for c in COLS if c != "ruc")}, capturado=now()
"""


def limpio(v: str | None) -> str | None:
    if v is None:
        return None
    t = v.strip()
    return None if t in ("", "-") else t


def fecha(v: str | None) -> str | None:
    t = limpio(v)
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", t) if t else None
    return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}" if m else None


def entero(v: str | None) -> int | None:
    t = limpio(v)
    try:
        return int(float(t)) if t else None
    except ValueError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Carga identidad SUNAT de proveedores de menores.")
    ap.add_argument("--entorno", choices=["dev", "prod"], required=True)
    ap.add_argument("--csv", default=CSV_DEF)
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    filas = []
    with open(a.csv, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f, delimiter=";"):
            ruc = limpio(r.get("ruc"))
            if not ruc:
                continue
            tipo = "juridica" if ruc.startswith("20") else "natural" if ruc.startswith("10") else "otro"
            filas.append((
                ruc,
                limpio(r.get("sunat_razon_social")) or limpio(r.get("razon_social")),
                tipo,
                limpio(r.get("sunat_tipo_contribuyente")),
                limpio(r.get("sunat_estado")),
                limpio(r.get("sunat_condicion")),
                fecha(r.get("sunat_fecha_inscripcion")),
                fecha(r.get("sunat_fecha_inicio_actividades")),
                limpio(r.get("sunat_departamento")) or limpio(r.get("departamento_sunat")),
                limpio(r.get("sunat_provincia")) or limpio(r.get("provincia_sunat")),
                limpio(r.get("sunat_distrito")) or limpio(r.get("distrito_sunat")),
                limpio(r.get("sunat_direccion")) or limpio(r.get("domicilio_sunat")),
                limpio(r.get("sunat_actividad_principal")) or limpio(r.get("actividad_ciiu_sunat")),
                limpio(r.get("sunat_nombre_comercial")),
                entero(r.get("nro_trabajadores_sunat")),
            ))
    print(f"filas del CSV: {len(filas)}")

    sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
    from tunel_rds import BASES, conexion
    from psycopg2.extras import execute_values
    with conexion(a.entorno) as con:
        with con, con.cursor() as cur:
            execute_values(cur, SQL, filas, page_size=1000)
            cur.execute("SELECT count(*), count(*) FILTER (WHERE estado<>'ACTIVO'), count(*) FILTER (WHERE condicion<>'HABIDO') FROM seace_proveedor_sunat")
            n, noact, nohab = cur.fetchone()
    print(f"✓ {BASES[a.entorno]}: {n} proveedores · {noact} no-activos · {nohab} no-habidos/no-hallados")
    return 0


if __name__ == "__main__":
    sys.exit(main())
