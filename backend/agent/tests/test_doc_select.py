"""Tests de la selección determinista de documentos (tools/doc_select.py).

Fixtures sintéticas: no tocan la BD (se inyecta `gcs_rows`) ni ningún LLM.
"""
from __future__ import annotations

import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_AGENT = os.path.dirname(_HERE)
if _AGENT not in sys.path:
    sys.path.insert(0, _AGENT)

from tools.doc_select import (  # noqa: E402
    seleccionar_documentos, rank_documento, categorias_de, norm_url, recorte_seleccion,
)

SEACE = "https://prod1.seace.gob.pe/SeaceWeb-PRO/SdescargarArchivoAlfresco?fileCode="
PRIO_BIENES = ("Bases integradas", "Bases", "EETT", "Acta/Cuadro comparativo", "Contrato/Orden",
               "Adendas", "Absolución")
PRIO_SERVICIOS = ("TDR", "Bases integradas", "Bases", "Acta/Cuadro comparativo", "Contrato/Orden", "Adendas")
PRIO_OBRAS = ("Expediente técnico", "Presupuesto", "Bases", "Contrato", "Adendas/adicionales", "Valorizaciones")
PRIO_OTROS = ("Informe técnico-legal", "Acto resolutivo", "Cotizaciones", "Contrato")


def _doc(id_, title, dtype, url, fmt="pdf"):
    return {"id": id_, "title": title, "documentType": dtype, "url": url, "format": fmt}


def _ocds(tender_docs=(), award_docs=(), contract_docs=()):
    return {
        "ocid": "ocds-dgv273-seacev3-1",
        "tender": {"documents": list(tender_docs)},
        "awards": [{"id": "a1", "documents": list(award_docs)}] if award_docs else [],
        "contracts": [{"id": "c1", "documents": list(contract_docs)}] if contract_docs else [],
    }


def _gcs(url_origen, sha, tipo="biddingDocuments", titulo="Bases Administrativas", seccion="tender",
         formato="pdf", gcs_id=1):
    return {"gcs_id": gcs_id, "tipo": tipo, "titulo": titulo, "seccion": seccion,
            "url_gcs": f"gs://vigia-peru-batch/batch/documentos/xx/1/{sha[:8]}.{formato}",
            "sha256": sha, "url_origen": url_origen, "formato": formato, "bytes": 1000}


# ── 1. Prioridad de bienes: Bases integradas > Bases > … y sin match al final ─────────
def test_prioridad_bienes_ordena_bases_integradas_primero():
    ocds = _ocds(tender_docs=[
        _doc("d1", "Pliego de Absolución de Consultas", "clarifications", SEACE + "abs"),
        _doc("d2", "Bases Administrativas", "biddingDocuments", SEACE + "bases"),
        _doc("d3", "Bases Integradas", "biddingDocuments", SEACE + "integradas"),
        _doc("d4", "Anexo fotográfico", "otro", SEACE + "fotos"),
    ])
    elegidos, omitidos = seleccionar_documentos("1", ocds, {}, PRIO_BIENES, 12, gcs_rows=[])
    assert [d["id"] for d in elegidos] == ["d3", "d2", "d1", "d4"]
    assert elegidos[0]["categoria"] == "bases_integradas"
    assert elegidos[3]["categoria"] is None       # sin match → al final, pero NO se pierde
    assert omitidos == []


# ── 2. Servicios: el TDR gana a las bases; títulos con tildes ─────────────────────────
def test_prioridad_servicios_tdr_con_tildes():
    ocds = _ocds(tender_docs=[
        _doc("d1", "Bases Administrativas", "biddingDocuments", SEACE + "b"),
        _doc("d2", "Términos de Referencia del Servicio", None, SEACE + "t"),
        _doc("d3", "Absolución de consultas y observaciones", "clarifications", SEACE + "a"),
    ])
    elegidos, _ = seleccionar_documentos("1", ocds, {}, PRIO_SERVICIOS, 12, gcs_rows=[])
    assert [d["id"] for d in elegidos][:2] == ["d2", "d1"]
    assert categorias_de("Términos de Referencia", None) == ["tdr"]
    assert categorias_de("ABSOLUCIÓN DE CONSULTAS", None) == ["absolucion"]


