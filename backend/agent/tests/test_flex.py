"""Flex PayGo por llamada con salida a Standard (tools/flex.py + patch de model_fallback)."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from google.genai import types

from agents._shared import model_fallback as MF
from pipeline_runtime import _factor_trafico
from tools import flex as F


@pytest.fixture(autouse=True)
def _limpio(monkeypatch):
    for k in ("GEMINI_FLEX", "GEMINI_FLEX_TIMEOUT_S", "GEMINI_FLEX_FALLAS", "GEMINI_FLEX_PAUSA_S",
              "GEMINI_FLEX_VENTANA_S", "GEMINI_FLEX_CORTE_S", "GEMINI_FLEX_EXCLUIR"):
        monkeypatch.delenv(k, raising=False)
    F._reiniciar_para_tests()
    yield
    F._reiniciar_para_tests()


class _Timeout(Exception):
    pass


_Timeout.__name__ = "ReadTimeout"


def test_con_flex_agrega_encabezado_y_timeout_sin_mutar():
    base = types.GenerateContentConfig(temperature=0.1, http_options=types.HttpOptions(timeout=60000))
    cfg = F.con_flex(base)
    assert F.es_flex(cfg) and not F.es_flex(base)
    assert cfg.http_options.timeout == 150000 and base.http_options.timeout == 60000
    largo = types.GenerateContentConfig(http_options=types.HttpOptions(timeout=300000))
    assert F.con_flex(largo).http_options.timeout == 300000     # el extractor conserva el suyo
    assert cfg.temperature == 0.1
    assert F.es_flex(F.con_flex(None))
    d = F.con_flex({"temperature": 0.2})
    assert d["temperature"] == 0.2 and F.es_flex(d)


def test_es_falla_flex():
    assert F.es_falla_flex(Exception("429 RESOURCE_EXHAUSTED. Resource exhausted"))
    assert F.es_falla_flex(Exception("503 UNAVAILABLE"))
    assert F.es_falla_flex(Exception("504 DEADLINE_EXCEEDED. Deadline expired"))
    assert F.es_falla_flex(Exception("499 CANCELLED. {'message': 'The operation was cancelled.'}"))
    assert F.es_falla_flex(_Timeout("read"))
    assert not F.es_falla_flex(Exception("400 INVALID_ARGUMENT: response_schema too large"))


def test_escape_a_standard_en_la_misma_llamada():
    vistos = []

    def llamar(cfg):
        vistos.append(F.es_flex(cfg))
        if F.es_flex(cfg):
            raise Exception("429 RESOURCE_EXHAUSTED")
        return "ok"

    est = {"mod": F, "on": True}
    assert MF._con_flex_o_escape(est, "gemini-3.6-flash", None, llamar) == "ok"
    assert vistos == [True, False] and est["on"] is False
    assert F.resumen_corrida()["escapes"] == 1


def test_escape_async():
    async def llamar(cfg):
        if F.es_flex(cfg):
            raise _Timeout("timed out")
        return "ok"

    est = {"mod": F, "on": True}
    assert asyncio.run(MF._con_flex_o_escape_async(est, "gemini-3.6-flash", None, llamar)) == "ok"


def test_error_que_no_es_de_flex_no_se_repite():
    def llamar(cfg):
        raise Exception("400 INVALID_ARGUMENT")

    with pytest.raises(Exception, match="400"):
        MF._con_flex_o_escape({"mod": F, "on": True}, "gemini-3.6-flash", None, llamar)


def test_cortacircuito_abre_tras_n_fallas(monkeypatch):
    monkeypatch.setenv("GEMINI_FLEX_FALLAS", "3")
    assert F.usar_flex_ahora()
    assert not F.registrar_falla() and not F.registrar_falla()
    assert F.registrar_falla()                 # la 3.ª abre
    assert not F.usar_flex_ahora()
    monkeypatch.setenv("GEMINI_FLEX", "0")
    assert not F.usar_flex_ahora()


def test_corte_por_tiempo_de_corrida(monkeypatch):
    F.iniciar_corrida()
    assert F.usar_flex_ahora()
    monkeypatch.setenv("GEMINI_FLEX_CORTE_S", "-1")
    assert not F.usar_flex_ahora()
    assert MF._estado_flex()["on"] is False


def test_patch_real_manda_flex_y_escapa(monkeypatch):
    """El wrapper instalado sobre Models.generate_content pone el encabezado y, ante un 429 de
    Flex, repite en Standard sin backoff ni cambio de modelo."""
    from google.genai import models as gm
    llamadas = []

    def falso(self, *, model, contents, config=None, **kw):
        llamadas.append((model, F.es_flex(config)))
        if F.es_flex(config):
            raise Exception("429 RESOURCE_EXHAUSTED")
        return SimpleNamespace(candidates=[], text="ok")

    monkeypatch.setattr(MF, "_RETRY_DELAYS", [0])
    orig = gm.Models.generate_content
    try:
        gm.Models.generate_content = falso
        MF._apply_gemini_fallback_patch()
        r = gm.Models.generate_content(object(), model="gemini-3.6-flash", contents="x")
    finally:
        gm.Models.generate_content = orig
    assert r.text == "ok"
    assert llamadas == [("gemini-3.6-flash", True), ("gemini-3.6-flash", False)]


def test_costo_flex_a_mitad():
    assert _factor_trafico(SimpleNamespace(traffic_type="ON_DEMAND_FLEX")) == 0.5
    assert _factor_trafico(SimpleNamespace(traffic_type="ON_DEMAND")) == 1.0
    assert _factor_trafico(SimpleNamespace()) == 1.0


def test_agente_excluido_va_por_standard(monkeypatch):
    cfg = types.GenerateContentConfig(labels={"adk_agent_name": "report_writer_agent"})
    assert F.agente_de(cfg) == "report_writer_agent"
    assert MF._estado_flex(cfg)["on"] is True
    monkeypatch.setenv("GEMINI_FLEX_EXCLUIR", "report_writer_agent, otro")
    assert MF._estado_flex(cfg)["on"] is False
    assert MF._estado_flex(types.GenerateContentConfig(labels={"adk_agent_name": "web_research_agent"}))["on"] is True
    assert MF._estado_flex(None)["on"] is True
