"""Tests de `agents/_shared/schemas.py`: ejemplos válidos e inválidos, tolerancia por ítem,
campos recalculados en código y compatibilidad con `response_schema` de Gemini."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from agents._shared import schemas as S

EV = {"url": "https://ejemplo.invalid/fuente", "cita": "fragmento literal"}
EV_DOC = {"documento": "a" * 64, "pagina": 7, "cita": "texto literal de la página 7"}


# ── Evidencia / Hallazgo ────────────────────────────────────────────────────
def test_evidencia_valida_y_cita_tope():
    e = S.Evidencia(**EV_DOC)
    assert e.pagina == 7 and e.documento
    S.Evidencia(cita="x" * S.CITA_MAX)  # justo en el tope
    with pytest.raises(ValidationError):
        S.Evidencia(cita="x" * (S.CITA_MAX + 1))
    with pytest.raises(ValidationError):
        S.Evidencia(cita="")
    with pytest.raises(ValidationError):
        S.Evidencia(cita="ok", pagina=0)


def test_hallado_sin_evidencia_es_invalido():
    assert S.Hallazgo(estado="hallado", evidencia=[EV]).estado == "hallado"
    assert S.Hallazgo(estado="sin_dato").evidencia == []
    assert S.Hallazgo(estado="no_verificable").evidencia == []
    with pytest.raises(ValidationError):
        S.Hallazgo(estado="hallado")
    with pytest.raises(ValidationError):
        S.Hallazgo(estado="encontrado")  # fuera del vocabulario


# ── Tolerancia por ítem: la bandera inválida se descarta, la salida sobrevive ──
def test_legal_output_descarta_flag_sin_evidencia_y_registra():
    lo = S.LegalOutput.model_validate({
        "estado": "hallado",
        "red_flags_documentales": [
            {"estado": "hallado", "vector": "marca_unica", "descripcion": "exige una marca sin equivalencia",
             "severidad": "alta", "norma_citada": "Art. 2 TUO Ley 30225 — Libertad de concurrencia",
             "articulo": "2", "item_afectado": "1", "evidencia": [EV_DOC]},
            {"estado": "hallado", "descripcion": "sin respaldo", "norma_citada": "Art. 2"},
            {"estado": "hallado", "descripcion": "vector desconocido", "norma_citada": "Art. 2",
             "vector": "inventado", "evidencia": [EV_DOC]},
        ],
    })
    assert [rf.vector for rf in lo.red_flags_documentales] == ["marca_unica"]
    assert len(lo.descartes()) == 2
    assert lo.descartes()[0]["donde"].startswith("schema.red_flags_documentales[1]")
    assert lo.descartes_schema and "evidencia" in lo.descartes_schema[0]
    # La salida "hallado" hereda la evidencia de sus banderas.
    assert lo.evidencia and lo.evidencia[0].pagina == 7


def test_legal_output_hallado_sin_ninguna_evidencia_se_degrada():
    # La raíz nunca se pierde: sin evidencia propia ni derivada pasa a no_verificable y queda anotado.
    o = S.LegalOutput.model_validate({"estado": "hallado", "red_flags_documentales": []})
    assert o.estado == "no_verificable" and o.descartes()[0]["motivo"] == "raiz_sin_evidencia"
    # Un ítem (no raíz) sí es inválido sin evidencia.
    with pytest.raises(ValidationError):
        S.Evidencia.model_validate({"cita": ""})
    ok = S.LegalOutput.model_validate({"estado": "sin_dato", "resumen_ejecutivo": "sin documento parseado"})
    assert ok.red_flags_documentales == [] and ok.descartes() == []


def test_validar_o_descartar_no_levanta():
    descartes: list = []
    obj0 = S.validar_o_descartar(S.LegalOutput, {"estado": "hallado"}, donde="legal", descartes=descartes)
    assert obj0 is not None and obj0.estado == "no_verificable"
    assert descartes and descartes[0]["motivo"] == "raiz_sin_evidencia"
    # estado desconocido en la raíz se normaliza (no se pierde la salida); un tipo imposible sí invalida.
    obj1 = S.validar_o_descartar(S.LegalOutput, {"estado": "inventado"}, donde="legal", descartes=descartes)
    assert obj1 is not None and obj1.estado == "no_verificable" and descartes[-1]["motivo"] == "estado_normalizado"
    assert S.validar_o_descartar(S.LegalOutput, {"estado": "sin_dato", "resumen_ejecutivo": ["no", "es", "texto"]}, donde="legal", descartes=descartes) is None
    assert descartes[-1]["motivo"] == "schema_invalido"
    obj = S.validar_o_descartar(S.NewsOutput, {"estado": "sin_dato", "noticias": [{"estado": "hallado", "fuente": "x", "titulo": "t"}]},
                                donde="news", descartes=descartes)
    assert obj is not None and obj.noticias == []
    assert descartes[-1]["donde"] == "news.schema.noticias[0]"


# ── Mercado: sin URL real no hay "hallado"; el ítem no se pierde ────────────
def test_market_finding_sin_url_se_degrada_a_no_verificable():
    f = S.MarketFinding.model_validate({
        "estado": "hallado", "item_numero": "1", "item_descripcion": "cortina blackout",
        "precios_observados": [{"producto": "cortina", "precio": 39.9}],
    })
    assert f.estado == "no_verificable" and f.evidencia == []
    g = S.MarketFinding.model_validate({
        "estado": "hallado", "item_numero": "1", "item_descripcion": "cortina blackout",
        "precios_observados": [{"producto": "cortina", "precio": 39.9, "url": "https://g/1"}],
    })
    assert g.estado == "hallado" and g.evidencia[0].url == "https://g/1"
    with pytest.raises(ValidationError):
        S.PrecioObservado(producto="p", precio=0)


def test_market_output_no_tiene_campos_calculados():
    campos = set(S.MarketFinding.model_fields)
    assert not campos & {"precio_mediana_mercado", "diff_pct", "veredicto", "rango_min", "rango_max"}


# ── Recalculados en código ──────────────────────────────────────────────────
def test_news_recalcula_conteos_y_sin_menciones():
    nw = S.NewsOutput.model_validate({
        "estado": "hallado",
        "noticias": [
            {"estado": "hallado", "fuente": "Medio", "titulo": "T1", "url": "https://m/1", "severidad": "alta"},
            {"estado": "hallado", "fuente": "Medio", "titulo": "T2", "url": "https://m/2", "severidad": "info"},
            {"estado": "hallado", "fuente": "Medio", "titulo": "sin url"},   # descartada
        ],
        "noticias_por_severidad": {"alta": 99, "media": 99},
        "n_noticias_totales": 42,
        "sin_menciones_relevantes": True,
    })
    assert nw.noticias_por_severidad.model_dump() == {"alta": 1, "media": 0, "baja": 0, "info": 1}
    assert nw.n_noticias_totales == 2 and nw.sin_menciones_relevantes is False
    assert len(nw.descartes()) == 1
    vacio = S.NewsOutput.model_validate({"estado": "sin_dato", "sin_menciones_relevantes": False})
    assert vacio.sin_menciones_relevantes is True


def test_web_research_recalcula_historial():
    w = S.WebResearchOutput.model_validate({
        "estado": "hallado",
        "empresa": {"ruc": "20000000001", "razon_social": "<razón social>"},
        "otros_contratos_con_estado": [
            {"estado": "hallado", "entidad": "Entidad B", "fecha": "2025-03", "evidencia": [EV]},
            {"estado": "hallado", "entidad": "Entidad A", "fecha": "2024-11", "evidencia": [EV]},
        ],
        "historial_resumido": {"n_contratos_estado_hallados": 77},
    })
    h = w.historial_resumido
    assert (h.n_contratos_estado_hallados, h.primer_contrato, h.ultimo_contrato) == (2, "2024-11", "2025-03")
    assert h.entidades_unicas == ["Entidad A", "Entidad B"]
    with pytest.raises(ValidationError):
        S.EmpresaPerfil(ruc="123")


def test_entity_personnel_recalcula_n_y_sin_data():
    ep = S.EntityPersonnelOutput.model_validate({
        "estado": "hallado", "n_funcionarios": 9, "sin_data_publica": True,
        "funcionarios_designados": [
            {"estado": "hallado", "nombre_completo": "<nombre>", "cargo": "GERENTE MUNICIPAL", "fuente_url": "https://gob/x"},
            {"estado": "hallado", "nombre_completo": "<nombre 2>", "cargo": "PROCURADOR"},   # sin fuente → descartado
        ],
    })
    assert ep.n_funcionarios == 1 and ep.sin_data_publica is False
    assert ep.funcionarios_designados[0].evidencia[0].url == "https://gob/x"


# ── Red de personas ─────────────────────────────────────────────────────────
def test_person_network_apellido_solo_no_es_bandera():
    pn = S.PersonNetworkOutput.model_validate({
        "estado": "sin_dato",
        "cruce_firmantes_ganador": [
            {"estado": "hallado", "firmante": "<firmante>", "persona_proveedor": "<gerente>",
             "tipo_relacion": "apellido_compartido", "confianza_match": "alta", "severidad": "alta",
             "evidencia": [EV]},
            {"estado": "hallado", "firmante": "<firmante 2>", "tipo_relacion": "codireccion_empresa",
             "confianza_match": "alta", "severidad": "alta", "fuente_url": "https://sunarp/x", "evidencia": [EV]},
            {"estado": "hallado", "firmante": "<firmante 3>", "tipo_relacion": "misma_direccion"},   # sin evidencia
        ],
        "banderas_red": [
            {"estado": "hallado", "titulo": "t", "descripcion": "d", "evidencia": [EV]},
        ],
    })
    a, b = pn.cruce_firmantes_ganador
    assert (a.confianza_match, a.severidad) == ("baja", "baja")
    assert (b.confianza_match, b.severidad) == ("alta", "alta")
    assert len(pn.descartes()) == 1
    assert pn.banderas_red[0].fuentes == [EV["url"]]


def test_person_network_hallado_deriva_evidencia_de_partes():
    pn = S.PersonNetworkOutput.model_validate({
        "estado": "hallado",
        "persona_principal": {"estado": "hallado", "nombre_completo": "<nombre>",
                              "cargos_pasados": [{"cargo": "Subgerente", "entidad": "<entidad>", "fuente_url": "https://e/1"}]},
    })
    assert pn.evidencia and pn.evidencia[0].url == "https://e/1"
    with pytest.raises(ValidationError):
        S.PersonaPrincipal(estado="hallado", dni="1234")


# ── Compatibilidad con Gemini `response_schema` ─────────────────────────────
@pytest.mark.parametrize("modelo", list(S.OUTPUT_SCHEMAS.values()))
def test_schemas_son_planos_para_gemini(modelo):
    """Sin dict libres ni Any: el JSON schema no puede tener `additionalProperties` abiertos ni
    `anyOf` con más de un tipo no-null."""
    js = modelo.model_json_schema()
    defs = js.get("$defs", {})

    def _walk(node):
        if isinstance(node, dict):
            assert node.get("additionalProperties") in (None, False), node
            if "anyOf" in node:
                tipos = [a.get("type") or ("$ref" if "$ref" in a else a) for a in node["anyOf"]]
                no_null = [t for t in tipos if t != "null"]
                assert len(no_null) <= 1, node
            for v in node.values():
                _walk(v)
        elif isinstance(node, list):
            for v in node:
                _walk(v)

    _walk(js)
    _walk(defs)


def test_schemas_convierten_a_schema_de_gemini():
    """La conversión pydantic → types.Schema del SDK no debe rechazar ningún keyword."""
    from google.genai import _transformers as t
    from google.genai import types

    for modelo in S.OUTPUT_SCHEMAS.values():
        sch = t.t_schema(None, modelo)
        assert isinstance(sch, types.Schema) and sch.properties, modelo.__name__


def test_output_schemas_cubren_los_seis_agentes():
    assert set(S.OUTPUT_SCHEMAS) == {"document_legal_analyst", "market", "web_research",
                                     "news_research", "entity_personnel", "person_network"}
    for m in S.OUTPUT_SCHEMAS.values():
        assert "estado" in m.model_fields or m is S.MarketOutput
