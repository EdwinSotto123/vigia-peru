"""Costo real de Gemini por análisis: TODAS las llamadas (agentes ADK y directas), con los
descuentos que Vertex aplicó de verdad a cada una.

- Caché implícito: `cached_content_token_count` es la parte de `prompt_token_count` que salió
  de caché y se cobra al 10 % de la entrada (doc de Vertex, "context caching"; medido
  2026-09-26: 37 % de la entrada de los agentes en 21 días).
- Flex PayGo: la mitad cuando la respuesta trae traffic_type ON_DEMAND_FLEX (tools/flex.py).
- Razonamiento: `thoughts_token_count` se cobra como salida.

Lo alimenta el patch de model_fallback, que ve cada respuesta de generate_content. Cada llamada
se atribuye a una etapa: la etiqueta `adk_agent_name` que ADK pone a sus requests, o
`vigia_etapa` en las llamadas directas (ver `etiquetas`). Las mismas etiquetas separan la
factura de Vertex por etapa. Cloud Run corre un análisis por instancia (concurrency 1), así
que alcanza con un acumulador de módulo que se reinicia al empezar cada análisis.
"""
from __future__ import annotations

import os
import threading

# USD por 1 M de tokens (entrada, salida), lista de Vertex consultada 2026-09-15/24.
# 3.6 Flash está en tarifa introductoria hasta 2026-12-31 (lista: 1,50 / 7,50).
TARIFAS = {
    "gemini-3.6-flash":      (0.75, 3.75),
    "gemini-3.8-flash":      (0.75, 3.75),   # mismo precio que 3.6 (2026-09-24)
    "gemini-3.5-flash-lite": (0.30, 2.50),
    "gemini-3.5-flash":      (1.50, 9.00),
    "gemini-3-flash":        (0.50, 3.00),
    "gemini-2.5-pro":        (1.25, 10.00),
    "gemini-2.5-flash-lite": (0.10, 0.40),
    "gemini-2.5-flash":      (0.30, 2.50),
}
TARIFA_DEFAULT = TARIFAS["gemini-3.6-flash"]
FACTOR_CACHE = 0.10


def tarifa(model) -> tuple[float, float]:
    """(entrada, salida) USD/1M según el id del modelo (prefijo más largo; 'lite' antes que su
    base). Robusto a None o a un objeto Model."""
    m = str(model or "").lower()
    if "/" in m:
        m = m.rsplit("/", 1)[-1]
    for key in sorted(TARIFAS, key=len, reverse=True):
        if m.startswith(key):
            return TARIFAS[key]
    if "pro" in m:
        return TARIFAS["gemini-2.5-pro"]
    if "lite" in m:
        return TARIFAS["gemini-3.5-flash-lite"]
    return TARIFA_DEFAULT


def _n(um, campo: str) -> int:
    try:
        return int(getattr(um, campo, 0) or 0)
    except (TypeError, ValueError):
        return 0


def tokens(um) -> dict:
    """Entrada (incluye la parte en caché), caché, salida visible y razonamiento."""
    return {"entrada": _n(um, "prompt_token_count"), "cache": _n(um, "cached_content_token_count"),
            "salida": _n(um, "candidates_token_count"), "razonamiento": _n(um, "thoughts_token_count")}


def es_flex(um) -> bool:
    return "FLEX" in str(getattr(um, "traffic_type", "") or "").upper()


def costo(model, um) -> float:
    """USD de UNA respuesta: entrada no cacheada a tarifa, caché al 10 %, salida + razonamiento a
    tarifa de salida; todo a la mitad si fue Flex."""
    t = tokens(um)
    ent, sal = tarifa(model)
    cache = min(t["cache"], t["entrada"])
    usd = ((t["entrada"] - cache) * ent + cache * ent * FACTOR_CACHE
           + (t["salida"] + t["razonamiento"]) * sal) / 1e6
    return usd * (0.5 if es_flex(um) else 1.0)


