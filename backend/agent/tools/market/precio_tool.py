"""Herramienta de precios de referencia para agentes: consulta vigia-precios (catálogos de tiendas con caché + historial
propio) y devuelve productos con precio, tienda y URL, para que el modelo ITERE: probar términos, descartar lo que no
es el bien y quedarse con el precio por unidad del ítem.

Unidades: en los catálogos VTEX de las tiendas, los productos que se venden por peso traen `unidad_medida: "kg"` y su
`precio` es el precio por kilo (lo que la web muestra como "S/ x kg"); `multiplicador` es el paso de compra o el peso
aproximado de una pieza, no un divisor del precio. Medido 2026-10-17: "Zapallo Macre x kg" S/ 3,59 (x1,5) en Plaza Vea,
S/ 3,99 (x0,9) en Metro y Wong.
"""
from __future__ import annotations

import os


def consultar_precios_referencia(producto: str, tool_context=None) -> dict:
    """Busca el precio vigente de un producto en catálogos de supermercados y tiendas del Perú (Plaza Vea, Metro, Wong,
    Promart, Oechsle) y lo ya visto antes. Devuelve productos con precio, tienda y URL; si se vende por peso
    (`unidad_medida` "kg") el `precio` es por kilo. Usa términos cortos ("limon x kg", "papaya", "choclo x und");
    si salen productos de otro rubro, reintenta con otro término.

    Args:
        producto: término de búsqueda corto.
    """
    from tools.market.catalogos import _worker
    try:
        d = _worker("/tiendas/buscar", {"q": producto, "n": int(os.getenv("CATALOGO_POR_TIENDA", "4"))})
    except Exception as e:  # noqa: BLE001
        return {"error": f"vigia-precios: {type(e).__name__}: {str(e)[:160]}", "productos": []}
    if d is None:
        return {"error": "vigia-precios no configurado (PRECIOS_URL/PRECIOS_TOKEN)", "productos": []}
    productos = [{
        "tienda": p.get("tienda"), "producto": p.get("producto"), "marca": p.get("marca"), "precio": p.get("precio"),
        "unidad_medida": p.get("unidad_medida"), "por_peso": (p.get("unidad_medida") or "").lower() == "kg",
        "url": p.get("url"),
    } for p in d.get("productos") or [] if p.get("precio")]
    try:   # las URLs que el agente vea quedan como respaldadas para el verificador
        from tools.busqueda import _publicar
        _publicar(getattr(tool_context, "state", None), [{"url": p["url"]} for p in productos if p.get("url")])
    except Exception:  # noqa: BLE001
        pass
    mayorista = []
    try:   # precio oficial mayorista (frescos): la referencia justa para compras al por mayor
        m = _worker("/mayorista", {"q": producto, "dias": 30}) or {}
        mayorista = [{k: v.get(k) for k in ("variedad", "unidad", "n_dias", "p25", "mediana", "p75", "ultimo")} for v in m.get("variedades") or []][:5]
    except Exception:  # noqa: BLE001
        pass
    return {"termino": d.get("termino"), "productos": productos, "mayorista_lima": mayorista,
            "nota": ("`productos`: supermercado/tienda en Lima, hoy (minorista: tope). `mayorista_lima`: Gran Mercado Mayorista "
                     "de Lima (EMMSA), precio por kg de los últimos 30 días (oficial, mayorista): prefiérelo para frescos.")}
