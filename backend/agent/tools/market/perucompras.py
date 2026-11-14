"""Candidatos de precio de los Catálogos Electrónicos de Perú Compras (tablas `perucompras_ficha` y
`perucompras_precio_ref`, migraciones 237 y 281).

Cada producto del catálogo (ficha-producto: descripción, marca y número de parte) trae la mediana de lo que pagaron por
él, en un año, 5 entidades o más. Es la referencia mejor identificada de la base para bienes comunes (útiles, tóner,
computadoras, llantas, limpieza). El precio de catálogo viene SIN IGV y un contrato se pacta CON IGV: aquí se le suma.

Salen como candidatos del juez de catálogos (el mismo que mira tiendas y compras de CONOSCE): él decide si es el mismo
bien y cuántas unidades del ítem trae. Sin tabla, sin permiso o sin coincidencias, devuelve [] y el mercado sigue."""
from __future__ import annotations

import os
import re

IGV = float(os.getenv("PERUCOMPRAS_IGV", "1.18"))
FUENTE_URL = "https://www.catalogos.perucompras.gob.pe/"
TIENDA = "Perú Compras (catálogos electrónicos)"


def _anio(hasta: str | None) -> int | None:
    m = re.match(r"^(\d{4})-\d{2}-\d{2}", hasta or "")
    return int(m.group(1)) if m else None


def _buscar(palabras: list[str], anio: int | None, limite: int) -> list[dict]:
    from tools._core import _pg
    conds = " AND ".join("f.descripcion_norm LIKE %s" for _ in palabras)
    sql = f"""SELECT f.ficha, f.descripcion, f.marca, f.nro_parte, f.catalogo, r.anio, r.lineas, r.entidades, r.p25, r.mediana, r.p75
                FROM perucompras_ficha f
                JOIN LATERAL (SELECT r.* FROM perucompras_precio_ref r
                               WHERE r.ficha = f.ficha AND r.anio <= COALESCE(%s, extract(year FROM CURRENT_DATE)::int)
                                 AND r.anio >= COALESCE(%s, extract(year FROM CURRENT_DATE)::int) - 2 AND r.mediana > 0
                               ORDER BY r.anio DESC LIMIT 1) r ON TRUE
               WHERE {conds}
               ORDER BY r.entidades DESC, r.lineas DESC LIMIT {int(limite)}"""
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute(sql, [anio, anio] + [f"%{p}%" for p in palabras])
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        conn.close()


def candidatos_perucompras(it: dict, hasta: str | None = None, maximo: int = 8) -> list[dict]:
    """Fichas del catálogo cuya descripción trae las palabras clave del ítem, en el formato de candidatos de catálogo."""
    from .catalogos import termino_busqueda
    from .compras_estado import _palabras
    desc = it.get("descripcion_corta") or ""
    filas: list[dict] = []
    for n in (4, 3, 2):       # de más a menos preciso: «toner negro hp 85a» → «toner negro hp» → «toner negro»
        palabras = _palabras(termino_busqueda(desc, max_palabras=n))
        if len(palabras) < 2:
            break
        filas = _buscar(palabras, _anio(hasta), maximo)
        if filas:
            break
    out = []
    for f in filas:
        med, p75 = float(f["mediana"]) * IGV, float(f["p75"] or f["mediana"]) * IGV
        marca = (f.get("marca") or "").strip()
        out.append({
            "producto": (f"{(f['descripcion'] or '')[:170]}" + (f" · parte {f['nro_parte']}" if f.get("nro_parte") else "")
                         + f" · catálogo de Perú Compras: mediana de {int(f['lineas'])} órdenes de {int(f['entidades'])} entidades en "
                           f"{int(f['anio'])}, con IGV")[:300],
            "marca": marca or None, "precio": round(med, 4), "unidad_medida": None, "multiplicador": None,
            "tienda": TIENDA, "url": FUENTE_URL, "origen": "perucompras",
            # Una mediana de muchas entidades vale más que un precio de tienda: se cuenta por las entidades que la sostienen,
            # y el tope de lo «normal» es su cuartil 3, no la mediana.
            "respaldo": int(f["entidades"]), "tope_referencia": round(p75, 4), "ficha": f["ficha"],
        })
    return out
