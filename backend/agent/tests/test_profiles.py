"""Perfiles por tipo de contratación (agents/_shared/profiles.py) y su lectura en el driver."""
from __future__ import annotations

import pytest

from agents._shared import profiles as P

TODOS_LOS_TIPOS = {"bienes", "servicios", "obras", "consultoria", "convenio", "directa", "otro"}


@pytest.mark.parametrize("nombre,tipos", [
    ("bienes", {"bienes"}),
    ("servicios", {"servicios"}),
    ("obras", {"obras"}),
    ("otros", {"consultoria", "convenio", "directa", "otro"}),
])
def test_cada_perfil_acepta_su_tipo_y_rechaza_los_demas(nombre, tipos):
    p = P.get_profile(nombre)
    assert p.nombre == nombre
    for t in tipos:
        assert P.acepta(p, t), f"{nombre} debe aceptar {t}"
        assert P.acepta(p, t.upper()) and P.acepta(p, f" {t} ")   # normaliza
    for t in TODOS_LOS_TIPOS - tipos:
        assert not P.acepta(p, t), f"{nombre} NO debe aceptar {t}"


def test_sin_tipo_acepta_a_demanda():
    for p in P.PROFILES.values():
        assert P.acepta(p, None)
        assert P.acepta(p, "")


def test_tipos_cubren_todo_y_sin_solapes():
    cubiertos = set()
    for p in P.PROFILES.values():
        assert not (cubiertos & p.tipos_aceptados), "dos perfiles aceptan el mismo tipo"
        cubiertos |= p.tipos_aceptados
    assert cubiertos == TODOS_LOS_TIPOS
    assert P.perfil_para_tipo("directa") == "otros"
    assert P.perfil_para_tipo("obras") == "obras"
    assert P.perfil_para_tipo("desconocido") is None


def test_agentes_de_cada_perfil_existen_en_fases_del_driver():
    import deterministic
    for p in P.PROFILES.values():
        assert set(p.agentes) <= set(deterministic.FASES), p.nombre
        assert len(p.agentes) == len(set(p.agentes))
        # orden de ejecución consistente con el driver
        idx = [deterministic.FASES.index(a) for a in p.agentes]
        assert idx == sorted(idx), f"{p.nombre}: orden de agentes distinto al del driver"
        assert p.agentes[0] == "compliance" and p.agentes[-1] == "report_writer"


def test_perfil_por_defecto_es_bienes(perfil_env):
    mod = perfil_env("")
    assert mod.get_profile().nombre == "bienes"
    mod = perfil_env("servicios")
    assert mod.get_profile().nombre == "servicios"
    mod = perfil_env("inexistente")
    assert mod.get_profile().nombre == "bienes"   # nunca rompe el servicio histórico


def test_contenido_por_perfil_segun_auditoria():
    b, s, o, x = (P.get_profile(n) for n in ("bienes", "servicios", "obras", "otros"))
    assert b.market_estrategia == "goods_retail" and b.parser_bloque is None
    assert s.market_estrategia == "historico_seace" and s.parser_bloque == "servicio"
    assert o.market_estrategia == "presupuesto_obra" and o.parser_bloque == "obra"
    assert x.market_estrategia == "cotizaciones" and x.parser_bloque == "sustento_directa"
    # market corre en TODOS los perfiles (ya no se omite a ciegas para no-bienes)
    for p in (b, s, o, x):
        assert "market" in p.agentes
        assert p.parse_max_docs == 12
        assert "Recortes y datos no verificables" in p.dictamen_secciones
        assert p.doc_prioridad and p.legal_vectores == p.nombre
    assert x.agentes == ("compliance", "document_parser", "document_legal_analyst", "market",
                         "web_research", "news_research", "person_network", "report_writer")
    assert o.topes_uit["licitacion_publica"] == 1800.0
    assert b.topes_uit["licitacion_publica"] == 400.0
    assert "adicional_acumulado" in o.reglas_activas
    assert "personal_clave_vinculado" in s.reglas_activas
    assert "directa_recurrente" in x.reglas_activas
    assert b.doc_prioridad[0] == "bases integradas" and s.doc_prioridad[0] == "terminos de referencia"
    assert o.doc_prioridad[0] == "expediente tecnico" and x.doc_prioridad[0] == "informe tecnico"


def test_as_state_es_serializable():
    import json
    for p in P.PROFILES.values():
        d = p.as_state()
        json.dumps(d)
        assert d["nombre"] == p.nombre and set(d["reglas_activas"]) == p.reglas_activas


