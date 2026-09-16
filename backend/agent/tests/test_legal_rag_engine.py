"""Backend `rag_engine` de tools/legal.py (Frente R, plan 2026-09-16) — con mocks, sin red.

Cubre: elección de corpus por régimen (norma_aplicable por fecha de convocatoria), enriquecimiento
de chunks con el catálogo (artículo desde la ruta gs://…/art-0050.txt, url_oficial, cita_formato),
claves legacy para `_elegir_opinion_pertinente`, publicación de url_oficial en
state['grounding_urls'] y la cascada rag_engine → vertex → pgvector.
"""
from __future__ import annotations

import importlib

import pytest

import tools.legal as L

CAT = {
    "gs://vigia-peru-rag/normas-vigentes/ley-32069/art-0050.txt": {
        "slug": "ley-32069", "documento": "Ley N° 32069, Ley General de Contrataciones Públicas",
        "numero": "Ley N° 32069", "tipo": "norma", "regimen": "32069", "articulo": "50", "pagina": 27,
        "url_oficial": "https://www.gob.pe/institucion/oece/informes-publicaciones/6444155-ley-n-32069",
    },
    "gs://vigia-peru-rag/criterios-vinculantes/opiniones/415.txt": {
        "slug": "opinion-415", "documento": "Opinión N° 014-2019/DTN (2019, Ley 30225)", "numero": "Opinión N° 014-2019",
        "num_opinion": "014-2019", "ano": 2019, "norma": "Ley 30225", "articulo_ley": "20", "articulo": "20",
        "tipo": "opinion", "regimen": "30225",
        "url_oficial": "https://www.gob.pe/institucion/osce/informes-publicaciones/opinion-014-2019",
    },
}

CTX_NORMA = {"sourceUri": "gs://vigia-peru-rag/normas-vigentes/ley-32069/art-0050.txt",
             "text": "Ley N° 32069 — Ley N° 32069\nArtículo 50 — Supuestos de fraccionamiento\n[página 27]\n\n"
                     "Artículo 50. Supuestos de fraccionamiento 50.1 La entidad contratante no fracciona…",
             "score": 0.19}  # RAG Engine devuelve DISTANCIA (menor = mejor)
CTX_OPINION = {"sourceUri": "gs://vigia-peru-rag/criterios-vinculantes/opiniones/415.txt",
               "text": "Opinión N° 014-2019 (2019) — Ley 30225 — Art. 20 de la Ley\n\nEl fraccionamiento se configura cuando…",
               "score": 0.66}
CTX_SIN_CATALOGO = {"sourceUri": "gs://vigia-peru-rag/normas-historicas/tuo-ley-30225-ds-082-2019-ef/art-0020.txt",
                    "text": "TUO de la Ley N° 30225 — D.S. N° 082-2019-EF\nArtículo 20 — Prohibición de fraccionamiento\n[página 5]\n\nArtículo 20. …",
                    "score": 0.3}


class _Ctx:
    def __init__(self, state=None):
        self.state = state if state is not None else {}


@pytest.fixture(autouse=True)
def _sin_cache():
    L._RAG_QUERY_CACHE.clear()
    yield
    L._RAG_QUERY_CACHE.clear()


@pytest.fixture
def rag_env(monkeypatch):
    monkeypatch.setenv("RAG_CORPUS_NORMAS_VIGENTES", "projects/p/locations/us-central1/ragCorpora/1")
    monkeypatch.setenv("RAG_CORPUS_NORMAS_HISTORICAS", "projects/p/locations/us-central1/ragCorpora/2")
    monkeypatch.setenv("RAG_CORPUS_CRITERIOS", "projects/p/locations/us-central1/ragCorpora/3")
    monkeypatch.setenv("RAG_CORPUS_CONTROL", "projects/p/locations/us-central1/ragCorpora/4")
    monkeypatch.setattr(L, "LEGAL_RAG_BACKEND", "rag_engine")
    monkeypatch.setattr(L, "_rag_catalogo", lambda: CAT)
    llamadas = []

    def fake_retrieve(question, corpus_resource, top_k):
        llamadas.append(corpus_resource)
        if corpus_resource.endswith("/1"):
            return [CTX_NORMA]
        if corpus_resource.endswith("/2"):
            return [CTX_SIN_CATALOGO]
        if corpus_resource.endswith("/3"):
            return [CTX_OPINION]
        return []

    monkeypatch.setattr(L, "_rag_retrieve", fake_retrieve)
    return llamadas


