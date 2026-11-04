#!/usr/bin/env python3
"""Publica lo leído sin esperar al refresco diario: rehace las banderas de los documentos (refrescar_cruce_acta, 246-247),
los casos cruzados que las suman y los antecedentes de cada entidad, cada uno en su transacción.

  python -X utf8 backend/lector/publicar.py prod

Va directo a la base por el túnel (sin el corte de la conexión del Worker). La cadena diaria (oece_ocds) hace lo mismo
cada mañana.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

PASOS = ["refrescar_cruce_acta", "dedup_cruces_proveedor", "refrescar_casos_cruce_base", "refrescar_entidad_antecedentes"]


def main() -> None:
    entorno = sys.argv[1] if len(sys.argv) > 1 else "prod"
    for f in PASOS:
        for intento in range(1, 4):
            try:
                with conexion(entorno) as c:
                    cur = c.cursor()
                    cur.execute("SET statement_timeout = 0")
                    cur.execute("SELECT to_regprocedure(%s) IS NOT NULL", (f"{f}()",))
                    if not cur.fetchone()[0]:
                        print(f"{entorno}: {f}() no existe: se salta", flush=True)
                        break
                    t0 = time.time()
                    cur.execute(f"SELECT {f}()")
                    r = cur.fetchone()[0]
                    c.commit()
                print(f"{entorno}: {f} → {r} ({time.time() - t0:.0f} s)", flush=True)
                break
            except Exception as e:  # noqa: BLE001
                print(f"{entorno}: {f} falló (intento {intento}): {str(e)[:200]}", flush=True)
                time.sleep(30)
    print("FIN", flush=True)


if __name__ == "__main__":
    main()
