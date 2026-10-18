"""Herramienta de agente: lo que pagaron OTRAS entidades por el mismo bien, con precio unitario.

Fuente: `conosce_adjudicaciones` (OECE · CONOSCE, ~550 000 ítems adjudicados desde 2018, cargados por el Worker
vigia-scrapers): descripción del ítem, cantidad, unidad y monto adjudicado → precio unitario = monto / cantidad.
Es la referencia más directa para bienes específicos (un tornillo de cierta medida, un repuesto, un insumo médico)
que no venden las tiendas ni el mercado mayorista, y para los bienes de ficha técnica (subasta inversa).

El texto trae ruido ("madera tornillo" es una especie de madera; lotes de 1 unidad que agrupan muchas cosas): la
herramienta devuelve las filas y el MODELO elige las comparables; el resumen en código es solo orientativo.
"""
from __future__ import annotations

import re
import statistics
import unicodedata

MAX_FILAS = 40


def _palabras(texto: str) -> list[str]:
    t = "".join(c for c in unicodedata.normalize("NFD", texto or "") if not unicodedata.combining(c)).lower()
    t = re.sub(r"[^a-z0-9ñ ]+", " ", t)
    vacias = {"de", "del", "la", "el", "los", "las", "para", "con", "y", "o", "en", "x", "por", "un", "una", "kg", "und"}
    return [p for p in t.split() if len(p) > 1 and p not in vacias][:6]


def consultar_compras_estado(producto: str, hasta: str = "", anios: int = 3, departamento: str = "",
                             solo_subasta_inversa: bool = False, tool_context=None) -> dict:
    """Busca compras públicas peruanas ya adjudicadas de un bien (OECE/CONOSCE, desde 2018) y devuelve su precio
    unitario (monto adjudicado / cantidad), con fecha, tipo de proceso, departamento y entidad. Úsalo para bienes
    específicos (tornillos, repuestos, insumos) o con ficha técnica. Todas las palabras de `producto` deben estar en
    la descripción; prueba variantes si no hay resultados. Descarta las filas que no son el mismo bien.

    Args:
        producto: palabras clave del bien (p. ej. "tornillo autorroscante 8 x 1").
        hasta: fecha AAAA-MM-DD; se buscan compras de los `anios` previos (por defecto, hasta hoy).
        anios: años hacia atrás (1 a 8).
        departamento: opcional, para preferir compras de la misma región.
        solo_subasta_inversa: solo procesos de subasta inversa (bienes estandarizados con ficha técnica).
    """
    from tools._core import _pg
    palabras = _palabras(producto)
    if not palabras:
        return {"error": "producto vacío", "compras": []}
    anios = max(1, min(int(anios or 3), 8))
    conds = ["unaccent(lower(descripcion_item)) LIKE %s" for _ in palabras]
    params: list = [f"%{p}%" for p in palabras]
    fin = hasta if re.match(r"^\d{4}-\d{2}-\d{2}$", hasta or "") else None
    conds.append("COALESCE(fecha_buenapro, fecha_convocatoria) <= COALESCE(%s::date, CURRENT_DATE)")
    params.append(fin)
    conds.append("COALESCE(fecha_buenapro, fecha_convocatoria) > COALESCE(%s::date, CURRENT_DATE) - make_interval(years => %s)")
    params += [fin, anios]
    if solo_subasta_inversa:
        conds.append("tipo_proceso ILIKE 'Subasta Inversa%%'")
    orden = "ORDER BY (upper(departamento_item) = upper(%s)) DESC, COALESCE(fecha_buenapro, fecha_convocatoria) DESC" if departamento \
        else "ORDER BY COALESCE(fecha_buenapro, fecha_convocatoria) DESC"
    sql = f"""SELECT COALESCE(fecha_buenapro, fecha_convocatoria)::date, tipo_proceso, departamento_item, entidad,
                     descripcion_item, cantidad, unidad_medida, monto_adjudicado, moneda, nomenclatura, proveedor
                FROM conosce_adjudicaciones
               WHERE {' AND '.join(conds)} AND cantidad > 0 AND monto_adjudicado > 0
               {orden} LIMIT {MAX_FILAS}"""
    if departamento:
        params.append(departamento)
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        filas = cur.fetchall()
    except Exception as e:  # noqa: BLE001
        return {"error": f"consulta: {str(e)[:200]}", "compras": []}
    finally:
        conn.close()
    compras = []
    for f, tipo, dpto, ent, desc, cant, um, monto, mon, nomen, prov in filas:
        cant, monto = float(cant), float(monto)
        compras.append({
            "fecha": f.isoformat() if f else None, "tipo_proceso": tipo, "departamento": dpto, "entidad": ent,
            "descripcion": (desc or "")[:220], "cantidad": cant, "unidad": um, "moneda": mon,
            "precio_unitario": round(monto / cant, 4), "monto_adjudicado": monto, "proceso": nomen, "proveedor": prov,
            "posible_lote": cant <= 1,      # cantidad 1 suele ser un lote: el "precio unitario" no es de una pieza
        })
    por_unidad: dict[str, list[float]] = {}
    for c in compras:
        if not c["posible_lote"] and (c["moneda"] or "PEN").upper().startswith(("PEN", "SOL", "S/")):
            por_unidad.setdefault((c["unidad"] or "?").lower(), []).append(c["precio_unitario"])
    resumen = {u: {"n": len(v), "mediana": round(statistics.median(v), 4)} for u, v in por_unidad.items()}
    return {"consulta": " ".join(palabras), "hasta": fin or "hoy", "anios": anios, "compras": compras,
            "resumen_orientativo": resumen,
            "fuente": "OECE · CONOSCE, ítems adjudicados (https://conosce.osce.gob.pe/buscador/)",
            "nota": "Filtra tú: solo el mismo bien y presentación. La mediana del resumen mezcla todo lo que coincidió."}
