#!/usr/bin/env python3
"""
fetch_mef_entities.py
─────────────────────
Pre-cachea el presupuesto de las 27 entidades del mock (`lib/mock-entities.ts`)
desde MEF — Datos Abiertos. Guarda en `frontend/public/mef-entities.json`.

Por qué este script existe (separado de fetch_mef_budget.py):
  fetch_mef_budget.py usa WHERE DEPARTAMENTO_EJECUTORA_NOMBRE = 'X' (igualdad,
  rápido). Acá usamos WHERE PLIEGO_NOMBRE LIKE '%X%' que NO tiene índice y
  hace full scan sobre 8M filas → 30-90 s por entidad. Con LIKE en Python
  tenemos timeout de 4 minutos por query → mucho más permisivo que el browser.

Estrategia para entidades MUY grandes (Ministerio de Transportes, PETROPERÚ):
  - Su query LIKE puede tardar > 4 min o devolver 500 (server overload)
  - Para esos casos, splitteamos por año (5 queries pequeñas en lugar de 1
    enorme)
  - Si igual falla → guardamos un placeholder con kind="too_large" y la UI lo
    maneja

Uso:
  python backend/scripts/fetch_mef_entities.py              # todas las entidades
  python backend/scripts/fetch_mef_entities.py --only "PETROPERU"  # filtra
  python backend/scripts/fetch_mef_entities.py --workers 3  # paralelismo

El JSON resultante se lee desde `lib/mef-cache.ts` antes de pegarle a MEF.
"""

from __future__ import annotations

import argparse
import json
import re
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
OUT = PROJECT_ROOT / "frontend" / "public" / "mef-entities.json"
MOCK_TS = PROJECT_ROOT / "frontend" / "lib" / "mock-entities.ts"
YEARS = [2022, 2023, 2024, 2025, 2026]

HEADERS = {"User-Agent": "vigia-peru-mef-entities/0.1", "Accept": "application/json"}


# ─── Extraer entidades del mock TS ────────────────────────────────

def extract_entities() -> list[tuple[str, str]]:
    """Devuelve [(ruc, nombre), …] parseando el .ts del mock."""
    text = MOCK_TS.read_text(encoding="utf-8")
    rucs = re.findall(r'ruc:\s*"(\d{11})"', text)
    nombres = re.findall(r'nombre:\s*"([^"]+)"', text)
    pairs = list(zip(rucs, nombres))
    return pairs


def mef_search_keyword(nombre: str) -> str:
    """Replica la lógica de `mefSearchKeywordFor` en TS.
    Convierte "Gobierno Regional de Cusco" → "REGIONAL DEL DEPARTAMENTO DE CUSCO"
    """
    n_upper = nombre.upper()
    if "GOBIERNO REGIONAL" in n_upper or "GOB. REG" in n_upper:
        m = re.search(r"de ([A-Za-záéíóúñÁÉÍÓÚÑ ]+)$", nombre)
        if m:
            return f"REGIONAL DEL DEPARTAMENTO DE {m.group(1).strip().upper()}"
    if "MUNICIPALIDAD" in n_upper or "MUN." in n_upper:
        m = re.search(r"de ([A-Za-záéíóúñÁÉÍÓÚÑ]+)\s*$", nombre)
        if m:
            tipo = ""
            if "DISTRITAL" in n_upper or "DIST" in n_upper:
                tipo = "DISTRITAL "
            elif "PROVINCIAL" in n_upper or "PROV" in n_upper:
                tipo = "PROVINCIAL "
            return f"MUNICIPALIDAD {tipo}DE {m.group(1).strip().upper()}".replace(
                "  ", " "
            ).strip()
    return nombre.upper()


# ─── HTTP helpers ─────────────────────────────────────────────────

def _fetch_sql(sql: str, timeout: int = 240, retries: int = 1) -> list[dict]:
    url = f"{MEF_BASE}/datastore_search_sql?sql={urllib.parse.quote(sql)}"
    last_err: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = json.loads(r.read().decode("utf-8"))
            return data.get("records", [])
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(2 ** attempt + 1)
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


# ─── Queries por entidad ─────────────────────────────────────────

def _sql_year_totals(keyword: str, year: int) -> str:
    kw = keyword.replace("'", "''")
    return (
        f'SELECT COUNT(*) AS rows, '
        f'SUM("PIA_{year}"::numeric) AS pia, '
        f'SUM("PIM_{year}"::numeric) AS pim, '
        f'SUM("DEVENGADO_{year}"::numeric) AS dev, '
        f'SUM("GIRADO_{year}"::numeric) AS gir '
        f'FROM "{RESOURCE}" '
        f"WHERE \"PLIEGO_NOMBRE\" LIKE '%{kw}%'"
    )


