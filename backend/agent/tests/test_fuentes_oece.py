"""Enlace al proceso con el OCID completo y resoluciones del Tribunal fuera de «prensa» (aviso de 2026-11-04, 1229308)."""
from __future__ import annotations

from tools.fuentes import arreglar_urls_oece, ocid_completo, proceso_oece
from tools.persistence.analysis_outputs import _banderas_investigacion

_P = "https://contratacionesabiertas.oece.gob.pe/proceso/"


def test_proceso_con_ocid_completo():
    assert proceso_oece("1229308") == _P + "ocds-dgv273-seacev3-1229308"
    assert proceso_oece("2018-1534-1") == _P + "ocds-dgv273-seacev3-2018-1534-1"
    assert proceso_oece("OECE-1229308") == _P + "ocds-dgv273-seacev3-1229308"
    assert proceso_oece("ocds-dgv273-seacev3-84547") == _P + "ocds-dgv273-seacev3-84547"
    assert ocid_completo("") == ""


def test_arreglar_urls_en_texto():
    md = ("Ver [proceso](https://contratacionesabiertas.oece.gob.pe/proceso/1229308) y "
          "https://contratacionesabiertas.osce.gob.pe/proceso/2018-1534-1 ; ya bien: " + _P + "ocds-dgv273-seacev3-9")
    out = arreglar_urls_oece(md)
    assert "(" + _P + "ocds-dgv273-seacev3-1229308)" in out
    assert _P + "ocds-dgv273-seacev3-2018-1534-1 ;" in out
    assert out.count("ocds-dgv273-seacev3-") == 3


def _estado(con_sancion: bool):
    st = {"ocid": "1229308", "grounding_urls": ["https://www.gob.pe/institucion/oece/normas-legales/4341948-2327-2023-tce-s5"],
          "news_research": {"banderas_prensa": [{
              "estado": "hallado", "confianza": "alta", "severidad": "media",
              "titulo": "Procedimiento administrativo sancionador ante el TCE por información inexacta",
              "descripcion": "El Tribunal de Contrataciones del Estado abrió procedimiento sancionador (Res. N° 2327-2023-TCE-S5).",
              "url": "https://www.gob.pe/institucion/oece/normas-legales/4341948-2327-2023-tce-s5",
              "evidencia": [{"url": "https://www.gob.pe/institucion/oece/normas-legales/4341948-2327-2023-tce-s5",
                             "cita": "Procedimiento administrativo sancionador instaurado contra la empresa CONSORCIO CAROLINA S.A.C."}]}]}}
    if con_sancion:
        st["oece_perfiles"] = {"20341191476": {"n_sanciones": 2}}
    return st


def test_resolucion_tce_ya_registrada_no_es_prensa():
    st = _estado(True)
    assert _banderas_investigacion(st) == []
    assert st["descartes"][0]["motivo"] == "resolucion_tce_ya_en_registro"


def test_resolucion_tce_fuera_del_registro_es_antecedente_bajo():
    out = _banderas_investigacion(_estado(False))
    assert len(out) == 1
    assert out[0]["regla"] == "antecedente_proveedor_web" and out[0]["severidad"] == "baja"
    assert "falta leer qué resolvió" in out[0]["evidencia"]
