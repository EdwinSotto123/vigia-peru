"""Los reportes que genera el SEACE se leen sin modelo (lector/plantillas.py). Los textos de prueba copian la FORMA real de
cada reporte (el orden en que PyMuPDF entrega las líneas: los valores van antes que sus etiquetas), con empresas y códigos
inventados.

  python -m pytest backend/lector/tests -q
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from lector import plantillas as P  # noqa: E402

CABECERA = """MUNICIPALIDAD DISTRITAL DE PRUEBA
1
LP-ABR-3-2026-MDP/CS-1
Bien
ADQUISICION DE EQUIPOS PARA LA MUNICIPALIDAD
DE PRUEBA
Entidad convocante :
Nomenclatura :
Objeto de contratación :
Descripción del objeto :
Nro. de convocatoria :
"""

EVALUACION = "REPORTE DE EVALUACIÓN TÉCNICA\n" + CABECERA + """Nro. Item :
Descripción del Item:
1
EQUIPOS DE COMPUTO
Estado de
admisión
Estado de
calificación
Puntaje
técnico
Estado de registro
de propuesta
Postor
EMPRESA UNO S.A.C.
Valido
Admitida
86.43
Calificada
COMERCIAL DOS SOCIEDAD ANONIMA
CERRADA Valido
Admitida
0.0
Descalificada
TRES E.I.R.L.
Valido
No Admitida
-
-
Nro. Item :
Descripción del Item:
2
IMPRESORAS
Estado de
admisión
Estado de
calificación
Puntaje
técnico
Estado de registro
de propuesta
Postor
NO EXISTEN POSTORES PARA EL ITEM
Usuario : 12345678
Pagina 1 de 1
17.18.49
01/10/2026
Fecha de Generación \t:
Hora de Generación \t:
"""

OTORGAMIENTO_1 = "REPORTE DE OTORGAMIENTO DE BUENA PRO\n" + CABECERA + """Adjudicado
Resultado
0.0
S/ 300,000.00
Valor Referencial :
Cantidad Desierta :
Unidad
Unidad de Medida :
1.561305E7
Cantidad Solicitada
EQUIPOS DE
COMPUTO
Descripción del
1
Nro. Item :
Cantidad Adjudicada
Integrante del Consorcio
Nombre o Razón Social
Monto Adjudicado
20999999991-CONSORCIO DE PRUEBA
20111111111-EMPRESA UNO
S.A.C.
20222222222-COMERCIAL DOS S.A.C.
1.561305E7
245563.44
Desierto
Resultado
2.0
$/. 10,500.50
Valor Referencial :
Cantidad Desierta :
Unidad
Unidad de Medida :
2.0
Cantidad Solicitada
IMPRESORAS
Descripción del
2
Nro. Item :
Cantidad Adjudicada
Integrante del Consorcio
Nombre o Razón Social
Monto Adjudicado
Monto mayor al valor
Resultado
0.0
S/ 49,000.00
Valor Referencial :
Cantidad Desierta :
Unidad
Unidad de Medida :
3500.0
Cantidad Solicitada
TONER
Descripción del
3
Nro. Item :
Usuario : 12345678
Pagina 1 de 2
5:46 PM
Hora de Generación \t:
21/05/2026
Fecha de Generación \t:
"""

# La hoja siguiente repite la cabecera pero no el título, y las columnas antes de las filas que faltaban.
OTORGAMIENTO_2 = CABECERA + """Cantidad Adjudicada
Integrante del Consorcio
Nombre o Razón Social
Monto Adjudicado
Adjudicado
Resultado
0.0
S/ 20,000.00
Valor Referencial :
Cantidad Desierta :
Unidad
Unidad de Medida :
10.0
Cantidad Solicitada
PAPEL
Descripción del
4
Nro. Item :
Cantidad Adjudicada
Integrante del Consorcio
Nombre o Razón Social
Monto Adjudicado
20333333333-TRES E.I.R.L.
10.0
18500
Usuario : 12345678
Pagina 2 de 2
5:46 PM
Hora de Generación \t:
21/05/2026
Fecha de Generación \t:
"""

PRESENTACION = "Presentación de ofertas/expresión de interés\n" + CABECERA + """Nro. ítem
Descripción del ítem
EQUIPOS DE COMPUTO
1
Fecha Presentación
Forma de presentación
Nombre o Razón Social
RUC / Código
Hora Presentación
EMPRESA UNO S.A.C.
20111111111
23/03/2026
Electronico
23:40:59
COMERCIAL DOS SOCIEDAD
ANONIMA CERRADA
20222222222
23/03/2026
Electronico
23:48:05
IMPRESORAS
2
RUC / Código
No presentaron propuesta al ítem
-
-
-
TONER
3
RUC / Código
TRES E.I.R.L.
20333333333
22/03/2026
Electronico
10:01:00
24/03/2026 8.14 AM
Usuario : 12345678
Fecha:
Página 1 de 1
"""

DESEMPATE = """REPORTE DEL DESEMPATE
Obra
LP-ABR-2-2026-MDP/C-1
1
Objeto de la Contratación :
MUNICIPALIDAD DISTRITAL DE PRUEBA
Descripción del Objeto :
EJECUCION DE LA OBRA DE PRUEBA
Nro. Convocatoria :
Nomenclatura :
Entidad Convocante :
Datos del Item y sorteo
1
EJECUCION DE LA OBRA DE PRUEBA
15/07/2026
5:18 PM
USUARIO DEL SEACE
Número Item
Descripción Item
Fecha :
Hora :
Usuario que actualizó :
Listado del Resultado del Desempate
Código/Ruc Postor
Razón Social
Orden de
Prelación
Puntaje total con
Bonificación
Puntaje Técnico
Mype
Empresa integrada por
discapacitados
20999999991
CONSORCIO DE PRUEBA
1
110.0
100.0
SI
NO
20999999992
CONSORCIO OTRO DE
PRUEBA
100.0
SI
SI
Usuario : 12345678
Página 1 de 1
Hora de Generación \t:
Fecha de Generación \t:
5:18 PM
15/07/2026
"""

NO_FORMULACION = """FORMULACIÓN DE CONSULTAS Y OBSERVACIONES
ACTA DE NO
MUNICIPALIDAD DISTRITAL DE PRUEBA
Obra
EJECUCION DE LA OBRA DE PRUEBA
Descripción del
Objeto de
Nro. de Convocatoria:
1
No se registraron Formulación de consultas y observaciones
en el procedimiento
Nomenclatura:
LP-ABR-4-2026-MDP/CS-1
08/07/2026 09:36 AM
Generado el
"""


def test_detecta_cada_reporte_y_nada_mas():
    assert P.detectar(EVALUACION) == "reporte_evaluacion"
    assert P.detectar(OTORGAMIENTO_1) == "reporte_otorgamiento"
    assert P.detectar(PRESENTACION) == "reporte_presentacion"
    assert P.detectar(DESEMPATE) == "reporte_desempate"
    assert P.detectar(NO_FORMULACION) == "acta_no_formulacion"
    assert P.detectar(OTORGAMIENTO_2) is None            # la hoja de continuación no trae título
    assert P.detectar("ACTA DE ADMISIÓN, CALIFICACIÓN Y EVALUACIÓN DE OFERTAS\nEn la ciudad de…") is None


def test_evaluacion_por_postor_con_su_item():
    d = P.leer_pagina(EVALUACION)
    assert d["plantilla"] == "reporte_evaluacion" and d["sobrante"] == 0
    assert d["nomenclatura"] == "LP-ABR-3-2026-MDP/CS-1" and d["nro_convocatoria"] == 1 and d["objeto"] == "Bien"
    assert d["entidad"] == "MUNICIPALIDAD DISTRITAL DE PRUEBA" and d["generado"] == "2026-10-01"
    uno, dos = d["items"]
    assert uno["item"] == 1 and uno["descripcion"] == "EQUIPOS DE COMPUTO"
    assert uno["postores"] == [
        {"nombre": "EMPRESA UNO S.A.C.", "registro": "Valido", "admitida": True, "puntaje_tecnico": 86.43, "calificada": True},
        # El registro pegado al final del nombre se separa; el nombre partido en dos líneas se junta.
        {"nombre": "COMERCIAL DOS SOCIEDAD ANONIMA CERRADA", "registro": "Valido", "admitida": True, "puntaje_tecnico": 0.0,
         "calificada": False},
        {"nombre": "TRES E.I.R.L.", "registro": "Valido", "admitida": False, "puntaje_tecnico": None, "calificada": None},
    ]
    assert dos["item"] == 2 and dos["postores"] == [] and dos["sin_postores"] is True


def test_el_registro_pegado_al_nombre_sin_espacio():
    """Lo encontró la lectura con modelo: el PDF a veces no trae el espacio («…INGENIEROSValido») y el nombre quedaba sucio."""
    pegado = EVALUACION.replace("EMPRESA UNO S.A.C.\nValido\n", "EMPRESA UNO INGENIEROSValido\n")
    primero = P.leer_pagina(pegado)["items"][0]["postores"][0]
    assert primero["nombre"] == "EMPRESA UNO INGENIEROS" and primero["registro"] == "Valido" and primero["admitida"] is True
    # Un nombre que termina en una palabra parecida, en mayúsculas, no se corta.
    intacto = EVALUACION.replace("EMPRESA UNO S.A.C.\nValido\n", "SERVICIOS DE INVALIDO\nValido\n")
    assert P.leer_pagina(intacto)["items"][0]["postores"][0]["nombre"] == "SERVICIOS DE INVALIDO"


def test_otorgamiento_consorcio_desierto_y_hoja_siguiente():
    (d,) = P.leer_paginas(["una página cualquiera", OTORGAMIENTO_1, OTORGAMIENTO_2])
    assert d["plantilla"] == "reporte_otorgamiento" and d["paginas"] == [2, 3] and d["sobrante"] == 0
    assert [i["item"] for i in d["items"]] == [1, 2, 3, 4]
    uno, dos, tres, cuatro = d["items"]
    assert uno["resultado"] == "adjudicado" and uno["valor_referencial"] == 300000.0 and uno["moneda"] == "PEN"
    assert uno["cantidad_solicitada"] == 15613050.0 and uno["descripcion"] == "EQUIPOS DE COMPUTO"
    (adj,) = uno["adjudicados"]
    assert adj["ruc"] == "20999999991" and adj["nombre"] == "CONSORCIO DE PRUEBA" and adj["monto"] == 245563.44
    assert adj["integrantes"] == [{"ruc": "20111111111", "nombre": "EMPRESA UNO S.A.C."},
                                  {"ruc": "20222222222", "nombre": "COMERCIAL DOS S.A.C."}]
    assert dos["resultado"] == "desierto" and dos["adjudicados"] == [] and dos["moneda"] == "USD"
    assert dos["valor_referencial"] == 10500.5 and dos["cantidad_desierta"] == 2.0
    # El ítem 3 quedó partido entre las dos hojas: sus etiquetas en la primera, sus filas (ninguna) en la segunda.
    assert tres["resultado"] == "monto_mayor" and tres["valor_referencial"] == 49000.0 and tres["adjudicados"] == []
    assert cuatro["adjudicados"] == [{"ruc": "20333333333", "nombre": "TRES E.I.R.L.", "integrantes": [], "cantidad": 10.0,
                                      "monto": 18500.0}]


def test_presentacion_varios_items_en_forma_compacta():
    d = P.leer_pagina(PRESENTACION)
    assert d["plantilla"] == "reporte_presentacion" and d["sobrante"] == 0 and d["generado"] == "2026-03-24"
    uno, dos, tres = d["items"]
    assert uno["item"] == 1 and [o["ruc"] for o in uno["ofertas"]] == ["20111111111", "20222222222"]
    assert uno["ofertas"][1] == {"ruc": "20222222222", "nombre": "COMERCIAL DOS SOCIEDAD ANONIMA CERRADA",
                                 "fecha": "2026-03-23", "forma": "Electronico", "hora": "23:48:05"}
    assert dos["item"] == 2 and dos["descripcion"] == "IMPRESORAS" and dos["ofertas"] == [] and dos["sin_ofertas"] is True
    # La oferta del ítem 3 no se le atribuye al ítem 1, y su nombre no arrastra la descripción del ítem.
    assert tres["item"] == 3 and tres["ofertas"] == [{"ruc": "20333333333", "nombre": "TRES E.I.R.L.", "fecha": "2026-03-22",
                                                      "forma": "Electronico", "hora": "10:01:00"}]


def test_desempate_con_y_sin_orden_de_prelacion():
    d = P.leer_pagina(DESEMPATE)
    assert d["plantilla"] == "reporte_desempate" and d["sobrante"] == 0 and d["nomenclatura"] == "LP-ABR-2-2026-MDP/C-1"
    (item,) = d["items"]
    assert item["item"] == 1 and item["fecha"] == "2026-07-15"
    assert item["postores"] == [
        {"ruc": "20999999991", "nombre": "CONSORCIO DE PRUEBA", "orden": 1, "puntaje_total": 110.0, "puntaje_tecnico": 100.0,
         "mype": True, "discapacitados": False},
        {"ruc": "20999999992", "nombre": "CONSORCIO OTRO DE PRUEBA", "orden": None, "puntaje_total": None,
         "puntaje_tecnico": 100.0, "mype": True, "discapacitados": True},
    ]


def test_acta_de_no_formulacion():
    d = P.leer_pagina(NO_FORMULACION)
    assert d["plantilla"] == "acta_no_formulacion" and d["nomenclatura"] == "LP-ABR-4-2026-MDP/CS-1"
    assert d["nro_convocatoria"] == 1 and d["generado"] == "2026-07-08"


def test_el_dni_de_quien_genero_el_reporte_nunca_sale():
    for texto in (EVALUACION, OTORGAMIENTO_1, PRESENTACION, DESEMPATE):
        assert "12345678" not in json.dumps(P.leer_paginas([texto, OTORGAMIENTO_2]), ensure_ascii=False)


def test_una_pagina_que_perdio_la_forma_no_se_adivina():
    # Una página pasada por OCR: el título está, las etiquetas no quedan en líneas propias.
    roto = "REPORTE DE EVALUACIÓN TÉCNICA\nEntidad convocante : MUNICIPALIDAD | Nro . Item | 1\nPostor | Estado | Puntaje"
    assert P.leer_paginas([roto]) == []
    # Una fila cortada cuenta como sobrante en vez de inventarse.
    cortada = EVALUACION.replace("TRES E.I.R.L.\nValido\nNo Admitida\n-\n-\n", "TRES E.I.R.L.\nValido\nNo\n")
    assert P.leer_pagina(cortada)["sobrante"] > 0