# ── 3. Obras: expediente técnico y presupuesto antes que bases; adicionales por documentType ──
def test_prioridad_obras_expediente_y_amendments():
    ocds = _ocds(
        tender_docs=[_doc("d1", "Bases Administrativas", "biddingDocuments", SEACE + "b"),
                     _doc("d2", "Expediente Técnico - Memoria descriptiva", "technicalSpecifications", SEACE + "e"),
                     _doc("d3", "Presupuesto de obra", None, SEACE + "p")],
        contract_docs=[_doc("c1", "Archivos del contrato", "contractSigned", SEACE + "c"),
                       _doc("c2", "Adicional de obra N° 1", "contractAmendment", SEACE + "ad")],
    )
    elegidos, _ = seleccionar_documentos("1", ocds, {}, PRIO_OBRAS, 12, gcs_rows=[])
    assert [d["id"] for d in elegidos] == ["d2", "d3", "d1", "c1", "c2"]
    assert elegidos[4]["seccion"] == "contract" and elegidos[4]["categoria"] == "adenda"


# ── 4. Tope max_docs: el resto va a omitidos con motivo tope_docs y hay recorte ────────
def test_tope_max_docs_registra_omitidos():
    docs = [_doc(f"d{i}", f"Anexo {i}", "biddingDocuments", SEACE + str(i)) for i in range(6)]
    docs.insert(0, _doc("bases", "Bases Integradas", "biddingDocuments", SEACE + "bi"))
    elegidos, omitidos = seleccionar_documentos("1", _ocds(tender_docs=docs), {}, PRIO_BIENES, 3, gcs_rows=[])
    assert len(elegidos) == 3 and elegidos[0]["id"] == "bases"
    assert len(omitidos) == 4 and all(o["motivo"] == "tope_docs" for o in omitidos)
    rec = recorte_seleccion(elegidos, omitidos, 3)
    assert rec["donde"] == "seleccion_documentos" and rec["limite"] == "parse_max_docs=3"
    assert len(rec["omitido"]) == 4


# ── 5. documentos_gcs aporta gs + sha256 y se casa con el record por URL normalizada ──
def test_gcs_rows_aportan_gs_y_sha_por_url_normalizada():
    ocds = _ocds(tender_docs=[_doc("d1", "Bases Administrativas", "biddingDocuments", SEACE + "ABC-1", "zip")])
    rows = [_gcs(SEACE + "abc-1", "sha_bases", formato="zip")]          # misma URL, otra caja
    elegidos, _ = seleccionar_documentos("1", ocds, {}, PRIO_BIENES, 12, gcs_rows=rows)
    assert len(elegidos) == 1
    d = elegidos[0]
    assert d["id"] == "d1" and d["sha256"] == "sha_bases" and d["gs"].startswith("gs://") and d["formato"] == "zip"


# ── 6. ZIP dentro de un award + docs de contrato: todas las secciones entran ──────────
def test_docs_de_award_y_contract_con_zip():
    ocds = _ocds(
        tender_docs=[_doc("d1", "Bases Administrativas", "biddingDocuments", SEACE + "b", "pdf")],
        award_docs=[_doc("a1", "Documentos de Otorgamiento de Buena Pro", "awardNotice", SEACE + "a", "zip")],
        contract_docs=[_doc("c1", "Archivos del contrato", "contractSigned",
                            "https://prod4.seace.gob.pe:9000/api/con/documentos/descargar/153182455", "application/pdf")],
    )
    rows = [_gcs(SEACE + "a", "sha_zip", tipo="awardNotice", titulo="Documentos de Otorgamiento de Buena Pro",
                 seccion="award", formato="zip", gcs_id=7)]
    elegidos, omitidos = seleccionar_documentos("1", ocds, {}, PRIO_BIENES, 12, gcs_rows=rows)
    ids = [d["id"] for d in elegidos]
    assert ids == ["d1", "a1", "c1"]
    z = elegidos[1]
    assert z["seccion"] == "award" and z["formato"] == "zip" and z["sha256"] == "sha_zip" and z["categoria"] == "acta"
    assert elegidos[2]["formato"] == "pdf" and elegidos[2]["seccion"] == "contract"
    assert omitidos == []


# ── 7. Dedupe por sha256 (mismo blob con dos URLs) y por URL ───────────────────────────
def test_dedupe_por_sha256_y_url():
    ocds = _ocds(tender_docs=[
        _doc("d1", "Bases Administrativas", "biddingDocuments", SEACE + "x"),
        _doc("d2", "Bases Administrativas (copia)", "biddingDocuments", SEACE + "y"),
        _doc("d3", "Bases Administrativas", "biddingDocuments", SEACE + "x"),   # misma URL que d1
    ])
    rows = [_gcs(SEACE + "x", "sha_same", gcs_id=1), _gcs(SEACE + "y", "sha_same", gcs_id=2)]
    elegidos, omitidos = seleccionar_documentos("1", ocds, {}, PRIO_BIENES, 12, gcs_rows=rows)
    assert [d["id"] for d in elegidos] == ["d1"]
    assert sorted(o["motivo"] for o in omitidos) == ["duplicado_sha256", "duplicado_url"]
    assert next(o for o in omitidos if o["motivo"] == "duplicado_url")["id"] == "d3"


