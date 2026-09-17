"""Tools del dominio: market."""

from tools._core import *  # noqa: F401,F403
from .input_building import build_market_input


def record_market_finding(
    item_numero: int, item_descripcion: str,
    precio_ofertado: float, precio_mediana_mercado: float,
    fuentes_consultadas: str, veredicto: str, nota: str,
    tool_context: ToolContext,
) -> dict:
    """Registra un hallazgo de validación de precio para un ítem específico.
    El agente debe llamar esta tool una vez por cada ítem después de buscar
    precios con google_search.

    Args:
        item_numero: Número del ítem según la convocatoria.
        item_descripcion: Descripción corta del ítem.
        precio_ofertado: Precio unitario ofertado (S/.).
        precio_mediana_mercado: Precio mediano que encontraste en el mercado (S/.).
        fuentes_consultadas: Lista de fuentes consultadas, separadas por ' · '.
        veredicto: Uno de 'alineado', 'elevado', 'muy_elevado', 'barato', 'sin_datos'.
        nota: Comentario explicando el veredicto.

    Returns:
        Diccionario con el hallazgo registrado y diferencia_pct calculada.
    """
    if precio_mediana_mercado > 0:
        diff_pct = (precio_ofertado - precio_mediana_mercado) / precio_mediana_mercado * 100
    else:
        diff_pct = 0.0
    finding = {
        "item_numero": item_numero,
        "item_descripcion": item_descripcion,
        "precio_ofertado": precio_ofertado,
        "precio_mediana_mercado": precio_mediana_mercado,
        "diferencia_pct": round(diff_pct, 2),
        "fuentes_consultadas": fuentes_consultadas,
        "veredicto": veredicto,
        "nota": nota,
    }
    tool_context.state.setdefault("market_findings", []).append(finding)
    return {"recorded": True, "finding": finding,
            "n_findings_so_far": len(tool_context.state["market_findings"])}


def read_market_input(tool_context: ToolContext) -> dict:
    """Devuelve los items consolidados con su requerimiento técnico, listo para
    que el market_price_agent valide precios. Self-contained: si ya hay cache
    en state, lo retorna; si no, ejecuta `build_market_input` con el OCID del
    state['ocds'] y cachea el resultado.

    Esta tool reemplaza la práctica anterior del orchestrator de pegar el JSON
    grande de items en el request del market_price_agent — operación que el
    LLM falla cuando el JSON es voluminoso (deja el placeholder literal).

    Returns:
        dict con `items[]`, `tiene_requerimiento`, `mensaje_para_market_agent`,
        `n_items` y el resto del payload que produce `build_market_input`.
        Si no hay OCDS en state, retorna {error: ...}.
    """
    state = tool_context.state
    cache = state.get("market_input")
    if cache and isinstance(cache, dict) and cache.get("items"):
        return cache
    ocds = state.get("ocds") or {}
    ocid_raw = ocds.get("ocid") or state.get("ocid")
    if not ocid_raw:
        return {"error": "no hay OCDS en state — ejecuta fetch_ocds_record primero",
                "items": []}
    # Normalizar al formato corto que usa SQL — bug detectado 2026-05-24
    ocid = _short_ocid(ocid_raw)
    result = build_market_input(ocid=ocid, tool_context=tool_context)
    state["market_input"] = result
    return result
