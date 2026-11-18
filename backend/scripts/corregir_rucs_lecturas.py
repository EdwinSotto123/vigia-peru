"""Corrige los RUC ya guardados que no pasan el dígito verificador en lo que leyeron los modelos (documento_lectura y
pieza_lectura con modelo), con la misma regla que los lectores aplican desde el 2026-11-18 (backend/lector/rucs.py):
el único RUC conocido del proceso a una o dos cifras, o null. Lo leído queda en `_rucs_corregidos` / `_rucs_invalidos`.

  python -X utf8 backend/scripts/corregir_rucs_lecturas.py prod             # sólo cuenta
  python -X utf8 backend/scripts/corregir_rucs_lecturas.py prod --aplicar

Después, para que lo vean las banderas y los hechos: refrescar_cruce_acta() y refrescar_hecho_documento().
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
sys.path.insert(0, str(RAIZ / "backend"))
from tunel_rds import conexion  # noqa: E402

from lector import rucs  # noqa: E402

TABLAS = {
    "documento_lectura": ("""SELECT ctid::text, ocid, salida FROM documento_lectura WHERE estado IN ('ok', 'parcial') AND salida::text ~ '\\d{11}'""",
                          "UPDATE documento_lectura SET salida = %s::jsonb WHERE ctid = %s::tid"),
    "pieza_lectura": ("""SELECT l.ctid::text, p.ocid, l.salida FROM pieza_lectura l JOIN documento_pieza p ON p.id = l.pieza_id
                          WHERE l.modelo <> 'plantilla' AND l.estado IN ('ok', 'parcial') AND l.salida::text ~ '\\d{11}'""",
                      "UPDATE pieza_lectura SET salida = %s::jsonb WHERE ctid = %s::tid"),
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["prod", "dev"])
    ap.add_argument("--aplicar", action="store_true")
    a = ap.parse_args()
    with conexion(a.entorno) as cn:
        cur = cn.cursor()
        cur.execute("SET statement_timeout = '10min'")
        for tabla, (leer, escribir) in TABLAS.items():
            cur.execute(leer)
            filas = cur.fetchall()
            # Sólo las que traen algún RUC inválido: los conocidos se buscan para esos procesos nada más.
            con_malos = []
            for ctid, ocid, salida in filas:
                _, _, n = rucs.corregir(json.loads(json.dumps(salida)), set())  # sobre una copia: sólo cuenta
                if n:
                    con_malos.append((ctid, ocid, salida))
            conocidos = rucs.conocidos(cur, [o for _, o, _ in con_malos])
            corregidos = anulados = 0
            cambios = []
            for ctid, ocid, salida in con_malos:
                salida, c, n = rucs.corregir(salida, conocidos.get(ocid, set()))
                corregidos += c
                anulados += n
                cambios.append((json.dumps(salida, ensure_ascii=False), ctid))
            print(f"{tabla}: {len(filas)} lecturas con RUC, {len(con_malos)} con alguno inválido → corregidos {corregidos}, "
                  f"en null {anulados}", flush=True)
            if a.aplicar and cambios:
                cur.executemany(escribir, cambios)
                cn.commit()
                print(f"  {len(cambios)} lecturas actualizadas", flush=True)
            else:
                cn.rollback()


if __name__ == "__main__":
    main()
