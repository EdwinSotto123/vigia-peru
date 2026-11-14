"""La justificación de una bandera de sobreprecio: qué se pagó, contra qué, de dónde sale la referencia y cuánto dinero es.

Antes la bandera decía sólo «precio ofertado 42 % por encima de la mediana de mercado» (auditoría 2026-11-14): quien la
lee no puede comprobarla ni saber si importa. Todo lo que hace falta ya está en el hallazgo del mercado; aquí se escribe.

Devuelve el texto que sigue a la frase de la bandera y los números usados, que van en campos propios de la bandera para
que la verificación los encuentre (tools/verify.py los busca en el expediente y en la bandera)."""
from __future__ import annotations

_FUENTE = {
    "osinergmin": "precios que los grifos declaran a Osinergmin",
    "emmsa": "precios mayoristas de EMMSA",
    "conosce": "otras compras del Estado (CONOSCE)",
    "catalogo_tienda": "catálogos de tiendas",
    "perucompras": "catálogos electrónicos de Perú Compras (lo que pagaron otras entidades por el mismo producto, con IGV)",
}


def _n(v) -> float | None:
    try:
        x = float(v)
        return x if x > 0 else None
    except (TypeError, ValueError):
        return None


def _s(v: float) -> str:
    return f"S/ {v:,.2f}"


def _fuentes(f: dict, de_ancla: bool) -> str:
    if de_ancla:
        return "otras compras del Estado por el mismo bien (SEACE)"
    if f.get("diff_fuente") == "cotizaciones_expediente":
        return "cotizaciones de terceros del propio expediente"
    obs = [x for x in (f.get("precios_observados") or []) if isinstance(x, dict)]
    origenes = {str(x.get("origen")) for x in obs if x.get("origen")}
    if origenes and origenes <= set(_FUENTE):
        return " y ".join(_FUENTE[o] for o in sorted(origenes))
    dominios: list[str] = []
    for x in obs:
        d = str(x.get("dominio") or "").replace("www.", "").strip()
        if d and d not in dominios:
            dominios.append(d)
    if not dominios:
        return "precios publicados"
    return "precios publicados en " + ", ".join(dominios[:3]) + (f" y {len(dominios) - 3} más" if len(dominios) > 3 else "")


def justificar(f: dict) -> tuple[str, dict]:
    """(texto, números). Texto vacío si el hallazgo no trae el precio pagado o la referencia."""
    de_ancla = f.get("diff_fuente") == "ancla_regional"
    ancla = f.get("ancla_regional") if isinstance(f.get("ancla_regional"), dict) else {}
    es_ref = f.get("diff_base") == "referencial"
    pagado = _n(f.get("precio_unitario_referencial") if es_ref else f.get("precio_unitario_ofertado")) \
        or _n(f.get("precio_unitario_ofertado")) or _n(f.get("precio_unitario_referencial"))
    ref = _n(f.get("precio_mediana_comparacion")) or (_n(ancla.get("mediana")) if de_ancla else None) or _n(f.get("precio_mediana_mercado"))
    if not pagado or not ref:
        return "", {}
    unidad = str(f.get("unidad") or "unidad").strip().lower() or "unidad"
    n = int(_n(ancla.get("n") if de_ancla else f.get("n_precios")) or 0)
    lo = _n(ancla.get("rango_min") if de_ancla else f.get("rango_min"))
    hi = _n(ancla.get("rango_max") if de_ancla else f.get("rango_max"))
    nums: dict = {"precio_pagado": pagado, "precio_referencia": ref}
    verbo = "El valor referencial es" if es_ref else "Se pagó"
    partes = [f"{verbo} {_s(pagado)} por {unidad}; la referencia es {_s(ref)}"]
    det = []
    # Perú Compras: la referencia es lo que pagaron N entidades, no «N precios».
    resp = 0 if de_ancla else sum(int(_n(x.get("respaldo")) or 0) for x in (f.get("precios_observados") or []) if isinstance(x, dict))
    if resp:
        det.append(f"de lo que pagaron {resp} entidades")
        nums["n_entidades_referencia"] = resp
    elif n:
        det.append(f"mediana de {n} precio{'s' if n != 1 else ''}")
        nums["n_precios_referencia"] = n
    if lo and hi and hi > lo:
        det.append(f"de {_s(lo)} a {_s(hi)}")
        nums.update({"referencia_min": lo, "referencia_max": hi})
    det.append(_fuentes(f, de_ancla))
    partes[0] += " (" + "; ".join(det) + ")."
    cant = _n(f.get("cantidad"))
    if cant and pagado > ref:
        exceso = round((pagado - ref) * cant, 2)
        total = round(pagado * cant, 2)
        cant_txt = f"{cant:,.0f}" if float(cant).is_integer() else f"{cant:,.2f}"
        partes.append(f"Cantidad: {cant_txt}. Total pagado: {_s(total)}; son {_s(exceso)} más que al precio de referencia.")
        nums.update({"cantidad": cant, "total_pagado": total, "exceso_soles": exceso})
    ver = f.get("verificacion_precio") if isinstance(f.get("verificacion_precio"), dict) else {}
    if ver.get("comparable") and ver.get("motivo"):
        partes.append(f"Revisado: {str(ver['motivo'])[:160].rstrip('.')}.")
    return " ".join(partes), nums
