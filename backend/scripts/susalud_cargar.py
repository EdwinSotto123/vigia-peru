"""Carga de SUSALUD (Gobserva Salud, migración 432) desde esta PC: abre el túnel a RDS y corre el MISMO código del Worker
(backend/scrapers-worker/scripts/susalud_local.ts) con Node. Para el relleno inicial y para reprocesar a mano; la carga de
todas las semanas la hace el Worker vigia-scrapers (fuentes `susalud` y `susalud_detalle`).

  python backend/scripts/susalud_cargar.py prod renipress <csv>
  python backend/scripts/susalud_cargar.py prod sanciones <xlsx> <url>
  python backend/scripts/susalud_cargar.py prod denuncias <csv> <año>
  python backend/scripts/susalud_cargar.py prod recursos <csv>
  python backend/scripts/susalud_cargar.py prod cirugias <csv>
  python backend/scripts/susalud_cargar.py prod detalle 2000 3     # 2 000 IPRESS con 3 hilos (sólo desde el Perú)
  python backend/scripts/susalud_cargar.py prod refrescar

Varios pasos en una sola apertura del túnel: separarlos con «--», p. ej. `prod recursos a.csv -- cirugias b.csv`.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
import tunel_rds as T  # noqa: E402

TRABAJO = RAIZ / "backend" / "scrapers-worker"


def main() -> None:
    if len(sys.argv) < 3 or sys.argv[1] not in T.BASES:
        print(__doc__)
        sys.exit(2)
    entorno = sys.argv[1]
    pasos: list[list[str]] = [[]]
    for a in sys.argv[2:]:
        if a == "--":
            pasos.append([])
        else:
            pasos[-1].append(a)
    base = T.BASES[entorno]
    clave = T._aws("ssm", "get-parameter", "--name", T.CLAVES[base], "--with-decryption", "--query", "Parameter.Value")
    with T.tunel(base) as (host, puerto):
        env = dict(os.environ, PG_URL=f"postgresql://postgres:{quote(clave, safe='')}@{host}:{puerto}/vigia?sslmode=no-verify",
                   NODE_TLS_REJECT_UNAUTHORIZED="0")
        for paso in filter(None, pasos):
            args = [str(Path(x).resolve()) if Path(x).exists() else x for x in paso]
            print(f"→ {' '.join(paso)}", flush=True)
            r = subprocess.run(["node", "scripts/susalud_local.ts", *args], cwd=TRABAJO, env=env)
            if r.returncode:
                sys.exit(r.returncode)


if __name__ == "__main__":
    main()
