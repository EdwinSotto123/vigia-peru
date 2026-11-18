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

Tampoco se BAJA a un proceso de una etapa con adjudicación (adjudicada, contratada, en ejecución, finalizada) a una sin
ella si guarda adjudicaciones: ahí el payload es el de una convocatoria anterior (desierta) y la adjudicación vino después.
Lo enseñó la primera corrida (2026-11-18): de 4 286 que bajaban, todos tenían adjudicación guardada con fecha posterior al
payload, y donde CONOSCE decía algo, lo de antes acertaba 24 de 29 (se revirtieron con `--revertir`). En la otra
dirección (subir a contratada) acertaba 7 738 de 7 754.

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
CON_ADJUDICACION = {"adjudicada", "contratada", "en_ejecucion", "finalizada"}

SQL_LOTE = """SELECT ocid, entidad_ruc, ocds_payload, tipo_contratacion, etapa, modalidad, procesable,
                     COALESCE(jsonb_array_length(adjudicaciones), 0) > 0 AS con_adj
                FROM convocatorias
               WHERE ocid > %s AND (%s::text IS NULL OR ocid <= %s) AND ocid NOT LIKE 'ocds-vigia-%%'
                 AND NOT (ocds_payload ? 'parties')
               ORDER BY ocid LIMIT %s"""
# Sin tope por omisión: con la intercalación de la base, '~' NO ordena después de los dígitos (el tramo final quedaba vacío).


def revertir(entorno: str, archivos: list[str], aplicar: bool) -> None:
    """Devuelve la clasificación de antes a los que la primera corrida bajó de una etapa con adjudicación a una sin ella
    teniendo adjudicaciones guardadas. Reclasifica el payload con el tipo y la etapa de antes (así los agentes y
    validaciones salen de la misma matriz) y la modalidad de antes."""
    import backend.core.clasificacion as cl
    from psycopg2.extras import execute_values

    antes: dict[str, dict] = {}
    for f in archivos:
        for linea in open(f, encoding="utf-8"):
            d = json.loads(linea)
            if d["antes"]["etapa"] in CON_ADJUDICACION and d["despues"]["etapa"] not in CON_ADJUDICACION:
                antes[d["ocid"]] = d["antes"]
    print("bajaron de una etapa con adjudicación:", len(antes))
    with conexion(entorno) as cn:
        cur = cn.cursor()
        cur.execute("""SELECT ocid, entidad_ruc, ocds_payload FROM convocatorias
                        WHERE ocid = ANY(%s) AND COALESCE(jsonb_array_length(adjudicaciones), 0) > 0
                          AND NOT (ocds_payload ? 'parties')""", (list(antes),))
        filas = []
        originales = cl.derivar_tipo, cl.derivar_etapa
        try:
            for ocid, ruc, payload in cur.fetchall():
                a = antes[ocid]
                cl.derivar_tipo = lambda rel, t=a["tipo_contratacion"]: t
                cl.derivar_etapa = lambda rel, nulo=False, e=a["etapa"]: e
                c = cl.clasificar(payload or {}, entidad_ruc_hint=ruc)
                c.modalidad = a["modalidad"]
                filas.append(_fila(ocid, c))
        finally:
            cl.derivar_tipo, cl.derivar_etapa = originales
        print("con adjudicaciones guardadas (se revierten):", len(filas))
        if aplicar and filas:
            for i in range(0, len(filas), 2000):
                execute_values(cur, _UPDATE_SQL, filas[i:i + 2000], template=_UPDATE_TEMPLATE, page_size=2000)
            cn.commit()
            print("revertidos")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["prod", "dev"])
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--revertir", nargs="+", metavar="ANTES.jsonl",
                    help="devuelve la etapa de antes a los que bajaron de una etapa con adjudicación (archivos de --antes)")
    ap.add_argument("--lote", type=int, default=4000)
    ap.add_argument("--desde", default="", help="OCID desde (excluido): para correr tramos en paralelo, p. ej. 2024")
    ap.add_argument("--hasta", default=None, help="OCID hasta (incluido), p. ej. 2025; sin él, hasta el final")
    ap.add_argument("--antes", default=str(Path.home() / "reclasificar_desfasadas_antes.jsonl"),
                    help="dónde guardar la clasificación anterior de cada fila cambiada (para deshacer)")
    a = ap.parse_args()
    if a.revertir:
        revertir(a.entorno, a.revertir, a.aplicar)
        return

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
            for ocid, ruc, payload, tipo, etapa, modalidad, procesable, con_adj in filas:
                if etapa == "nula":
                    continue
                c = clasificar(payload or {}, entidad_ruc_hint=ruc)
                if c.etapa == "nula":
                    continue
                if con_adj and etapa in CON_ADJUDICACION and c.etapa not in CON_ADJUDICACION:
                    continue  # el payload es de una convocatoria anterior a la adjudicación guardada
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
