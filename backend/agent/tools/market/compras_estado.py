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
FUENTE_URL = "https://conosce.osce.gob.pe/buscador/"


def _palabras(texto: str) -> list[str]:
    t = "".join(c for c in unicodedata.normalize("NFD", texto or "") if not unicodedata.combining(c)).lower()
    t = re.sub(r"[^a-z0-9ñ ]+", " ", t)
    vacias = {"de", "del", "la", "el", "los", "las", "para", "con", "y", "o", "en", "x", "por", "un", "una", "kg", "und"}
    return [p for p in t.split() if len(p) > 1 and p not in vacias][:6]


def _buscar(palabras: list[str], hasta: str = "", anios: int = 3, departamento: str = "",
            solo_subasta_inversa: bool = False) -> list[dict]:
    """Filas de conosce_adjudicaciones con todas las `palabras`, de los `anios` previos a `hasta` (la región primero)."""
    from tools._core import _pg
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
    orden = "ORDER BY (upper(departamento_item) = upper(%s)) DESC, COALESCE(fecha_buenapro, fecha_convocatoria) DESC" if departamento         else "ORDER BY COALESCE(fecha_buenapro, fecha_convocatoria) DESC"
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
    return compras


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
    palabras = _palabras(producto)
    if not palabras:
        return {"error": "producto vacío", "compras": []}
    fin = hasta if re.match(r"^\d{4}-\d{2}-\d{2}$", hasta or "") else None
    anios = max(1, min(int(anios or 3), 8))
    try:
        compras = _buscar(palabras, hasta, anios, departamento, solo_subasta_inversa)
    except Exception as e:  # noqa: BLE001
        return {"error": f"consulta: {str(e)[:200]}", "compras": []}
    por_unidad: dict[str, list[float]] = {}
    for c in compras:
        if not c["posible_lote"] and (c["moneda"] or "PEN").upper().startswith(("PEN", "SOL", "S/")):
            por_unidad.setdefault((c["unidad"] or "?").lower(), []).append(c["precio_unitario"])
    resumen = {u: {"n": len(v), "mediana": round(statistics.median(v), 4)} for u, v in por_unidad.items()}
    return {"consulta": " ".join(palabras), "hasta": fin or "hoy", "anios": anios, "compras": compras,
            "resumen_orientativo": resumen,
            "fuente": f"OECE · CONOSCE, ítems adjudicados ({FUENTE_URL})",
            "nota": "Filtra tú: solo el mismo bien y presentación. La mediana del resumen mezcla todo lo que coincidió."}


# ─── nivel del mercado del pipeline: candidatos para el juez de catálogos ───────
_UNIDADES = {"unidad": "unidad", "und": "unidad", "unid": "unidad", "u": "unidad", "pieza": "unidad", "bolsa": "unidad",
             "caja": "unidad", "frasco": "unidad", "rollo": "unidad", "paquete": "unidad", "par": "unidad",
             "kilogramo": "kilogramo", "kg": "kilogramo", "kilo": "kilogramo", "galon": "galon", "gal": "galon",
             "litro": "litro", "lt": "litro", "metro": "metro", "metro lineal": "metro",
             "m2": "m2", "metro cuadrado": "m2", "m3": "m3", "metro cubico": "m3", "millar": "millar",
             "tonelada": "tonelada", "t": "tonelada", "ciento": "centena", "centena": "centena", "docena": "docena"}


def unidad_canonica(u: str | None) -> str | None:
    t = "".join(c for c in unicodedata.normalize("NFD", u or "") if not unicodedata.combining(c)).lower().strip(" .")
    return _UNIDADES.get(t) or _UNIDADES.get(t.split()[0] if t else "")


def candidatos_compras_estado(it: dict, hasta: str | None = None, departamento: str = "", maximo: int = 8) -> list[dict]:
    """Compras de otras entidades del mismo bien, en el formato de candidatos de catálogo (producto, precio, tienda,
    url) más `origen: conosce`. Solo filas en soles, en la MISMA unidad que el ítem y que no son lotes (cantidad > 1):
    el juez de catálogos decide luego cuáles son el mismo bien."""
    from .catalogos import termino_busqueda
    unidad = unidad_canonica(it.get("unidad"))
    if not unidad:
        return []
    desc = it.get("descripcion_corta") or ""
    compras: list[dict] = []
    for n in (3, 2):      # tres palabras; si no hay nada, dos ("tornillo autorroscante 8x1" → "tornillo autorroscante")
        palabras = _palabras(termino_busqueda(desc, max_palabras=n))
        if not palabras:
            return []
        compras = _buscar(palabras, hasta or "", 3, departamento)
        if compras:
            break
    out = []
    for c in compras:
        if c["posible_lote"] or unidad_canonica(c["unidad"]) != unidad:
            continue
        if not (c["moneda"] or "PEN").upper().startswith(("PEN", "SOL", "S/")):
            continue
        out.append({
            "producto": (f"{c['descripcion'][:160]} · compra de {c['entidad'] or 'entidad pública'} ({c['departamento'] or 's/d'}, "
                         f"{c['fecha']}, {c['cantidad']:g} {c['unidad']}, {c['proceso'] or ''})")[:300],
            "marca": None, "precio": c["precio_unitario"], "unidad_medida": c["unidad"], "multiplicador": None,
            "tienda": "Compras del Estado (OECE)", "url": FUENTE_URL, "origen": "conosce",
        })
        if len(out) >= maximo:
            break
    return out
