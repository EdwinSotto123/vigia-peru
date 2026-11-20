"""Las resoluciones del Tribunal en el contexto del analista legal (tools/lecturas.py, 2026-11-20): el resultado sólo si
está comprobado, las empresas con su papel y la marca de «corregido otra vez» (dos correcciones a 7 días o más)."""
from tools.lecturas import lecturas_para_legal, tribunal_de_filas


def _fila(titulo, fecha, resultado, corrigio, partes="[]", cita=None):
    return (titulo, fecha, resultado, ["revoca_buena_pro"] if corrigio else [], corrigio, "El comité descalificó mal.",
            cita, [], f"https://www.gob.pe/{titulo}", partes)


def test_resultado_y_papel():
    r = tribunal_de_filas([
        _fila("Resolución N.° 1-2026-TCP-S1", "2026-05-01", "fundado", True,
              '[{"ruc": "20100000001", "rol": "adjudicatario", "nombre": "A S.A.C."},'
              ' {"ruc": "20100000001", "rol": "sancionador", "nombre": "A S.A.C."}]', cita="Declarar FUNDADO"),
    ])
    assert r[0]["resultado"] == "fundado" and r[0]["corrigio"] is True and r[0]["cita"] == "Declarar FUNDADO"
    assert [e["papel"] for e in r[0]["empresas"]] == ["tenía la buena pro", "sancionador ordenado"]
    assert "corregido_otra_vez" not in r[0]


def test_sin_resultado_comprobado_queda_none():
    r = tribunal_de_filas([_fila("Resolución N.° 2-2026-TCP-S2", "2026-06-01", None, False)])
    assert r[0]["resultado"] is None and r[0]["corrigio"] is False and r[0]["empresas"] == []


def test_corregido_otra_vez_solo_con_rondas_separadas():
    # El mismo día (ítems paralelos): no es otra ronda.
    mismo_dia = tribunal_de_filas([_fila("R1", "2026-06-01", "fundado", True), _fila("R2", "2026-06-01", "fundado", True)])
    assert not any(x.get("corregido_otra_vez") for x in mismo_dia)
    # Un mes después: el comité volvió a decidir y el Tribunal lo corrigió otra vez.
    rondas = tribunal_de_filas([_fila("R1", "2026-06-01", "fundado", True), _fila("R2", "2026-07-05", "nulidad_de_oficio", True)])
    assert all(x.get("corregido_otra_vez") for x in rondas)
    # Una infundada en medio no cuenta como corrección.
    una = tribunal_de_filas([_fila("R1", "2026-06-01", "fundado", True), _fila("R2", "2026-07-05", "infundado", False)])
    assert not any(x.get("corregido_otra_vez") for x in una)


def test_lecturas_para_legal_no_pisa_el_tribunal():
    # lecturas_para_legal arma las lecturas; el Tribunal se suma aparte en el state y no debe perderse ni colarse.
    assert "tribunal" not in lecturas_para_legal({})
