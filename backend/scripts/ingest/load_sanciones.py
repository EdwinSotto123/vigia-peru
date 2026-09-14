#!/usr/bin/env python3
"""
Carga las sanciones del dataset local a Cloud SQL.

Fuentes (en `dataset/datos_complementarios/sanciones/`):
  - sancionados.csv               · 9,355 sanciones OSCE
  - inhabilitaciones_judiciales.csv · sancionados por jueces (DNI/RUC)
  - penalidades.csv               · 13K penalidades de contratos

Encoding: latin-1. Delimiter: `|`.

Política:
  - INSERT idempotente vía `--reset` (DELETE primero) — NO usamos ON CONFLICT
    porque la f1-micro tiene problemas con UNIQUE INDEX sobre expresiones
    COALESCE() en tablas grandes.
  - Commit en lotes de 500 filas para que la transacción no quede gigante.
  - Usamos `execute_batch` (psycopg2.extras) para INSERTs masivos eficientes.

Uso:
  python backend/scripts/ingest/load_sanciones.py --reset   # recomendado
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

import psycopg2
from psycopg2.extras import execute_batch, Json

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))
from lib.pg import connect  # noqa: E402

ROOT = THIS_DIR.parent.parent
SANCIONES_DIR = ROOT / "dataset" / "datos_complementarios" / "sanciones"

OSCE_URL = "https://apps.osce.gob.pe/perfilprov-ui/inhabilitado.xhtml"
BATCH = 500


# ─── helpers ─────────────────────────────────────────────────────

def parse_date_yyyymmdd(s: str | None) -> str | None:
    if not s or not s.strip():
        return None
    s = s.strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    return None


def normalize_ruc(ruc: str | None) -> str | None:
    if not ruc:
        return None
    ruc = ruc.strip()
    if len(ruc) == 11 and ruc.isdigit() and (ruc.startswith("20") or ruc.startswith("10")):
        return ruc
    return None


def read_csv_rows(path: Path):
    with path.open(encoding="latin-1", newline="") as f:
        reader = csv.DictReader(f, delimiter="|")
        for row in reader:
            yield row


# ─── loaders ─────────────────────────────────────────────────────

def load_sancionados(conn, reset: bool) -> tuple[int, int]:
    path = SANCIONES_DIR / "sancionados.csv"

    if reset:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM persona_flags WHERE tipo = 'sancion_osce'")
        conn.commit()
        print("  · borradas persona_flags previas (sancion_osce)", flush=True)

    # Pasada 1: recolectar empresas + flags ÚNICAS (dedup en Python)
    empresas_set: dict[str, str] = {}
    flags_seen: set[tuple] = set()  # dedup key: (ruc, detalle)
    flags_data: list[tuple] = []
    for row in read_csv_rows(path):
        ruc = normalize_ruc(row.get("RUC"))
        if not ruc:
            continue
        nombre = (row.get("NOMBRE_RAZONODENOMINACIONSOCIAL") or "").strip()
        empresas_set.setdefault(ruc, nombre)
        detalle = (
            f"{row.get('DE_MOTIVO_INFRACCION', '').strip()} · "
            f"Res. {row.get('NUMERO_RESOLUCION', '').strip()}"
        )[:500]
        key = (ruc, detalle)
        if key in flags_seen:
            continue
        flags_seen.add(key)
        flags_data.append((
            ruc, "sancion_osce", "alta", detalle, OSCE_URL,
            parse_date_yyyymmdd(row.get("FECHA_INICIO")),
            "load_sanciones.py",
        ))

    # Insertar empresas en batches
    print(f"  · {len(empresas_set)} empresas únicas, {len(flags_data)} flags", flush=True)
    empresas_rows = [(ruc, nombre, Json({"fuente": "OECE sancionados"}))
                     for ruc, nombre in empresas_set.items()]
    with conn.cursor() as cur:
        execute_batch(cur, """
            INSERT INTO empresas (ruc, razon_social, metadata)
            VALUES (%s, %s, %s)
            ON CONFLICT (ruc) DO UPDATE SET
              razon_social = COALESCE(empresas.razon_social, EXCLUDED.razon_social),
              updated_at = NOW()
        """, empresas_rows, page_size=BATCH)
    conn.commit()
    print(f"  · empresas insertadas", flush=True)

    # Insertar flags en batches
    with conn.cursor() as cur:
        execute_batch(cur, """
            INSERT INTO persona_flags
              (empresa_ruc, tipo, severidad, detalle, fuente_url, fuente_fecha, agente_origen)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, flags_data, page_size=BATCH)
    conn.commit()
    print(f"  · flags insertadas", flush=True)

    return len(empresas_set), len(flags_data)


