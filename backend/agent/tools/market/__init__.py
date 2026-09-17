"""Tools del dominio: market."""

from tools._core import *  # noqa: F401,F403
from .config import ESTRATEGIAS
from .cotizaciones import _mercado_cotizaciones
from .goods_retail import _fanout_estimacion_llm, _fanout_goods_retail, _mercado_goods_retail
from .historico_seace import _mercado_historico_seace
from .input_building import (build_market_input, list_items_for_pricing,
    _award_items_ocds, _enriquecer_precio_ofertado, _total_ofertado_proceso)
from .ancla_regional import _ancla_regional_item, _consultar_referencias_internas
from .normalizar import (_registrar_descarte, _coincide_objeto, _coincide_objeto_fallback,
    _contexto_unidad_item, _norm_num, _normalizar_precio_observado, _unidad_canon)
from .presupuesto_obra import _mercado_presupuesto_obra
from .state_io import read_market_input, record_market_finding

# Re-exportadas explícitamente arriba (no solo lo "público"): la suite de tests parchea
# varias de estas funciones internas directamente sobre el módulo (`monkeypatch.setattr(mk,
# "_fanout_goods_retail", ...)`), igual que hacía con el market.py monolítico original —
# compatibilidad 100% con ese patrón de test.


_ESTRATEGIA_FN = {
    "goods_retail": _mercado_goods_retail,
    "historico_seace": _mercado_historico_seace,
    "presupuesto_obra": _mercado_presupuesto_obra,
    "cotizaciones": _mercado_cotizaciones,
}


def analizar_mercado(state: dict, estrategia: str) -> dict:
    """Análisis de mercado según la estrategia del perfil. Escribe `state["market_analysis"]`
    (formato que consumen persist_market_flags_as_banderas y el frontend), publica las URLs
    reales en `state["grounding_urls"]`, registra `recortes`/`descartes` y devuelve un resumen.

    estrategia: "goods_retail" | "historico_seace" | "presupuesto_obra" | "cotizaciones".
    Nunca inventa referencias: sin base de comparación → `estado: "sin_dato"` explícito.
    """
    state.setdefault("grounding_urls", [])
    state.setdefault("descartes", [])
    state.setdefault("recortes", [])
    fn = _ESTRATEGIA_FN.get(estrategia)
    if fn is None:
        res = {"error": "estrategia_desconocida", "estrategia": estrategia, "validas": list(ESTRATEGIAS)}
        state["market_analysis"] = {"estado": "sin_dato", "estrategia": estrategia, "findings": [],
                                    "veredicto_global": "sin_dato", "observaciones_clave": [res["error"]]}
        return res
    t0 = time.time()
    try:
        out = fn(state)
    except Exception as e:
        _registrar_descarte(state, f"market.{estrategia}", "error", f"{type(e).__name__}: {str(e)[:200]}")
        out = {"estado": "sin_dato", "findings": [], "veredicto_global": "sin_dato",
               "observaciones_clave": [f"Análisis de mercado falló: {type(e).__name__}: {str(e)[:160]}"],
               "error": f"{type(e).__name__}: {str(e)[:200]}"}
    out["estrategia"] = estrategia
    out.setdefault("veredicto_global", "sin_dato")
    out.setdefault("findings", [])
    out["segundos"] = round(time.time() - t0, 1)
    out["n_descartes"] = len([d for d in state.get("descartes") or [] if str(d.get("donde", "")).startswith("market.")])
    state["market_analysis"] = out
    findings = out.get("findings") or []
    return {
        "ok": "error" not in out,
        "estrategia": estrategia,
        "estado": out.get("estado"),
        "n_items": len(findings),
        "n_con_mediana": sum(1 for f in findings if isinstance(f.get("precio_mediana_comparacion") or f.get("precio_mediana_mercado"), (int, float))),
        "veredicto_global": out.get("veredicto_global"),
        "sobreprecio_pct": out.get("sobreprecio_pct"),
        "cobertura": out.get("cobertura_mercado"),
        "n_grounding_urls": len(out.get("grounding_urls") or []),
        "n_descartes": out["n_descartes"],
        "segundos": out["segundos"],
        **({"error": out["error"]} if out.get("error") else {}),
    }


def analizar_mercado_por_estrategia(estrategia: str, tool_context: ToolContext) -> dict:
    """Tool: corre `analizar_mercado` sobre el state de la sesión.

    Args:
        estrategia: goods_retail | historico_seace | presupuesto_obra | cotizaciones.

    Returns:
        Resumen {ok, estrategia, estado, n_items, n_con_mediana, veredicto_global, ...}.
    """
    return analizar_mercado(tool_context.state, estrategia)


def analyze_market_sharded(ocid: str, tool_context: ToolContext) -> dict:
    """Compat: precia los ítems de la convocatoria (estrategia `goods_retail`). Equivale a
    `analizar_mercado(state, "goods_retail")`; el driver por perfil llama a esa función.

    Args:
        ocid: OCID o código corto de la convocatoria.

    Returns:
        Resumen {ok, n_items, n_con_mediana, cobertura, veredicto_global}.
    """
    state = tool_context.state
    if not (isinstance(state.get("market_input"), dict) and state["market_input"].get("items")):
        read_market_input(tool_context=tool_context)
    return analizar_mercado(state, "goods_retail")


list_items_for_pricing_tool = FunctionTool(func=list_items_for_pricing)
build_market_input_tool = FunctionTool(func=build_market_input)
record_market_finding_tool = FunctionTool(func=record_market_finding)
read_market_input_tool = FunctionTool(func=read_market_input)
analyze_market_sharded_tool = FunctionTool(func=analyze_market_sharded)
analizar_mercado_por_estrategia_tool = FunctionTool(func=analizar_mercado_por_estrategia)