def test_permitido_interseca_matriz_y_perfil():
    import deterministic
    otros = P.get_profile("otros")
    # sin matriz → decide el perfil
    assert deterministic.permitido({}, "market", otros)
    assert not deterministic.permitido({}, "entity_personnel", otros)
    # con matriz → intersección
    st = {"agentes_permitidos": ["compliance", "entity_personnel", "report_writer"]}
    assert deterministic.permitido(st, "compliance", otros)
    assert not deterministic.permitido(st, "entity_personnel", otros)   # perfil lo excluye
    assert not deterministic.permitido(st, "market", otros)             # matriz lo excluye
    bienes = P.get_profile("bienes")
    assert deterministic.permitido(st, "entity_personnel", bienes)


def test_rate_for_model_cubre_3x_y_thinking():
    import deterministic as D
    assert D._rate_for_model("gemini-3.6-flash") == (0.75, 3.75)
    assert D._rate_for_model("gemini-3.5-flash-lite") == (0.30, 2.50)
    assert D._rate_for_model("gemini-3.5-flash") == (1.50, 9.00)
    assert D._rate_for_model("gemini-2.5-flash-lite") == (0.10, 0.40)
    assert D._rate_for_model("publishers/google/models/gemini-2.5-pro") == (1.25, 10.00)
    assert D._rate_for_model(None) == D._DEFAULT_RATE

    class UM:
        prompt_token_count = 100
        candidates_token_count = 50
        thoughts_token_count = 30
        total_token_count = 180
    assert D._usage_tokens(UM()) == (100, 50, 30, 180)


def test_kwargs_soportados_filtra_por_firma():
    import deterministic as D

    def vieja(ocid, tool_context):
        return 1

    def nueva(ocid, tool_context, reglas_activas=None, topes_uit=None):
        return 2

    def abierta(ocid, tool_context, **kw):
        return 3
    extra = {"reglas_activas": frozenset({"x"}), "topes_uit": {"a": 1.0}}
    assert D._kwargs_soportados(vieja, **extra) == {}
    assert D._kwargs_soportados(nueva, **extra) == extra
    assert D._kwargs_soportados(abierta, **extra) == extra


def test_bloque_recortes_lista_y_declara_el_tope():
    import deterministic as D
    assert D._bloque_recortes({}) == ""
    st = {"recortes": [{"donde": "doc_select", "limite": 12, "omitido": {"id": "x"}}],
          "descartes": [{"donde": "web_research", "motivo": "schema_invalido", "detalle": "e"}]}
    txt = D._bloque_recortes(st)
    assert "Recortes y datos no verificables" in txt and "doc_select" in txt and "schema_invalido" in txt
    st2 = {"recortes": [{"donde": f"r{i}", "limite": 1, "omitido": i} for i in range(40)]}
    txt2 = D._bloque_recortes(st2)
    assert "recortes/descartes más" in txt2


def test_fallback_chain_cubre_modelos_verificados():
    from agents._shared import model_fallback as MF
    for m in ("gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"):
        assert m in MF._FALLBACK_CHAIN, m
    for chain in MF._FALLBACK_CHAIN.values():
        for m in chain:
            assert m not in ("gemini-3.6-pro", "gemini-3.5-pro", "gemini-3.6-flash-lite")
    assert MF._deadline_s() > 0
    import time
    assert MF._next_wait(time.monotonic(), 10) is not None


def test_deadline_corta_la_espera(monkeypatch):
    import time
    from agents._shared import model_fallback as MF
    monkeypatch.setenv("GEMINI_CALL_DEADLINE_S", "5")
    assert MF._next_wait(time.monotonic(), 10) is None
    assert MF._next_wait(time.monotonic(), 1) is not None


def test_thinking_level_por_env(monkeypatch):
    from agents._shared import models as M
    assert M.thinking_level_for("report_writer_agent", "high") == "high"
    monkeypatch.setenv("THINKING_REPORT_WRITER", "medium")
    assert M.thinking_level_for("report_writer_agent", "high") == "medium"
    monkeypatch.setenv("THINKING_REPORT_WRITER", "none")
    assert M.thinking_level_for("report_writer_agent", "high") is None
    monkeypatch.setenv("THINKING_REPORT_WRITER", "ultra")
    assert M.thinking_level_for("report_writer_agent", "high") == "high"
    assert M.is_gemini_3("gemini-3.6-flash") and not M.is_gemini_3("gemini-2.5-flash")
