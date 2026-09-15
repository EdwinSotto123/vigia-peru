"""Tests de `backend/core/clasificacion.py` contra releases/records REALES del OECE.

Las fixtures salen de `convocatorias.ocds_payload` (release recortado que guarda la
ingesta `oece_ocds`) y de `GET /api/v1/record/<ocid>` (compiledRelease completo). La única
sintética es `release_planning_only.json` (ver su `_fixture`): SEACE no publica releases
solo-planning, pero la etapa existe en el vocabulario y hay que cubrirla.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.core.clasificacion import (
    AGENTES, ETAPAS, MATRIZ, TIPOS, Clasificacion, clasificar, derivar_etapa, derivar_tipo,
)

FIXTURES = Path(__file__).parent / "fixtures"
TODOS = list(AGENTES)
SIN_MARKET = [a for a in AGENTES if a != "market"]


def load(name: str) -> tuple[dict, str | None]:
    rel = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    return rel, (rel.get("_fixture") or {}).get("entidad_ruc")


def clas(name: str, **kw) -> Clasificacion:
    rel, ruc = load(name)
    return clasificar(rel, entidad_ruc_hint=ruc, **kw)


# ── Esperados explícitos por fixture ────────────────────────────────────────
ESPERADOS = {
    # fixture                              tipo          etapa           procesable  agentes
    "release_goods_convocada_lpa.json":   ("bienes",      "convocada",    True,  ["compliance", "document_parser", "document_legal_analyst", "market", "entity_personnel", "report_writer"]),
    "release_goods_convocada_sie.json":   ("bienes",      "convocada",    True,  ["compliance", "document_parser", "document_legal_analyst", "market", "entity_personnel", "report_writer"]),
    "release_goods_contratada.json":      ("bienes",      "contratada",   True,  TODOS),
    "record_goods_contratada.json":       ("bienes",      "contratada",   True,  TODOS),
    "release_services_adjudicada.json":   ("servicios",   "adjudicada",   True,  SIN_MARKET),
    "record_services_adjudicada.json":    ("servicios",   "adjudicada",   True,  SIN_MARKET),
    "release_works_contratada.json":      ("obras",       "contratada",   True,  SIN_MARKET),
    "release_consultoria_convocada.json": ("consultoria", "convocada",    True,  ["compliance", "document_parser", "document_legal_analyst", "entity_personnel", "report_writer"]),
    "release_convenio_adjudicada.json":   ("convenio",    "adjudicada",   True,  ["compliance", "document_parser", "document_legal_analyst", "web_research", "news_research", "person_network", "report_writer"]),
    "release_goods_directa.json":         ("directa",     "adjudicada",   True,  ["compliance", "document_parser", "document_legal_analyst", "web_research", "news_research", "person_network", "report_writer"]),
    "release_planning_only.json":         ("bienes",      "planificacion", False, []),
    "release_goods_desierta.json":        ("bienes",      "desierta",     True,  ["compliance", "report_writer"]),
    "release_services_nula.json":         ("servicios",   "nula",         True,  ["compliance", "report_writer"]),
    "release_works_cancelada.json":       ("obras",       "cancelada",    True,  ["compliance", "report_writer"]),
    "release_services_en_ejecucion.json": ("servicios",   "en_ejecucion", True,  SIN_MARKET),
}


@pytest.mark.parametrize("name", sorted(ESPERADOS))
def test_fixture_real(name):
    tipo, etapa, procesable, agentes = ESPERADOS[name]
    c = clas(name)
    assert (c.tipo, c.etapa, c.procesable) == (tipo, etapa, procesable), c
    assert c.agentes == agentes, c
    assert c.tipo in TIPOS and c.etapa in ETAPAS
    assert set(c.agentes) <= set(AGENTES)


def test_fixtures_cubren_las_ocho_del_plan():
    """C1 pide: 2 goods convocada, 1 goods contratada, 1 services adjudicada, 1 works
    contratada, 1 consultoría, 1 convenio, 1 solo planning."""
    combos = [(v[0], v[1]) for v in ESPERADOS.values()]
    assert combos.count(("bienes", "convocada")) >= 2
    for c in [("bienes", "contratada"), ("servicios", "adjudicada"), ("obras", "contratada"),
              ("consultoria", "convocada"), ("convenio", "adjudicada"), ("bienes", "planificacion")]:
        assert c in combos


# ── Detalles por fixture ────────────────────────────────────────────────────
def test_record_completo_trae_proveedor_ruc():
    assert clas("record_goods_contratada.json").proveedor_ruc == "20508320664"
    assert clas("record_services_adjudicada.json").proveedor_ruc == "20541660870"
    assert clas("release_goods_directa.json").proveedor_ruc == "20574739161"   # compiled con awards


def test_release_recortado_no_conoce_proveedor_pero_no_omite_agentes():
    """Sin `awards` en el release, el RUC del proveedor lo resuelve el orquestador al traer
    el record: NO se omiten web/news/person a ciegas."""
    c = clas("release_goods_contratada.json")
    assert c.proveedor_ruc is None
    assert "web_research" in c.agentes and "person_network" in c.agentes
    assert "proveedor_sin_ruc" not in c.validaciones_pendientes


def test_obras_contratada_marca_infobras_pendiente():
    c = clas("release_works_contratada.json")
    assert c.validaciones_pendientes == ["infobras_avance"]
    assert c.procesable and "document_parser" in c.agentes


def test_modalidad_se_guarda_tal_cual():
    assert clas("release_goods_convocada_sie.json").modalidad == "Subasta Inversa Electrónica"
    assert clas("release_convenio_adjudicada.json").modalidad == "Convenio"


def test_planificacion_no_es_procesable():
    c = clas("release_planning_only.json")
    assert c.procesable is False and c.motivo_no_procesable == "etapa_planificacion"
    assert c.agentes == [] and c.validaciones_pendientes == []


def test_negativas_solo_compliance_y_dictamen_breve():
    for name in ("release_goods_desierta.json", "release_services_nula.json", "release_works_cancelada.json"):
        c = clas(name)
        assert c.procesable and c.agentes == ["compliance", "report_writer"], name


def test_marca_nulo_local_gana():
    c = clas("release_goods_contratada.json", nulo=True)
    assert c.etapa == "nula" and c.agentes == ["compliance", "report_writer"]


# ── Reglas de derivación (casos sintéticos mínimos) ─────────────────────────
def _rel(cat="goods", mod="Licitación Pública Abreviada", tag=("planning", "tender"), items=("CONVOCADO",), **extra):
    rel = {"ocid": "ocds-dgv273-seacev3-1", "tag": list(tag),
           "tender": {"id": "1", "mainProcurementCategory": cat, "procurementMethodDetails": mod,
                      "items": [{"id": str(i), "statusDetails": s, "quantity": 1, "unit": {"name": "Unidad"}} for i, s in enumerate(items)],
                      "documents": [{"documentType": "biddingDocuments", "url": "https://x/bases.zip"}]}}
    rel.update(extra)
    return rel


def test_tipo_por_modalidad_manda_sobre_categoria():
    assert derivar_tipo(_rel("services", "Concurso Público para Consultoría")) == "consultoria"
    assert derivar_tipo(_rel("works", "Licitación Pública", ) | {"tender": {"mainProcurementCategory": "works", "procurementMethodDetails": "Licitación Pública", "title": "Consultoría de obra: supervisión"}}) == "consultoria"
    assert derivar_tipo(_rel("goods", "Regímen Especial")) == "convenio"
    assert derivar_tipo(_rel("services", "Contratación Internacional")) == "convenio"
    assert derivar_tipo(_rel("goods", "Contratación Directa")) == "directa"
    assert derivar_tipo(_rel("works", "Procedimiento Especial de Contratación")) == "obras"
    assert derivar_tipo(_rel(None, None)) == "otro"


def test_tipo_otro_no_es_procesable():
    c = clasificar(_rel(None, None))
    assert c.tipo == "otro" and c.procesable is False and c.motivo_no_procesable == "tipo_no_soportado"


def test_etapa_por_items_cuando_el_tag_no_alcanza():
    assert derivar_etapa(_rel(items=("DESIERTO",))) == "desierta"
    assert derivar_etapa(_rel(items=("NULO", "DESIERTO"))) == "nula"
    assert derivar_etapa(_rel(items=("CANCELADO",))) == "cancelada"
    assert derivar_etapa(_rel(items=("APELADO",))) == "adjudicada"
    assert derivar_etapa(_rel(items=("CONTRATADO", "DESIERTO"))) == "contratada"    # parcial: manda lo más avanzado
    assert derivar_etapa(_rel(items=("SUSPENDIDO",))) == "convocada"


def test_etapa_por_objetos_del_record():
    assert derivar_etapa(_rel(tag=("compiled",), contracts=[{"status": "terminated"}])) == "finalizada"
    assert derivar_etapa(_rel(tag=("compiled",), contracts=[{"implementation": {"transactions": [{"id": 1}]}}])) == "en_ejecucion"
    assert derivar_etapa(_rel(tag=("compiled",), contracts=[{"id": "c1"}])) == "contratada"
    assert derivar_etapa(_rel(tag=("compiled",), awards=[{"status": "active"}])) == "adjudicada"
    assert derivar_etapa(_rel(tag=("compiled",), awards=[{"status": "unsuccessful"}])) == "desierta"
    assert derivar_etapa(_rel(tag=("compiled",), tender={"status": "cancelled", "items": []}) | {"tender": {"status": "cancelled"}}) == "cancelada"


def test_etapa_desconocida_sin_datos():
    c = clasificar({"ocid": "x", "tender": {"mainProcurementCategory": "goods"}})
    assert c.etapa == "desconocida" and c.procesable is False and c.motivo_no_procesable == "etapa_desconocida"
    assert clasificar({}).tipo == "otro"


def test_market_se_omite_sin_items_fisicos():
    rel = _rel()
    rel["tender"]["items"] = [{"id": "1", "statusDetails": "CONVOCADO", "quantity": 0, "unit": {"name": "Unidad"}}]
    c = clasificar(rel, entidad_ruc_hint="20100000001")
    assert "market" not in c.agentes and c.validaciones_pendientes == ["market_sin_items_fisicos"]


def test_parser_y_legal_se_omiten_sin_documentos_clave():
    rel = _rel()
    rel["tender"]["documents"] = [{"documentType": "clarifications", "url": "https://x/a.pdf"}]
    c = clasificar(rel, entidad_ruc_hint="20100000001")
    assert "document_parser" not in c.agentes and "document_legal_analyst" not in c.agentes
    assert c.validaciones_pendientes == ["sin_documentos_descargables"]
    assert c.procesable  # compliance + market + entidad + dictamen siguen


def test_proveedor_sin_ruc_solo_con_record_completo():
    rel = _rel(tag=("compiled",), awards=[{"status": "active", "suppliers": [{"id": "PE-CONSUCODE-9", "name": "X"}]}])
    c = clasificar(rel, entidad_ruc_hint="20100000001")
    assert c.etapa == "adjudicada" and c.proveedor_ruc is None
    for a in ("web_research", "news_research", "person_network", "compliance_extended"):
        assert a not in c.agentes
    assert "proveedor_sin_ruc" in c.validaciones_pendientes


def test_entidad_sin_ruc_omite_entity_personnel():
    c = clasificar(_rel())
    assert "entity_personnel" not in c.agentes and "entidad_sin_ruc" in c.validaciones_pendientes
    c2 = clasificar(_rel(), entidad_ruc_hint="20100000001")
    assert "entity_personnel" in c2.agentes


def test_entidad_ruc_desde_parties():
    rel = _rel(parties=[{"roles": ["buyer"], "identifier": {"scheme": "PE-CONSUCODE", "id": "5"},
                         "additionalIdentifiers": [{"scheme": "PE-RUC", "id": "20131369124"}]}])
    assert "entity_personnel" in clasificar(rel).agentes


# ── Invariantes de la matriz ────────────────────────────────────────────────
def test_matriz_cubre_todo_tipo_x_etapa_soportado():
    for tipo in TIPOS:
        if tipo == "otro":
            continue
        for etapa in ETAPAS:
            if etapa == "desconocida":
                continue
            assert (tipo, etapa) in MATRIZ, (tipo, etapa)


def test_matriz_orden_canonico_y_compliance_siempre():
    for (tipo, etapa), ags in MATRIZ.items():
        assert ags == [a for a in AGENTES if a in ags], (tipo, etapa)   # orden del pipeline
        if etapa != "planificacion":
            assert "compliance" in ags and "report_writer" in ags, (tipo, etapa)
        if tipo != "bienes" and etapa not in ("contratada", "en_ejecucion", "finalizada"):
            assert "market" not in ags, (tipo, etapa)


def test_as_dict_serializable():
    d = clas("release_goods_contratada.json").as_dict()
    assert json.dumps(d) and set(d) == {"tipo", "etapa", "modalidad", "procesable", "motivo_no_procesable",
                                        "agentes", "validaciones_pendientes", "proveedor_ruc"}
