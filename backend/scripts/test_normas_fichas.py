"""Pruebas del conversor de normas a fichas (normas_fichas.py): sin archivos ni red.

    python -m pytest backend/scripts/test_normas_fichas.py -q
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import normas_fichas as F  # noqa: E402

LEY = """LEY Nº 99999
EL CONGRESO DE LA REPÚBLICA ha dado la Ley siguiente, con una parte considerativa que no tiene artículos pero sí bastante texto para
que supere el mínimo de caracteres que se exige antes de considerarla un trozo aparte del primer artículo de la norma, y que por eso
se guarda como parte considerativa. Otra línea más de relleno para pasar el umbral de cuatrocientos caracteres que usa el cortador.
Y otra línea adicional de relleno que no dice nada pero suma caracteres al preámbulo de esta ley de prueba.

Artículo 1. Objeto
La presente ley regula las contrataciones de prueba de las entidades públicas del Estado.

Artículo 2. Ámbito
2.1. Se aplica a todas las entidades.
2.2. Se cita aquí el «Artículo 150» de otra norma dentro del texto, que no debe abrir un artículo nuevo.

DISPOSICIONES COMPLEMENTARIAS FINALES

PRIMERA. Vigencia
La presente ley rige desde el día siguiente de su publicación en el diario oficial.

SEGUNDA. Reglamento
El Poder Ejecutivo aprueba el reglamento en un plazo de noventa días calendario.
"""


def test_una_ley_se_corta_por_articulo_y_por_disposicion():
    fr = F.fragmentos([LEY], "Ley N° 99999", "ley")
    arts = [f["articulo"] for f in fr]
    assert arts == [None, "1", "2", "DCF-1", "DCF-2"]
    assert fr[0]["epigrafe"] == "Parte considerativa"
    assert fr[1]["epigrafe"] == "Objeto" and fr[1]["texto"].startswith("Ley N° 99999 — Artículo 1 — Objeto\n")
    assert "Artículo 150" in fr[2]["texto"]                         # la cita se queda dentro del artículo 2
    assert fr[3]["texto"].startswith("Ley N° 99999 — Primera Disposición Complementaria Final")


def test_un_articulo_largo_se_parte_y_conserva_su_numero():
    cuerpo = "\n\n".join(f"{i}.1. " + "Texto del numeral con contenido suficiente. " * 12 for i in range(1, 9))
    fr = F.fragmentos([f"Artículo 7. Largo\n{cuerpo}\n\nArtículo 8. Corto\nUn artículo breve pero con el texto mínimo necesario para entrar."], "D.S. X", "reglamento")
    del_7 = [f for f in fr if f["articulo"] == "7"]
    assert len(del_7) >= 2 and all(len(f["texto"]) < 3200 for f in del_7)
    assert "(parte 1 de" in del_7[0]["texto"] and all(f["epigrafe"] == "Largo" for f in del_7)


def test_una_directiva_se_corta_por_numeral_con_su_seccion():
    t = "V. DISPOSICIONES GENERALES\n" + "\n".join(f"5.{i} La entidad cumple la obligación número {i} dentro del plazo previsto en esta directiva." for i in range(1, 5)) \
        + "\nVI. DISPOSICIONES ESPECÍFICAS\n" + "\n".join(f"6.{i} El área usuaria registra la información número {i} en el sistema informático." for i in range(1, 5))
    fr = F.fragmentos([t], "Directiva N° 001-2025-OECE-CD", "directiva")
    assert [f["articulo"] for f in fr] == ["5.1", "5.2", "5.3", "5.4", "6.1", "6.2", "6.3", "6.4"]
    assert fr[0]["epigrafe"] == "Disposiciones Generales" and fr[4]["epigrafe"] == "Disposiciones Específicas"
    assert fr[0]["texto"].startswith("Directiva N° 001-2025-OECE-CD — Numeral 5.1 — Disposiciones Generales")


def test_el_mismo_slug_venga_de_la_descarga_que_venga():
    assert F.slug_de("Directiva N° 001-2025-OECE-CD", "A-DIR-001-2025") == "directiva-001-2025-oece-cd"
    assert F.slug_de("DIR-OECE-001-2025", "DIR-OECE-001-2025") == "directiva-001-2025-oece-cd"
    assert F.slug_de("CAT-LIN-001-2025-OECE-CD-V2", "CAT-LIN-001-2025-OECE-CD-V2") == "lineamiento-001-2025-oece-cd"
    assert F.slug_de("D.S. N° 009-2025-EF") == "ds-009-2025-ef" and F.slug_de("Ley 31589 (via TUO D.S. 206-2024-EF)") == "ley-31589"
    assert F.slug_de("R.D. 00016-2026-EF/54.01") == "rd-0016-2026-ef-54-01"
    assert F.slug_de("Acuerdo de Sala Plena 002-2025/TCP") == "acuerdo-sala-plena-002-2025-tcp"


def test_regimen_materia_y_vigencia():
    d = F.clasificar({"id": "A-DIR-003-2025", "identificador": "Directiva N° 003-2025-OECE-CD", "tipo_documento": "Directiva", "version_fecha": "2025-04-19"})
    assert (d["tipo"], d["regimen"], d["materia"], d["vigencia_desde"]) == ("directiva", "32069", "contrataciones", "2025-04-22")
    d = F.clasificar({"id": "D-N1-DL1057", "identificador": "D.L. N° 1057", "fecha_publicacion": "2008-06-28"})
    assert (d["tipo"], d["regimen"], d["materia"]) == ("ley", "ambos", "empleo_publico")
    d = F.clasificar({"id": "G-N2-DS168-2020-EF", "identificador": "D.S. N° 168-2020-EF", "fecha_publicacion": "2020-06-30"})
    assert (d["tipo"], d["regimen"], d["vigencia_hasta"]) == ("reglamento", "30225", "2025-04-21")
    # La fecha de una opinión es la de su año: la otra suele ser una fecha citada en el texto.
    d = F.clasificar({"id": "OPINION-D000107-2026", "identificador": "Opinión D000107-2026-OECE-DTN", "tipo": "opinion", "regimen": "32069",
                      "fecha_emision": "2019-01-30", "fecha_publicacion": "2026-10-01"})
    assert (d["tipo"], d["regimen"], d["fecha_emision"]) == ("opinion", "32069", "2026-10-01")
    d = F.clasificar({"id": "ACUERDO-002-2023-TCE", "identificador": "Acuerdo de Sala Plena 002-2023/TCE", "tipo": "acuerdo_sala_plena", "fecha_publicacion": "2023-12-02"})
    assert (d["tipo"], d["regimen"]) == ("acuerdo_sala_plena", "30225")


OPINION = """OPINIÓN Nº D000099-2026-OECE-DTN
Entidad: Municipalidad de prueba
ASUNTO
: Fraccionamiento en contratos menores

