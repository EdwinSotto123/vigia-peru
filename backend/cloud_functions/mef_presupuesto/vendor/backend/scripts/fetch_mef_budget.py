#!/usr/bin/env python3
"""
fetch_mef_budget.py
───────────────────
Pre-cachea el presupuesto de los 25 departamentos del Perú desde MEF —
Datos Abiertos. Guarda en `frontend/public/mef-budget.json`.

Por qué este script existe:
  El endpoint SQL de MEF NO tiene índices sobre DEPARTAMENTO_EJECUTORA_NOMBRE
  y hace full scan sobre 8M filas. Una query de un departamento grande
  (LORETO, LIMA) tarda 80-120s. No es viable consultarlo en vivo desde el
  frontend en cada click. Solución: pre-fetch + cache estático.

Uso:
  python backend/scripts/fetch_mef_budget.py          # corre todo (5 workers paralelos)
  python backend/scripts/fetch_mef_budget.py --quick  # solo año actual, sin breakdowns

El script guarda progreso parcial después de cada departamento, así que se
puede cancelar con Ctrl+C y reanudar (los ya hechos se omiten).
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

MEF_BASE = "https://api.datosabiertos.mef.gob.pe/DatosAbiertos/v1"
RESOURCE = "510bae6d-3d37-4fb2-af35-a40ce01715f4"
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent  # raíz del repo
OUT = PROJECT_ROOT / "frontend" / "public" / "mef-budget.json"
CSV_DIR = PROJECT_ROOT / "dataset" / "mef"

DEPARTMENTS: list[str] = [
    "AMAZONAS", "ANCASH", "APURIMAC", "AREQUIPA", "AYACUCHO",
    "CAJAMARCA", "PROVINCIA CONSTITUCIONAL DEL CALLAO", "CUSCO",
    "HUANCAVELICA", "HUANUCO", "ICA", "JUNIN", "LA LIBERTAD",
    "LAMBAYEQUE", "LIMA", "LORETO", "MADRE DE DIOS", "MOQUEGUA",
    "PASCO", "PIURA", "PUNO", "SAN MARTIN", "TACNA", "TUMBES", "UCAYALI",
]

YEARS = [2022, 2023, 2024, 2025, 2026]
CURRENT_YEAR = 2026

HEADERS = {"User-Agent": "vigia-peru-mef-cache/0.1", "Accept": "application/json"}


def _sql_year_totals(dept: str, year: int) -> str:
    d = dept.replace("'", "''")
    return (
        f'SELECT COUNT(*) AS rows, '
        f'SUM("PIA_{year}"::numeric) AS pia, '
        f'SUM("PIM_{year}"::numeric) AS pim, '
        f'SUM("DEVENGADO_{year}"::numeric) AS dev, '
        f'SUM("GIRADO_{year}"::numeric) AS gir '
        f'FROM "{RESOURCE}" '
        f"WHERE \"DEPARTAMENTO_EJECUTORA_NOMBRE\" = '{d}'"
    )


def _sql_breakdown(dept: str, field: str, year: int) -> str:
    d = dept.replace("'", "''")
    return (
        f'SELECT "{field}" AS nombre, '
        f'SUM("PIA_{year}"::numeric) AS pia, '
        f'SUM("PIM_{year}"::numeric) AS pim, '
        f'SUM("DEVENGADO_{year}"::numeric) AS dev '
        f'FROM "{RESOURCE}" '
        f"WHERE \"DEPARTAMENTO_EJECUTORA_NOMBRE\" = '{d}' "
        f'GROUP BY "{field}" ORDER BY pim DESC LIMIT 6'
    )


def _fetch_sql(sql: str, retries: int = 2, timeout: int = 240) -> list[dict]:
    url = f"{MEF_BASE}/datastore_search_sql?sql={urllib.parse.quote(sql)}"
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.loads(r.read().decode("utf-8"))
            return data.get("records", [])
        except (urllib.error.URLError, urllib.error.HTTPError) as e:
            last_err = e
            if attempt < retries:
                time.sleep(2 ** attempt)
                continue
            raise
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(2 ** attempt)
                continue
            raise
    if last_err:
        raise last_err
    return []


def _num(v) -> float:
    if v is None or v == "":
        return 0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0


def _year_query(dept: str, year: int) -> tuple[str, dict]:
    """Devuelve (tag, row) para una query de año."""
    try:
        rs = _fetch_sql(_sql_year_totals(dept, year))
        r = rs[0] if rs else {}
        return (f"year-{year}", r)
    except Exception as e:
        print(f"  [{dept}] year {year} ✗ {e}", flush=True)
        return (f"year-{year}", {})


def _breakdown_query(dept: str, field: str, year: int) -> tuple[str, list[dict]]:
    """Devuelve (key, rows) para una query de breakdown."""
    try:
        rs = _fetch_sql(_sql_breakdown(dept, field, year))
        rows = []
        for r in rs:
            nombre = r.get("nombre")
            if not nombre:
                continue
            pim = _num(r.get("pim"))
            if pim <= 0:
                continue
            dev = _num(r.get("dev"))
            rows.append({
                "nombre": nombre,
                "pim": pim,
                "devengado": dev,
                "pia": _num(r.get("pia")),
                "ejecPct": (dev / pim * 100) if pim > 0 else 0,
            })
        return (field, rows)
    except Exception as e:
        print(f"  [{dept}] breakdown {field} ✗ {e}", flush=True)
        return (field, [])


def fetch_dept(dept: str, *, quick: bool = False) -> dict:
    """Fetch completo de un depto. Lanza TODAS las queries (años + breakdowns) en
    PARALELO usando un pool interno → de ~9min serial baja a ~90s paralelo."""
    print(f"  [{dept}] starting…", flush=True)
    t0 = time.time()
    out = {
        "department": dept,
        "totalRows": 0,
        "byYear": [],
        "topSectores": [],
        "topPliegos": [],
        "topProgramas": [],
        "topGenericas": [],
    }

    breakdown_field_to_key = {
        "SECTOR_NOMBRE": "topSectores",
        "PLIEGO_NOMBRE": "topPliegos",
        "PROGRAMA_PPTO_NOMBRE": "topProgramas",
        "GENERICA_NOMBRE": "topGenericas",
    }

    # Tareas a paralelizar dentro de este depto
    tasks = []
    # Todos los años
    for y in YEARS:
        tasks.append(("year", y))
    # Breakdowns (solo si !quick)
    if not quick:
        for field in breakdown_field_to_key:
            tasks.append(("breakdown", field))

    # Pool interno: tantos workers como queries → 5-9 simultáneas a MEF
    year_rows: dict[int, dict] = {}
    with ThreadPoolExecutor(max_workers=len(tasks)) as pool:
        futures = []
        for kind, value in tasks:
            if kind == "year":
                futures.append((pool.submit(_year_query, dept, value), kind, value))
            else:
                futures.append((pool.submit(_breakdown_query, dept, value, CURRENT_YEAR), kind, value))

        for fut, kind, value in futures:
            try:
                tag, payload = fut.result()
                if kind == "year":
                    year_rows[value] = payload
                else:
                    out[breakdown_field_to_key[value]] = payload
            except Exception as e:
                print(f"  [{dept}] task {kind}:{value} ✗ {e}", flush=True)

    # Build byYear ordenado
    current = year_rows.get(CURRENT_YEAR, {})
    out["totalRows"] = int(_num(current.get("rows")))
    if out["totalRows"] == 0:
        print(f"  [{dept}] sin data (rows=0)", flush=True)
        return out

    for y in sorted(YEARS):
        r = year_rows.get(y, {})
        out["byYear"].append({
            "year": y,
            "pia": _num(r.get("pia")),
            "pim": _num(r.get("pim")),
            "certificado": 0,
            "comprometido": 0,
            "devengado": _num(r.get("dev")),
            "girado": _num(r.get("gir")),
        })

    elapsed = time.time() - t0
    breakdowns_count = sum(1 for k in breakdown_field_to_key.values() if out.get(k))
    print(
        f"  [{dept}] ✓ {elapsed:.0f}s · {out['totalRows']} rows · "
        f"{len(out['byYear'])} años · {breakdowns_count} breakdowns",
        flush=True,
    )
    return out


def _write_csvs(results: dict) -> None:
    """Genera CSVs + schema.sql paralelos al JSON, listos para importar a SQL.
    Se llama después de cada save parcial — los archivos siempre reflejan el JSON actual."""
    CSV_DIR.mkdir(parents=True, exist_ok=True)

    # 1. mef_regions.csv — una fila por depto
    with (CSV_DIR / "mef_regions.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["department", "total_rows"])
        for dept, data in sorted(results.items()):
            w.writerow([dept, data.get("totalRows", 0)])

    # 2. mef_regions_years.csv — una fila por (depto × año)
    with (CSV_DIR / "mef_regions_years.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "department", "year",
            "pia", "pim", "certificado", "comprometido", "devengado", "girado",
        ])
        for dept, data in sorted(results.items()):
            for y in data.get("byYear", []):
                w.writerow([
                    dept,
                    y.get("year"),
                    y.get("pia", 0),
                    y.get("pim", 0),
                    y.get("certificado", 0),
                    y.get("comprometido", 0),
                    y.get("devengado", 0),
                    y.get("girado", 0),
                ])

    # 3. mef_regions_breakdown.csv — una fila por (depto × tipo × nombre)
    breakdowns = [
        ("SECTOR", "topSectores"),
        ("PLIEGO", "topPliegos"),
        ("PROGRAMA", "topProgramas"),
        ("GENERICA", "topGenericas"),
    ]
    with (CSV_DIR / "mef_regions_breakdown.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["department", "tipo", "nombre", "pia", "pim", "devengado", "ejec_pct"])
        for dept, data in sorted(results.items()):
            for tipo, key in breakdowns:
                for row in data.get(key, []):
                    w.writerow([
                        dept,
                        tipo,
                        row.get("nombre", ""),
                        row.get("pia", 0),
                        row.get("pim", 0),
                        row.get("devengado", 0),
                        round(row.get("ejecPct", 0), 2),
                    ])

    # 4. mef_schema.sql — DDL listo para PostgreSQL, SQLite o DuckDB
    schema = """-- MEF — Datos Abiertos · presupuesto y ejecución 2022-2026
