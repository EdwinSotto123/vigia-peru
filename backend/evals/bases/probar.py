#!/usr/bin/env python3
"""Prueba del lector de bases (backend/lector/bases.py): no hay registro oficial con qué
compararlo, así que se lee cada pliego DOS veces y se mide cuánto coinciden las dos lecturas.

  python -X utf8 backend/evals/consultas/probar.py [--casos 40]

Resultados en datos/ (fuera del repo) y resumen en informe.md.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[2]
sys.path.insert(0, str(RAIZ / "backend"))
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
from lector import bases as lector  # noqa: E402
from lector.base import cliente_claude  # noqa: E402
from lector.leer import leer_contrato  # noqa: E402
from tunel_rds import conexion  # noqa: E402

DATOS = AQUI / "datos"
SQL = """SELECT ocid, array_agg(id ORDER BY creado_at), array_agg(url_gcs ORDER BY creado_at), array_agg(lower(formato) ORDER BY creado_at)
           FROM documentos_gcs WHERE tipo = 'biddingDocuments' AND borrado_at IS NULL AND lower(formato) IN ('pdf', 'zip')
          GROUP BY ocid"""


def resumen(s: dict) -> dict:
    e = s.get("experiencia_postor") or {}
    return {"monto_minimo": e.get("monto_minimo"), "personal": len(s.get("personal_clave") or []),
            "factores": len(s.get("factores_evaluacion") or []), "marcas": len(s.get("marcas") or []),
            "banderas": lector.banderas_de(s)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--casos", type=int, default=40)
    a = ap.parse_args()
    DATOS.mkdir(exist_ok=True)
    with conexion("prod") as c:
        cur = c.cursor()
        cur.execute("SET TRANSACTION READ ONLY")
        cur.execute(SQL)
        filas = cur.fetchall()
        c.rollback()
    random.Random(20261105).shuffle(filas)
    filas = filas[: a.casos]
    claude = cliente_claude()

    def dos(f):
        ocid, ids, urls, formatos = f
        return ocid, [leer_contrato(claude, lector, ocid, list(ids), list(urls), list(formatos)) for _ in range(2)]

    with ThreadPoolExecutor(max_workers=6) as pool:
        pares = list(pool.map(dos, filas))
    (DATOS / "resultados.json").write_text(json.dumps(pares, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    ok = [(o, a1, b1) for o, (a1, b1) in pares if a1["estado"] == "ok" and b1["estado"] == "ok"]
    costo = sum(float(x["costo_usd"] or 0) for _, par in pares for x in par)
    r = [(resumen(a1["salida"]), resumen(b1["salida"])) for _, a1, b1 in ok]

    def igual(clave: str) -> str:
        return f"{100 * sum(x[clave] == y[clave] for x, y in r) / max(len(r), 1):.0f} %"

    def cerca(clave: str) -> str:
        return f"{100 * sum(abs((x[clave] or 0) - (y[clave] or 0)) <= max(1, 0.1 * max(x[clave] or 0, y[clave] or 0)) for x, y in r) / max(len(r), 1):.0f} %"

    lineas = ["# Prueba del lector de bases (Claude Haiku 5.5, esfuerzo bajo)", "",
              f"{len(pares)} bases leídas dos veces; {len(ok)} con las dos lecturas ok. Costo USD {costo:.3f} "
              f"({costo / max(2 * len(pares), 1):.4f} por lectura).", "",
              "| Entre las dos lecturas | Igual | A ±10 % (mín. 1) |", "|---|---|---|"]
    for clave, nombre in [("monto_minimo", "Experiencia exigida (monto)"), ("personal", "Personal clave (cargos)"),
                          ("factores", "Factores de evaluación"), ("marcas", "Marcas nombradas")]:
        lineas.append(f"| {nombre} | {igual(clave)} | {cerca(clave)} |")
    for b in lector.BANDERAS:
        en_a = {o for (o, _, _), (x, _) in zip(ok, r) if b in x["banderas"]}
        en_b = {o for (o, _, _), (_, y) in zip(ok, r) if b in y["banderas"]}
        lineas.append(f"\n- {b}: {len(en_a)} y {len(en_b)} actas, {len(en_a & en_b)} en ambas"
                      f" (coinciden {len(en_a & en_b) / max(len(en_a | en_b), 1):.2f})")
    (AQUI / "informe.md").write_text("\n".join(lineas) + "\n", encoding="utf-8")
    print("\n".join(lineas))


if __name__ == "__main__":
    main()
