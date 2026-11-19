"""El lector del comité (lector/comite.py): lo que el código hace sin modelo. Nombres inventados."""
import fitz

from lector.comite import clave, comprobar_pdfs, elegir_paginas


def pdf(*paginas: str) -> bytes:
    doc = fitz.open()
    for t in paginas:
        doc.new_page().insert_text((50, 72), t, fontsize=10)
    b = doc.tobytes()
    doc.close()
    return b


def test_la_clave_quita_titulos_y_tildes_como_el_sql():
    assert clave("Ing. José Ramírez Quispe") == "JOSE RAMIREZ QUISPE"
    assert clave("ABOG. LIC. María  del Pilar Ñaupa") == "MARIA DEL PILAR NAUPA"


def test_verificada_solo_si_todas_sus_palabras_estan_en_una_misma_pagina():
    b = pdf("ACTA DE OTORGAMIENTO\nPresidente: Ing. Jose Ramirez\nQuispe", "Firmado: MARIA TORRES LUNA - Primer miembro")
    salida = {"comite": [
        {"nombre_completo": "José Ramírez Quispe", "rol": "Presidente", "pagina": 1, "cita": "x"},
        {"nombre_completo": "María Torres Luna", "rol": "Primer miembro", "pagina": 2, "cita": "x"},
        # Inventado por el modelo: no está en el texto.
        {"nombre_completo": "Pedro Inventado Salas", "rol": "Segundo miembro", "pagina": 2, "cita": "x"},
    ], "confianza": "alta"}
    r = comprobar_pdfs(salida, [("acta.pdf", b)])
    por = {m["clave"]: m for m in r["comite"]}
    assert por["JOSE RAMIREZ QUISPE"]["verificada"] and por["JOSE RAMIREZ QUISPE"]["pagina_texto"] == 1
    assert por["MARIA TORRES LUNA"]["verificada"] and por["MARIA TORRES LUNA"]["pagina_texto"] == 2
    assert por["PEDRO INVENTADO SALAS"]["verificada"] is False


def test_nombres_cortos_y_repetidos_no_quedan():
    b = pdf("Comite: Juan Perez")
    salida = {"comite": [
        {"nombre_completo": "Juan Pérez", "rol": None, "pagina": 1, "cita": "x"},          # dos palabras: no sirve para cruzar
        {"nombre_completo": "Ana Lucía Soto", "rol": "Presidente", "pagina": 1, "cita": "x"},
        {"nombre_completo": "ANA LUCIA SOTO", "rol": "Presidente", "pagina": 1, "cita": "x"},
    ]}
    r = comprobar_pdfs(salida, [("acta.pdf", b)])
    assert [m["clave"] for m in r["comite"]] == ["ANA LUCIA SOTO"]


def test_la_cita_no_guarda_un_numero_de_documento():
    b = pdf("Presidente: Ana Lucia Soto, identificada con DNI 12345678")
    salida = {"comite": [{"nombre_completo": "Ana Lucía Soto", "rol": "Presidente", "pagina": 1,
                          "cita": "Ana Lucia Soto, identificada con DNI 12345678"}]}
    r = comprobar_pdfs(salida, [("acta.pdf", b)])
    assert "12345678" not in r["comite"][0]["cita"] and r["comite"][0]["verificada"]


def test_elige_las_primeras_y_las_ultimas_paginas():
    b = pdf(*[f"pagina {i}" for i in range(10)])
    assert elegir_paginas(b, 14) == [0, 1, 7, 8, 9]
    assert elegir_paginas(pdf("una"), 14) == [0]