def test_corpus_por_regimen():
    assert L._rag_corpus_por_regimen("ley_32069") == ["normas-vigentes", "criterios-vinculantes"]
    assert L._rag_corpus_por_regimen("32069") == ["normas-vigentes", "criterios-vinculantes"]
    assert L._rag_corpus_por_regimen("tuo_30225") == ["normas-historicas", "criterios-vinculantes"]
    assert L._rag_corpus_por_regimen("") == ["normas-vigentes", "normas-historicas", "criterios-vinculantes"]


def test_regimen_desde_state_por_fecha_convocatoria():
    ctx_hist = _Ctx({"ocds": {"tender": {"tenderPeriod": {"startDate": "2024-11-30T00:00:00Z"}}}})
    ctx_vig = _Ctx({"ocds": {"tender": {"datePublished": "2026-02-01"}}})
    assert L._rag_regimen_state(ctx_hist) == "tuo_30225"
    assert L._rag_regimen_state(ctx_vig) == "ley_32069"
    assert L._rag_regimen_state(None) == "ley_32069"


def test_enriquecer_norma_con_catalogo():
    m = L._rag_enriquecer(CTX_NORMA, "normas-vigentes", CAT)
    assert m["corpus"] == "normas-vigentes"
    assert m["articulo"] == "50" and m["pagina"] == 27
    assert m["documento"].startswith("Ley N° 32069")
    assert m["url_oficial"].startswith("https://www.gob.pe/institucion/oece/")
    assert m["cita_formato"].startswith("Art. 50 de Ley N° 32069") and m["url_oficial"] in m["cita_formato"]
    assert m["score"] == 0.81 and m["distancia"] == 0.19  # similitud = 1 − distancia
    assert m["cita"].startswith("Ley N° 32069")
    # claves legacy que espera compliance_rules._elegir_opinion_pertinente
    assert m["interpretacion_snippet"] and m["link"] == m["url_oficial"] and m["art_ley"] == "50"


def test_enriquecer_sin_catalogo_deduce_articulo_y_pagina():
    m = L._rag_enriquecer(CTX_SIN_CATALOGO, "normas-historicas", {})
    assert m["articulo"] == "20" and m["pagina"] == 5
    assert m["documento"] == "art-0020.txt"  # sin catálogo: nombre de archivo (no se inventa nada)
    assert m["url_oficial"] == "" and "(" not in m["cita_formato"]


def test_enriquecer_opinion_conserva_num_opinion():
    m = L._rag_enriquecer(CTX_OPINION, "criterios-vinculantes", CAT)
    assert m["num_opinion"] == "014-2019" and m["norma"] == "Ley 30225" and m["art_ley"] == "20"
    assert m["tipo"] == "opinion" and m["cita_formato"].startswith("Opinión N° 014-2019 (https://")


def test_query_legal_rag_engine_consulta_normas_y_criterios(rag_env):
    res = L.query_legal_rag_engine("fraccionamiento de contrataciones", regimen="ley_32069")
    assert res["_source"] == "rag_engine" and not res.get("error")
    assert res["corpus"] == ["normas-vigentes", "criterios-vinculantes"]
    assert [c.rsplit("/", 1)[-1] for c in rag_env] == ["1", "3"]
    assert res["n_matches"] == 2
    # ordenados por score descendente
    assert [m["corpus"] for m in res["matches"]] == ["normas-vigentes", "criterios-vinculantes"]


def test_query_legal_rag_engine_control_opcional(rag_env):
    res = L.query_legal_rag_engine("matriz condición criterio causa efecto", regimen="", incluir_control=True)
    assert res["corpus"][-1] == "control-cgr"
    assert set(res["por_corpus"]) == {"normas-vigentes", "normas-historicas", "criterios-vinculantes", "control-cgr"}


def test_query_legal_rag_elige_corpus_historico_y_publica_grounding(rag_env):
    ctx = _Ctx({"ocds": {"tender": {"tenderPeriod": {"startDate": "2023-05-10"}}}, "grounding_urls": ["https://x.gob.pe/a"]})
    res = L.query_legal_rag("prohibición de fraccionamiento", ctx)
    assert res["_source"] == "rag_engine"
    assert res["corpus"] == ["normas-historicas", "criterios-vinculantes"]
    assert [c.rsplit("/", 1)[-1] for c in rag_env] == ["2", "3"]
    # la url_oficial de la opinión (catálogo) queda como URL respaldada para verify.py
    assert CAT["gs://vigia-peru-rag/criterios-vinculantes/opiniones/415.txt"]["url_oficial"] in ctx.state["grounding_urls"]
    assert ctx.state["grounding_urls"][0] == "https://x.gob.pe/a"  # no pisa lo que ya había