def etiquetas(etapa: str) -> dict | None:
    """`labels` para una llamada directa (Vertex acepta minúsculas, dígitos, _ y -). La Gemini API
    con llave (AI Studio) rechaza `labels`: ahí no se etiqueta, igual que hace ADK."""
    vertex = os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").strip().lower() in ("true", "1", "yes")
    if os.getenv("GOOGLE_API_KEY", "").strip() and not vertex:
        return None
    return {"vigia_etapa": etapa}


def etapa_de(config) -> str:
    labels = (config.get("labels") if isinstance(config, dict) else getattr(config, "labels", None)) or {}
    return str(labels.get("adk_agent_name") or labels.get("vigia_etapa") or "otras")


# ── Acumulador del análisis en curso ───────────────────────────────────────────
_LOCK = threading.Lock()
_ACUM: dict = {}


def iniciar() -> None:
    with _LOCK:
        _ACUM.clear()


def registrar(model, config, resp) -> None:
    """Suma una respuesta al acumulador (lo llama el patch de model_fallback). Nunca levanta."""
    try:
        um = getattr(resp, "usage_metadata", None)
        if um is None:
            return
        t = tokens(um)
        usd = costo(model, um)
        etapa = etapa_de(config)
        with _LOCK:
            e = _ACUM.setdefault(etapa, {"llamadas": 0, "flex": 0, "entrada": 0, "cache": 0,
                                         "salida": 0, "razonamiento": 0, "costo_usd": 0.0})
            e["llamadas"] += 1
            e["flex"] += 1 if es_flex(um) else 0
            for k in ("entrada", "cache", "salida", "razonamiento"):
                e[k] += t[k]
            e["costo_usd"] += usd
    except Exception:
        pass


def resumen() -> dict:
    """Totales del análisis y desglose por etapa (ordenado por costo)."""
    with _LOCK:
        etapas = [{"etapa": k, **v, "costo_usd": round(v["costo_usd"], 6)} for k, v in _ACUM.items()]
    etapas.sort(key=lambda e: -e["costo_usd"])
    tot = {k: sum(e[k] for e in etapas) for k in ("llamadas", "flex", "entrada", "cache", "salida", "razonamiento")}
    tot["costo_usd"] = round(sum(e["costo_usd"] for e in etapas), 6)
    return {**tot, "por_etapa": etapas}


def metricas_finales(agentes: dict, extra: dict | None = None) -> dict:
    """`llm_metrics` que se guarda con el análisis. Los campos de siempre (cost_usd, tokens_*,
    n_llm_calls) pasan a ser el TOTAL de todas las llamadas; lo que antes se contaba (solo los
    agentes ADK, desde sus eventos) queda en `agentes`."""
    r = resumen()
    if not r["llamadas"]:          # sin patch (scripts sueltos): lo de los agentes
        r = {"llamadas": agentes.get("calls", 0), "flex": agentes.get("flex_calls", 0),
             "entrada": agentes.get("prompt", 0), "cache": agentes.get("cached", 0),
             "salida": max(0, agentes.get("output", 0) - agentes.get("thoughts", 0)),
             "razonamiento": agentes.get("thoughts", 0), "costo_usd": agentes.get("cost", 0.0), "por_etapa": []}
    salida_total = r["salida"] + r["razonamiento"]
    out = {
        "tokens_total": r["entrada"] + salida_total, "tokens_prompt": r["entrada"],
        "tokens_output": salida_total, "tokens_thoughts": r["razonamiento"], "tokens_cached": r["cache"],
        "n_llm_calls": r["llamadas"], "n_llm_calls_flex": r["flex"], "cost_usd": r["costo_usd"],
        "por_etapa": r["por_etapa"],
        "agentes": {"n_llm_calls": agentes.get("calls", 0), "cost_usd": agentes.get("cost", 0.0),
                    "tokens_prompt": agentes.get("prompt", 0), "tokens_cached": agentes.get("cached", 0)},
    }
    out.update(extra or {})
    return out