-- Generado por backend/scripts/fetch_mef_budget.py
-- Fuente: api.datosabiertos.mef.gob.pe (resource_id 510bae6d-3d37-4fb2-af35-a40ce01715f4)

-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mef_regions (
  department  VARCHAR(80) PRIMARY KEY,
  total_rows  BIGINT
);

CREATE TABLE IF NOT EXISTS mef_regions_years (
  department    VARCHAR(80) NOT NULL,
  year          INT         NOT NULL,
  pia           NUMERIC(20,2),
  pim           NUMERIC(20,2),
  certificado   NUMERIC(20,2),
  comprometido  NUMERIC(20,2),
  devengado     NUMERIC(20,2),
  girado        NUMERIC(20,2),
  PRIMARY KEY (department, year)
);

CREATE TABLE IF NOT EXISTS mef_regions_breakdown (
  department  VARCHAR(80)  NOT NULL,
  tipo        VARCHAR(20)  NOT NULL,        -- SECTOR | PLIEGO | PROGRAMA | GENERICA
  nombre      VARCHAR(255) NOT NULL,
  pia         NUMERIC(20,2),
  pim         NUMERIC(20,2),
  devengado   NUMERIC(20,2),
  ejec_pct    NUMERIC(6,2),
  PRIMARY KEY (department, tipo, nombre)
);

