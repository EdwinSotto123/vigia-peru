#!/usr/bin/env python3
"""
Aplica los .sql en orden contra Postgres (Cloud SQL o local).

Conexión vía variables PGHOST / PGPORT / PGUSER / PGDATABASE / PGPASSWORD /
PGSSLMODE (defaults: 127.0.0.1 / 5432 / postgres / vigia / prefer). Si no hay
PGPASSWORD, lee `.cloudsql-password` en la raíz del repo.

Uso:
  python backend/db/apply_all.py             # corre todas las migraciones
  python backend/db/apply_all.py --check     # solo verifica conexión
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

import psycopg2

ROOT = Path(__file__).resolve().parent.parent.parent  # raíz del repo
SQL_DIR = ROOT / "backend" / "db" / "migrations"
PW_FILE = ROOT / ".cloudsql-password"

PG_HOST = os.getenv("PGHOST", "127.0.0.1")
PG_PORT = int(os.getenv("PGPORT", "5432"))
PG_USER = os.getenv("PGUSER", "postgres")
PG_DB = os.getenv("PGDATABASE", "vigia")
PG_SSLMODE = os.getenv("PGSSLMODE", "prefer")

ORDER = [
    "01_extensions.sql",
    "02_core.sql",
    "03_contrataciones.sql",
    "04_alertas_red.sql",
    "05_mef_cache.sql",
    "06_documentos_opiniones.sql",
    "07_alertas_extras.sql",
    "08_penalidades.sql",
    "09_financiamiento.sql",
    "10_admin_config.sql",
    "11_convocatorias_ubigeo.sql",
    "12_procesamientos.sql",
    "13_clasificacion.sql",
    "14_lotes.sql",
    "15_retencion_pedidos.sql",
    "16_cobertura.sql",
    "17_documentos_texto.sql",
    "18_verificacion.sql",
    "19_procesamiento_activo.sql",
    "20_fases.sql",
    "21_montos.sql",
]


def read_password() -> str:
    env = os.getenv("PGPASSWORD")
    if env:
        return env
    if not PW_FILE.exists():
        raise SystemExit(f"✗ Falta PGPASSWORD y no existe {PW_FILE}.")
    text = PW_FILE.read_text(encoding="utf-8").strip()
    m = re.search(r"password:\s*(\S+)", text, flags=re.IGNORECASE)
    if not m:
        raise SystemExit(f"✗ No pude parsear el password de {PW_FILE}")
    return m.group(1)


def connect(pw: str):
    return psycopg2.connect(
        host=PG_HOST, port=PG_PORT,
        user=PG_USER, password=pw,
        dbname=PG_DB, sslmode=PG_SSLMODE,
        connect_timeout=15,
    )


def apply_file(conn, path: Path) -> None:
    sql = path.read_text(encoding="utf-8")
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()


def seed_zonas(conn) -> int:
    """Carga backend/db/seed/zonas.csv (INEI: 25 dptos, 196 provs, 1 892 distritos) si la tabla está vacía."""
    csv_path = ROOT / "backend" / "db" / "seed" / "zonas.csv"
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM zonas")
        if cur.fetchone()[0] > 0 or not csv_path.exists():
            return 0
        with csv_path.open(encoding="utf-8") as f:
            cur.copy_expert("COPY zonas (ubigeo, nivel, nombre, padre_ubigeo, lat, lon) FROM STDIN WITH (FORMAT csv, HEADER true, NULL '')", f)
        n = cur.rowcount
        cur.execute("SELECT refresh_financiamiento()")
    conn.commit()
    return n


def list_tables(conn) -> list[str]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT tablename FROM pg_tables "
            "WHERE schemaname='public' ORDER BY tablename"
        )
        return [r[0] for r in cur.fetchall()]


def list_extensions(conn) -> list[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT extname FROM pg_extension ORDER BY extname")
        return [r[0] for r in cur.fetchall()]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="sólo verifica conexión y sale")
    args = ap.parse_args()

    pw = read_password()
    print(f"→ conectando a {PG_HOST}/{PG_DB} como {PG_USER}…", flush=True)
    try:
        conn = connect(pw)
    except Exception as e:
        print(f"✗ conexión falló: {e}", file=sys.stderr)
        return 1
    print("✓ conectado", flush=True)

    if args.check:
        with conn.cursor() as cur:
            cur.execute("SELECT version()")
            print(f"  · {cur.fetchone()[0][:80]}")
        return 0

    for fname in ORDER:
        path = SQL_DIR / fname
        if not path.exists():
            print(f"⚠ {fname} no existe, salteo")
            continue
        print(f"→ aplicando {fname}…", flush=True)
        try:
            apply_file(conn, path)
            print(f"  ✓ ok", flush=True)
        except Exception as e:
            print(f"  ✗ {e}", flush=True)
            conn.rollback()
            return 1

    n = seed_zonas(conn)
    if n:
        print(f"→ zonas: {n} filas cargadas (INEI)")

    print("\n→ extensiones instaladas:")
    for ext in list_extensions(conn):
        print(f"  · {ext}")

    print("\n→ tablas creadas:")
    for tbl in list_tables(conn):
        print(f"  · {tbl}")

    print("\n✓ schema aplicado completo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