Referencia: Formulario S/N de fecha 01.09.2026

1.
ANTECEDENTES
Mediante el documento de la referencia, la entidad formula varias consultas sobre el fraccionamiento de las contrataciones.

2.
CONSULTA1 Y ANÁLISIS
2.1 La entidad pregunta si dos órdenes de servicio del mismo objeto en el mismo año configuran fraccionamiento prohibido.
Sobre el particular, corresponde señalar que el artículo 50 de la Ley establece los supuestos de fraccionamiento.

3. CONCLUSIONES
3.1 La contratación del mismo objeto mediante varias órdenes en el mismo ejercicio puede configurar fraccionamiento.
3.2 No hay fraccionamiento cuando la necesidad surge de manera imprevisible con posterioridad a la primera contratación.

Jesús María, 28 de septiembre de 2026
Firmado digitalmente por la Directora Técnico Normativa
"""


def test_una_opinion_deja_cada_conclusion_como_fragmento():
    fr = F.fragmentos([OPINION], "Opinión D000099-2026-OECE-DTN (28-09-2026)", "opinion")
    epis = [f["epigrafe"] for f in fr]
    de = ": Fraccionamiento en contratos menores"
    assert epis == ["Asunto" + de, "Antecedentes" + de, "Consultas y análisis" + de, "Conclusión 3.1" + de, "Conclusión 3.2" + de]
    assert fr[3]["texto"].startswith("Opinión D000099-2026-OECE-DTN (28-09-2026) — Conclusión 3.1: Fraccionamiento en contratos menores\n3.1 La contratación")
    assert "Firmado digitalmente" not in fr[4]["texto"] and "imprevisible" in fr[4]["texto"]
    # Sin la estructura de siempre se corta por párrafos, como antes.
    assert F.cortar_opinion("Un texto cualquiera sin secciones numeradas de opinión.") is None