def load_inhabilitaciones(conn, reset: bool) -> tuple[int, int, int]:
    path = SANCIONES_DIR / "inhabilitaciones_judiciales.csv"
    if reset:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM persona_flags WHERE tipo = 'inhabilitacion_judicial'")
        conn.commit()

    empresas: dict[str, str] = {}
    personas: dict[str, str] = {}
    flags_emp: list[tuple] = []
    flags_per: list[tuple] = []
    seen_emp: set[tuple] = set()
    seen_per: set[tuple] = set()

    for row in read_csv_rows(path):
        ruc_dni = (row.get("RUC_DNI") or "").strip()
        nombre = (row.get("NOMBRE_RAZONODENOMINACIONSOCIAL") or "").strip()
        organo = (row.get("ORGANO_JURISDICCIONAL") or "").strip()
        fecha = parse_date_yyyymmdd(row.get("FECHA_INICIO"))

        ruc = normalize_ruc(ruc_dni)
        if ruc:
            empresas.setdefault(ruc, nombre)
            detalle = f"{organo} · Res. {(row.get('NUMERO_RESOLUCION') or '').strip()}"[:500]
            if (ruc, detalle) in seen_emp:
                continue
            seen_emp.add((ruc, detalle))
            flags_emp.append((
                ruc, "inhabilitacion_judicial", "alta", detalle,
                "https://www.gob.pe/poder-judicial", fecha, "load_sanciones.py",
            ))
        elif len(ruc_dni) == 8 and ruc_dni.isdigit():
            personas.setdefault(ruc_dni, nombre)
            detalle = organo[:500]
            if (ruc_dni, detalle) in seen_per:
                continue
            seen_per.add((ruc_dni, detalle))
            flags_per.append((
                ruc_dni, "inhabilitacion_judicial", "alta", detalle,
                "https://www.gob.pe/poder-judicial", fecha, "load_sanciones.py",
            ))

    with conn.cursor() as cur:
        if empresas:
            execute_batch(cur, """
                INSERT INTO empresas (ruc, razon_social)
                VALUES (%s, %s)
                ON CONFLICT (ruc) DO NOTHING
            """, list(empresas.items()), page_size=BATCH)
        if personas:
            execute_batch(cur, """
                INSERT INTO personas (dni, nombre) VALUES (%s, %s)
                ON CONFLICT (dni) DO NOTHING
            """, list(personas.items()), page_size=BATCH)
        if flags_emp:
            execute_batch(cur, """
                INSERT INTO persona_flags
                  (empresa_ruc, tipo, severidad, detalle, fuente_url, fuente_fecha, agente_origen)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, flags_emp, page_size=BATCH)
        if flags_per:
            execute_batch(cur, """
                INSERT INTO persona_flags
                  (persona_dni, tipo, severidad, detalle, fuente_url, fuente_fecha, agente_origen)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, flags_per, page_size=BATCH)
    conn.commit()
    return len(empresas), len(personas), len(flags_emp) + len(flags_per)


def load_penalidades(conn, reset: bool) -> int:
    path = SANCIONES_DIR / "penalidades.csv"
    if reset:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM penalidades")
        conn.commit()
        print("  · borradas penalidades previas", flush=True)

    empresas: dict[str, str] = {}
    rows_data: list[tuple] = []

    for row in read_csv_rows(path):
        ruc = normalize_ruc(row.get("RUC CONTRATISTA"))
        if ruc:
            empresas.setdefault(ruc, (row.get("OBJETO CONTRATO") or "")[:80])

        fecha_str = (row.get("FECHA PENALIDAD") or "").strip()
        fecha = None
        if fecha_str and "/" in fecha_str:
            parts = fecha_str.split("/")
            if len(parts) == 3:
                d, m, y = parts
                if len(y) == 2:
                    y = "20" + y
                try:
                    fecha = f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
                except ValueError:
                    pass

        monto_str = (row.get("MONTO") or "0").strip().replace(",", ".")
        try:
            monto = float(monto_str) if monto_str else None
        except ValueError:
            monto = None

        rows_data.append((
            (row.get("ID CONTRATO") or "").strip() or None,
            ruc,
            (row.get("TIPO PENALIDAD") or "").strip(),
            (row.get("OBJETO CONTRATO") or "").strip()[:500],
            (row.get("ENTIDAD CONTRATANTE") or "").strip()[:500],
            fecha,
            (row.get("DESCRIPCION/MOTIVO") or "").strip()[:500],
            monto,
        ))

    print(f"  · {len(empresas)} empresas únicas, {len(rows_data)} penalidades a insertar", flush=True)
    with conn.cursor() as cur:
        if empresas:
            execute_batch(cur, """
                INSERT INTO empresas (ruc, razon_social)
                VALUES (%s, %s)
                ON CONFLICT (ruc) DO NOTHING
            """, list(empresas.items()), page_size=BATCH)
        conn.commit()

        execute_batch(cur, """
            INSERT INTO penalidades
              (contrato_id, empresa_ruc, tipo_penalidad, objeto_contrato,
               entidad_contratante, fecha, descripcion, monto)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, rows_data, page_size=BATCH)
        conn.commit()
    return len(rows_data)


# ─── main ────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="DELETE previous data first")
    args = ap.parse_args()

    conn = connect()
    try:
        print("→ cargando sancionados OSCE…", flush=True)
        ne, nf = load_sancionados(conn, args.reset)
        print(f"  ✓ {ne} empresas · {nf} flags", flush=True)

        print("→ cargando inhabilitaciones judiciales…", flush=True)
        ne, np, nf = load_inhabilitaciones(conn, args.reset)
        print(f"  ✓ {ne} empresas · {np} personas · {nf} flags", flush=True)

        print("→ cargando penalidades…", flush=True)
        n = load_penalidades(conn, args.reset)
        print(f"  ✓ {n} penalidades", flush=True)

        # Resumen
        print("\n→ resumen en BD:", flush=True)
        with conn.cursor() as cur:
            for tbl in ["empresas", "personas", "persona_flags", "penalidades"]:
                cur.execute(f"SELECT COUNT(*) FROM {tbl}")
                print(f"  · {tbl}: {cur.fetchone()[0]:,}", flush=True)
            cur.execute("""
              SELECT tipo, COUNT(*) FROM persona_flags GROUP BY tipo ORDER BY 2 DESC
            """)
            print("  · flags por tipo:")
            for tipo, n in cur.fetchall():
                print(f"    – {tipo}: {n}")
    finally:
        conn.close()
    print("\n✓ done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
