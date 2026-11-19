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


def test_el_resultado_sale_del_resolutivo_en_mayusculas():
    texto = ("… por unanimidad; LA SALA RESUELVE: 1. Declarar la nulidad de oficio de la Licitación Pública N° 1-2026-X-1. "
             "2. Devolver la garantía. … n) Registro de la resolución que resuelve el recurso de apelación: la entidad …")
    assert T.resultado_de_texto(texto) == "nulidad_de_oficio"
    texto = "LA SALA RESUELVE: 1. Declarar INFUNDADO el recurso de apelación. 2. Ejecutar la garantía."
    assert T.resultado_de_texto(texto) == "infundado"
    s = T.comprobar({"resultado": "fundado", "cita_resolutivo": "", "procedimientos": []}, texto)
    assert s["_resultado_ok"] is False and s["_resultado_regla"] == "infundado"


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


def test_la_sala_resuelve_en_minusculas_y_sin_la_palabra():
    # Salas 1 y 5 (2026): «La Sala resuelve:»; no debe calzar la nota al pie «la resolución que resuelve el recurso».
    texto = ("… por unanimidad, La Sala resuelve: 1. Declarar infundado el recurso de apelación interpuesto por el postor X. "
             "2. Ejecutar la garantía. 6 n) Registro de la resolución que resuelve el recurso de apelación: la Entidad …")
    assert T.resultado_de_texto(texto) == "infundado"
    # Sala 2 (2026): sin «resuelve», «… el debate correspondiente, por unanimidad; 1. Declarar …».
    texto = ("analizados los antecedentes y luego de agotado el debate correspondiente, por unanimidad; 1. Declarar FUNDADO "
             "EN PARTE el recurso de apelación … 2. Revocar la buena pro. … que resuelve el recurso de apelación. Al día …")
    assert T.resultado_de_texto(texto) == "fundado_en_parte"


def test_gana_lo_primero_del_primer_punto():
    texto = ("LA SALA RESUELVE: 1. Declarar FUNDADO el recurso de apelación y, en consecuencia, declarar la nulidad del "
             "otorgamiento de la buena pro. 2. Devolver la garantía.")
    assert T.resultado_de_texto(texto) == "fundado"
    texto = "LA SALA RESUELVE: 1. Declarar la nulidad de oficio de la Licitación Pública N° 6-2026-OEFA-1. 2. Devolver."
    assert T.resultado_de_texto(texto) == "nulidad_de_oficio"
    # El punto 1 es improcedente y el 2 declara la nulidad de oficio: el proceso se corrigió.
    texto = ("LA SALA RESUELVE: 1. Declarar IMPROCEDENTE el recurso de apelación. 2. Declarar la nulidad de oficio del "
             "procedimiento, debiendo retrotraerse. 3. Devolver la garantía. Regístrese, comuníquese y publíquese.")
    assert T.resultado_de_texto(texto) == "nulidad_de_oficio"


def test_resoluciones_que_no_resuelven_una_apelacion():
    texto = "LA SALA RESUELVE: 1. SANCIONAR a la empresa X con una multa. 2. Disponer que …"
    assert T.resultado_de_texto(texto) == "sancion"
    s = T.comprobar({"resultado": "otro", "cita_resolutivo": "", "procedimientos": []}, texto)
    assert s["_resultado_ok"] is True and s["_corregido_ok"] is True
    texto = "LA SALA RESUELVE: 1. Rectificar el error material advertido en el numeral 6 de la Resolución N° 1-2026-TCP-S5."
    assert T.resultado_de_texto(texto) == "rectificacion"


def test_corregido_coincide_aunque_el_resultado_exacto_no():
    # «Declarar la NULIDAD de la resolución que declaró la nulidad»: la regla dice nulidad, el modelo fundado; los dos
    # dicen que el Tribunal corrigió a la entidad.
    texto = "LA SALA RESUELVE: 1. Declarar la NULIDAD de la Resolución Gerencial N° 87-2026 que dispuso la nulidad. 2. Devolver."
    s = T.comprobar({"resultado": "fundado", "cita_resolutivo": "", "procedimientos": []}, texto)
    assert s["_resultado_ok"] is False and s["_corregido_ok"] is True
    s = T.comprobar({"resultado": "infundado", "cita_resolutivo": "", "procedimientos": []}, texto)
    assert s["_corregido_ok"] is False
