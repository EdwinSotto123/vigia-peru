"""La ficha completa de las bases (lector/ficha_bases.py), el texto por página (lector/texto.py) y la transcripción
(lector/transcribir.py): lo que hace el código alrededor del modelo. Nada de aquí llama a un modelo ni a la red.

  python -m pytest backend/lector/tests -q
"""
import io
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from lector import ficha_bases as F  # noqa: E402
from lector import texto, transcribir  # noqa: E402

RELLENO = " Texto de relleno de la página, para que no parezca un escaneo." * 6


def bases_largas() -> list[dict]:
    """Unas bases con la armazón real y páginas con texto de verdad; las páginas 7 a 9 son un bloque escaneado."""
    pag = lambda n, t: {"n": n, "texto": t + RELLENO}  # noqa: E731
    return [
        pag(1, "BASES ESTÁNDAR\nSECCIÓN GENERAL\nCAPÍTULO I\nLa retención aplica cuando la cuantía adjudicada sea igual o menor a S/ 480 000,00."),
        pag(2, "CAPÍTULO IV\nDisposiciones comunes."),
        pag(3, "SECCIÓN ESPECÍFICA\nCONDICIONES ESPECIALES"),
        pag(4, "CAPÍTULO I\nGENERALIDADES\n1.4. CUANTÍA DE LA CONTRATACIÓN\nLa cuantía asciende a S/ 100,000.00."),
        pag(5, "CAPÍTULO II\nDEL PROCEDIMIENTO DE SELECCIÓN\n2.2.1.1 Documentos para la admisión de la oferta"),
        pag(6, "CAPÍTULO III\nREQUERIMIENTO\n3.1 TÉRMINOS DE REFERENCIA"),
        {"n": 7, "texto": "MUNICIPALIDAD DE PRUEBA"}, {"n": 8, "texto": "MUNICIPALIDAD DE PRUEBA"}, {"n": 9, "texto": "MUNICIPALIDAD DE PRUEBA"},
        pag(10, "CAPÍTULO IV\nFACTORES DE EVALUACIÓN\nA. EXPERIENCIA ADICIONAL"),
        {"n": 11, "texto": "CAPÍTULO V"},                                      # una carátula suelta: no es un escaneo
        pag(12, "PROFORMA DEL CONTRATO\nCLÁUSULA DUODÉCIMA: PENALIDADES"),
        pag(13, "ANEXOS\nANEXO Nº 1\nDECLARACIÓN JURADA DE DATOS DEL POSTOR"),
        pag(14, "ANEXO Nº 2\nPACTO DE INTEGRIDAD"),
    ]


def test_un_escaneo_es_un_bloque_seguido_no_una_hoja_suelta():
    assert F.bloques_escaneados([(1, 3000), (2, 100), (3, 3000), (4, 50), (5, 60), (6, 70), (7, 2000), (8, 10)]) == [4, 5, 6]
    assert F.bloques_escaneados([(1, 10), (2, 10), (3, 2000)]) == []


def test_se_lee_la_parte_especifica_entera_y_se_dice_lo_que_falta():
    prep = F.preparar(bases_largas())
    # Desde las generalidades hasta el final de la proforma: ni la sección general ni los formatos de los anexos.
    assert prep["rango"] == [4, 12] and prep["escaneadas"] == [7, 8, 9] and prep["sin_leer_por_tope"] == []
    (tramo,) = prep["tramos"]
    assert (tramo["pag_ini"], tramo["pag_fin"], tramo["con_generalidades"]) == (4, 12, True)
    assert "480 000" not in tramo["texto"] and "PACTO DE INTEGRIDAD" not in tramo["texto"]
    assert "⟦p.10⟧" in tramo["texto"] and "⟦p.7⟧" not in tramo["texto"]


def test_cada_tramo_sabe_bajo_que_titulos_empieza(monkeypatch):
    monkeypatch.setattr(F, "TRAMO", 500)                 # tramos de una página, para forzar el corte
    tramos = F.preparar(bases_largas())["tramos"]
    assert len(tramos) >= 4
    del_factor = next(t for t in tramos if t["pag_ini"] == 12)
    # La proforma empieza después de los factores de evaluación: el rastro lo dice aunque el título quedó atrás.
    assert "FACTORES DE EVALUACION" in del_factor["texto"].splitlines()[0]
    assert [t["con_generalidades"] for t in tramos].count(True) == 1 and tramos[0]["con_generalidades"]


