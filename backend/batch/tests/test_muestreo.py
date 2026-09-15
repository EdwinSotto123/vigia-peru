"""Tests de las funciones puras de backend.batch.muestreo (sin red ni DB)."""

from __future__ import annotations

import pytest

from backend.batch.muestreo import extrapolar, meses_de, ocid_corto, percentiles, resumir


def test_extrapolar_tres_meses_a_anio():
    conteos = {
        "2019-01": {"releases": 6000, "ocids": 4500},
        "2019-05": {"releases": 7200, "ocids": 5100},
        "2019-09": {"releases": 6600, "ocids": 4800},
    }
    r = extrapolar(conteos)
    assert r["meses_medidos"] == 3
    assert r["meses_vacios"] == []
    assert r["releases_mes_prom"] == pytest.approx(6600)
    assert r["ocids_mes_prom"] == pytest.approx(4800)
    assert r["releases_anio"] == 79200
    assert r["ocids_anio"] == 57600
    assert r["ratio_releases_ocid"] == pytest.approx(19800 / 14400)


def test_extrapolar_mes_vacio_se_reporta_y_promedia_como_cero():
    conteos = {"2016-01": {"releases": 0, "ocids": 0}, "2016-05": {"releases": 3000, "ocids": 2400}}
    r = extrapolar(conteos)
    assert r["meses_vacios"] == ["2016-01"]
    assert r["releases_anio"] == 18000        # (0 + 3000) / 2 * 12
    assert r["ocids_anio"] == 14400
    assert r["ratio_releases_ocid"] == pytest.approx(1.25)


def test_extrapolar_sin_datos():
    r = extrapolar({})
    assert r["meses_medidos"] == 0 and r["releases_anio"] == 0 and r["ratio_releases_ocid"] is None
    r = extrapolar({"2005-01": {"releases": 0, "ocids": 0}})
    assert r["releases_anio"] == 0 and r["ratio_releases_ocid"] is None and r["meses_vacios"] == ["2005-01"]


def test_percentiles_interpolacion_lineal():
    p = percentiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert p["n"] == 10
    assert p["p50"] == pytest.approx(5.5)
    assert p["p90"] == pytest.approx(9.1)
    assert p["media"] == pytest.approx(5.5)
    assert p["max"] == 10 and p["min"] == 1 and p["suma"] == 55


def test_percentiles_ignora_none_y_vacio():
    assert percentiles([None, 4, None])["p50"] == 4
    p = percentiles([])
    assert p["n"] == 0 and p["p50"] is None and p["suma"] == 0


def test_resumir_agrupa_por_categoria_tipo_y_formato():
    records = [
        {"ocid": "1", "categoria": "goods", "bytes": 10_000, "tags": ["tender"], "n_releases": 2, "docs": [
            {"documentType": "biddingDocuments", "format": "pdf", "bytes": 1_000_000, "status": "head"},
            {"documentType": "awardNotice", "format": "zip", "bytes": 5_000_000, "status": "head"},
            {"documentType": "clarifications", "format": "pdf", "bytes": None, "status": "no_medido"},
        ]},
        {"ocid": "2", "categoria": "works", "bytes": 20_000, "tags": ["tender", "award"], "n_releases": 4, "docs": [
            {"documentType": "biddingDocuments", "format": "pdf", "bytes": 3_000_000, "status": "head"},
        ]},
        {"ocid": "3", "categoria": "works", "error": "HTTP 404"},
    ]
    s = resumir(records)
    assert s["records_medidos"] == 3
    assert s["record_bytes"]["total"]["n"] == 2 and s["record_bytes"]["por_categoria"]["works"]["p50"] == 20_000
    assert s["docs_por_record"]["por_categoria"]["goods"]["p50"] == 3
    assert s["docs_por_record"]["solo_tipos_clave"]["media"] == pytest.approx((2 + 1 + 0) / 3)
    assert s["docs_listados"]["por_tipo"] == {"biddingDocuments": 2, "awardNotice": 1, "clarifications": 1}
    assert s["docs_listados"]["por_formato"] == {"pdf": 3, "zip": 1}
    assert s["doc_bytes"]["por_tipo"]["biddingDocuments"]["p50"] == 2_000_000
    assert s["doc_bytes"]["por_formato"]["zip"]["n"] == 1
    assert s["doc_bytes"]["total"]["n"] == 3               # el doc sin bytes no cuenta
    assert s["head_estados"] == {"head": 3, "no_medido": 1}
    assert s["releases_por_record"]["media"] == 3
    assert s["tags"] == {"tender": 2, "award": 1}


def test_meses_de_y_ocid_corto():
    assert meses_de(2024, [2, 12]) == [("2024-02", "2024-02-01", "2024-02-29"), ("2024-12", "2024-12-01", "2024-12-31")]
    assert ocid_corto("ocds-dgv273-seacev3-1212239") == "1212239"
    assert ocid_corto("1212239") == "1212239"
    assert ocid_corto("ocds-dgv273-seacev3-2026-10404-12") == "2026-10404-12"
