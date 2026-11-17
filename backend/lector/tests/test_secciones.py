"""Las secciones de unas bases y lo que se saca de ellas sin modelo (lector/secciones.py). Bases inventadas con la armazón
real: sección general con topes legales, sección específica con la cuantía en el Capítulo I, la experiencia exigida en los
requisitos de calificación y la experiencia adicional en los factores de evaluación.

  python -m pytest backend/lector/tests -q
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from lector import secciones as S  # noqa: E402


def bases(apartado_cuantia: str) -> list[dict]:
    return [
        {"n": 1, "texto": "BASES ESTÁNDAR DE CONCURSO PÚBLICO ABREVIADO DE SERVICIOS\nSECCIÓN GENERAL\nCAPÍTULO I\nETAPAS"},
        {"n": 2, "texto": "CAPÍTULO IV\n4.3.2. La retención del 10% aplica cuando la cuantía adjudicada sea igual o menor a "
                          "S/ 480 000,00 (Cuatrocientos ochenta mil y 00/100 Soles)."},
        {"n": 3, "texto": "SECCIÓN ESPECÍFICA\nCONDICIONES ESPECIALES DEL PROCEDIMIENTO DE SELECCIÓN"},
        {"n": 4, "texto": "CAPÍTULO I\nGENERALIDADES\n1.2. ENTIDAD CONTRATANTE\nMunicipalidad de Prueba\n1.3. OBJETO DE LA CONVOCATORIA\n"
                          "Servicio de limpieza\n" + apartado_cuantia + "\n1.5. EXPEDIENTE DE CONTRATACIÓN\nAprobado.\n"
                          "1.6. FUENTE DE FINANCIAMIENTO\nRecursos ordinarios"},
        {"n": 5, "texto": "CAPÍTULO II\nDEL PROCEDIMIENTO DE SELECCIÓN\n2.1. CRONOGRAMA"},
        {"n": 6, "texto": "CAPÍTULO III\nREQUERIMIENTO\n3.1. TÉRMINOS DE REFERENCIA\nEl servicio dura 365 días."},
        {"n": 7, "texto": "3.5 REQUISITOS DE CALIFICACIÓN\nB. EXPERIENCIA DEL POSTOR EN LA ESPECIALIDAD\nRequisitos:\n"
                          "El postor debe acreditar un monto facturado acumulado equivalente a S/ 100,000.00 (Cien mil con 00/100 "
                          "soles), por la contratación de servicios iguales o similares, durante los diez (10) años anteriores a la "
                          "fecha de la presentación de ofertas.\nEn el caso de micro y pequeña empresa, se acredita un monto "
                          "facturado acumulado equivalente a S/ 45,000.00."},
        {"n": 8, "texto": "CAPÍTULO IV\nFACTORES DE EVALUACIÓN\nA. EXPERIENCIA ADICIONAL DEL POSTOR EN LA ESPECIALIDAD\n"
                          "Se otorga puntaje al postor que acredite un monto facturado acumulado equivalente a "
                          "S/ 24,978,592.50, adicional al requisito de calificación."},
        {"n": 9, "texto": "CAPÍTULO V\nPROFORMA DEL CONTRATO\nCLÁUSULA DÉCIMA: PENALIDADES"},
        {"n": 10, "texto": "ANEXOS\nANEXO Nº 1\nDECLARACIÓN JURADA"},
    ]


PUBLICA = ("1.4. CUANTÍA DE LA CONTRATACIÓN\nLa cuantía de la contratación asciende a la suma de S/ 9,826,530.00 (Nueve millones "
           "ochocientos veintiséis mil quinientos treinta con 00/100 soles), incluidos los impuestos de ley.")
RESERVADA = ("1.4. CUANTÍA DE LA CONTRATACIÓN\nEn el presente procedimiento de selección, la entidad contratante ha determinado no "
             "dar a\nconocer la cuantía de la contratación a los proveedores, de conformidad con el numeral 53.4 del artículo 53.")


def test_las_secciones_en_su_orden_y_con_sus_paginas():
    claves = [(s["clave"], s["pag_ini"], s["pag_fin"]) for s in S.partir(bases(PUBLICA))]
    # La sección general termina donde empieza el título «SECCIÓN ESPECÍFICA» (página 3), que no es una sección con datos.
    assert claves == [("general", 1, 2), ("generalidades", 4, 4), ("procedimiento", 5, 5), ("requerimiento", 6, 6),
                      ("requisitos_calificacion", 7, 7), ("evaluacion", 8, 8), ("capitulo_5", 9, 9), ("proforma", 9, 9),
                      ("anexos", 10, 10)]


def test_la_cuantia_sale_del_capitulo_i_y_no_de_otro_lado():
    c = S.cuantia(S.partir(bases(PUBLICA)))
    assert c["valor"] == 9826530.0 and c["moneda"] == "PEN" and c["reservada"] is False and c["pagina"] == 4
    assert "9,826,530.00" in c["cita"] and c["rotulo"] == "cuantia de la contratacion"


def test_la_cuantia_reservada_es_un_dato_y_no_trae_monto():
    c = S.cuantia(S.partir(bases(RESERVADA)))
    assert c["reservada"] is True and c["valor"] is None and "no dar a conocer" in c["cita"].lower()


def test_el_caso_del_16_de_noviembre_la_experiencia_nunca_es_la_cuantia():
    """El monto de «experiencia adicional» (S/ 24 978 592,50) es un factor de evaluación: sale como tal y sólo como tal."""
    d = S.leer(bases(RESERVADA))
    assert d["cuantia"]["valor"] is None
    assert [e["monto"] for e in d["experiencia_adicional"]] == [24978592.5] and d["experiencia_adicional"][0]["pagina"] == 8
    exigida = d["experiencia_exigida"]
    assert [e["monto"] for e in exigida] == [100000.0, 45000.0] and exigida[0]["anios"] == 10 and exigida[0]["pagina"] == 7
    # El tope legal de la sección general (S/ 480 000) no aparece en ningún dato.
    todo = [d["cuantia"]["valor"]] + [e["monto"] for e in exigida + d["experiencia_adicional"]]
    assert 480000.0 not in todo


def test_experiencia_en_veces_la_cuantia():
    b = bases(RESERVADA)
    b[6]["texto"] = ("3.5 REQUISITOS DE CALIFICACIÓN\nB. EXPERIENCIA DEL POSTOR EN LA ESPECIALIDAD\nEl postor debe acreditar un monto "
                     "facturado acumulado equivalente a UNA (1) VEZ LA CUANTÍA DE LA CONTRATACIÓN, durante los 8 años anteriores.")
    (e,) = S.experiencia_exigida(S.partir(b))
    assert e["veces"] == 1.0 and e["monto"] is None and e["anios"] == 8


def _exigida(frase: str) -> list[dict]:
    b = bases(RESERVADA)
    b[6]["texto"] = "3.5 REQUISITOS DE CALIFICACIÓN\nB. EXPERIENCIA DEL POSTOR EN LA ESPECIALIDAD\nRequisitos:\n" + frase
    return S.experiencia_exigida(S.partir(b))


def test_las_redacciones_reales_de_la_experiencia():
    # Sin la «a», con el símbolo pegado y con las letras antes que las cifras.
    assert _exigida("El postor debe acreditar un monto facturado acumulado equivalente S/. 700,000.00 (Setecientos Mil con 00/100 "
                    "soles), durante los quince años anteriores a la fecha.")[0] | {"cita": "", "pagina": 0} == {
        "monto": 700000.0, "moneda": "PEN", "veces": None, "anios": 15, "item": None, "cita": "", "pagina": 0}
    assert _exigida("El postor debe acreditar un monto facturado acumulado equivalente a DOSCIENTOS MIL CON 00/100 SOLES "
                    "(S/.200,000.00), por la venta de bienes.")[0]["monto"] == 200000.0
    # Sin símbolo de moneda, pero con su importe en letras.
    assert _exigida("un monto facturado acumulado equivalente a 100,000.00 (Cien mil con 00/100 soles), por la contratación")[0][
        "monto"] == 100000.0
    # En veces la cuantía, con la palabra.
    (e,) = _exigida("un monto facturado acumulado equivalente a UNA VEZ LA CUANTÍA DE LA CONTRATACIÓN en la ejecución de obras "
                    "durante los veinte años anteriores")
    assert e["veces"] == 1.0 and e["monto"] is None and e["anios"] == 20
    # Por ítem.
    dos = _exigida("ITEM N° 1 El postor debe acreditar un monto facturado acumulado equivalente a S/ 1,800,000.00.\n"
                   "ITEM N° 2 El postor debe acreditar un monto facturado acumulado equivalente a S/ 90,000.00.")
    assert [(e["item"], e["monto"]) for e in dos] == [("1", 1800000.0), ("2", 90000.0)]


def test_la_plantilla_sin_llenar_no_es_un_dato():
    assert _exigida("un monto facturado acumulado equivalente a [CONSIGNAR EL MONTO DE FACTURACIÓN EXPRESADO EN NÚMEROS Y LETRAS, "
                    "MONTO QUE NO PUEDE SER MAYOR A TRES VECES LA CUANTÍA DE LA CONTRATACIÓN O DEL ÍTEM], por la venta") == []


def test_en_obras_la_cuantia_es_el_total_de_la_tabla_de_costos():
    tabla = ("1.4. CUANTÍA DE LA CONTRATACIÓN\nOBLIGACIONES\nCOSTO (S/)\nA. COMPONENTE DE EJECUCIÓN OBRA\nCosto Directo\nS/ 152,883.12\n"
             "Gastos Generales\nS/ 26,586.92\nUtilidad (7 %)\nS/ 10,701.82\nSub Total\nS/ 190,171.86\nImpuesto I.G.V. (18%)\n"
             "S/ 34,230.93\nTOTAL\nS/ 224,402.79")
    c = S.cuantia(S.partir(bases(tabla)))
    assert c["valor"] == 224402.79 and c["reservada"] is False


def test_montos_como_los_escriben_las_bases():
    assert S.numero("198,410.00") == 198410.0
    assert S.numero("5 000 000,00") == 5000000.0
    assert S.numero("480 000.00") == 480000.0
    assert S.numero("1'250,000.50") == 1250000.5
    assert S.numero("480,000") == 480000.0
    assert S.numero("12,5") == 12.5
    assert S.numero("no es") is None


def test_sin_seccion_especifica_no_se_adivina():
    assert S.partir([{"n": 1, "texto": "TÉRMINOS DE REFERENCIA\nServicio de limpieza por S/ 50,000.00"}]) == []
    assert S.leer([{"n": 1, "texto": ""}]) is None