def _sql_pliegos(keyword: str) -> str:
    kw = keyword.replace("'", "''")
    return (
        f'SELECT DISTINCT "PLIEGO_NOMBRE" AS nombre '
        f'FROM "{RESOURCE}" '
        f"WHERE \"PLIEGO_NOMBRE\" LIKE '%{kw}%' "
        f"LIMIT 10"
    )


def fetch_entity(ruc: str, nombre: str, keyword: str) -> dict:
    """Fetch presupuesto de una entidad. Para entidades grandes, splitea por año."""
    print(f"  [{ruc}] {nombre[:50]:50s} → '{keyword[:40]}'", flush=True)

    by_year = []
    total_rows = 0
    failed_years = []

    # Una query por año (más manejable que SUM de 5 años en una query enorme)
    for year in YEARS:
        try:
            t0 = time.time()
            rs = _fetch_sql(_sql_year_totals(keyword, year), timeout=180)
            elapsed = time.time() - t0
            r = rs[0] if rs else {}
            pim = _num(r.get("pim"))
            rows_count = int(_num(r.get("rows")))
            by_year.append({
                "year": year,
                "pia": _num(r.get("pia")),
                "pim": pim,
                "certificado": 0,
                "comprometido": 0,
                "devengado": _num(r.get("dev")),
                "girado": _num(r.get("gir")),
            })
            total_rows = max(total_rows, rows_count)
            print(f"    · {year}: PIM S/. {pim/1e6:.1f}M ({elapsed:.1f}s)",
                  flush=True)
        except Exception as e:
            print(f"    · {year}: ✗ {type(e).__name__}", flush=True)
            failed_years.append(year)
            by_year.append({
                "year": year,
                "pia": 0, "pim": 0,
                "certificado": 0, "comprometido": 0,
                "devengado": 0, "girado": 0,
            })

    # Si todos los años fallaron, no vale guardar
    if len(failed_years) == len(YEARS):
        return {
            "ruc": ruc,
            "nombre": nombre,
            "keyword": keyword,
            "kind": "failed",
            "totalRows": 0,
            "matchedPliegos": [],
            "byYear": [],
        }

    # Lista de pliegos matched
    try:
        rs = _fetch_sql(_sql_pliegos(keyword), timeout=60)
        pliegos = [r["nombre"] for r in rs if r.get("nombre")]
    except Exception:
        pliegos = []

    return {
        "ruc": ruc,
        "nombre": nombre,
        "keyword": keyword,
        "kind": "partial" if failed_years else "ok",
        "totalRows": total_rows,
        "matchedPliegos": pliegos[:8],
        "byYear": by_year,
    }


# ─── Main ────────────────────────────────────────────────────────

def load_existing() -> dict[str, dict]:
    if OUT.exists():
        try:
            return json.loads(OUT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"⚠ {OUT.name} corrupto, empezando de cero", flush=True)
    return {}


def save(cache: dict[str, dict]) -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="filtra entidades cuyo nombre contenga este texto")
    ap.add_argument("--workers", type=int, default=3,
                    help="entidades en paralelo (3 por defecto, max recomendado 4)")
    ap.add_argument("--resume", action="store_true",
                    help="omite las que ya están en cache (no las re-fetchea)")
    args = ap.parse_args()

    entities = extract_entities()
    if args.only:
        filt = args.only.upper()
        entities = [(r, n) for (r, n) in entities if filt in n.upper()]

    cache = load_existing()
    print(f"→ {len(entities)} entidades · cache previo: {len(cache)} entries", flush=True)
    print(f"→ output: {OUT}", flush=True)

    to_process = []
    for ruc, nombre in entities:
        if args.resume and ruc in cache and cache[ruc].get("kind") in ("ok", "partial"):
            print(f"  ✓ {ruc} {nombre[:40]} ya cacheada", flush=True)
            continue
        to_process.append((ruc, nombre, mef_search_keyword(nombre)))

    print(f"→ a procesar: {len(to_process)} entidades · {args.workers} workers paralelos", flush=True)
    t_start = time.time()

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {
            ex.submit(fetch_entity, ruc, nombre, kw): (ruc, nombre)
            for (ruc, nombre, kw) in to_process
        }
        for fut in as_completed(futs):
            ruc, nombre = futs[fut]
            try:
                result = fut.result()
                cache[ruc] = result
                save(cache)  # guardado incremental
                print(f"  ✓ {ruc} ({result['kind']}, rows {result['totalRows']})",
                      flush=True)
            except Exception as e:
                print(f"  ✗ {ruc}: {e}", flush=True)

    save(cache)
    elapsed = time.time() - t_start
    print(f"\n✓ done · {len(cache)} entidades · {elapsed/60:.1f} min", flush=True)


if __name__ == "__main__":
    sys.exit(main() or 0)