def test_query_legal_rag_regimen_explicito_gana_al_state(rag_env):
    ctx = _Ctx({"ocds": {"tender": {"datePublished": "2026-01-01"}}})
    res = L.query_legal_rag("impedimentos", ctx, regimen="30225")
    assert res["corpus"][0] == "normas-historicas"


def test_cascada_rag_engine_a_vertex_a_pgvector(monkeypatch, rag_env):
    monkeypatch.setattr(L, "_rag_retrieve", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("HTTP 503")))
    monkeypatch.setattr(L, "query_legal_rag_vertex", lambda q, top_k=5: {"error": "vertex search HTTP 500"})
    monkeypatch.setattr(L, "_query_legal_rag_pgvector",
                        lambda q, tc=None: {"question": q, "n_matches": 1, "matches": [{"num_opinion": "1-2024"}], "_source": "pgvector"})
    res = L.query_legal_rag("adenda mayor al 25%", _Ctx())
    assert res["_source"] == "pgvector"
    assert any("rag_engine" in f for f in res["_fallback_desde"])
    assert any("vertex" in f for f in res["_fallback_desde"])


def test_cascada_rag_engine_sin_resultados_usa_vertex(monkeypatch, rag_env):
    monkeypatch.setattr(L, "_rag_retrieve", lambda *a, **k: [])
    monkeypatch.setattr(L, "query_legal_rag_vertex",
                        lambda q, top_k=5: {"question": q, "n_matches": 1, "matches": [{"num_opinion": "2-2024"}], "_source": "vertex_ai_search"})
    res = L.query_legal_rag("único postor", _Ctx())
    assert res["_source"] == "vertex_ai_search" and res["_fallback_desde"] == ["rag_engine_sin_resultados"]


def test_sin_env_rag_engine_no_configurado(monkeypatch):
    for k in ("RAG_CORPUS_NORMAS_VIGENTES", "RAG_CORPUS_NORMAS_HISTORICAS", "RAG_CORPUS_CRITERIOS", "RAG_CORPUS_CONTROL"):
        monkeypatch.delenv(k, raising=False)
    assert L.rag_engine_configurado() is False
    monkeypatch.setattr(L, "LEGAL_RAG_BACKEND", "rag_engine")
    monkeypatch.setattr(L, "query_legal_rag_vertex",
                        lambda q, top_k=5: {"question": q, "n_matches": 1, "matches": [{}], "_source": "vertex_ai_search"})
    # sin corpus configurados, va directo a vertex sin marcar fallback de rag_engine
    res = L.query_legal_rag("garantías", _Ctx())
    assert res["_source"] == "vertex_ai_search" and "_fallback_desde" not in res


def test_elegir_opinion_pertinente_acepta_chunk_rag_engine():
    cr = importlib.import_module("tools.compliance_rules")
    h = {"titulo": "Fraccionamiento de contrataciones", "descripcion": "contrataciones del mismo objeto fraccionadas en el año"}
    m = L._rag_enriquecer(CTX_OPINION, "criterios-vinculantes", CAT)
    op, motivo = cr._elegir_opinion_pertinente(h, [m], "bienes", cr.norma_aplicable("2024-01-01"))
    assert op is None or op["num_opinion"] == "014-2019"
    # con score bajo el umbral se descarta con motivo explícito (el score de RAG Engine es similitud)
    op2, motivo2 = cr._elegir_opinion_pertinente(h, [{**m, "score": 0.2}], "bienes", cr.norma_aplicable(None))
    assert op2 is None and "score" in (motivo2 or "")


def test_cache_por_proceso_evita_segunda_llamada(rag_env):
    L.query_legal_rag_engine("garantía de fiel cumplimiento", regimen="32069")
    n = len(rag_env)
    res = L.query_legal_rag_engine("garantía de fiel cumplimiento", regimen="32069")
    assert len(rag_env) == n and res["n_matches"] == 2
