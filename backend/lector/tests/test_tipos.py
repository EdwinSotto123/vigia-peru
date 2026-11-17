"""El tipo de cada pieza (lector/tipos.py) y el corte de un documento en piezas (lector/piezas.py), sin modelo.

  python -m pytest backend/lector/tests -q
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from lector import piezas, tipos  # noqa: E402
from lector.tests.test_plantillas import EVALUACION, OTORGAMIENTO_1  # noqa: E402

ACTA = ("ACTA DE ADMISIÓN, CALIFICACIÓN, EVALUACIÓN DE OFERTAS Y OTORGAMIENTO DE LA BUENA PRO\nLICITACIÓN PÚBLICA ABREVIADA\n"
        "En la ciudad de Prueba, siendo las 15:00 horas, se reunió el comité de selección designado para conducir el "
        "procedimiento, con la asistencia de sus tres miembros titulares, para revisar las ofertas presentadas.")


def test_el_reporte_del_seace_se_reconoce_por_su_plantilla_aunque_el_casillero_diga_otra_cosa():
    assert tipos.clasificar("INFORME QUE SUSTENTA LA DECLARATORIA DE DESIERTO", None, OTORGAMIENTO_1) == ("reporte_otorgamiento", "plantilla")


def test_dentro_de_un_zip_manda_el_nombre_del_archivo():
    assert tipos.clasificar("DOCUMENTOS DE OTORGAMIENTO DE BUENA PRO", "1Acta de otorgamiento de la buena pro.pdf", "") == ("acta_buena_pro", "nombre")
    assert tipos.clasificar("DOCUMENTOS DE CALIFICACIÓN Y EVALUACIÓN", "0Cuadro de evaluacion tecnica.pdf", "") == ("cuadro_evaluacion", "nombre")
    assert tipos.clasificar("BASES INTEGRADAS", "02_PRESUPUESTO DE OBRA.xlsx", "") == ("presupuesto", "nombre")
    assert tipos.clasificar("PLIEGO DE ABSOLUCIÓN DE CONSULTAS Y OBSERVACIONES", "BASES INTEGRADAS LP 03.pdf", "") == ("bases_integradas", "nombre")


def test_el_casillero_no_es_el_tipo():
    # En el casillero de desierto, un acta sigue siendo un acta.
    assert tipos.clasificar("INFORME QUE SUSTENTA LA DECLARATORIA DE DESIERTO", None, ACTA, ACTA + "\nSe declara desierto el procedimiento.") == \
        ("acta_buena_pro", "titulo")
    # En el casillero del adicional, lo que resuelve dice si es un adicional, una reducción o una ampliación.
    reduccion = "RESOLUCIÓN DE GERENCIA\nVISTO el informe técnico.\nSE RESUELVE:\nAPROBAR la Reducción de Prestaciones N.º 01 al contrato."
    assert tipos.clasificar("ARCHIVOS DEL ADICIONAL DEL CONTRATO", None, reduccion, reduccion) == ("reduccion", "titulo")
    ampliacion = "RESOLUCIÓN GERENCIAL\nSE RESUELVE: DECLARAR PROCEDENTE la solicitud de Ampliación de Plazo N° 03 por dos días."
    assert tipos.clasificar("ARCHIVOS DEL ADICIONAL", None, ampliacion, ampliacion) == ("ampliacion_plazo", "titulo")


def test_un_pliego_que_nombra_las_bases_es_un_pliego():
    pliego = "PLIEGO DE ABSOLUCIÓN DE CONSULTAS Y OBSERVACIONES\nA las bases de la licitación pública abreviada N° 3\nConsulta N° 1"
    assert tipos.clasificar("PLIEGO DE ABSOLUCIÓN DE CONSULTAS Y OBSERVACIONES", None, pliego) == ("pliego_absolucion", "titulo")


def test_un_escaneo_sin_texto_cae_en_su_casillero_y_lo_dice():
    assert tipos.clasificar("ARCHIVOS DEL CONTRATO", None, "") == ("contrato", "casillero")
    assert tipos.clasificar("ARCHIVOS DE LA GARANTÍA DEL CONTRATO", None, "") == ("garantia", "casillero")
    assert tipos.clasificar("ALGO QUE EL SEACE NO TENÍA", None, "") == ("otro", "casillero")


def test_el_regimen_sale_de_la_ley_que_cita_el_documento():
    assert tipos.regimen("…de conformidad con la Ley N° 32069, Ley General de Contrataciones Públicas…") == "ley_32069"
    assert tipos.regimen("…Ley N° 30225, Ley de Contrataciones del Estado, y su Reglamento…") == "ley_30225"
    assert tipos.regimen("un texto que no cita ninguna ley") is None


def test_un_zip_se_corta_en_piezas_y_cada_reporte_va_con_la_suya():
    paginas = [
        {"n": 1, "archivo": "0Cuadro de evaluacion tecnica.pdf", "texto": ""},                       # escaneado
        {"n": 2, "archivo": "0Cuadro de evaluacion tecnica.pdf", "texto": ""},
        {"n": 3, "archivo": "1Reporte de evaluacion tecnica.pdf", "texto": EVALUACION},
    ]
    cuadro, reporte = piezas.leer_documento("DOCUMENTOS DE CALIFICACIÓN Y EVALUACIÓN", paginas, "zip")
    assert (cuadro["tipo"], cuadro["por"], cuadro["paginas"], cuadro["paginas_con_texto"], cuadro["lecturas"]) == \
        ("cuadro_evaluacion", "nombre", 2, 0, [])
    assert (reporte["tipo"], reporte["por"], reporte["pag_ini"], reporte["origen"]) == ("reporte_evaluacion", "plantilla", 3, "generado")
    (lectura,) = reporte["lecturas"]
    assert lectura["plantilla"] == "reporte_evaluacion" and reporte["nomenclatura"] == "LP-ABR-3-2026-MDP/CS-1"


def test_el_nombre_de_un_pdf_suelto_no_clasifica():
    # Un PDF suelto se llama como su casillero («…ampliación del contrato.pdf»): no por eso es un contrato.
    texto = "RESOLUCIÓN\nSE RESUELVE: APROBAR la Ampliación de Plazo N° 01 por diez días calendario." + " relleno" * 30
    (pieza,) = piezas.leer_documento("ARCHIVOS DE LA AMPLIACIÓN DEL CONTRATO",
                                     [{"n": 1, "archivo": "ARCHIVOS DE LA AMPLIACION DEL CONTRATO.pdf", "texto": texto}], "pdf")
    assert pieza["tipo"] == "ampliacion_plazo"


def test_bases_integradas_por_casillero_aunque_la_portada_diga_estandar():
    # Proceso 1225937: las integradas conservan la portada «BASES ESTÁNDAR…»; el casillero del SEACE dice cuáles son.
    assert tipos.clasificar("Bases Integradas", None, "BASES ESTÁNDAR DE LICITACIÓN PÚBLICA ABREVIADA") == ("bases_integradas", "casillero")
    assert tipos.clasificar("Bases Administrativas", None, "BASES ESTÁNDAR DE LICITACIÓN PÚBLICA ABREVIADA") == ("bases", "titulo")
