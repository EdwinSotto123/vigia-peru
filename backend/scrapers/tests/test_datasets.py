"""Tests de los pipelines de datasets externos (Frente D) con fixtures pequeños y sin red ni DB.

  cd backend/scrapers && PYTHONPATH=../.. python -m pytest -q tests
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

from backend.scrapers._core.ubigeo import ZonaIndex
from backend.scrapers.jne_infogob.pipeline import _proceso_codigo, normalize_rows, parse_xls
from backend.scrapers.onpe_claridad.pipeline import normalize_candidatos, normalize_detail
from backend.scrapers.pnda_visitas.pipeline import months_between, parse_xlsx, periodo_de, slug_candidates

FX = Path(__file__).parent / "fixtures"


# ── pnda_visitas ────────────────────────────────────────────────────────────────────────
def test_visitas_slugs_cubren_las_tres_convenciones_de_la_pnda():
    s = slug_candidates(2025, 9)
    assert "reporte-de-registro-de-visitas-en-linea-setiembre-2025" in s
    assert "reporte-de-registro-de-visitas-septiembre-2025" in s
    assert "reporte-de-registro-de-visitas-septiembre" in s          # 2025 se publicó sin año
    assert s[0].startswith("reporte-de-registro-de-visitas-en-linea-")  # la más nueva primero


def test_visitas_periodo_desde_el_nombre_del_archivo():
    assert periodo_de(Path("REPORTE DE REGISTRO DE VISITAS - ENERO - 2025.xlsx")) == "2025-01"
    assert periodo_de(Path("REPORTE DE REGISTRO DE VISITAS EN LINEA  - MARZO - 2026.xlsx")) == "2026-03"
    assert periodo_de(Path("REPORTE DE REGISTRO DE VISITAS - SEPTIEMBRE - 2025.xlsx")) == "2025-09"


def test_visitas_meses_entre():
    assert months_between(dt.date(2025, 11, 1), dt.date(2026, 2, 15)) == [(2025, 11), (2025, 12), (2026, 1), (2026, 2)]


def test_visitas_parse_xlsx_fixture():
    rows, bad = parse_xlsx(FX / "REPORTE DE REGISTRO DE VISITAS - FEBRERO - 2025.xlsx")
    assert bad == 1                       # la fila sin visitante se descarta
    assert len(rows) == 2
    r = rows[0]
    assert r["fecha_visita"] == dt.date(2025, 2, 3)
    assert r["tipo_documento"] == "DNI" and r["numero_documento"] == "00000001"
    assert r["tipo_entidad_visitante"] == "privada" and r["entidad_visitante"] == "CONSTRUCTORA EJEMPLO S.A.C."
    assert r["funcionario_nombre"] == "MONTALVAN GUERRA LUIS DANIEL" and r["funcionario_cargo"] == "Gerente"
    assert r["duracion_min"] == 90
    assert rows[1]["tipo_documento"] == "CE" and rows[1]["tipo_entidad_visitante"] == "persona_natural"


# ── onpe_claridad ───────────────────────────────────────────────────────────────────────
def test_onpe_normalize_detail_fixture():
    doc = json.loads((FX / "onpe_find_detail_EG2021.json").read_text(encoding="utf-8"))
    rows = normalize_detail(doc)
    assert len(rows) == 2                 # la tercera no tiene nombre ni documento
    persona, empresa = rows
    assert persona["numero_documento"] == "00000002" and persona["nombre"] == "APORTANTE PRUEBA EJEMPLO"
    assert persona["tipo_aporte"] == "efectivo" and persona["monto"] == 70000.0
    assert persona["fecha_aporte"] == dt.date(2020, 7, 9) and persona["año"] == 2020
    assert persona["proceso"] == "EG2021" and persona["partido"] == "PARTIDO EJEMPLO" and persona["ruc_organizacion"] == "20603108079"
    assert persona["nivel"] == "campaña"
    assert empresa["numero_documento"] == "20123456789" and empresa["nombre"] == "EMPRESA EJEMPLO S.A." and empresa["tipo_aporte"] == "especie"
    assert len({r["aporte_clave"] for r in rows}) == 2 and all(len(r["aporte_clave"]) == 40 for r in rows)


def test_onpe_normalize_detail_es_determinista():
    doc = json.loads((FX / "onpe_find_detail_EG2021.json").read_text(encoding="utf-8"))
    assert [r["aporte_clave"] for r in normalize_detail(doc)] == [r["aporte_clave"] for r in normalize_detail(doc)]


def test_onpe_ifa_va_como_nivel_anual():
    doc = {"proceso": "IFA2023", "ruc": "1", "organizacion": "X",
           "aportantes": [{"apellidos": None, "nombres": "LUNA MORALES JOSE LUIS", "razonSocial": None, "tipoAporte": "E",
                           "fechaAporte": "02/01/2023", "monto": 40605.0, "anioEleccion": "2023", "proceso": "IFA2023", "dni": "45160276"}]}
    (r,) = normalize_detail(doc)
    assert r["nivel"] == "anual" and r["nombre"] == "LUNA MORALES JOSE LUIS" and r["tipo_aporte"] == "especie"


def test_onpe_candidatos_fixture():
    doc = json.loads((FX / "onpe_candidatos.json").read_text(encoding="utf-8"))
    rows = normalize_candidatos(doc)
    assert rows[0]["dni"] == "00000001" and rows[0]["proceso"] == "ERM2022"
    assert rows[1]["dni"] is None and rows[1]["proceso"] == "EMC2023"   # 'EMC 2023' → sin espacio


# ── jne_infogob ─────────────────────────────────────────────────────────────────────────
def test_jne_codigo_de_proceso():
    assert _proceso_codigo("ELECCIONES REGIONALES Y MUNICIPALES 2022", "2022") == "ERM2022"
    assert _proceso_codigo("ELECCIONES GENERALES 2026", 2026.0) == "EG2026"
    assert _proceso_codigo("ELECCIONES MUNICIPALES COMPLEMENTARIAS 2023", "2023") == "EMC2023"
    assert _proceso_codigo("SEGUNDA ELECCIÓN REGIONAL 2022", "2022") == "SER2022"


def test_jne_parse_y_ubigeo_inei():
    raw = parse_xls(FX / "autoridades_vigentes_muestra.xls", vigente=True)
    assert len(raw) == 4
    assert raw[0]["FEINICIOVIGENCIA"] == dt.date(2023, 1, 1) and raw[0]["FEFINVIGENCIA"] == dt.date(2026, 12, 31)
    ix = ZonaIndex.from_rows([
        ("08", "departamento", "Cusco", None), ("0809", "provincia", "La Convención", "08"), ("080918", "distrito", "Manitea", "0809"),
        ("0806", "provincia", "Canchis", "08"), ("080607", "distrito", "San Pedro", "0806"),
    ])
    rows = normalize_rows(raw, ix, "https://www.datosabiertos.gob.pe/dataset/autoridades-vigentes-jne")
    assert len(rows) == 4
    manitea = rows[0]
    assert manitea["ubigeo"] == "080918" and manitea["ubigeo_jne"] == "070918"    # INEI vs RENIEC/JNE
    assert manitea["cargo"] == "ALCALDE DISTRITAL" and manitea["proceso"] == "EMC2023"   # Manitea: distrito nuevo, complementarias 2023
    assert manitea["nombre"] == "PATERNO1 MATERNO1 NOMBRE1" and manitea["nombre_norm"] == "PATERNO1 MATERNO1 NOMBRE1"
    assert manitea["periodo_inicio"] == dt.date(2023, 1, 1) and manitea["dni"] is None
    assert rows[1]["ubigeo"] == "080607"
    assert rows[2]["ubigeo"] == "08"           # Marcapata no está en el índice de prueba → cae al departamento
    senador = rows[3]
    assert senador["ubigeo"] is None and senador["ambito"] == "NACIONAL" and senador["proceso"] == "EG2026"
