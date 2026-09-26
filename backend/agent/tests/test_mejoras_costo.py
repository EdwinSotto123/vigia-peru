"""Mejoras de costo, calidad y privacidad (auditoría de Gemini 2026-09-26): cadenas de
respaldo sin 2.5, razonamiento explícito en llamadas directas, Flex, jueces que no inventan
veredictos al fallar, redacción de DNI y contexto sin duplicados."""
from __future__ import annotations

import threading
from types import SimpleNamespace

from google.genai import types

from agents._shared import model_fallback as MF
from agents._shared import models as M
from agents._shared import pii
from tools import _core as C
from tools import self_eval as SE
from tools import state_loaders as SL
from tools.contexto import compactar_errores
from tools.documentos import schema as SCH


# ── Modelos y respaldo ──────────────────────────────────────────────────────────
def test_cadenas_de_respaldo_sin_gemini_25_como_destino():
    for origen, cadena in MF._FALLBACK_CHAIN.items():
        assert all(not m.startswith("gemini-2.5") for m in cadena), (origen, cadena)
    # 3.5-flash (el doble de caro) ya no es el primer salto de 3.6-flash
    assert MF._FALLBACK_CHAIN["gemini-3.6-flash"][0] == "gemini-3.8-flash"


def test_config_para_sube_minimal_a_low_solo_en_38():
    cfg = types.GenerateContentConfig(thinking_config=types.ThinkingConfig(thinking_level="minimal"))
    assert str(MF._config_para("gemini-3.8-flash", cfg).thinking_config.thinking_level).lower().endswith("low")
    assert MF._config_para("gemini-3.6-flash", cfg) is cfg
    sin = types.GenerateContentConfig(temperature=0.1)
    assert MF._config_para("gemini-3.8-flash", sin) is sin


def test_modelo_no_disponible_detecta_retiro_y_no_confunde_503():
    assert MF._modelo_no_disponible(Exception(
        "404 NOT_FOUND. Publisher Model `projects/x/locations/global/publishers/google/models/gemini-2.5-flash` was not found"))
    assert not MF._modelo_no_disponible(Exception("503 UNAVAILABLE high demand"))
    assert not MF._modelo_no_disponible(Exception("400 INVALID_ARGUMENT: response_schema too large"))


def test_thinking_crudo_por_modelo_y_env(monkeypatch):
    monkeypatch.delenv("THINKING_EXTRACTOR", raising=False)
    assert str(C.thinking_crudo("extractor", "gemini-3.6-flash", "minimal").thinking_level).lower().endswith("minimal")
    assert str(C.thinking_crudo("extractor", "gemini-3.8-flash", "minimal").thinking_level).lower().endswith("low")
    assert C.thinking_crudo("extractor", "gemini-2.5-flash", "minimal").thinking_budget == 0
    monkeypatch.setenv("THINKING_EXTRACTOR", "none")
    assert C.thinking_crudo("extractor", "gemini-3.6-flash", "low") is None
    monkeypatch.setenv("THINKING_EXTRACTOR", "high")
    assert str(C.thinking_crudo("extractor", "gemini-3.6-flash", "low").thinking_level).lower().endswith("high")


def test_flex_estandar_y_fuera_del_config_de_adk(monkeypatch):
    monkeypatch.delenv("GEMINI_FLEX", raising=False)
    assert C.flex_activo()                            # Flex es el modo por defecto
    monkeypatch.setenv("GEMINI_FLEX", "0")
    assert not C.flex_activo()
    # El encabezado ya no va fijo en el agente: lo pone el patch por llamada.
    monkeypatch.delenv("GEMINI_FLEX", raising=False)
    assert M.build_generate_config("x_agent") is None


def test_descartes_del_schema_son_por_hilo():
    SCH._DESCARTES_HILO.valor = ["contrato_final"]
    visto = {}

    def otro():
        visto["b"] = SCH.descartes_de_este_hilo()
    t = threading.Thread(target=otro)
    t.start()
    t.join()
    assert visto["b"] == [] and SCH.descartes_de_este_hilo() == ["contrato_final"]


# ── Jueces ──────────────────────────────────────────────────────────────────────
def test_modelo_juez_por_defecto_es_flash_lite(monkeypatch):
    monkeypatch.delenv("GEMINI_MODEL_JUDGE", raising=False)
    assert "flash-lite" in SE._judge_model() or SE._judge_model() == M._MODEL_JUDGE


