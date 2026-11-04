"""Precio de cada ítem contra lo que pagaron otras entidades, desde la base de Vigía (sin web ni modelo).
Plan 2026-11-04, parte 1.

`precio_item` (migración 84) tiene, por ítem del proceso, su CUBSO, unidad y precio unitario adjudicado (o referencial).
`precio_referencia` tiene los percentiles 25, 50 y 75 de lo adjudicado por CUBSO, unidad y año en todo el Estado: la
misma base de las banderas de sobreprecio de Vigía. Se toma el año del proceso, o el más cercano con datos (hasta 2 años
de distancia), y sólo referencias con 5 o más precios de 3 o más entidades.
"""
from __future__ import annotations

from tools._core import *  # noqa: F401,F403

_MIN_PRECIOS = 5
_MIN_ENTIDADES = 3


def _veredicto(unit: float | None, p25, med, p75) -> str:
    if not unit or not med:
        return "sin_dato"
    if p75 and unit > 1.5 * float(p75):
        return "muy_por_encima"
    if p75 and unit > float(p75):
        return "por_encima"
    if p25 and unit < float(p25):
        return "por_debajo"
    return "en_rango"


def precios_internos_bd(ocid: str, conn=None) -> list[dict]:
    corto = str(ocid or "").split("-")[-1]
    propia = conn is None
    conn = conn or _pg()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT i.posicion, left(i.descripcion, 160), i.cubso, i.unidad, i.anio, i.cantidad::float,
                   COALESCE(i.unit_adj, i.unit_ref)::float, (i.unit_adj IS NOT NULL),
                   r.anio, r.n, r.entidades, r.p25::float, r.mediana::float, r.p75::float
              FROM precio_item i
              LEFT JOIN LATERAL (
                SELECT * FROM precio_referencia r
                 WHERE r.cubso = i.cubso AND r.unidad = i.unidad AND r.base = 'adjudicado'
                   AND r.n >= %s AND r.entidades >= %s AND abs(r.anio - i.anio) <= 2
                 ORDER BY abs(r.anio - i.anio), r.anio DESC LIMIT 1) r ON true
             WHERE i.ocid = %s
             ORDER BY i.posicion""", (_MIN_PRECIOS, _MIN_ENTIDADES, corto))
        filas = cur.fetchall()
    finally:
        if propia:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
    out = []
    for pos, desc, cubso, unidad, anio, cant, unit, es_adj, r_anio, n, ent, p25, med, p75 in filas:
        out.append({
            "item": pos, "descripcion": desc, "cubso": cubso, "unidad": unidad, "cantidad": cant,
            "precio_unitario": unit, "origen_precio": "adjudicado" if es_adj else "referencial",
            "referencia": None if med is None else {"anio": r_anio, "precios": n, "entidades": ent,
                                                    "p25": p25, "mediana": med, "p75": p75},
            "diferencia_vs_mediana_pct": round((unit / med - 1) * 100, 1) if unit and med else None,
            "veredicto": _veredicto(unit, p25, med, p75),
        })
    return out


def query_precios_internos(ocid: str, tool_context: ToolContext) -> dict:
    """Precio unitario de cada ítem del proceso contra los percentiles de lo que pagó el Estado por el mismo CUBSO y
    unidad (base de Vigía).

    Args:
        ocid: el proceso.
    """
    try:
        items = precios_internos_bd(ocid)
    except Exception as e:  # noqa: BLE001
        return {"error": f"base no disponible: {str(e)[:160]}"}
    if items:
        tool_context.state["precios_internos"] = {
            "items": items,
            "fuente": "Vigía: precio unitario del ítem (precio_item) contra los percentiles 25-50-75 de lo adjudicado por "
                      "el mismo CUBSO y unidad en el Estado (precio_referencia)",
        }
    resumen: dict[str, int] = {}
    for x in items:
        resumen[x["veredicto"]] = resumen.get(x["veredicto"], 0) + 1
    return {"items": len(items), "veredictos": resumen}


query_precios_internos_tool = FunctionTool(query_precios_internos)
