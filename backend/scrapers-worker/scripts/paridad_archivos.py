"""Paridad con archivos REALES de la PNDA (solo local, no se sube): aplica los parsers de Python a los
archivos de una carpeta y guarda lo que dan en .paridad/archivos.json. Después
`node scripts/paridad_archivos.ts <carpeta>` compara con el port.

  python backend/scrapers-worker/scripts/paridad_archivos.py <carpeta con visitas_*.xlsx, jne_*.xls, sancionados_*.csv>
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(RAIZ))

from backend.scrapers._core.ubigeo import ZonaIndex  # noqa: E402
from backend.scrapers.jne_infogob.pipeline import normalize_rows, parse_xls  # noqa: E402
from backend.scrapers.pnda_sancionados.pipeline import normalize_csv  # noqa: E402
from backend.scrapers.pnda_visitas.pipeline import parse_xlsx  # noqa: E402


def a_json(v):
    if isinstance(v, (dt.date, dt.datetime, dt.time)):
        return v.isoformat()
    raise TypeError(type(v))


def main(carpeta: str) -> None:
    d = Path(carpeta)
    with open(RAIZ / "backend" / "db" / "seed" / "zonas.csv", encoding="utf-8") as f:
        ix = ZonaIndex.from_rows((r["ubigeo"], r["nivel"], r["nombre"], r["padre_ubigeo"] or None) for r in csv.DictReader(f))
    out = {}
    for p in sorted(d.iterdir()):
        if p.name.startswith("visitas_") and p.suffix == ".xlsx":
            rows, bad = parse_xlsx(p)
            out[p.name] = {"filas": rows, "descartadas": bad}
        elif p.name.startswith("jne_") and p.suffix == ".xls":
            out[p.name] = normalize_rows(parse_xls(p, "vigentes" in p.name), ix, "https://www.datosabiertos.gob.pe/dataset/x")
        elif p.name.startswith("sancionados_") and p.suffix == ".csv":
            out[p.name] = normalize_csv(p)
        else:
            continue
        print(f"  {p.name}")
    destino = Path(__file__).resolve().parents[1] / ".paridad" / "archivos.json"
    destino.parent.mkdir(exist_ok=True)
    destino.write_text(json.dumps(out, ensure_ascii=False, default=a_json), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1])
