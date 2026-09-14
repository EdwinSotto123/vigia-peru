#!/usr/bin/env python3
"""
fetch_peru_geo.py
─────────────────
Descarga la geometría real del Perú a nivel **departamental (25)** y
**provincial (197)** y la guarda como GeoJSON listo para que el frontend
la consuma con d3-geo.

FUENTE PRIMARIA: `juaneladio/peru-geojson`
  https://github.com/juaneladio/peru-geojson
  Polígonos provenientes del INEI (IDEP - SEDAPAL), la misma cartografía
  oficial que el paquete R `perumapas` de calderonsamuel usa internamente.
  Diferencia: este repo ya los expone como GeoJSON simplificado, así que
  podemos consumirlos directo sin pasar por `.rda` ni R.

FALLBACK: geoBoundaries ADM1 (sólo departamentos).

Uso:
    python backend/scripts/fetch_peru_geo.py

Requisitos: stdlib de Python 3.9+. Nada que instalar.
"""

from __future__ import annotations

import json
import sys
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

OUT_DIR = (
    Path(__file__).resolve().parent.parent.parent / "frontend" / "public"
)

JUANELADIO_BASE = "https://raw.githubusercontent.com/juaneladio/peru-geojson/master"

SOURCES = {
    "peru-departments.json": {
        "url": f"{JUANELADIO_BASE}/peru_departamental_simple.geojson",
        "name_field": "NOMBDEP",
        "code_field": "FIRST_IDDP",
        "expected": 25,
        "kind": "department",
    },
    "peru-provinces.json": {
        "url": f"{JUANELADIO_BASE}/peru_provincial_simple.geojson",
        "name_field": "NOMBPROV",
        "parent_field": "FIRST_NOMB",
        "code_field": "FIRST_IDPR",
        "expected": 197,
        "kind": "province",
    },
}

GEOBOUNDARIES_FALLBACK = (
    "https://www.geoboundaries.org/api/current/gbOpen/PER/ADM1/"
)

HEADERS = {
    "User-Agent": "vigia-peru/0.1 (+https://github.com/vigia-peru)",
    "Accept": "application/json",
}


def _open(url: str, timeout: int = 60) -> Any:
    req = urllib.request.Request(url, headers=HEADERS)
    return urllib.request.urlopen(req, timeout=timeout)


def _normalize_id(name: str) -> str:
    """'Áncash' → 'ancash' ; 'La Libertad' → 'lalibertad' ; 'San Martín' → 'sanmartin'.
    Debe coincidir con los `id` definidos en frontend/lib/peru-data.ts."""
    if not name:
        return "?"
    nfkd = unicodedata.normalize("NFD", name)
    no_accents = "".join(c for c in nfkd if not unicodedata.combining(c))
    return (
        no_accents.lower()
        .replace(" ", "")
        .replace(".", "")
        .replace("'", "")
        .replace("-", "")
    )


def _capitalize(s: str) -> str:
    """'LA LIBERTAD' → 'La Libertad' ; 'AMAZONAS' → 'Amazonas'."""
    return " ".join(w.capitalize() for w in s.lower().split())


def _fetch_json(url: str) -> dict:
    with _open(url) as r:
        return json.loads(r.read().decode())


def _normalize_department_feature(feat: dict, spec: dict) -> dict:
    p = feat.get("properties", {})
    raw = p.get(spec["name_field"]) or "?"
    name = _capitalize(raw)
    feat["properties"] = {
        "name": name,
        "id": _normalize_id(name),
        "code": p.get(spec["code_field"], ""),
    }
    return feat


def _normalize_province_feature(feat: dict, spec: dict) -> dict:
    p = feat.get("properties", {})
    prov = _capitalize(p.get(spec["name_field"]) or "?")
    dep = _capitalize(p.get(spec["parent_field"]) or "?")
    feat["properties"] = {
        "name": prov,
        "departamento": dep,
        "regionId": _normalize_id(dep),
        "id": f"{_normalize_id(dep)}-{_normalize_id(prov)}",
        "code": p.get(spec["code_field"], ""),
    }
    return feat


def _process(out_name: str, spec: dict) -> bool:
    print(f"\n[{out_name}]")
    print(f"  ↓ {spec['url']}")
    try:
        gj = _fetch_json(spec["url"])
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        print(f"  ✗ Error de red: {e}")
        return False
    except json.JSONDecodeError as e:
        print(f"  ✗ Respuesta no es JSON válido: {e}")
        return False

    feats = gj.get("features", [])
    n = len(feats)
    if n < spec["expected"] // 2:
        print(f"  ⚠ Sólo {n} features (esperaba ~{spec['expected']}). Abortando este archivo.")
        return False

    print(f"  ↳ {n} features recibidos")

    normalizer = (
        _normalize_province_feature if spec["kind"] == "province"
        else _normalize_department_feature
    )
    gj["features"] = [normalizer(f, spec) for f in feats]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / out_name
    out_path.write_text(json.dumps(gj, ensure_ascii=False), encoding="utf-8")
    size_kb = out_path.stat().st_size / 1024

    # Muestra los primeros IDs detectados para verificar el join
    sample_ids = [
        f["properties"].get("id", "?") for f in gj["features"][:6]
    ]
    print(f"  ✓ {out_path.name} → {size_kb:.0f} KB")
    print(f"    primeros IDs: {', '.join(sample_ids)} …")
    return True


def main() -> int:
    print(f"Output dir: {OUT_DIR}")
    print(
        "Fuente: juaneladio/peru-geojson (cartografía INEI — la misma que perumapas)\n"
    )

    ok = sum(_process(name, spec) for name, spec in SOURCES.items())
    total = len(SOURCES)
    print(f"\n{ok}/{total} archivos generados correctamente.")
    if ok < total:
        print("→ Si falla la fuente primaria, ver backend/scripts/README.md para Plan B manual.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