def test_al_juntar_la_cuantia_solo_sale_del_tramo_de_las_generalidades():
    uno = {"cuantia": {"estado": "reservada", "valor": None, "moneda": None, "pagina": 4, "cita": "no dar a conocer"},
           "objeto": "Servicio de limpieza", "requisitos_calificacion": [{"tipo": "experiencia_postor", "requisito": "Monto facturado", "para": "general"}],
           "resumen_tramo": "Generalidades."}
    # Un tramo posterior que «ve» una cuantía donde hay un monto de experiencia adicional: no se acepta.
    dos = {"cuantia": {"estado": "publica", "valor": 24978592.5, "moneda": "PEN", "pagina": 44, "cita": "S/ 24,978,592.50"},
           "objeto": "Otra cosa", "sistema_contratacion": "Suma alzada",
           "requisitos_calificacion": [{"tipo": "experiencia_postor", "requisito": "Monto facturado", "para": "general"},
                                       {"tipo": "experiencia_postor", "requisito": "Monto facturado", "para": "mype"}],
           "factores_evaluacion": [{"factor": "Experiencia adicional", "monto": 24978592.5}], "resumen_tramo": "Factores."}
    f = F.juntar([uno, None, dos], [{"con_generalidades": True}, {"con_generalidades": False}, {"con_generalidades": False}])
    assert f["cuantia"]["estado"] == "reservada" and f["cuantia"]["valor"] is None
    assert f["objeto"] == "Servicio de limpieza" and f["sistema_contratacion"] == "Suma alzada"
    assert [r["para"] for r in f["requisitos_calificacion"]] == ["general", "mype"]        # sin repetir el de los dos tramos
    assert f["factores_evaluacion"][0]["monto"] == 24978592.5 and f["resumen"] == "Generalidades. Factores."


def test_las_citas_se_buscan_en_el_texto():
    ficha = {"cuantia": {"cita": "asciende a S/ 100,000.00"}, "penalidades": [{"cita": "esto no está en el documento"}, {"cita": ""}]}
    r = F.revisar_citas(ficha, "la cuantia asciende a s 100 000 00 incluidos los impuestos", lambda c, t: " ".join(c.lower().replace("/", " ").replace(",", " ").replace(".", " ").split()) in t)
    assert (r["total"], r["en_texto"], r["fallas"]) == (2, 1, ["penalidades[0]"])


def test_el_texto_corrido_lleva_una_marca_por_pagina_y_por_archivo():
    paginas = [{"n": 1, "texto": "uno", "archivo": "a.pdf"}, {"n": 2, "texto": "dos", "archivo": "b.pdf"}]
    assert transcribir.armar_texto(paginas) == "⟦archivo: a.pdf⟧\n⟦p.1⟧\nuno\n⟦archivo: b.pdf⟧\n⟦p.2⟧\ndos"
    assert transcribir.armar_texto([{"n": 1, "texto": "solo", "archivo": "x.pdf"}]) == "⟦p.1⟧\nsolo"


def test_la_pieza_de_un_zip_se_saca_por_su_nombre():
    z = io.BytesIO()
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("Bases/bases integradas.pdf", b"%PDF-uno")
        f.writestr("Bases/presupuesto.xlsx", b"no es pdf")
        f.writestr("otro.pdf", b"%PDF-dos")
    assert transcribir.pdf_de_la_pieza(z.getvalue(), "zip", "Bases/bases integradas.pdf") == b"%PDF-uno"
    assert transcribir.pdf_de_la_pieza(z.getvalue(), "zip", "otro.pdf") == b"%PDF-dos"
    assert transcribir.pdf_de_la_pieza(z.getvalue(), "zip", "no-existe.pdf") is None
    assert transcribir.pdf_de_la_pieza(b"%PDF-suelto", "pdf", "") == b"%PDF-suelto"


def test_el_texto_de_un_pdf_y_cuando_puede_reutilizarlo_un_agente():
    fitz = pytest.importorskip("fitz")

    def pdf(textos: list[str]) -> bytes:
        doc = fitz.open()
        for t in textos:
            pagina = doc.new_page()
            if t:
                pagina.insert_textbox(fitz.Rect(40, 40, 550, 800), t, fontsize=9)
        return doc.tobytes()

    largo = "Cláusula primera del contrato de prueba. " * 12
    completo = texto.extraer(pdf([largo, largo]), "pdf", "Contrato.pdf")
    assert completo["n_paginas"] == 2 and completo["escaneadas"] == 0 and completo["version_parser"] == "texto-v1"
    assert completo["texto"].startswith("⟦p.1⟧") and "⟦archivo" not in completo["texto"]
    # Con una página sin texto (un escaneo) el agente no debe tomarlo como su caché: hará su propia lectura.
    con_escaneo = texto.extraer(pdf([largo, ""]), "pdf", "Contrato.pdf")
    assert con_escaneo["escaneadas"] == 1 and con_escaneo["version_parser"] == "lector-v1"
    assert any(r["donde"] == "escaneo_sin_transcribir" for r in con_escaneo["recortes"])
    # Un ZIP: cada PDF con su nombre, lo que no es PDF queda anotado, y nunca se marca como caché del agente.
    z = io.BytesIO()
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("1Acta.pdf", pdf([largo]))
        f.writestr("presupuesto.xlsx", b"x")
    en_zip = texto.extraer(z.getvalue(), "zip", "Otorgamiento.pdf")
    assert [p["archivo"] for p in en_zip["paginas"]] == ["1Acta.pdf"] and en_zip["version_parser"] == "lector-v1"
    assert any(r["limite"] == "no_es_pdf" for r in en_zip["recortes"])
    assert texto.extraer(b"esto no es un pdf", "pdf", "x.pdf")["n_paginas"] == 0
