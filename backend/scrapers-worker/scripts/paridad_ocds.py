"""Paridad con datos REALES (solo local, no se sube): baja releases de la API OCDS (desde una IP peruana
responde directo), aplica normalize_release() de Python y guarda entrada + salida en .paridad/ (gitignored).
Después `node scripts/paridad_ocds.ts` compara con el port.

  python backend/scrapers-worker/scripts/paridad_ocds.py 2026-10-06 2026-10-12
"""

from __future__ import annotations

import csv
import json
import sys
import time
from pathlib import Path

import requests

RAIZ = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(RAIZ))

from backend.scrapers._core.ubigeo import ZonaIndex  # noqa: E402
from backend.scrapers.oece_ocds.pipeline import normalize_release  # noqa: E402

DIR = Path(__file__).resolve().parents[1] / ".paridad"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"


def main(desde: str, hasta: str) -> None:
    import datetime as dt

    DIR.mkdir(exist_ok=True)
    with open(RAIZ / "backend" / "db" / "seed" / "zonas.csv", encoding="utf-8") as f:
        ix = ZonaIndex.from_rows((r["ubigeo"], r["nivel"], r["nombre"], r["padre_ubigeo"] or None) for r in csv.DictReader(f))
    d0, d1 = dt.date.fromisoformat(desde), dt.date.fromisoformat(hasta)
    releases, filas = [], []
    s = requests.Session()
    s.headers["User-Agent"] = UA
    t0 = time.time()
    while d0 <= d1:
        url = "https://contratacionesabiertas.oece.gob.pe/api/v1/releasesAfter"
        params = {"size": 100, "startDate": d0.isoformat(), "endDate": d0.isoformat()}
        n = 0
        while url:
            r = s.get(url, params=params, timeout=90)
            params = None
            r.raise_for_status()
            datos = r.json()
            rels = datos.get("releases") or []
            if not rels:
                break
            for rel in rels:
                releases.append(rel)
                filas.append(normalize_release(rel, ix))
            n += len(rels)
            url = (datos.get("links") or {}).get("next")
        print(f"  {d0} · {n} releases · {time.time() - t0:.0f}s")
        d0 += dt.timedelta(days=1)
    (DIR / "releases.json").write_text(json.dumps(releases, ensure_ascii=False), encoding="utf-8")
    (DIR / "esperado.json").write_text(json.dumps(filas, ensure_ascii=False), encoding="utf-8")
    print(f"✓ {len(releases)} releases → .paridad/ ({sum(1 for f in filas if f)} filas)")


if __name__ == "__main__":
    main(*sys.argv[1:3])
