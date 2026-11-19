"""El lector y el cargador de las apelaciones del Tribunal (migración 402): las piezas sin red ni base."""
import importlib.util
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ.parent / "infrastructure" / "aws"))
from lector import tribunal as T  # noqa: E402

_spec = importlib.util.spec_from_file_location("tribunal_cargar", RAIZ / "scripts" / "tribunal_cargar.py")
C = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(C)


def test_enruta_por_el_encabezado():
    assert T.tipo_de("VISTO el Expediente N° 1/2026.TCP, sobre el recurso de apelación interpuesto por X") == "apelacion"
    assert T.tipo_de("sobre el procedimiento administrativo sancionador generado contra la empresa") == "sancion"
    assert T.tipo_de("Sustituir la sanción impuesta") == "otro"


def test_la_cita_y_los_procedimientos_se_comprueban_en_el_texto():
    texto = "LA SALA RESUELVE: 1. Declarar fundado el recurso de apelación … Licitación Pública N° 2-2026-CS-MDCH-1 …"
    s = T.comprobar({"cita_resolutivo": "1. Declarar fundado el recurso de apelación",
                     "procedimientos": ["Licitación Pública N° 2-2026-CS-MDCH-1", "Adjudicación Simplificada N° 9-2026-X-1"]}, texto)
    assert s["_cita_ok"] is True
    assert s["_procedimientos_ok"] == ["Licitación Pública N° 2-2026-CS-MDCH-1"]


def test_parte_la_nomenclatura_escrita_en_palabras():
    p = C.partir("Licitación Pública Abreviada de Obras N° 003-2026-MDH/C-1")
    assert (p["tipo"], p["num"], p["anio"], p["conv"]) == ("LP", 3, 2026, 1)
    assert "MDH" in C.siglas(p["resto"])
    p = C.partir("Concurso Público de Servicios N° 02-2026-ADINELSA – Primera Convocatoria")
    assert (p["tipo"], p["num"], p["anio"], p["conv"]) == ("CP", 2, 2026, 1)
    p = C.partir("Licitación Pública para Bienes N° 006 2026/INEN")
    assert (p["tipo"], p["num"], p["anio"]) == ("LP", 6, 2026)


def test_gobierno_regional_no_es_la_municipalidad_del_mismo_lugar():
    assert C.entidad_parecida("Gobierno Regional de Lambayeque Sede Central", "MUNICIPALIDAD PROVINCIAL DE LAMBAYEQUE") < 0.34
    assert C.entidad_parecida("Municipalidad Distrital de Chadín", "MUNICIPALIDAD DISTRITAL DE CHADIN") == 1.0
