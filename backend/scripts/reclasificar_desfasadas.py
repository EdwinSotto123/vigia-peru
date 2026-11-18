"""Reclasifica los procesos cuya clasificación guardada (tipo, etapa, modalidad, procesable) no es la que sale de su propio
payload, cuando el payload es un release recortado del OCDS.

Por qué (2026-11-18): el upsert de oece_ocds.ts guardaba el payload sólo si el release era más nuevo, pero pisaba la
clasificación siempre. El relleno de historia del 2026-10-19 pasó los releases fuera de orden y dejó la clasificación del
último release PROCESADO: un proceso desierto en su primera convocatoria y contratado en la tercera quedaba «desierta» y
con la modalidad de la primera. Medido: 1,9 % de los procesos. Con evidencia de CONOSCE (estado de los ítems), el payload
recortado acertaba en 246 de 246 casos.

Los records completos (payload con `parties`) NO se tocan: ahí el record quedó viejo y la clasificación la pusieron
releases más nuevos (CONOSCE le daba la razón a lo guardado en 37 de 38). Tampoco la etapa «nula», que puede venir de la
lista local de nulos.

  python -X utf8 backend/scripts/reclasificar_desfasadas.py prod                # sólo cuenta
  python -X utf8 backend/scripts/reclasificar_desfasadas.py prod --aplicar      # corrige (y guarda el antes para deshacer)
  ... --desde 2024 --hasta 2025 --antes ~/antes_2024.jsonl                       # un tramo (por OCID), para ir en paralelo

Después: refrescar los derivados de contratos (contratos_agregado, casos_cruce_dia…) por la cola de refrescos.
"""
from __future__ import annotations

import argparse
import collections
import json
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
sys.path.insert(0, str(RAIZ))
from tunel_rds import conexion  # noqa: E402

from backend.core.clasificacion import _UPDATE_SQL, _UPDATE_TEMPLATE, _fila, clasificar  # noqa: E402

CAMPOS = ("tipo_contratacion", "etapa", "modalidad", "procesable")

SQL_LOTE = """SELECT ocid, entidad_ruc, ocds_payload, tipo_contratacion, etapa, modalidad, procesable
                FROM convocatorias
               WHERE ocid > %s AND (%s::text IS NULL OR ocid <= %s) AND ocid NOT LIKE 'ocds-vigia-%%'
                 AND NOT (ocds_payload ? 'parties')
               ORDER BY ocid LIMIT %s"""
# Sin tope por omisión: con la intercalación de la base, '~' NO ordena después de los dígitos (el tramo final quedaba vacío).


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["prod", "dev"])
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--lote", type=int, default=4000)
    ap.add_argument("--desde", default="", help="OCID desde (excluido): para correr tramos en paralelo, p. ej. 2024")
    ap.add_argument("--hasta", default=None, help="OCID hasta (incluido), p. ej. 2025; sin él, hasta el final")
    ap.add_argument("--antes", default=str(Path.home() / "reclasificar_desfasadas_antes.jsonl"),
                    help="dónde guardar la clasificación anterior de cada fila cambiada (para deshacer)")
    a = ap.parse_args()

    from psycopg2.extras import execute_values

    vistos = 0
    cambios: collections.Counter = collections.Counter()
    transiciones: collections.Counter = collections.Counter()
    ultimo = a.desde
    t0 = time.time()
    salida = open(a.antes, "a", encoding="utf-8") if a.aplicar else None
    with conexion(a.entorno) as cn:
        cur = cn.cursor()
        cur.execute("SET statement_timeout = '5min'")
        while True:
            cur.execute(SQL_LOTE, (ultimo, a.hasta, a.hasta, a.lote))
            filas = cur.fetchall()
            if not filas:
                break
            ultimo = filas[-1][0]
            vistos += len(filas)
            nuevas = []
            for ocid, ruc, payload, tipo, etapa, modalidad, procesable in filas:
                if etapa == "nula":
                    continue
                c = clasificar(payload or {}, entidad_ruc_hint=ruc)
                if c.etapa == "nula":
                    continue
                antes = {"tipo_contratacion": tipo, "etapa": etapa, "modalidad": modalidad, "procesable": procesable}
                despues = {"tipo_contratacion": c.tipo, "etapa": c.etapa, "modalidad": c.modalidad, "procesable": c.procesable}
                distintos = [k for k in CAMPOS if antes[k] != despues[k]]
                if not distintos:
                    continue
                for k in distintos:
                    cambios[k] += 1
                if "etapa" in distintos:
                    transiciones[(etapa, c.etapa)] += 1
                nuevas.append(_fila(ocid, c))
                if salida:
                    salida.write(json.dumps({"ocid": ocid, "antes": antes, "despues": despues}, ensure_ascii=False) + "\n")
            if a.aplicar and nuevas:
                execute_values(cur, _UPDATE_SQL + " AND NOT (c.ocds_payload ? 'parties')", nuevas,
                               template=_UPDATE_TEMPLATE, page_size=len(nuevas))
                cn.commit()
            else:
                cn.rollback()
            print(f"  {vistos:7d} vistos · {dict(cambios)} · {time.time() - t0:.0f} s", flush=True)
    if salida:
        salida.close()
    print("vistos:", vistos, "cambios por campo:", dict(cambios))
    print("etapa (guardada → la del payload):")
    for (x, y), n in transiciones.most_common(20):
        print(f"  {n:7d}  {x} → {y}")
    if a.aplicar:
        print("antes guardado en", a.antes)


if __name__ == "__main__":
    main()