CREATE INDEX IF NOT EXISTS idx_mef_years_year ON mef_regions_years(year);
CREATE INDEX IF NOT EXISTS idx_mef_break_tipo ON mef_regions_breakdown(tipo);

-- ─── Carga en PostgreSQL ────────────────────────────────────────
-- \\COPY mef_regions             FROM 'mef_regions.csv'           DELIMITER ',' CSV HEADER;
-- \\COPY mef_regions_years       FROM 'mef_regions_years.csv'     DELIMITER ',' CSV HEADER;
-- \\COPY mef_regions_breakdown   FROM 'mef_regions_breakdown.csv' DELIMITER ',' CSV HEADER;

-- ─── Carga en SQLite ────────────────────────────────────────────
-- .mode csv
-- .import --csv --skip 1 mef_regions.csv             mef_regions
-- .import --csv --skip 1 mef_regions_years.csv       mef_regions_years
-- .import --csv --skip 1 mef_regions_breakdown.csv   mef_regions_breakdown

-- ─── Carga en DuckDB (la más simple) ────────────────────────────
-- CREATE TABLE mef_regions             AS SELECT * FROM read_csv_auto('mef_regions.csv');
-- CREATE TABLE mef_regions_years       AS SELECT * FROM read_csv_auto('mef_regions_years.csv');
-- CREATE TABLE mef_regions_breakdown   AS SELECT * FROM read_csv_auto('mef_regions_breakdown.csv');
"""
    (CSV_DIR / "mef_schema.sql").write_text(schema, encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--quick", action="store_true",
        help="Solo año actual; sin breakdowns ni históricos (~3x más rápido)",
    )
    parser.add_argument(
        "--workers", type=int, default=4,
        help="Workers paralelos (default 4)",
    )
    parser.add_argument(
        "--only", nargs="+", default=None,
        help="Limita a estos departamentos (ej: --only LIMA CUSCO)",
    )
    parser.add_argument(
        "--resume", action="store_true",
        help="Salta departamentos que ya están en el JSON",
    )
    args = parser.parse_args()

    targets = [d for d in DEPARTMENTS if not args.only or d in args.only]
    existing: dict = {}
    if OUT.exists():
        try:
            existing = json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            existing = {}

    def is_complete(entry: dict) -> bool:
        """Una entrada está completa cuando tiene los 5 años, los 4 breakdowns y rows>0."""
        if not entry or entry.get("totalRows", 0) == 0:
            return False
        if len(entry.get("byYear", [])) < 5:
            return False
        # Las 4 breakdowns deben existir (al menos como lista, aunque vacía es OK
        # si el depto realmente no tiene esa categoría)
        for k in ("topSectores", "topPliegos", "topProgramas", "topGenericas"):
            if k not in entry:
                return False
        return True

    if args.resume:
        pending = [d for d in targets if not is_complete(existing.get(d, {}))]
    else:
        pending = targets

    if not pending:
        print(f"Nada que hacer ({len(existing)}/{len(targets)} ya en cache).")
        return 0

    print(f"Fetching MEF budget para {len(pending)} departamentos…")
    print(f"Modo: {'quick' if args.quick else 'completo'} · workers: {args.workers}")
    print(f"(Las queries de MEF tardan 30-120s c/u, dependiendo del depto)\n")
    OUT.parent.mkdir(parents=True, exist_ok=True)

    results: dict = dict(existing)
    completed = 0

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(fetch_dept, d, quick=args.quick): d for d in pending}
        for f in as_completed(futures):
            dept = futures[f]
            try:
                data = f.result()
                results[dept] = data
            except Exception as e:
                print(f"  [{dept}] EXCEPTION: {e}", flush=True)
                results[dept] = {"department": dept, "totalRows": 0, "byYear": [], "topSectores": [], "topPliegos": [], "topProgramas": [], "error": str(e)}
            # Save partial — JSON (frontend) + CSVs (SQL)
            OUT.write_text(json.dumps(results, ensure_ascii=False), encoding="utf-8")
            _write_csvs(results)
            completed += 1
            print(f"  → progreso: {completed}/{len(pending)} guardado (JSON + CSVs)", flush=True)

    # Save final (asegura que CSVs reflejen estado final aunque el último worker
    # haya fallado antes del save dentro del loop)
    OUT.write_text(json.dumps(results, ensure_ascii=False), encoding="utf-8")
    _write_csvs(results)

    size_kb = OUT.stat().st_size / 1024
    print(f"\n✓ Listo")
    print(f"  JSON  → {OUT}  ({size_kb:.0f} KB)")
    print(f"  CSVs  → {CSV_DIR}/")
    print(f"  Tablas SQL en {CSV_DIR / 'mef_schema.sql'}")
    print(f"  {len(results)} deptos · cargá los CSVs con el schema.sql")
    return 0


if __name__ == "__main__":
    sys.exit(main())
