#!/usr/bin/env python3
"""Cruza `dji_vinculos` (parientes declarados) contra los locadores RUC-10 del Estado → indicios de nepotismo.

- Cruce fuerte ("grave"): el pariente es locador de la MISMA entidad del declarante (persona_orden_anual).
- Contexto: el pariente es locador de CUALQUIER entidad.
Es indicio para revisión humana. La identidad del pariente NUNCA se publica (solo el hecho agregado).

  python backend/scripts/cruce_dji.py --entorno prod
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entorno", choices=["dev", "prod"], default="prod")
    a = ap.parse_args()
    with conexion(a.entorno) as c:
        cur = c.cursor()
        cur.execute("SELECT count(*), count(DISTINCT entidad_ruc) FROM dji_vinculos")
        print("dji_vinculos:", cur.fetchone())

        # NEPOTISMO FUERTE: pariente = locador de la MISMA entidad
        cur.execute("""
          SELECT v.entidad_ruc, v.grado, v.parentesco, v.pariente_doc,
                 min(v.pariente_norm) AS pariente, sum(p.ordenes)::int AS ordenes, sum(p.monto)::float AS monto,
                 min(coalesce(pe.entidad, p.entidad)) AS entidad, min(pe.autoridad) AS autoridad
          FROM dji_vinculos v
          JOIN persona_orden_anual p ON substr(p.ruc,3,8) = v.pariente_doc AND p.entidad_ruc = v.entidad_ruc
          LEFT JOIN poder_entidad pe ON pe.entidad_ruc = v.entidad_ruc
          GROUP BY v.entidad_ruc, v.grado, v.parentesco, v.pariente_doc
          ORDER BY monto DESC NULLS LAST""")
        hits = cur.fetchall()
        print(f"\n★★★ NEPOTISMO (pariente declarado que es LOCADOR DE SU MISMA ENTIDAD): {len(hits)} ★★★")
        for er, grado, par, doc, pariente, n, monto, ent, aut in hits[:40]:
            print(f"  [{er}] {grado:<8} {str(par)[:22]:<22} {n:>3}ord S/{float(monto or 0):>11,.0f}  {str(ent)[:34]}  (autoridad: {aut})")

        # CONTEXTO: pariente locador en cualquier entidad
        cur.execute("""
          SELECT count(DISTINCT v.pariente_doc)
          FROM dji_vinculos v JOIN persona_orden_anual p ON substr(p.ruc,3,8) = v.pariente_doc""")
        print(f"\nparientes que son locadores del Estado (cualquier entidad): {cur.fetchone()[0]:,}")


if __name__ == "__main__":
    main()
