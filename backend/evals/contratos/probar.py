#!/usr/bin/env python3
"""Prueba del lector de contratos (backend/lector/contrato.py) contra el registro oficial de CONOSCE.

  python -X utf8 backend/evals/contratos/probar.py [--casos 60]

Elige contratos firmados (contractSigned) de procesos con UN solo contrato en conosce_contratos, en soles; los lee con
la misma función que la corrida masiva (lector/leer.py → leer_contrato, sin guardar nada en la base) y compara:
  monto     el monto del contrato está a 1 % o menos de monto_contratado_total
  fecha     la fecha de suscripción es la de CONOSCE
  ruc       el RUC del contratista (o de un integrante del consorcio) es ruc_contratista
Los resultados quedan en datos/ (fuera del repo: traen nombres) y el resumen en informe.md.
"""
from __future__ import annotations

import argparse
import json
import random
import statistics
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parents[2]
sys.path.insert(0, str(RAIZ / "backend"))
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
from lector import contrato as lector  # noqa: E402
from lector.base import cliente_claude, solo_digitos  # noqa: E402
from lector.leer import leer_contrato  # noqa: E402
from tunel_rds import conexion  # noqa: E402

DATOS = AQUI / "datos"

SQL = """
WITH un AS (
  SELECT codigo_convocatoria FROM conosce_contratos
   WHERE moneda IN ('Soles', 'Nuevos Soles') GROUP BY 1 HAVING count(DISTINCT codigo_contrato) = 1),
k AS (
  SELECT DISTINCT ON (c.codigo_convocatoria) c.codigo_convocatoria, c.monto_contratado_total AS monto,
         c.fecha_suscripcion::date AS fecha, c.ruc_contratista
    FROM conosce_contratos c JOIN un USING (codigo_convocatoria)
   ORDER BY c.codigo_convocatoria, c.anio DESC),
d AS (
  SELECT ocid, array_agg(id ORDER BY creado_at) AS ids, array_agg(url_gcs ORDER BY creado_at) AS urls,
         array_agg(lower(formato) ORDER BY creado_at) AS formatos
    FROM documentos_gcs WHERE tipo = 'contractSigned' AND borrado_at IS NULL AND lower(formato) IN ('pdf', 'zip')
   GROUP BY ocid)
SELECT d.ocid, d.ids, d.urls, d.formatos, k.monto, k.fecha, k.ruc_contratista,
       COALESCE((SELECT array_agg(DISTINCT m.ruc_miembro) FROM conosce_consorcios m WHERE m.ruc_consorcio = k.ruc_contratista), '{}')
  FROM d JOIN convocatorias v ON v.ocid = d.ocid JOIN k ON k.codigo_convocatoria = v.codigo
 WHERE k.monto > 30000
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--casos", type=int, default=60)
    a = ap.parse_args()
    DATOS.mkdir(exist_ok=True)
    with conexion("prod") as c:
        cur = c.cursor()
        cur.execute("SET TRANSACTION READ ONLY")
        cur.execute(SQL)
        filas = cur.fetchall()
        c.rollback()
    random.Random(20261104).shuffle(filas)
    print(f"{len(filas)} candidatos; se prueban {a.casos}", flush=True)
    claude = cliente_claude()
    res, costo = [], 0.0
    for ocid, ids, urls, formatos, monto, fecha, ruc, miembros in filas:
        if len(res) >= a.casos:
            break
        f = leer_contrato(claude, lector, ocid, list(ids), list(urls), list(formatos))
        if f["estado"] == "sin_pdf":
            continue
        costo += float(f["costo_usd"] or 0)
        s = f["salida"] or {}
        k = s.get("contratista") or {}
        rucs = {solo_digitos(k.get("ruc"))} | {solo_digitos(x) for x in k.get("integrantes_ruc") or []}
        oficiales = {solo_digitos(ruc)} | {solo_digitos(m) for m in miembros}
        n = {"ocid": ocid, "estado": f["estado"], "costo": f["costo_usd"], "paginas": f["paginas"],
             "es_contrato": s.get("es_contrato"),
             "monto": (abs(float(s["monto_contratado"]) - float(monto)) / float(monto) <= 0.01) if s.get("monto_contratado") else None,
             "fecha": (s.get("fecha_suscripcion") == fecha.isoformat()) if s.get("fecha_suscripcion") and fecha else None,
             "ruc": bool(rucs & oficiales - {""}) if rucs - {""} else None,
             "banderas": f["banderas"], "salida": s}
        res.append(n)
        print(f"  {len(res)} {ocid}: {f['estado']} monto {n['monto']} fecha {n['fecha']} ruc {n['ruc']} {f['banderas']} "
              f"USD {f['costo_usd']}", flush=True)
    (DATOS / "resultados.json").write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    ok = [r for r in res if r["estado"] == "ok"]

    def pct(clave: str) -> str:
        v = [r[clave] for r in ok if r[clave] is not None]
        return f"{100 * sum(v) / len(v):.0f} % (n={len(v)}, sin dato {len(ok) - len(v)})" if v else "—"

    banderas: dict[str, int] = {}
    for r in ok:
        for b in r["banderas"]:
            banderas[b] = banderas.get(b, 0) + 1
    informe = "\n".join([
        "# Prueba del lector de contratos (Claude Haiku 5.5, esfuerzo bajo)", "",
        f"{len(res)} contratos firmados de procesos con un solo contrato en soles; respuesta oficial de conosce_contratos.",
        f"Estados: { {e: sum(r['estado'] == e for r in res) for e in {r['estado'] for r in res}} }. "
        f"Costo USD {costo:.3f} ({costo / max(len(res), 1):.4f} por contrato); páginas (mediana) "
        f"{statistics.median([r['paginas'] or 0 for r in res]) if res else 0}.", "",
        "| Métrica | Resultado |", "|---|---|",
        f"| Reconoce el contrato | {pct('es_contrato')} |",
        f"| Monto (±1 %) | {pct('monto')} |",
        f"| Fecha de suscripción | {pct('fecha')} |",
        f"| RUC del contratista | {pct('ruc')} |", "",
        "Banderas por reglas: " + (", ".join(f"{b} {n}" for b, n in sorted(banderas.items())) or "ninguna") + ".", ""])
    (AQUI / "informe.md").write_text(informe, encoding="utf-8")
    print(informe)


if __name__ == "__main__":
    main()
