"""Refresca la lista del comité (comite_integrante, migraciones 408 y 411) y las dos señales que la leen.

  python -X utf8 backend/scripts/refrescar_comite.py prod

Lo corre la tarea de Windows VigiaComite2 después de cada segunda lectura del comité (C:\\Users\\usuario\\vigia-comite2.bat),
para que los nombres nuevos lleguen a comite_mismo_ganador (396) y comite_socio_proveedor (407) sin esperar a
tarea:refrescar-piezas del CI, que hace lo mismo junto con más cosas.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

FUNCIONES = ("refrescar_comite_integrante", "refrescar_cruce_comite_mismo_ganador",
             "refrescar_cruce_comite_socio_proveedor", "refrescar_cruce_comite_competencia_restringida",
             "refrescar_senal_tasa_base")


def main() -> None:
    entorno = sys.argv[1] if len(sys.argv) > 1 else "prod"
    with conexion(entorno) as cn:
        cur = cn.cursor()
        cur.execute("SET statement_timeout = 0")
        for f in FUNCIONES:
            t = time.time()
            cur.execute(f"SELECT {f}()")
            n = cur.fetchone()[0]
            cn.commit()
            print(f"{f}(): {n} ({round(time.time() - t)} s)", flush=True)
        cur.execute("SELECT fuente, count(*), count(DISTINCT ocid) FROM comite_integrante GROUP BY 1 ORDER BY 1")
        print("comite_integrante:", cur.fetchall(), flush=True)


if __name__ == "__main__":
    main()