def test_juez_caido_no_inventa_veredictos(monkeypatch):
    monkeypatch.setattr(SE, "_judge_array_reason", lambda p, n, labels: [{"label": None, "reason": "no evaluado"}] * n)
    monkeypatch.setattr(SE, "_judge_one_reason", lambda p, labels: (None, "no evaluado: timeout"))
    llamado = {}
    monkeypatch.setattr(SE, "degradar_mercado_implausible", lambda *a, **k: llamado.setdefault("si", True))
    out = SE.run_inline_evals(
        banderas=[{"regla": "r1", "evidencia": "x"}, {"regla": "r2", "evidencia": "y"}],
        market_findings=[{"item_descripcion": "llanta", "precios_observados": [1], "veredicto": "sobreprecio"}],
        dictamen="x" * 200, objeto="llantas", doc_item_descs=["llanta"], state={})
    assert out["respaldo"]["n"] == 0 and out["precio"]["n"] == 0
    assert out["tono"] is None and out["coherencia"] is None
    assert all(p["plausible"] is None for p in out["per_precio"])
    assert "si" not in llamado                       # no se borran banderas de mercado
    assert SE.debe_bloquear(out) == (False, "")      # nada evaluado → no bloquea
    assert len(out["no_evaluados"]) == 5


# ── Privacidad ──────────────────────────────────────────────────────────────────
def test_redaccion_de_dni():
    assert pii.redactar_texto('{"dni": "08049411"}') == '{"dni": "[DNI]"}'
    assert pii.redactar_texto("identificado con DNI N° 28305511") == "identificado con DNI N° [DNI]"
    assert pii.redactar_texto("monto 12345678 soles; RUC 10223344556") == "monto 12345678 soles; RUC 10223344556"
    assert pii.redactar({"socios": [{"dni": 8049411}]}) == {"socios": [{"dni": "[DNI]"}]}


# ── Cruce normativo ─────────────────────────────────────────────────────────────
def test_cruce_normativo_no_cae_con_evidencia_en_lista(monkeypatch):
    """1225884 (2026-09-26): un cruce de la red de personas con `evidencia` como lista tumbaba
    evaluate_normative_compliance ("unhashable type: 'list'") y se perdían el cruce normativo y
    las reglas del lote 1."""
    from tools.compliance_rules import _analysis as AN
    monkeypatch.setattr(AN, "run_reglas_lote1", lambda ocid, ctx: {})
    monkeypatch.setattr(AN, "query_legal_rag", lambda q, ctx=None, **kw: {"matches": []})
    st = {"person_network": {"cruce_firmantes_ganador": [
        {"tipo_relacion": "socio_comun", "severidad": "alta",
         "evidencia": [{"url": "https://ejemplo.pe/a", "cita": "figura como socio"}]}]}}
    out = AN.evaluate_normative_compliance("1", SimpleNamespace(state=st))
    assert isinstance(out, dict) and "error" not in out
    assert st.get("normative_compliance") is not None


# ── Contexto ────────────────────────────────────────────────────────────────────
def test_compactar_errores():
    d = {"sunat_decolecta": {"error": "HTTP 401 — API key inválida", "body": "{...}"}, "ok": {"a": 1}}
    out = compactar_errores(d)
    assert out["sunat_decolecta"] == {"estado": "no_disponible", "motivo": "HTTP 401 — API key inválida"}
    assert out["ok"] == {"a": 1} and d["sunat_decolecta"]["body"] == "{...}"   # no muta


def test_read_document_analysis_una_sola_lista_sin_alias():
    item = {"descripcion_corta": "llanta", "texto_literal": "req", "requerimiento_tecnico_detallado": "req",
            "documento_sha256": "a" * 64}
    ctx = SimpleNamespace(state={"parser_raw_consolidated": {"items_consolidados": [item], "firmantes": []}})
    out = SL.read_document_analysis(ctx)
    assert "items_consolidados" not in out and len(out["items"]) == 1
    assert "requerimiento_tecnico_detallado" not in out["items"][0]
    assert "documento_sha256" not in out["items"][0]


def test_dictamen_sin_reglas_evaluadas_y_mercado_compacto():
    finding = {"item_descripcion": "llanta", "veredicto": "sobreprecio", "precios_observados": list(range(8)),
               "evidencia": "x" * 900, "queries_realizadas": ["q"]}
    ctx = SimpleNamespace(state={"pending_flags": [{"regla": "r"}], "market_analysis": {"findings": [finding]},
                                 "sunat_decolecta": {"error": "HTTP 401", "body": "b"}})
    out = SL.get_dictamen_context(ctx)
    assert "reglas_evaluadas" not in out
    f = out["market_analysis"]["findings"][0]
    assert f["precios_observados"] == [0, 1, 2] and f["precios_observados_total"] == 8
    assert "evidencia" not in f and "queries_realizadas" not in f
    assert out["sunat_decolecta"]["estado"] == "no_disponible"
