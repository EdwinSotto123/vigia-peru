#!/usr/bin/env python3
"""Aplica UN archivo de migración en una transacción, por el túnel (infrastructure/aws/tunel_rds.py).

  python -X utf8 backend/scripts/aplicar_migracion.py prod backend/db/migrations/248_cruce_acta_dos_lecturas.sql

Para DEV ya está `infrastructure/deploy/dev.sh migrar`. Éste es para PROD, que lo corre el usuario.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in ("dev", "prod"):
        sys.exit("uso: aplicar_migracion.py dev|prod <archivo.sql>")
    entorno, archivo = sys.argv[1], Path(sys.argv[2])
    if not archivo.is_absolute():
        archivo = RAIZ / archivo
    sql = archivo.read_text(encoding="utf-8")
    t0 = time.time()
    with conexion(entorno) as c:
        cur = c.cursor()
        cur.execute("SET statement_timeout = 0")
        cur.execute(sql)
        c.commit()
    print(f"{entorno}: {archivo.name} aplicada en {time.time() - t0:.1f} s")


if __name__ == "__main__":
    main()
