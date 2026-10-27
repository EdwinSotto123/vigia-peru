#!/usr/bin/env python3
"""Las DJI marcadas «parser_fallo» que en realidad no declaran familiares: «7 Sí [ ] No [X]» en todas sus declaraciones.

procesar_dji.py marca parser_fallo cuando el PDF tiene texto y el lector de la sección 7 no saca a nadie (para
mandarlo a un modelo después). Revisado el 2026-10-27 en una muestra: en esos PDF el declarante marcó «No» en la
sección 7. No es una falla: quedan como parse_estado = 'sin_familiares', y la marca de la 7 va a dji_secciones.
Los que sí marcaron «Sí» y no salió nadie siguen como parser_fallo (esos sí son del lector).

  python -u backend/scripts/reclasificar_sin_familiares.py --entorno prod --pdfs dataset/declaracion_jurada/pdfs_ci
"""
from __future__ import annotations

import argparse
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infrastructure" / "aws"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from tunel_rds import conexion                       # noqa: E402
from parse_dji_intereses import intereses_pdf        # noqa: E402
from psycopg2.extras import execute_values           # noqa: E402


def marcas_7(pdf: str) -> list[str | None] | None:
    try:
        return [d["marcas"].get(7) for d in intereses_pdf(pdf)["declaraciones"]]
    except Exception:  # noqa: BLE001
        return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entorno", choices=["dev", "prod"], required=True)
    ap.add_argument("--pdfs", required=True)
    ap.add_argument("--procesos", type=int, default=3)
    a = ap.parse_args()
    locales = {p.name: p for p in Path(a.pdfs).rglob("*.pdf")}
    with conexion(a.entorno) as c:
        cur = c.cursor()
        cur.execute("SELECT ruc, apellidos, pdf_r2 FROM dji_descargas WHERE parse_estado = 'parser_fallo' AND pdf_r2 IS NOT NULL")
        filas = [(ruc, ape, locales.get(Path(r2).name)) for ruc, ape, r2 in cur.fetchall()]
        filas = [f for f in filas if f[2]]
        print(f"{len(filas)} parser_fallo con su PDF en la PC", flush=True)
        with ProcessPoolExecutor(a.procesos) as pool:
            marcas = list(pool.map(marcas_7, [str(f[2]) for f in filas], chunksize=8))
        sin = [(ruc, ape) for (ruc, ape, _), m in zip(filas, marcas) if m and all(x == "no" for x in m)]
        con_si = sum(1 for m in marcas if m and any(x == "si" for x in m))
        if sin:
            execute_values(cur, """UPDATE dji_descargas d SET parse_estado = 'sin_familiares', actualizado = now()
                                     FROM (VALUES %s) AS v(ruc, apellidos)
                                    WHERE d.ruc = v.ruc AND d.apellidos = v.apellidos AND d.parse_estado = 'parser_fallo'""", sin)
        c.commit()
        print(f"✓ {len(sin)} pasan a sin_familiares; {con_si} marcaron «Sí» en la 7 y siguen como parser_fallo; "
              f"{sum(1 for m in marcas if not m)} sin leer", flush=True)


if __name__ == "__main__":
    main()
