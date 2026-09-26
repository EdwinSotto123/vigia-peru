"""Costo real por análisis (tools/costo_llm.py): caché al 10 %, Flex a la mitad, razonamiento
como salida, y TODAS las llamadas (agentes y directas) sumadas por etapa desde el patch."""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from google.genai import types

from agents._shared import model_fallback as MF
from tools import costo_llm as CL
from tools import flex as F


def _um(entrada=0, cache=0, salida=0, razon=0, flex=False):
    return SimpleNamespace(prompt_token_count=entrada, cached_content_token_count=cache,
                           candidates_token_count=salida, thoughts_token_count=razon,
                           traffic_type="ON_DEMAND_FLEX" if flex else "ON_DEMAND")


@pytest.fixture(autouse=True)
def _limpio(monkeypatch):
    monkeypatch.delenv("GEMINI_FLEX", raising=False)
    CL.iniciar()
    F._reiniciar_para_tests()
    yield
    CL.iniciar()


def test_cache_al_diez_por_ciento_y_razonamiento_como_salida():
    # 1 M de entrada, 600 k en caché: 400 k × 0,75 + 600 k × 0,075 = 0,345; salida 100 k + 100 k × 3,75 = 0,75
    assert CL.costo("gemini-3.6-flash", _um(1_000_000, 600_000, 100_000, 100_000)) == pytest.approx(1.095)
    assert CL.costo("gemini-3.6-flash", _um(1_000_000, 600_000, 100_000, 100_000, flex=True)) == pytest.approx(0.5475)
    assert CL.costo("gemini-3.5-flash-lite", _um(1_000_000)) == pytest.approx(0.30)


def test_acumula_por_etapa_con_etiquetas():
    adk = types.GenerateContentConfig(labels={"adk_agent_name": "report_writer_agent"})
    CL.registrar("gemini-3.6-flash", adk, SimpleNamespace(usage_metadata=_um(10_000, 4_000, 1_000, flex=True)))
    CL.registrar("gemini-3.6-flash", types.GenerateContentConfig(labels=CL.etiquetas("extractor")),
                 SimpleNamespace(usage_metadata=_um(50_000, 0, 5_000)))
    CL.registrar("gemini-3.6-flash", None, SimpleNamespace(usage_metadata=_um(100)))
    CL.registrar("gemini-3.6-flash", None, SimpleNamespace())          # sin usage: se ignora
    r = CL.resumen()
    assert r["llamadas"] == 3 and r["flex"] == 1 and r["cache"] == 4_000
    etapas = {e["etapa"]: e for e in r["por_etapa"]}
    assert set(etapas) == {"report_writer_agent", "extractor", "otras"}
    assert r["por_etapa"][0]["etapa"] == "extractor"                   # ordenado por costo


def test_metricas_finales_total_y_agentes():
    CL.registrar("gemini-3.6-flash", None, SimpleNamespace(usage_metadata=_um(1000, 0, 100, 50)))
    m = CL.metricas_finales({"calls": 1, "cost": 0.5, "prompt": 10}, {"phoenix_trace_id": "x"})
    assert m["n_llm_calls"] == 1 and m["tokens_output"] == 150 and m["tokens_thoughts"] == 50
    assert m["agentes"]["cost_usd"] == 0.5 and m["phoenix_trace_id"] == "x"
    CL.iniciar()
    m2 = CL.metricas_finales({"calls": 2, "cost": 0.25, "prompt": 10, "output": 5, "thoughts": 1})
    assert m2["cost_usd"] == 0.25 and m2["n_llm_calls"] == 2            # sin patch: lo de los agentes


def test_etiquetas_no_van_a_ai_studio(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "x")
    monkeypatch.delenv("GOOGLE_GENAI_USE_VERTEXAI", raising=False)
    assert CL.etiquetas("juez") is None
    monkeypatch.setenv("GOOGLE_GENAI_USE_VERTEXAI", "true")
    assert CL.etiquetas("juez") == {"vigia_etapa": "juez"}


def test_el_patch_contabiliza_la_llamada_que_responde():
    """Flex falla, responde Standard: se cuenta UNA llamada, la que se cobró."""
    def llamar(cfg):
        if F.es_flex(cfg):
            raise Exception("429 RESOURCE_EXHAUSTED")
        return SimpleNamespace(usage_metadata=_um(2000, 0, 100))

    cfg = types.GenerateContentConfig(labels=CL.etiquetas("mercado"))
    MF._con_flex_o_escape(MF._estado_flex(cfg), "gemini-3.6-flash", cfg, llamar)
    r = CL.resumen()
    assert r["llamadas"] == 1 and r["flex"] == 0 and r["por_etapa"][0]["etapa"] == "mercado"