# ── 8. doc_ids del body restringe el lote (por id OCDS, sha256 o URL) ─────────────────
def test_doc_ids_restringe():
    ocds = _ocds(tender_docs=[
        _doc("d1", "Bases Administrativas", "biddingDocuments", SEACE + "1"),
        _doc("d2", "Acta de buena pro", "awardNotice", SEACE + "2"),
        _doc("d3", "Contrato", "contractSigned", SEACE + "3"),
    ])
    rows = [_gcs(SEACE + "3", "sha_contrato", tipo="contractSigned", titulo="Contrato", gcs_id=3)]
    elegidos, omitidos = seleccionar_documentos("1", ocds, {}, PRIO_BIENES, 12,
                                                doc_ids=["d2", "sha_contrato"], gcs_rows=rows)
    assert sorted(d["id"] for d in elegidos) == ["d2", "d3"]
    assert [o["id"] for o in omitidos] == ["d1"] and omitidos[0]["motivo"] == "no_en_doc_ids"


# ── 9. Solo documentos_gcs (record sin documents) y doc_urls del dispatcher ───────────
def test_solo_gcs_y_doc_urls_sin_record():
    rows = [_gcs(SEACE + "r", "sha_rar", formato="rar", gcs_id=9)]
    doc_urls = {SEACE + "otro": "gs://vigia-peru-batch/batch/documentos/zz/1/deadbeef.pdf"}
    elegidos, _ = seleccionar_documentos("1248872", {"tender": {}}, doc_urls, PRIO_SERVICIOS, 12, gcs_rows=rows)
    assert len(elegidos) == 2
    rar = next(d for d in elegidos if d["formato"] == "rar")
    assert rar["id"] == "gcs:9" and rar["sha256"] == "sha_rar" and rar["titulo"] == "Bases Administrativas"
    otro = next(d for d in elegidos if d["formato"] == "pdf")
    assert otro["gs"].startswith("gs://") and otro["sha256"] is None and otro["seccion"] == "tender"


# ── 10. Perfil OTROS: informe y acto resolutivo antes que el contrato ─────────────────
def test_prioridad_otros():
    ocds = _ocds(tender_docs=[
        _doc("d1", "Contrato N° 12-2026", "contractSigned", SEACE + "c"),
        _doc("d2", "Resolución de Alcaldía que aprueba la contratación directa", None, SEACE + "r"),
        _doc("d3", "Informe técnico legal que sustenta", None, SEACE + "i"),
        _doc("d4", "Cotización proveedor A", None, SEACE + "q"),
    ])
    elegidos, _ = seleccionar_documentos("1", ocds, {}, PRIO_OTROS, 12, gcs_rows=[])
    assert [d["id"] for d in elegidos] == ["d3", "d2", "d4", "d1"]


# ── 11. Helpers ───────────────────────────────────────────────────────────────────────
def test_norm_url_conserva_filecode_y_quita_barra():
    a = norm_url("https://PROD1.seace.gob.pe/SeaceWeb-PRO/SdescargarArchivoAlfresco?fileCode=AB-1")
    b = norm_url("https://prod1.seace.gob.pe/SeaceWeb-PRO/SdescargarArchivoAlfresco?fileCode=ab-1")
    assert a == b
    assert norm_url("https://x.gob.pe/api/doc/1/") == norm_url("https://x.gob.pe/api/doc/1")
    assert norm_url(SEACE + "1") != norm_url(SEACE + "2")


def test_rank_sin_prioridad_devuelve_orden_estable():
    assert rank_documento("Bases", "biddingDocuments", ()) == (0, "bases")
    ocds = _ocds(tender_docs=[_doc("d1", "B", None, SEACE + "1"), _doc("d2", "A", None, SEACE + "2")])
    elegidos, _ = seleccionar_documentos("1", ocds, {}, (), 12, gcs_rows=[])
    assert [d["id"] for d in elegidos] == ["d1", "d2"]


@pytest.mark.parametrize("titulo,tipo,esperado", [
    ("Bases Integradas", "biddingDocuments", "bases_integradas"),
    ("Documentos de Presentación de Propuestas", "biddingDocuments", "propuesta"),   # el título manda sobre biddingDocuments
    ("Documentos de Otorgamiento de Buena Pro", "awardNotice", "acta"),
    ("Archivos del contrato", "contractSigned", "contrato"),
    ("Orden de Compra N° 33", None, "orden"),
    ("Valorización N° 3", None, "valorizaciones"),
])
def test_categorias_titulos_seace(titulo, tipo, esperado):
    assert esperado in categorias_de(titulo, tipo)
